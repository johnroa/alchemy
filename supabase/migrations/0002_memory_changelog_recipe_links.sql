-- Alchemy V1 expansion: standardized changelog, memory lifecycle, recipe links, and image pipeline.

alter table public.recipes
  add column if not exists image_status text not null default 'pending' check (image_status in ('pending', 'ready', 'failed')),
  add column if not exists image_updated_at timestamptz,
  add column if not exists image_last_error text,
  add column if not exists image_generation_attempts int not null default 0 check (image_generation_attempts >= 0);

alter table public.memories
  add column if not exists memory_kind text not null default 'preference',
  add column if not exists salience numeric(5,4) not null default 0.5000 check (salience between 0 and 1),
  add column if not exists status text not null default 'active' check (status in ('active', 'superseded', 'deleted')),
  add column if not exists supersedes_memory_id uuid references public.memories(id) on delete set null,
  add column if not exists source_event_id uuid references public.events(id) on delete set null;

create table if not exists public.memory_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  summary jsonb not null default '{}'::jsonb,
  token_estimate int not null default 0 check (token_estimate >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create table if not exists public.memory_recipe_links (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references public.memories(id) on delete cascade,
  recipe_id uuid references public.recipes(id) on delete cascade,
  recipe_version_id uuid references public.recipe_versions(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (recipe_id is not null or recipe_version_id is not null),
  unique (memory_id, recipe_id, recipe_version_id)
);

create table if not exists public.recipe_links (
  id uuid primary key default gen_random_uuid(),
  parent_recipe_id uuid not null references public.recipes(id) on delete cascade,
  child_recipe_id uuid not null references public.recipes(id) on delete cascade,
  relation_type_id uuid not null references public.graph_relation_types(id) on delete restrict,
  position int not null default 0,
  source text not null default 'llm',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (parent_recipe_id, child_recipe_id, relation_type_id),
  check (parent_recipe_id <> child_recipe_id)
);

create index if not exists recipe_links_parent_idx on public.recipe_links(parent_recipe_id, position asc);
create index if not exists recipe_links_child_idx on public.recipe_links(child_recipe_id);

create table if not exists public.recipe_image_jobs (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'ready', 'failed')),
  attempt int not null default 0 check (attempt >= 0),
  max_attempts int not null default 5 check (max_attempts >= 1),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists recipe_image_jobs_unique_open on public.recipe_image_jobs(recipe_id)
where status in ('pending', 'processing');

create index if not exists recipe_image_jobs_poll_idx on public.recipe_image_jobs(status, next_attempt_at asc);

create table if not exists public.recipe_version_events (
  id uuid primary key default gen_random_uuid(),
  recipe_version_id uuid not null references public.recipe_versions(id) on delete cascade,
  event_type text not null,
  request_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.changelog_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.users(id) on delete set null,
  scope text not null,
  entity_type text not null,
  entity_id text,
  action text not null,
  request_id uuid,
  before_json jsonb,
  after_json jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists changelog_events_created_idx on public.changelog_events(created_at desc);
create index if not exists changelog_events_scope_idx on public.changelog_events(scope, created_at desc);
create index if not exists changelog_events_entity_idx on public.changelog_events(entity_type, entity_id, created_at desc);
create index if not exists changelog_events_actor_idx on public.changelog_events(actor_user_id, created_at desc);
create index if not exists changelog_events_request_idx on public.changelog_events(request_id);

create or replace view public.v_changelog_recent as
select
  ce.id,
  ce.created_at,
  ce.scope,
  ce.entity_type,
  ce.entity_id,
  ce.action,
  ce.request_id,
  ce.actor_user_id,
  u.email as actor_email
from public.changelog_events ce
left join public.users u on u.id = ce.actor_user_id
order by ce.created_at desc;

create or replace view public.v_memory_health_rollup as
select
  date_trunc('hour', m.created_at) as hour_bucket,
  count(*) filter (where m.status = 'active') as active_count,
  count(*) filter (where m.status = 'superseded') as superseded_count,
  avg(m.salience)::numeric(6,4) as avg_salience,
  avg(m.confidence)::numeric(6,4) as avg_confidence
from public.memories m
group by 1
order by 1 desc;

create or replace view public.v_image_pipeline_rollup as
select
  date_trunc('hour', created_at) as hour_bucket,
  count(*) filter (where status = 'pending') as pending_count,
  count(*) filter (where status = 'processing') as processing_count,
  count(*) filter (where status = 'ready') as ready_count,
  count(*) filter (where status = 'failed') as failed_count,
  avg(attempt)::numeric(6,2) as avg_attempt
from public.recipe_image_jobs
group by 1
order by 1 desc;

create or replace function public.log_changelog_event(
  p_actor_user_id uuid,
  p_scope text,
  p_entity_type text,
  p_entity_id text,
  p_action text,
  p_request_id uuid,
  p_before_json jsonb,
  p_after_json jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.changelog_events(
    actor_user_id,
    scope,
    entity_type,
    entity_id,
    action,
    request_id,
    before_json,
    after_json,
    metadata
  )
  values (
    p_actor_user_id,
    p_scope,
    p_entity_type,
    p_entity_id,
    p_action,
    p_request_id,
    p_before_json,
    p_after_json,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

insert into public.graph_relation_types(name, description)
values
  ('is_appetizer_of', 'Entity can be served as an appetizer of another entity'),
  ('is_dessert_of', 'Entity can be served as a dessert of another entity')
on conflict (name) do nothing;

insert into public.llm_model_routes(scope, route_name, provider, model, config, is_active)
values
  ('memory_extract', 'memory_extract_route', 'openai', 'gpt-4.1-mini', '{"temperature":0.2}'::jsonb, true),
  ('memory_select', 'memory_select_route', 'openai', 'gpt-4.1-mini', '{"temperature":0.1}'::jsonb, true),
  ('memory_summarize', 'memory_summarize_route', 'openai', 'gpt-4.1-mini', '{"temperature":0.2}'::jsonb, true),
  ('memory_conflict_resolve', 'memory_conflict_route', 'openai', 'gpt-4.1-mini', '{"temperature":0.2}'::jsonb, true)
on conflict (scope, route_name) do nothing;

insert into public.llm_prompts(scope, version, name, template, is_active)
values
  (
    'memory_extract',
    1,
    'default_memory_extract_prompt',
    'Extract durable cooking preferences and contextual memory candidates from the interaction. Return strict JSON with memory candidates, each with kind, content, salience, confidence, and reason.',
    true
  ),
  (
    'memory_select',
    1,
    'default_memory_select_prompt',
    'Select the most relevant memories for the next response given user prompt, preferences, and thread context. Return strict JSON with selected memory ids and rationale.',
    true
  ),
  (
    'memory_summarize',
    1,
    'default_memory_summarize_prompt',
    'Summarize active user memory into compact structured JSON optimized for prompt context injection while preserving important details.',
    true
  ),
  (
    'memory_conflict_resolve',
    1,
    'default_memory_conflict_prompt',
    'Resolve conflicting memory candidates intelligently and return actions: keep, supersede, delete, or merge with explanation.',
    true
  )
on conflict (scope, version) do nothing;

insert into public.llm_rules(scope, version, name, rule, is_active)
values
  (
    'memory_extract',
    1,
    'memory_extract_rule',
    '{"max_candidates":8,"minimum_confidence":0.35}'::jsonb,
    true
  ),
  (
    'memory_select',
    1,
    'memory_select_rule',
    '{"max_selected":10,"prefer_recent":true}'::jsonb,
    true
  ),
  (
    'memory_summarize',
    1,
    'memory_summarize_rule',
    '{"target_token_budget":900}'::jsonb,
    true
  ),
  (
    'memory_conflict_resolve',
    1,
    'memory_conflict_rule',
    '{"allow_supersede":true,"allow_merge":true}'::jsonb,
    true
  )
on conflict (scope, version) do nothing;

alter table public.memory_snapshots enable row level security;
alter table public.memory_recipe_links enable row level security;
alter table public.recipe_links enable row level security;
alter table public.recipe_image_jobs enable row level security;
alter table public.recipe_version_events enable row level security;
alter table public.changelog_events enable row level security;

create policy memory_snapshots_owner_rw on public.memory_snapshots
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy memory_recipe_links_owner_read on public.memory_recipe_links
  for select
  using (
    exists (
      select 1
      from public.memories m
      where m.id = memory_id
        and m.user_id = auth.uid()
    )
  );

create policy recipe_links_visible_read on public.recipe_links
  for select
  using (
    exists (
      select 1 from public.recipes r
      where r.id = parent_recipe_id
        and (r.owner_user_id = auth.uid() or r.visibility = 'public')
    )
    and exists (
      select 1 from public.recipes r
      where r.id = child_recipe_id
        and (r.owner_user_id = auth.uid() or r.visibility = 'public')
    )
  );

create policy recipe_links_owner_write on public.recipe_links
  for all
  using (
    exists (
      select 1 from public.recipes r
      where r.id = parent_recipe_id
        and r.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.recipes r
      where r.id = parent_recipe_id
        and r.owner_user_id = auth.uid()
    )
  );

create policy recipe_image_jobs_owner_read on public.recipe_image_jobs
  for select
  using (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_id
        and (r.owner_user_id = auth.uid() or r.visibility = 'public')
    )
  );

create policy recipe_version_events_visible_read on public.recipe_version_events
  for select
  using (
    exists (
      select 1
      from public.recipe_versions rv
      join public.recipes r on r.id = rv.recipe_id
      where rv.id = recipe_version_id
        and (r.owner_user_id = auth.uid() or r.visibility = 'public')
    )
  );

create policy changelog_events_owner_read on public.changelog_events
  for select
  using (actor_user_id = auth.uid());

