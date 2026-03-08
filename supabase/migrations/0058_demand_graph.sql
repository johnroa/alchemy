-- 0058_demand_graph.sql
--
-- Internal-first demand graph primitives. These tables keep structured
-- demand/intent observations separate from the raw source-of-truth records
-- in chat, import, variant, and behavior tables.

create table if not exists public.demand_observations (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null,
  source_id text not null,
  user_id uuid references public.users(id) on delete set null,
  chat_session_id uuid references public.chat_sessions(id) on delete set null,
  recipe_id uuid references public.recipes(id) on delete set null,
  variant_id uuid references public.user_recipe_variants(id) on delete set null,
  observed_at timestamptz not null default now(),
  stage text not null
    check (stage in ('intent', 'iteration', 'import', 'selection', 'commit', 'consumption', 'feedback')),
  extractor_scope text not null,
  extractor_version integer not null default 1,
  confidence numeric(4,3) not null default 0.5
    check (confidence >= 0 and confidence <= 1),
  privacy_tier text not null default 'derived'
    check (privacy_tier in ('derived', 'redacted_snippet')),
  admin_snippet_redacted text,
  raw_trace_ref text,
  summary_jsonb jsonb not null default '{}'::jsonb,
  review_status text not null default 'pending'
    check (review_status in ('pending', 'confirmed', 'rejected')),
  sampled_for_review boolean not null default false,
  sampled_at timestamptz,
  review_notes text,
  reviewed_at timestamptz,
  reviewed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_kind, source_id, stage, extractor_version)
);

comment on table public.demand_observations is
  'Derived intent and demand observations created from Alchemy creation flows.';
comment on column public.demand_observations.admin_snippet_redacted is
  'Short privacy-defensible snippet for admin traceability. Full raw text remains in source tables.';

create index if not exists idx_demand_observations_user_time
  on public.demand_observations (user_id, observed_at desc);

create index if not exists idx_demand_observations_stage_time
  on public.demand_observations (stage, observed_at desc);

create index if not exists idx_demand_observations_source_kind_time
  on public.demand_observations (source_kind, observed_at desc);

create index if not exists idx_demand_observations_chat
  on public.demand_observations (chat_session_id, observed_at desc);

create index if not exists idx_demand_observations_recipe
  on public.demand_observations (recipe_id, observed_at desc);

create index if not exists idx_demand_observations_review
  on public.demand_observations (sampled_for_review, review_status, observed_at desc);

create table if not exists public.demand_fact_values (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references public.demand_observations(id) on delete cascade,
  facet text not null
    check (
      facet in (
        'goal',
        'dish',
        'cuisine',
        'ingredient_want',
        'ingredient_avoid',
        'pantry_item',
        'diet_constraint',
        'health_goal',
        'time_budget',
        'budget_tier',
        'occasion',
        'appliance',
        'household_context',
        'novelty_preference',
        'requested_substitution'
      )
    ),
  normalized_value text not null,
  raw_value text,
  polarity text not null default 'positive'
    check (polarity in ('positive', 'negative', 'neutral')),
  entity_id uuid references public.graph_entities(id) on delete set null,
  confidence numeric(4,3) not null default 0.5
    check (confidence >= 0 and confidence <= 1),
  rank integer not null default 1,
  metadata_jsonb jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.demand_fact_values is
  'Flattened demand facts derived from one demand observation.';

create index if not exists idx_demand_fact_values_observation
  on public.demand_fact_values (observation_id, rank asc);

create index if not exists idx_demand_fact_values_facet_value
  on public.demand_fact_values (facet, normalized_value, created_at desc);

create index if not exists idx_demand_fact_values_entity
  on public.demand_fact_values (entity_id, created_at desc);

create table if not exists public.demand_outcomes (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references public.demand_observations(id) on delete cascade,
  origin_observation_id uuid references public.demand_observations(id) on delete set null,
  outcome_type text not null
    check (
      outcome_type in (
        'candidate_selected',
        'candidate_rejected',
        'recipe_committed',
        'recipe_saved',
        'variant_refreshed',
        'substitution_accepted',
        'substitution_reverted',
        'cook_inferred',
        'repeat_cook'
      )
    ),
  source_kind text not null,
  source_id text not null,
  recipe_id uuid references public.recipes(id) on delete set null,
  variant_id uuid references public.user_recipe_variants(id) on delete set null,
  candidate_id text,
  occurred_at timestamptz not null default now(),
  payload_jsonb jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_kind, source_id, outcome_type)
);

comment on table public.demand_outcomes is
  'Observed downstream outcomes linked back to demand observations when lineage is known.';

create index if not exists idx_demand_outcomes_observation
  on public.demand_outcomes (observation_id, occurred_at desc);

create index if not exists idx_demand_outcomes_origin
  on public.demand_outcomes (origin_observation_id, occurred_at desc);

create index if not exists idx_demand_outcomes_type_time
  on public.demand_outcomes (outcome_type, occurred_at desc);

create index if not exists idx_demand_outcomes_recipe
  on public.demand_outcomes (recipe_id, occurred_at desc);

