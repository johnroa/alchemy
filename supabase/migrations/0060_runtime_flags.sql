create table if not exists public.feature_flag_environments (
  environment_key text primary key
    check (environment_key in ('development', 'production')),
  label text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.feature_flag_environments is
  'Runtime feature-flag environments. Seeded with development and production.';

create table if not exists public.feature_flags (
  id uuid primary key default gen_random_uuid(),
  flag_key text not null unique
    check (flag_key ~ '^[a-z0-9][a-z0-9._-]*$'),
  name text not null,
  description text not null default '',
  flag_type text not null
    check (flag_type in ('release', 'operational', 'kill_switch', 'permission')),
  owner text not null,
  tags text[] not null default '{}'::text[],
  expires_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.feature_flags is
  'Global runtime feature flag registry shared across environments.';

create index if not exists idx_feature_flags_archived_at
  on public.feature_flags (archived_at, flag_key);

create index if not exists idx_feature_flags_tags
  on public.feature_flags using gin (tags);

create table if not exists public.feature_flag_environment_configs (
  flag_id uuid not null references public.feature_flags(id) on delete cascade,
  environment_key text not null references public.feature_flag_environments(environment_key) on delete cascade,
  enabled boolean not null default false,
  payload_json jsonb,
  revision bigint not null default 1 check (revision >= 1),
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (flag_id, environment_key),
  check (payload_json is null or jsonb_typeof(payload_json) = 'object')
);

comment on table public.feature_flag_environment_configs is
  'Per-environment runtime configuration for each feature flag.';

create index if not exists idx_feature_flag_environment_configs_environment_key
  on public.feature_flag_environment_configs (environment_key, enabled);

create table if not exists public.feature_flag_state_revisions (
  environment_key text primary key references public.feature_flag_environments(environment_key) on delete cascade,
  revision bigint not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now()
);

comment on table public.feature_flag_state_revisions is
  'Per-environment cache invalidation revision for compiled runtime flag state.';

create or replace function public.set_feature_flag_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.bump_feature_flag_config_revision()
returns trigger
language plpgsql
as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.bump_feature_flag_state_revision(
  target_environment_key text
)
returns void
language sql
as $$
  update public.feature_flag_state_revisions
  set
    revision = revision + 1,
    updated_at = now()
  where environment_key = target_environment_key;
$$;

create or replace function public.bump_feature_flag_state_revision_from_config()
returns trigger
language plpgsql
as $$
declare
  target_environment text;
begin
  target_environment := coalesce(new.environment_key, old.environment_key);
  perform public.bump_feature_flag_state_revision(target_environment);
  return coalesce(new, old);
end;
$$;

create or replace function public.bump_feature_flag_state_revision_all()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and
     new.flag_key is not distinct from old.flag_key and
     new.flag_type is not distinct from old.flag_type and
     new.archived_at is not distinct from old.archived_at then
    return new;
  end if;

  update public.feature_flag_state_revisions
  set
    revision = revision + 1,
    updated_at = now();

  return coalesce(new, old);
end;
$$;

drop trigger if exists feature_flags_set_updated_at on public.feature_flags;
create trigger feature_flags_set_updated_at
before update on public.feature_flags
for each row
execute function public.set_feature_flag_updated_at();

drop trigger if exists feature_flag_environment_configs_set_updated_at on public.feature_flag_environment_configs;
create trigger feature_flag_environment_configs_set_updated_at
before update on public.feature_flag_environment_configs
for each row
execute function public.set_feature_flag_updated_at();

drop trigger if exists feature_flag_environment_configs_bump_revision on public.feature_flag_environment_configs;
create trigger feature_flag_environment_configs_bump_revision
before update on public.feature_flag_environment_configs
for each row
execute function public.bump_feature_flag_config_revision();

drop trigger if exists feature_flag_environment_configs_bump_state on public.feature_flag_environment_configs;
create trigger feature_flag_environment_configs_bump_state
after insert or update or delete on public.feature_flag_environment_configs
for each row
execute function public.bump_feature_flag_state_revision_from_config();

drop trigger if exists feature_flags_bump_state on public.feature_flags;
create trigger feature_flags_bump_state
after update on public.feature_flags
for each row
execute function public.bump_feature_flag_state_revision_all();

alter table public.feature_flag_environments enable row level security;
alter table public.feature_flags enable row level security;
alter table public.feature_flag_environment_configs enable row level security;
alter table public.feature_flag_state_revisions enable row level security;

insert into public.feature_flag_environments (
  environment_key,
  label,
  description
)
values
  (
    'development',
    'Development',
    'Local and non-production runtime flag values.'
  ),
  (
    'production',
    'Production',
    'Live runtime flag values served to production traffic.'
  )
on conflict (environment_key) do update
set
  label = excluded.label,
  description = excluded.description,
  updated_at = now();

insert into public.feature_flag_state_revisions (
  environment_key,
  revision
)
select
  environment_key,
  1
from public.feature_flag_environments
on conflict (environment_key) do nothing;

insert into public.feature_flags (
  flag_key,
  name,
  description,
  flag_type,
  owner,
  tags
)
values
  (
    'recipe_canon_match',
    'Recipe Canon Match',
    'Controls ambiguous canon matching for canonical recipe persistence.',
    'operational',
    'backend',
    array['recipes', 'canon', 'rollout']
  ),
  (
    'same_canon_image_judge',
    'Same Canon Image Judge',
    'Controls judge-based reuse within an existing recipe canon family.',
    'operational',
    'backend',
    array['images', 'canon', 'rollout']
  )
on conflict (flag_key) do update
set
  name = excluded.name,
  description = excluded.description,
  flag_type = excluded.flag_type,
  owner = excluded.owner,
  tags = excluded.tags,
  updated_at = now();

insert into public.feature_flag_environment_configs (
  flag_id,
  environment_key,
  enabled,
  payload_json,
  updated_by
)
select
  f.id,
  e.environment_key,
  false,
  case
    when f.flag_key = 'recipe_canon_match'
      then jsonb_build_object('mode', 'shadow')
    else null
  end,
  'migration:0060_runtime_flags'
from public.feature_flags f
cross join public.feature_flag_environments e
where f.flag_key in ('recipe_canon_match', 'same_canon_image_judge')
on conflict (flag_id, environment_key) do update
set
  updated_by = excluded.updated_by;
