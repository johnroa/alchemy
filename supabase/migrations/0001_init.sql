-- Alchemy V1 core schema
-- All business behavior is data-driven through llm_prompts, llm_rules, and llm_model_routes.

create extension if not exists pgcrypto;

-- Core profile table linked to Supabase auth.
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  free_form text,
  dietary_preferences text[] not null default '{}',
  dietary_restrictions text[] not null default '{}',
  skill_level text not null default 'intermediate',
  equipment text[] not null default '{}',
  cuisines text[] not null default '{}',
  aversions text[] not null default '{}',
  cooking_for text,
  max_difficulty int not null default 3 check (max_difficulty between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  hero_image_url text,
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  source_draft_id uuid,
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recipe_versions (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  parent_version_id uuid references public.recipe_versions(id) on delete set null,
  payload jsonb not null,
  diff_summary text,
  provenance jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.recipes
  add constraint recipes_current_version_fk
  foreign key (current_version_id)
  references public.recipe_versions(id)
  on delete set null;

create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, name)
);

create table if not exists public.collection_items (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (collection_id, recipe_id)
);

create table if not exists public.recipe_saves (
  user_id uuid not null references public.users(id) on delete cascade,
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);

create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  memory_type text not null,
  memory_content jsonb not null,
  confidence numeric(5,4) not null default 0.5000 check (confidence between 0 and 1),
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  event_type text not null,
  event_payload jsonb not null default '{}'::jsonb,
  request_id uuid,
  latency_ms int,
  token_input int,
  token_output int,
  token_total int,
  cost_usd numeric(12,6),
  safety_state text,
  created_at timestamptz not null default now()
);

create table if not exists public.llm_prompts (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  version int not null,
  name text not null,
  template text not null,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default false,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (scope, version)
);

create unique index if not exists llm_prompts_active_scope_unique
  on public.llm_prompts(scope)
  where is_active = true;

create table if not exists public.llm_rules (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  version int not null,
  name text not null,
  rule jsonb not null,
  is_active boolean not null default false,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (scope, version)
);

create unique index if not exists llm_rules_active_scope_unique
  on public.llm_rules(scope)
  where is_active = true;

create table if not exists public.llm_model_routes (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  route_name text not null,
  provider text not null,
  model text not null,
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (scope, route_name)
);

create unique index if not exists llm_model_routes_active_scope_unique
  on public.llm_model_routes(scope)
  where is_active = true;

create table if not exists public.graph_entities (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  label text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_type, label)
);

create table if not exists public.graph_relation_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.graph_edges (
  id uuid primary key default gen_random_uuid(),
  from_entity_id uuid not null references public.graph_entities(id) on delete cascade,
  to_entity_id uuid not null references public.graph_entities(id) on delete cascade,
  relation_type_id uuid not null references public.graph_relation_types(id) on delete restrict,
  source text not null,
  confidence numeric(5,4) not null default 0.5000 check (confidence between 0 and 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (from_entity_id, to_entity_id, relation_type_id, source)
);

create index if not exists graph_edges_from_idx on public.graph_edges(from_entity_id);
create index if not exists graph_edges_to_idx on public.graph_edges(to_entity_id);
create index if not exists graph_edges_relation_idx on public.graph_edges(relation_type_id);

create table if not exists public.recipe_graph_links (
  recipe_version_id uuid not null references public.recipe_versions(id) on delete cascade,
  entity_id uuid not null references public.graph_entities(id) on delete cascade,
  primary key (recipe_version_id, entity_id)
);

create table if not exists public.recipe_auto_categories (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  category text not null,
  confidence numeric(5,4) not null default 0.5000 check (confidence between 0 and 1),
  source text not null,
  created_at timestamptz not null default now(),
  unique (recipe_id, category)
);

create table if not exists public.recipe_user_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  category text not null,
  created_at timestamptz not null default now(),
  unique (user_id, recipe_id, category)
);

create table if not exists public.explore_publications (
  recipe_id uuid primary key references public.recipes(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'hidden', 'flagged')),
  ranking_features jsonb not null default '{}'::jsonb,
  moderation_notes text,
  updated_at timestamptz not null default now()
);