create table if not exists public.demand_graph_edges (
  id uuid primary key default gen_random_uuid(),
  from_facet text not null,
  from_value text not null,
  to_facet text not null,
  to_value text not null,
  from_entity_id uuid references public.graph_entities(id) on delete set null,
  to_entity_id uuid references public.graph_entities(id) on delete set null,
  window text not null check (window in ('7d', '30d')),
  count integer not null default 0,
  recency_weighted_score numeric(12,4) not null default 0,
  acceptance_score numeric(8,4),
  segment_jsonb jsonb not null default '{}'::jsonb,
  last_observed_at timestamptz not null,
  updated_at timestamptz not null default now()
);

comment on table public.demand_graph_edges is
  'Derived demand co-occurrence and intent-to-outcome graph edges for internal analytics and future enterprise products.';

create index if not exists idx_demand_graph_edges_window_score
  on public.demand_graph_edges (window, recency_weighted_score desc, count desc);

create index if not exists idx_demand_graph_edges_window_last_seen
  on public.demand_graph_edges (window, last_observed_at desc);

create table if not exists public.demand_extraction_jobs (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null,
  source_id text not null,
  user_id uuid references public.users(id) on delete set null,
  stage text not null
    check (stage in ('intent', 'iteration', 'import', 'selection', 'commit', 'consumption', 'feedback')),
  extractor_scope text not null,
  extractor_version integer not null default 1,
  observed_at timestamptz not null default now(),
  payload_jsonb jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  observation_id uuid references public.demand_observations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_kind, source_id, stage, extractor_version)
);

comment on table public.demand_extraction_jobs is
  'Async extraction queue for demand observations and outcomes.';

create index if not exists idx_demand_extraction_jobs_status_due
  on public.demand_extraction_jobs (status, next_attempt_at asc, observed_at asc);

create index if not exists idx_demand_extraction_jobs_user_time
  on public.demand_extraction_jobs (user_id, observed_at desc);

update public.llm_model_routes
set is_active = false
where scope in (
  'demand_extract_observation',
  'demand_extract_iteration_delta',
  'demand_link_entities',
  'demand_summarize_outcome_reason'
)
  and is_active = true;

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
    'demand_extract_observation',
    'primary',
    'openai',
    'gpt-5-mini',
    jsonb_build_object('temperature', 0.1, 'timeout_ms', 20000, 'max_output_tokens', 2048),
    true
  ),
  (
    'demand_extract_iteration_delta',
    'primary',
    'openai',
    'gpt-5-mini',
    jsonb_build_object('temperature', 0.1, 'timeout_ms', 20000, 'max_output_tokens', 2048),
    true
  ),
  (
    'demand_link_entities',
    'primary',
    'openai',
    'gpt-5-mini',
    jsonb_build_object('temperature', 0.0, 'timeout_ms', 12000, 'max_output_tokens', 1024),
    true
  ),
  (
    'demand_summarize_outcome_reason',
    'primary',
    'openai',
    'gpt-5-mini',
    jsonb_build_object('temperature', 0.1, 'timeout_ms', 12000, 'max_output_tokens', 1024),
    true
  )
on conflict (scope, route_name) do update
set
  provider = excluded.provider,
  model = excluded.model,
  config = excluded.config,
  is_active = excluded.is_active,
  created_at = public.llm_model_routes.created_at;

