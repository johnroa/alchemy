-- Recipe search: graph identity hardening + hybrid retrieval storage/functions.

create extension if not exists vector;

do $$
declare
  graph_entities_unique_name text;
begin
  select conname
    into graph_entities_unique_name
  from pg_constraint
  where conrelid = 'public.graph_entities'::regclass
    and contype = 'u'
    and pg_get_constraintdef(oid) like '%(entity_type, label)%'
  limit 1;

  if graph_entities_unique_name is not null then
    execute format(
      'alter table public.graph_entities drop constraint %I',
      graph_entities_unique_name
    );
  end if;
end $$;

alter table public.graph_entities
  add column if not exists entity_key text;

update public.graph_entities
set entity_key = lower(label)
where entity_key is null
  and entity_type <> 'recipe';

update public.graph_entities
set entity_key = 'recipe:' || (metadata ->> 'recipe_id')
where entity_type = 'recipe'
  and metadata ? 'recipe_id'
  and nullif(metadata ->> 'recipe_id', '') is not null
  and (
    entity_key is null
    or entity_key <> 'recipe:' || (metadata ->> 'recipe_id')
  );

create temp table tmp_nonrecipe_entity_canonical_map on commit drop as
with ranked as (
  select
    id,
    first_value(id) over (
      partition by entity_type, entity_key
      order by created_at asc, id asc
    ) as canonical_entity_id
  from public.graph_entities
  where entity_type <> 'recipe'
    and entity_key is not null
)
select
  id as old_entity_id,
  canonical_entity_id
from ranked
where id <> canonical_entity_id;

insert into public.graph_entities (entity_type, label, entity_key, metadata)
select
  'recipe',
  r.title,
  'recipe:' || r.id::text,
  jsonb_build_object('recipe_id', r.id)
from public.recipes r
where not exists (
  select 1
  from public.graph_entities existing
  where existing.entity_type = 'recipe'
    and existing.entity_key = 'recipe:' || r.id::text
);

create temp table tmp_recipe_entity_canonical_map on commit drop as
select
  legacy.id as old_entity_id,
  canonical.id as canonical_entity_id
from public.graph_entities legacy
join public.graph_entities canonical
  on canonical.entity_type = 'recipe'
 and canonical.entity_key = 'recipe:' || (legacy.metadata ->> 'recipe_id')
where legacy.entity_type = 'recipe'
  and legacy.metadata ? 'recipe_id'
  and legacy.id <> canonical.id;

create temp table tmp_graph_entity_canonical_map on commit drop as
select * from tmp_nonrecipe_entity_canonical_map
union
select * from tmp_recipe_entity_canonical_map;

insert into public.recipe_graph_links (recipe_version_id, entity_id)
select distinct
  links.recipe_version_id,
  map.canonical_entity_id
from public.recipe_graph_links links
join tmp_graph_entity_canonical_map map
  on map.old_entity_id = links.entity_id
on conflict do nothing;

delete from public.recipe_graph_links links
using tmp_graph_entity_canonical_map map
where links.entity_id = map.old_entity_id;

insert into public.graph_edges (
  from_entity_id,
  to_entity_id,
  relation_type_id,
  source,
  confidence,
  metadata,
  created_at
)
select
  coalesce(from_map.canonical_entity_id, edges.from_entity_id),
  coalesce(to_map.canonical_entity_id, edges.to_entity_id),
  edges.relation_type_id,
  edges.source,
  edges.confidence,
  edges.metadata,
  edges.created_at
from public.graph_edges edges
left join tmp_graph_entity_canonical_map from_map
  on from_map.old_entity_id = edges.from_entity_id
left join tmp_graph_entity_canonical_map to_map
  on to_map.old_entity_id = edges.to_entity_id
where from_map.old_entity_id is not null
   or to_map.old_entity_id is not null
on conflict (from_entity_id, to_entity_id, relation_type_id, source) do update
set
  confidence = greatest(public.graph_edges.confidence, excluded.confidence),
  metadata = public.graph_edges.metadata || excluded.metadata;