create table if not exists public.recipe_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'finalized', 'archived')),
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recipe_draft_messages (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.recipe_drafts(id) on delete cascade,
  role text not null check (role in ('system', 'user', 'assistant')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists recipe_draft_messages_draft_idx
  on public.recipe_draft_messages(draft_id, created_at asc);

-- Views for admin analytics.
create or replace view public.v_recipe_version_diff_meta as
select
  rv.id as version_id,
  rv.recipe_id,
  rv.parent_version_id,
  rv.diff_summary,
  rv.created_by,
  rv.created_at,
  jsonb_array_length(coalesce(rv.payload -> 'ingredients', '[]'::jsonb)) as ingredient_count,
  jsonb_array_length(coalesce(rv.payload -> 'steps', '[]'::jsonb)) as step_count
from public.recipe_versions rv;

create or replace view public.v_llm_cost_latency_rollup as
select
  date_trunc('hour', created_at) as hour_bucket,
  event_payload ->> 'scope' as scope,
  count(*) as request_count,
  avg(latency_ms)::int as avg_latency_ms,
  sum(coalesce(cost_usd, 0)) as total_cost_usd,
  sum(coalesce(token_total, 0)) as total_tokens
from public.events
where event_type = 'llm_call'
group by 1, 2;

create or replace view public.v_abuse_rate_limit_flags as
select
  id,
  user_id,
  created_at,
  event_payload ->> 'reason' as reason,
  event_payload ->> 'severity' as severity,
  event_payload ->> 'scope' as scope
from public.events
where event_type in ('abuse_flag', 'rate_limit_flag');

-- Admin functions.
create or replace function public.admin_deactivate_user(target_user_id uuid, reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users
  set status = 'disabled', updated_at = now()
  where id = target_user_id;

  insert into public.events (user_id, event_type, event_payload)
  values (target_user_id, 'admin_deactivate_user', jsonb_build_object('reason', reason));
end;
$$;

create or replace function public.admin_reset_user_memory(target_user_id uuid, reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.memories where user_id = target_user_id;

  insert into public.events (user_id, event_type, event_payload)
  values (target_user_id, 'admin_reset_user_memory', jsonb_build_object('reason', reason));
end;
$$;

create or replace function public.admin_revert_recipe_version(target_recipe_id uuid, target_version_id uuid, actor_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.recipes
  set current_version_id = target_version_id,
      updated_at = now()
  where id = target_recipe_id;

  insert into public.events (user_id, event_type, event_payload)
  values (
    actor_id,
    'admin_revert_recipe_version',
    jsonb_build_object('recipe_id', target_recipe_id, 'target_version_id', target_version_id)
  );
end;
$$;

-- Seed relation types for graph traversal semantics.
insert into public.graph_relation_types(name, description)
values
  ('is_a_side_of', 'Entity can be served as a side of another entity'),
  ('pairs_with', 'Entity pairs well with another entity'),
  ('contains_ingredient', 'Recipe contains ingredient entity'),
  ('substitutes_for', 'Entity can substitute for another entity')
on conflict (name) do nothing;

-- Seed adaptive routing placeholders; behavior comes from table data, not app constants.
insert into public.llm_model_routes(scope, route_name, provider, model, config, is_active)
values
  ('generate', 'quality_route', 'openai', 'gpt-4.1', '{"temperature":0.7}'::jsonb, true),
  ('tweak', 'fast_route', 'openai', 'gpt-4.1-mini', '{"temperature":0.4}'::jsonb, true),
  ('classify', 'classifier_route', 'openai', 'gpt-4.1-mini', '{"temperature":0.1}'::jsonb, true),
  ('image', 'image_route', 'openai', 'gpt-image-1', '{"size":"1536x1024","quality":"high"}'::jsonb, true)
on conflict (scope, route_name) do nothing;

insert into public.llm_prompts(scope, version, name, template, is_active)
values
  (
    'generate',
    1,
    'default_generate_prompt',
    'You are Alchemy chef assistant. Use user profile, recipe context, and active rules to produce structured recipe JSON with title, servings, ingredients, steps, optional notes, and pairings.',
    true
  ),
  (
    'tweak',
    1,
    'default_tweak_prompt',
    'You are Alchemy chef editor. Apply requested edits while preserving schema integrity and culinary coherence. Output structured recipe JSON.',
    true
  ),
  (
    'classify',
    1,
    'default_classify_prompt',
    'Classify request scope for chef/recipe domain tasks. Output JSON according to active classify rules.',
    true
  ),
  (
    'image',
    1,
    'default_image_prompt',
    'Generate a refined food photography image prompt for this recipe context. Focus on premium editorial kitchen composition and appetizing plating.',
    true
  )
on conflict (scope, version) do nothing;

insert into public.llm_rules(scope, version, name, rule, is_active)
values
  (
    'generate',
    1,
    'generate_scope_rule',
    '{"allowed_domains":["recipe","chef","ingredient","technique"],"reject_out_of_scope":true}'::jsonb,
    true
  ),
  (
    'tweak',
    1,
    'tweak_scope_rule',
    '{"allowed_domains":["recipe","chef","ingredient","technique"],"reject_out_of_scope":true}'::jsonb,
    true
  ),
  (
    'classify',
    1,
    'classify_scope_rule',
    '{"labels":["in_scope","out_of_scope"],"accept_labels":["in_scope"],"default":"out_of_scope"}'::jsonb,
    true
  ),
  (
    'image',
    1,
    'image_style_rule',
    '{"style":"premium-editorial","lighting":"natural","camera":"50mm","mood":"warm"}'::jsonb,
    true
  )
on conflict (scope, version) do nothing;

-- RLS
alter table public.users enable row level security;
alter table public.preferences enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_versions enable row level security;
alter table public.collections enable row level security;
alter table public.collection_items enable row level security;
alter table public.recipe_saves enable row level security;
alter table public.memories enable row level security;
alter table public.events enable row level security;
alter table public.llm_prompts enable row level security;
alter table public.llm_rules enable row level security;
alter table public.llm_model_routes enable row level security;
alter table public.recipe_user_categories enable row level security;
alter table public.recipe_auto_categories enable row level security;
alter table public.explore_publications enable row level security;
alter table public.recipe_drafts enable row level security;
alter table public.recipe_draft_messages enable row level security;
alter table public.recipe_graph_links enable row level security;
alter table public.graph_entities enable row level security;
alter table public.graph_edges enable row level security;
alter table public.graph_relation_types enable row level security;

create policy users_self_rw on public.users
  for all
  using (id = auth.uid())
  with check (id = auth.uid());

create policy preferences_self_rw on public.preferences
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy recipes_owner_or_public_read on public.recipes
  for select
  using (owner_user_id = auth.uid() or visibility = 'public');

create policy recipes_owner_write on public.recipes
  for all
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

create policy recipe_versions_read_visible on public.recipe_versions
  for select
  using (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_id
        and (r.owner_user_id = auth.uid() or r.visibility = 'public')
    )
  );

create policy recipe_versions_owner_write on public.recipe_versions
  for insert
  with check (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_id and r.owner_user_id = auth.uid()
    )
  );

create policy collections_owner_rw on public.collections
  for all
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

create policy collection_items_owner_rw on public.collection_items
  for all
  using (
    exists (
      select 1 from public.collections c
      where c.id = collection_id and c.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.collections c
      where c.id = collection_id and c.owner_user_id = auth.uid()
    )
  );

create policy recipe_saves_owner_rw on public.recipe_saves
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy memories_owner_rw on public.memories
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy events_owner_read on public.events
  for select
  using (user_id = auth.uid());

create policy events_owner_insert on public.events
  for insert
  with check (user_id = auth.uid() or user_id is null);

create policy recipe_user_categories_owner_rw on public.recipe_user_categories
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy recipe_auto_categories_read_visible on public.recipe_auto_categories
  for select
  using (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_id and (r.owner_user_id = auth.uid() or r.visibility = 'public')
    )
  );

create policy explore_publications_read_public on public.explore_publications
  for select
  using (exists (select 1 from public.recipes r where r.id = recipe_id and r.visibility = 'public'));

create policy recipe_drafts_owner_rw on public.recipe_drafts
  for all
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

create policy recipe_draft_messages_owner_rw on public.recipe_draft_messages
  for all
  using (
    exists (
      select 1 from public.recipe_drafts d
      where d.id = draft_id and d.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.recipe_drafts d
      where d.id = draft_id and d.owner_user_id = auth.uid()
    )
  );

create policy recipe_graph_links_read_visible on public.recipe_graph_links
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

create policy graph_entities_read_authenticated on public.graph_entities
  for select
  using (auth.role() = 'authenticated');

create policy graph_edges_read_authenticated on public.graph_edges
  for select
  using (auth.role() = 'authenticated');

create policy graph_relation_types_read_authenticated on public.graph_relation_types
  for select
  using (auth.role() = 'authenticated');
