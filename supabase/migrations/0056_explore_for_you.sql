-- 0056_explore_for_you.sql
--
-- Personalized Explore "For You" feed foundations:
-- - cached per-user taste profiles
-- - algorithm version registry
-- - search session metadata for recommender sessions
-- - impression outcome rollup view for admin visibility
-- - model routes for profile + rank scopes

create table if not exists public.user_taste_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  profile_state text not null default 'cold'
    check (profile_state in ('cold', 'warm', 'established')),
  algorithm_version text not null,
  retrieval_text text not null default '',
  retrieval_embedding vector(1536),
  profile_json jsonb not null default '{}'::jsonb,
  signal_summary jsonb not null default '{}'::jsonb,
  source_event_watermark timestamptz,
  last_built_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_taste_profiles is
  'Cached user taste profiles for the Explore For You feed. Generated from preferences, memories, behavior, and cookbook history.';

create index if not exists idx_user_taste_profiles_state_built_at
  on public.user_taste_profiles (profile_state, last_built_at desc);

alter table public.user_taste_profiles enable row level security;

create policy user_taste_profiles_owner_read
  on public.user_taste_profiles
  for select
  using (auth.uid() = user_id);

create table if not exists public.explore_algorithm_versions (
  version text primary key,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'retired')),
  label text not null,
  notes text,
  profile_scope text not null default 'explore_for_you_profile',
  profile_scope_version int not null default 1,
  rank_scope text not null default 'explore_for_you_rank',
  rank_scope_version int not null default 1,
  novelty_policy text not null default 'balanced',
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default false,
  activated_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((is_active = false) or (status = 'active'))
);

comment on table public.explore_algorithm_versions is
  'Registry of Explore For You recommender versions, rollout state, and serving config.';

create unique index if not exists explore_algorithm_versions_single_active_idx
  on public.explore_algorithm_versions (is_active)
  where is_active = true;

create index if not exists idx_explore_algorithm_versions_status_created_at
  on public.explore_algorithm_versions (status, created_at desc);

alter table public.explore_algorithm_versions enable row level security;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.recipe_search_sessions'::regclass
      and conname = 'recipe_search_sessions_applied_context_check'
  ) then
    alter table public.recipe_search_sessions
      drop constraint recipe_search_sessions_applied_context_check;
  end if;
end $$;

alter table public.recipe_search_sessions
  add constraint recipe_search_sessions_applied_context_check
  check (applied_context in ('all', 'preset', 'query', 'for_you'));

alter table public.recipe_search_sessions
  add column if not exists algorithm_version text,
  add column if not exists profile_state text
    check (profile_state in ('cold', 'warm', 'established')),
  add column if not exists rationale_tags_by_recipe jsonb not null default '{}'::jsonb;

create index if not exists idx_recipe_search_sessions_algorithm_version
  on public.recipe_search_sessions (algorithm_version, created_at desc);

insert into public.explore_algorithm_versions (
  version,
  status,
  label,
  notes,
  profile_scope,
  profile_scope_version,
  rank_scope,
  rank_scope_version,
  novelty_policy,
  config,
  is_active,
  activated_at
)
values (
  'for_you_v1',
  'active',
  'For You v1',
  'Initial production Explore For You retrieval + rerank release.',
  'explore_for_you_profile',
  1,
  'explore_for_you_rank',
  1,
  'balanced',
  jsonb_build_object(
    'candidate_pool_limit', 160,
    'page1_rerank_limit', 30,
    'page1_limit', 10,
    'exploration_ratio', 0.2,
    'suppress_saved_on_page1', true,
    'freshness_window_hours', 48
  ),
  true,
  now()
)
on conflict (version) do update
set
  status = excluded.status,
  label = excluded.label,
  notes = excluded.notes,
  profile_scope = excluded.profile_scope,
  profile_scope_version = excluded.profile_scope_version,
  rank_scope = excluded.rank_scope,
  rank_scope_version = excluded.rank_scope_version,
  novelty_policy = excluded.novelty_policy,
  config = excluded.config,
  is_active = excluded.is_active,
  activated_at = coalesce(public.explore_algorithm_versions.activated_at, excluded.activated_at),
  updated_at = now();

insert into public.llm_model_routes (
  scope,
  route_name,
  provider,
  model,
  config,
  is_active
)
values
  (
    'explore_for_you_profile',
    'primary',
    'openai',
    'gpt-5-mini',
    jsonb_build_object('temperature', 0.1, 'timeout_ms', 45000, 'max_output_tokens', 2048),
    true
  ),
  (
    'explore_for_you_rank',
    'primary',
    'openai',
    'gpt-5-mini',
    jsonb_build_object('temperature', 0.0, 'timeout_ms', 2200, 'max_output_tokens', 2048),
    true
  )
on conflict (scope, route_name) do update
set
  provider = excluded.provider,
  model = excluded.model,
  config = excluded.config,
  is_active = excluded.is_active,
  created_at = public.llm_model_routes.created_at;

create or replace view public.explore_impression_outcomes as
with impressions as (
  select
    e.event_id as impression_event_id,
    e.occurred_at as impression_occurred_at,
    e.install_id,
    e.user_id,
    e.session_id as feed_id,
    e.entity_id as recipe_id,
    e.algorithm_version,
    e.payload,
    coalesce(nullif(e.payload ->> 'profile_state', ''), 'cold') as profile_state,
    coalesce(nullif(e.payload ->> 'preset_id', ''), 'for_you') as preset_id
  from public.behavior_events e
  where e.event_type = 'explore_impression'
    and e.session_id is not null
    and e.entity_id is not null
)
select
  impressions.impression_event_id,
  impressions.impression_occurred_at,
  impressions.install_id,
  impressions.user_id,
  impressions.feed_id,
  impressions.recipe_id,
  impressions.algorithm_version,
  impressions.profile_state,
  impressions.preset_id,
  impressions.payload ->> 'fallback_path' as fallback_path,
  impressions.payload ->> 'why_tag_1' as why_tag_1,
  impressions.payload ->> 'why_tag_2' as why_tag_2,
  exists(
    select 1
    from public.behavior_events opened
    where opened.event_type = 'explore_opened_recipe'
      and opened.session_id = impressions.feed_id
      and opened.entity_id = impressions.recipe_id
  ) as opened,
  exists(
    select 1
    from public.behavior_events skipped
    where skipped.event_type = 'explore_skipped_recipe'
      and skipped.session_id = impressions.feed_id
      and skipped.entity_id = impressions.recipe_id
  ) as skipped,
  exists(
    select 1
    from public.behavior_events hidden
    where hidden.event_type = 'explore_hidden_recipe'
      and hidden.session_id = impressions.feed_id
      and hidden.entity_id = impressions.recipe_id
  ) as hidden,
  exists(
    select 1
    from public.behavior_events saved
    where saved.event_type in ('explore_saved_recipe', 'recipe_saved')
      and saved.entity_id = impressions.recipe_id
      and coalesce(saved.payload ->> 'source_session_id', saved.session_id) = impressions.feed_id
  ) as saved,
  exists(
    select 1
    from public.behavior_events cooked
    where cooked.event_type = 'recipe_cooked_inferred'
      and cooked.entity_id = impressions.recipe_id
      and coalesce(cooked.payload ->> 'source_session_id', cooked.session_id) = impressions.feed_id
  ) as cooked
from impressions;