delete from public.graph_edges edges
using tmp_graph_entity_canonical_map map
where edges.from_entity_id = map.old_entity_id
   or edges.to_entity_id = map.old_entity_id;

delete from public.graph_entities entities
using tmp_graph_entity_canonical_map map
where entities.id = map.old_entity_id;

create unique index if not exists graph_entities_entity_key_unique
  on public.graph_entities(entity_type, entity_key);

update public.graph_entities entities
set
  label = recipes.title,
  metadata = coalesce(entities.metadata, '{}'::jsonb) || jsonb_build_object('recipe_id', recipes.id),
  updated_at = now()
from public.recipes recipes
where entities.entity_type = 'recipe'
  and entities.entity_key = 'recipe:' || recipes.id::text
  and (
    entities.label is distinct from recipes.title
    or not (entities.metadata ? 'recipe_id')
  );

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.recipe_metadata_jobs'::regclass
      and conname = 'recipe_metadata_jobs_stage_check'
  ) then
    alter table public.recipe_metadata_jobs
      drop constraint recipe_metadata_jobs_stage_check;
  end if;
end $$;

alter table public.recipe_metadata_jobs
  add constraint recipe_metadata_jobs_stage_check
  check (
    stage in (
      'queued',
      'ingredient_resolution',
      'ingredient_enrichment',
      'recipe_enrichment',
      'edge_inference',
      'search_index',
      'finalize'
    )
  );

create table if not exists public.recipe_search_documents (
  recipe_id uuid primary key references public.recipes(id) on delete cascade,
  recipe_version_id uuid not null references public.recipe_versions(id) on delete cascade,
  visibility text not null check (visibility in ('public', 'private')),
  image_url text,
  image_status text not null check (image_status in ('pending', 'ready', 'failed')),
  explore_eligible boolean not null default false,
  title text not null,
  summary text not null default '',
  time_minutes int,
  difficulty text check (difficulty in ('easy', 'medium', 'complex')),
  health_score int,
  ingredient_count int not null default 0,
  canonical_ingredient_ids uuid[] not null default '{}',
  canonical_ingredient_names text[] not null default '{}',
  ontology_term_keys text[] not null default '{}',
  cuisine_tags text[] not null default '{}',
  diet_tags text[] not null default '{}',
  occasion_tags text[] not null default '{}',
  technique_tags text[] not null default '{}',
  keyword_terms text[] not null default '{}',
  search_text text not null default '',
  search_tsv tsvector generated always as (
    to_tsvector('english', coalesce(search_text, ''))
  ) stored,
  embedding vector(1536) not null,
  indexed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recipe_version_id)
);

create index if not exists recipe_search_documents_feed_idx
  on public.recipe_search_documents(visibility, explore_eligible, indexed_at desc, recipe_id desc);

create index if not exists recipe_search_documents_tsv_idx
  on public.recipe_search_documents using gin (search_tsv);

create index if not exists recipe_search_documents_ingredient_names_idx
  on public.recipe_search_documents using gin (canonical_ingredient_names);

create index if not exists recipe_search_documents_cuisine_tags_idx
  on public.recipe_search_documents using gin (cuisine_tags);

create index if not exists recipe_search_documents_diet_tags_idx
  on public.recipe_search_documents using gin (diet_tags);

create index if not exists recipe_search_documents_technique_tags_idx
  on public.recipe_search_documents using gin (technique_tags);

create index if not exists recipe_search_documents_embedding_hnsw_idx
  on public.recipe_search_documents using hnsw (embedding vector_cosine_ops);

create table if not exists public.recipe_search_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.users(id) on delete cascade,
  surface text not null check (surface in ('explore', 'chat')),
  applied_context text not null check (applied_context in ('all', 'preset', 'query')),
  normalized_input text,
  preset_id text,
  interpreted_intent jsonb not null default '{}'::jsonb,
  query_embedding vector(1536),
  snapshot_cutoff_indexed_at timestamptz not null,
  page1_promoted_recipe_ids uuid[] not null default '{}',
  hybrid_items jsonb not null default '[]'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists recipe_search_sessions_owner_idx
  on public.recipe_search_sessions(owner_user_id, created_at desc);