create or replace function public.refresh_demand_graph_edges()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer := 0;
begin
  delete from public.demand_graph_edges;

  with windows as (
    select '7d'::text as window, interval '7 days' as lookback
    union all
    select '30d'::text as window, interval '30 days' as lookback
  ),
  observation_facts as (
    select
      w.window,
      o.id as observation_id,
      o.stage,
      o.source_kind,
      o.observed_at,
      f.id as fact_id,
      f.facet,
      f.normalized_value,
      f.entity_id
    from windows w
    join public.demand_observations o
      on o.observed_at >= now() - w.lookback
    join public.demand_fact_values f
      on f.observation_id = o.id
  ),
  fact_totals as (
    select
      window,
      stage,
      source_kind,
      facet,
      normalized_value,
      count(distinct observation_id) as total_observations
    from observation_facts
    group by 1, 2, 3, 4, 5
  ),
  fact_pairs as (
    select
      first_fact.window,
      case
        when row(first_fact.facet, first_fact.normalized_value) <= row(second_fact.facet, second_fact.normalized_value)
          then first_fact.facet
        else second_fact.facet
      end as from_facet,
      case
        when row(first_fact.facet, first_fact.normalized_value) <= row(second_fact.facet, second_fact.normalized_value)
          then first_fact.normalized_value
        else second_fact.normalized_value
      end as from_value,
      case
        when row(first_fact.facet, first_fact.normalized_value) <= row(second_fact.facet, second_fact.normalized_value)
          then first_fact.entity_id
        else second_fact.entity_id
      end as from_entity_id,
      case
        when row(first_fact.facet, first_fact.normalized_value) <= row(second_fact.facet, second_fact.normalized_value)
          then second_fact.facet
        else first_fact.facet
      end as to_facet,
      case
        when row(first_fact.facet, first_fact.normalized_value) <= row(second_fact.facet, second_fact.normalized_value)
          then second_fact.normalized_value
        else first_fact.normalized_value
      end as to_value,
      case
        when row(first_fact.facet, first_fact.normalized_value) <= row(second_fact.facet, second_fact.normalized_value)
          then second_fact.entity_id
        else first_fact.entity_id
      end as to_entity_id,
      jsonb_build_object(
        'stage',
        first_fact.stage,
        'source_kind',
        first_fact.source_kind
      ) as segment_jsonb,
      count(*) as pair_count,
      sum(exp(-extract(epoch from (now() - first_fact.observed_at)) / 604800.0)) as recency_weighted_score,
      max(first_fact.observed_at) as last_observed_at
    from observation_facts first_fact
    join observation_facts second_fact
      on second_fact.window = first_fact.window
     and second_fact.observation_id = first_fact.observation_id
     and second_fact.fact_id > first_fact.fact_id
    group by 1, 2, 3, 4, 5, 6, 7, 8
  ),
  outcome_pairs as (
    select
      origin_facts.window,
      origin_facts.stage,
      origin_facts.source_kind,
      origin_facts.facet as from_facet,
      origin_facts.normalized_value as from_value,
      origin_facts.entity_id as from_entity_id,
      'outcome'::text as to_facet,
      outcomes.outcome_type as to_value,
      null::uuid as to_entity_id,
      jsonb_build_object(
        'stage',
        origin_facts.stage,
        'source_kind',
        origin_facts.source_kind
      ) as segment_jsonb,
      count(*) as pair_count,
      sum(exp(-extract(epoch from (now() - outcomes.occurred_at)) / 604800.0)) as recency_weighted_score,
      max(outcomes.occurred_at) as last_observed_at
    from public.demand_outcomes outcomes
    join observation_facts origin_facts
      on origin_facts.observation_id = coalesce(outcomes.origin_observation_id, outcomes.observation_id)
     and outcomes.occurred_at >= now() - (
       case origin_facts.window
         when '7d' then interval '7 days'
         else interval '30 days'
       end
     )
    group by 1, 2, 3, 4, 5, 6, 7, 8, 9
  ),
  inserted_edges as (
    insert into public.demand_graph_edges (
      from_facet,
      from_value,
      to_facet,
      to_value,
      from_entity_id,
      to_entity_id,
      window,
      count,
      recency_weighted_score,
      acceptance_score,
      segment_jsonb,
      last_observed_at,
      updated_at
    )
    select
      fact_pairs.from_facet,
      fact_pairs.from_value,
      fact_pairs.to_facet,
      fact_pairs.to_value,
      fact_pairs.from_entity_id,
      fact_pairs.to_entity_id,
      fact_pairs.window,
      fact_pairs.pair_count,
      round(fact_pairs.recency_weighted_score::numeric, 4),
      null::numeric,
      fact_pairs.segment_jsonb,
      fact_pairs.last_observed_at,
      now()
    from fact_pairs
    union all
    select
      outcome_pairs.from_facet,
      outcome_pairs.from_value,
      outcome_pairs.to_facet,
      outcome_pairs.to_value,
      outcome_pairs.from_entity_id,
      outcome_pairs.to_entity_id,
      outcome_pairs.window,
      outcome_pairs.pair_count,
      round(outcome_pairs.recency_weighted_score::numeric, 4),
      case
        when fact_totals.total_observations > 0
          then round(outcome_pairs.pair_count::numeric / fact_totals.total_observations::numeric, 4)
        else null
      end as acceptance_score,
      outcome_pairs.segment_jsonb,
      outcome_pairs.last_observed_at,
      now()
    from outcome_pairs
    left join fact_totals
      on fact_totals.window = outcome_pairs.window
     and fact_totals.stage = outcome_pairs.stage
     and fact_totals.source_kind = outcome_pairs.source_kind
     and fact_totals.facet = outcome_pairs.from_facet
     and fact_totals.normalized_value = outcome_pairs.from_value
    returning 1
  )
  select count(*) into inserted_count from inserted_edges;

  return jsonb_build_object(
    'ok',
    true,
    'edges',
    inserted_count
  );
end;
$$;

alter table public.demand_observations enable row level security;
alter table public.demand_fact_values enable row level security;
alter table public.demand_outcomes enable row level security;
alter table public.demand_graph_edges enable row level security;
alter table public.demand_extraction_jobs enable row level security;

create policy demand_observations_owner_read
  on public.demand_observations
  for select
  using (auth.uid() = user_id);

create policy demand_fact_values_owner_read
  on public.demand_fact_values
  for select
  using (
    exists (
      select 1
      from public.demand_observations observations
      where observations.id = demand_fact_values.observation_id
        and observations.user_id = auth.uid()
    )
  );

create policy demand_outcomes_owner_read
  on public.demand_outcomes
  for select
  using (
    exists (
      select 1
      from public.demand_observations observations
      where observations.id = demand_outcomes.observation_id
        and observations.user_id = auth.uid()
    )
  );