create index if not exists recipe_search_sessions_expiry_idx
  on public.recipe_search_sessions(expires_at);

alter table public.recipe_search_documents enable row level security;
alter table public.recipe_search_sessions enable row level security;

drop policy if exists recipe_search_documents_read_public on public.recipe_search_documents;
create policy recipe_search_documents_read_public
  on public.recipe_search_documents
  for select
  using (
    auth.role() = 'authenticated'
    and visibility = 'public'
  );

drop policy if exists recipe_search_sessions_owner_read on public.recipe_search_sessions;
create policy recipe_search_sessions_owner_read
  on public.recipe_search_sessions
  for select
  using (owner_user_id = auth.uid());

drop policy if exists recipe_search_sessions_owner_insert on public.recipe_search_sessions;
create policy recipe_search_sessions_owner_insert
  on public.recipe_search_sessions
  for insert
  with check (owner_user_id = auth.uid());

drop policy if exists recipe_search_sessions_owner_update on public.recipe_search_sessions;
create policy recipe_search_sessions_owner_update
  on public.recipe_search_sessions
  for update
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

create or replace function public.recipe_search_difficulty_rank(p_value text)
returns int
language sql
immutable
as $$
  select case lower(coalesce(p_value, ''))
    when 'easy' then 1
    when 'medium' then 2
    when 'complex' then 3
    else 999
  end;
$$;

create or replace function public.list_recipe_search_documents(
  p_snapshot_cutoff_indexed_at timestamptz,
  p_explore_only boolean default false,
  p_limit int default 20,
  p_cursor_indexed_at timestamptz default null,
  p_cursor_recipe_id uuid default null
)
returns table (
  recipe_id uuid,
  recipe_version_id uuid,
  title text,
  summary text,
  image_url text,
  image_status text,
  time_minutes int,
  difficulty text,
  health_score int,
  ingredient_count int,
  indexed_at timestamptz
)
language sql
stable
as $$
  select
    d.recipe_id,
    d.recipe_version_id,
    d.title,
    d.summary,
    d.image_url,
    d.image_status,
    d.time_minutes,
    d.difficulty,
    d.health_score,
    d.ingredient_count,
    d.indexed_at
  from public.recipe_search_documents d
  where d.visibility = 'public'
    and d.indexed_at <= p_snapshot_cutoff_indexed_at
    and (not p_explore_only or d.explore_eligible)
    and (
      p_cursor_indexed_at is null
      or d.indexed_at < p_cursor_indexed_at
      or (
        d.indexed_at = p_cursor_indexed_at
        and d.recipe_id < p_cursor_recipe_id
      )
    )
  order by d.indexed_at desc, d.recipe_id desc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

create or replace function public.hybrid_search_recipe_documents(
  p_query_text text,
  p_query_embedding vector(1536),
  p_snapshot_cutoff_indexed_at timestamptz,
  p_explore_only boolean default false,
  p_limit int default 200,
  p_cuisine_tags text[] default '{}',
  p_diet_tags text[] default '{}',
  p_technique_tags text[] default '{}',
  p_exclude_ingredient_names text[] default '{}',
  p_max_time_minutes int default null,
  p_max_difficulty text default null
)
returns table (
  recipe_id uuid,
  recipe_version_id uuid,
  title text,
  summary text,
  image_url text,
  image_status text,
  time_minutes int,
  difficulty text,
  health_score int,
  ingredient_count int,
  indexed_at timestamptz,
  hybrid_score double precision,
  fts_rank real,
  semantic_distance double precision
)
language sql
stable
as $$
  with filtered as (
    select d.*
    from public.recipe_search_documents d
    where d.visibility = 'public'
      and d.indexed_at <= p_snapshot_cutoff_indexed_at
      and (not p_explore_only or d.explore_eligible)
      and (
        coalesce(array_length(p_cuisine_tags, 1), 0) = 0
        or d.cuisine_tags && p_cuisine_tags
      )
      and (
        coalesce(array_length(p_diet_tags, 1), 0) = 0
        or d.diet_tags && p_diet_tags
      )
      and (
        coalesce(array_length(p_technique_tags, 1), 0) = 0
        or d.technique_tags && p_technique_tags
      )
      and (
        coalesce(array_length(p_exclude_ingredient_names, 1), 0) = 0
        or not (d.canonical_ingredient_names && p_exclude_ingredient_names)
      )
      and (
        p_max_time_minutes is null
        or d.time_minutes is null
        or d.time_minutes <= p_max_time_minutes
      )
      and (
        p_max_difficulty is null
        or public.recipe_search_difficulty_rank(d.difficulty)
          <= public.recipe_search_difficulty_rank(p_max_difficulty)
      )
  ),
  query_input as (
    select nullif(trim(coalesce(p_query_text, '')), '') as query_text
  ),
  fts_query as (
    select
      case
        when query_text is null then null::tsquery
        else websearch_to_tsquery('english', query_text)
      end as ts_query
    from query_input
  ),
  fts_candidates as (
    select
      f.recipe_id,
      row_number() over (
        order by ts_rank_cd(f.search_tsv, q.ts_query) desc, f.indexed_at desc, f.recipe_id desc
      ) as rank_idx,
      ts_rank_cd(f.search_tsv, q.ts_query) as score
    from filtered f
    cross join fts_query q
    where q.ts_query is not null
      and f.search_tsv @@ q.ts_query
    order by score desc, f.indexed_at desc, f.recipe_id desc
    limit 100
  ),
  semantic_candidates as (
    select
      f.recipe_id,
      row_number() over (
        order by f.embedding <=> p_query_embedding, f.indexed_at desc, f.recipe_id desc
      ) as rank_idx,
      (f.embedding <=> p_query_embedding) as distance
    from filtered f
    where p_query_embedding is not null
    order by distance asc, f.indexed_at desc, f.recipe_id desc
    limit 100
  ),
  candidate_scores as (
    select
      recipe_id,
      sum(rrf_score) as hybrid_score,
      max(fts_score) as fts_rank,
      min(semantic_distance) as semantic_distance
    from (
      select
        recipe_id,
        (1.0 / (60 + rank_idx))::double precision as rrf_score,
        score as fts_score,
        null::double precision as semantic_distance
      from fts_candidates
      union all
      select
        recipe_id,
        (1.0 / (60 + rank_idx))::double precision as rrf_score,
        null::real as fts_score,
        distance as semantic_distance
      from semantic_candidates
    ) scored
    group by recipe_id
  )
  select
    d.recipe_id,
    d.recipe_version_id,
    d.title,
    d.summary,
    d.image_url,
    d.image_status,
    d.time_minutes,
    d.difficulty,
    d.health_score,
    d.ingredient_count,
    d.indexed_at,
    scores.hybrid_score,
    scores.fts_rank,
    scores.semantic_distance
  from candidate_scores scores
  join filtered d
    on d.recipe_id = scores.recipe_id
  order by scores.hybrid_score desc, d.indexed_at desc, d.recipe_id desc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

grant execute on function public.list_recipe_search_documents(
  timestamptz,
  boolean,
  int,
  timestamptz,
  uuid
) to authenticated, service_role;

grant execute on function public.hybrid_search_recipe_documents(
  text,
  vector,
  timestamptz,
  boolean,
  int,
  text[],
  text[],
  text[],
  text[],
  int,
  text
) to authenticated, service_role;

insert into public.llm_model_registry (
  provider,
  model,
  display_name,
  input_cost_per_1m_tokens,
  output_cost_per_1m_tokens,
  context_window_tokens,
  max_output_tokens,
  notes
)
values (
  'openai',
  'text-embedding-3-small',
  'Text Embedding 3 Small',
  0.02,
  0.00,
  8192,
  null,
  'Search embedding model for recipe retrieval'
)
on conflict (provider, model) do update
set
  display_name = excluded.display_name,
  input_cost_per_1m_tokens = excluded.input_cost_per_1m_tokens,
  output_cost_per_1m_tokens = excluded.output_cost_per_1m_tokens,
  context_window_tokens = excluded.context_window_tokens,
  max_output_tokens = excluded.max_output_tokens,
  notes = excluded.notes,
  is_available = true,
  updated_at = now();

update public.llm_model_routes
set is_active = false
where scope in ('recipe_search_embed', 'recipe_search_interpret', 'recipe_search_rerank')
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
    'recipe_search_embed',
    'primary',
    'openai',
    'text-embedding-3-small',
    jsonb_build_object('timeout_ms', 45000),
    true
  ),
  (
    'recipe_search_interpret',
    'primary',
    'openai',
    'gpt-5-mini',
    jsonb_build_object('temperature', 0.1, 'timeout_ms', 45000, 'max_output_tokens', 2048),
    true
  ),
  (
    'recipe_search_rerank',
    'primary',
    'openai',
    'gpt-5-mini',
    jsonb_build_object('temperature', 0.0, 'timeout_ms', 2000, 'max_output_tokens', 2048),
    true
  )
on conflict (scope, route_name) do update
set
  provider = excluded.provider,
  model = excluded.model,
  config = excluded.config,
  is_active = excluded.is_active,
  created_at = public.llm_model_routes.created_at;

update public.llm_prompts
set is_active = false
where scope in ('recipe_search_embed', 'recipe_search_interpret', 'recipe_search_rerank')
  and is_active = true;

insert into public.llm_prompts (
  scope,
  version,
  name,
  template,
  metadata,
  is_active
)
values
  (
    'recipe_search_embed',
    1,
    'Recipe search embedding',
    '',
    jsonb_build_object('kind', 'embedding'),
    true
  ),
  (
    'recipe_search_interpret',
    1,
    'Recipe search interpret v1',
    $$You are Alchemy's recipe search interpreter.
Return one strict JSON object only.
Interpret the user's search request into structured retrieval intent.
Do not ask questions.
Preserve subjective culinary language inside soft_targets instead of inventing hard filters.
Only use hard_filters for explicit constraints you can justify from the input/context.
Allowed hard_filters keys: cuisines, diet_tags, techniques, exclude_ingredients, max_time_minutes, max_difficulty.
Allowed query_style values: explicit, subjective, mixed, all.$$,
    jsonb_build_object('kind', 'json'),
    true
  ),
  (
    'recipe_search_rerank',
    1,
    'Recipe search rerank v1',
    $$You are Alchemy's recipe search reranker.
Return one strict JSON object only.
Rank the provided candidate recipes from best to worst for the interpreted search intent.
Do not invent recipe ids.
Keep rationale tags terse and retrieval-oriented.$$,
    jsonb_build_object('kind', 'json'),
    true
  )
on conflict (scope, version) do update
set
  name = excluded.name,
  template = excluded.template,
  metadata = excluded.metadata,
  is_active = excluded.is_active;

update public.llm_rules
set is_active = false
where scope in ('recipe_search_embed', 'recipe_search_interpret', 'recipe_search_rerank')
  and is_active = true;

insert into public.llm_rules (
  scope,
  version,
  name,
  rule,
  is_active
)
values
  (
    'recipe_search_embed',
    1,
    'Recipe search embedding rule',
    jsonb_build_object(
      'response_contract', 'recipe_search_embedding_v1',
      'dimensions', 1536,
      'normalize', 'unit'
    ),
    true
  ),
  (
    'recipe_search_interpret',
    1,
    'Recipe search interpret rule',
    jsonb_build_object(
      'response_contract', 'recipe_search_interpret_v1',
      'strict_json_only', true
    ),
    true
  ),
  (
    'recipe_search_rerank',
    1,
    'Recipe search rerank rule',
    jsonb_build_object(
      'response_contract', 'recipe_search_rerank_v1',
      'strict_json_only', true
    ),
    true
  )
on conflict (scope, version) do update
set
  name = excluded.name,
  rule = excluded.rule,
  is_active = excluded.is_active;
