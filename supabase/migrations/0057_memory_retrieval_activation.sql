-- Activate scalable memory retrieval and operator-safe memory rebuilds.

create extension if not exists vector;

create index if not exists memories_active_user_rank_idx
  on public.memories(user_id, status, salience desc, updated_at desc);

create table if not exists public.memory_search_documents (
  memory_id uuid primary key references public.memories(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  memory_type text not null,
  memory_kind text not null,
  status text not null default 'active' check (status in ('active', 'superseded', 'deleted')),
  confidence numeric(5,4) not null default 0.5000 check (confidence between 0 and 1),
  salience numeric(5,4) not null default 0.5000 check (salience between 0 and 1),
  retrieval_text text not null default '',
  search_tsv tsvector generated always as (
    to_tsvector('english', coalesce(retrieval_text, ''))
  ) stored,
  embedding vector(1536) not null,
  indexed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists memory_search_documents_user_status_rank_idx
  on public.memory_search_documents(user_id, status, salience desc, updated_at desc);

create index if not exists memory_search_documents_user_indexed_idx
  on public.memory_search_documents(user_id, indexed_at desc);

create index if not exists memory_search_documents_tsv_idx
  on public.memory_search_documents using gin (search_tsv);

alter table public.memory_search_documents enable row level security;

drop policy if exists memory_search_documents_owner_read on public.memory_search_documents;
create policy memory_search_documents_owner_read
  on public.memory_search_documents
  for select
  using (user_id = auth.uid());

create or replace function public.hybrid_search_memories(
  p_user_id uuid,
  p_query_text text,
  p_query_embedding vector(1536),
  p_limit int default 24
)
returns table (
  memory_id uuid,
  user_id uuid,
  memory_type text,
  memory_kind text,
  memory_content jsonb,
  confidence numeric,
  salience numeric,
  status text,
  source text,
  created_at timestamptz,
  updated_at timestamptz,
  indexed_at timestamptz,
  hybrid_score double precision,
  fts_rank real,
  semantic_distance double precision
)
language sql
stable
as $$
  with filtered as (
    select
      d.memory_id,
      d.user_id,
      d.memory_type,
      d.memory_kind,
      m.memory_content,
      d.confidence,
      d.salience,
      d.status,
      m.source,
      m.created_at,
      m.updated_at,
      d.indexed_at,
      d.search_tsv,
      d.embedding
    from public.memory_search_documents d
    join public.memories m
      on m.id = d.memory_id
    where d.user_id = p_user_id
      and d.status = 'active'
      and m.user_id = p_user_id
      and m.status = 'active'
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
      f.memory_id,
      row_number() over (
        order by ts_rank_cd(f.search_tsv, q.ts_query) desc, f.salience desc, f.updated_at desc, f.memory_id desc
      ) as rank_idx,
      ts_rank_cd(f.search_tsv, q.ts_query) as score
    from filtered f
    cross join fts_query q
    where q.ts_query is not null
      and f.search_tsv @@ q.ts_query
    order by score desc, f.salience desc, f.updated_at desc, f.memory_id desc
    limit 100
  ),
  semantic_candidates as (
    select
      f.memory_id,
      row_number() over (
        order by f.embedding <=> p_query_embedding, f.salience desc, f.updated_at desc, f.memory_id desc
      ) as rank_idx,
      (f.embedding <=> p_query_embedding) as distance
    from filtered f
    where p_query_embedding is not null
    order by distance asc, f.salience desc, f.updated_at desc, f.memory_id desc
    limit 100
  ),
  candidate_scores as (
    select
      memory_id,
      sum(rrf_score) as hybrid_score,
      max(fts_score) as fts_rank,
      min(semantic_distance) as semantic_distance
    from (
      select
        memory_id,
        (1.0 / (50 + rank_idx))::double precision as rrf_score,
        score as fts_score,
        null::double precision as semantic_distance
      from fts_candidates
      union all
      select
        memory_id,
        (1.0 / (50 + rank_idx))::double precision as rrf_score,
        null::real as fts_score,
        distance as semantic_distance
      from semantic_candidates
    ) scored
    group by memory_id
  )
  select
    f.memory_id,
    f.user_id,
    f.memory_type,
    f.memory_kind,
    f.memory_content,
    f.confidence,
    f.salience,
    f.status,
    f.source,
    f.created_at,
    f.updated_at,
    f.indexed_at,
    scores.hybrid_score,
    scores.fts_rank,
    scores.semantic_distance
  from candidate_scores scores
  join filtered f
    on f.memory_id = scores.memory_id
  order by scores.hybrid_score desc, f.salience desc, f.updated_at desc, f.memory_id desc
  limit greatest(1, least(coalesce(p_limit, 24), 100));
$$;

grant execute on function public.hybrid_search_memories(
  uuid,
  text,
  vector,
  int
) to authenticated, service_role;

update public.llm_model_routes
set is_active = false
where scope = 'memory_retrieval_embed'
  and is_active = true;

insert into public.llm_model_routes (
  scope,
  route_name,
  provider,
  model,
  config,
  is_active
)
values (
  'memory_retrieval_embed',
  'primary',
  'openai',
  'text-embedding-3-small',
  jsonb_build_object('timeout_ms', 45000),
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
where scope = 'memory_retrieval_embed'
  and is_active = true;

insert into public.llm_prompts (
  scope,
  version,
  name,
  template,
  metadata,
  is_active
)
values (
  'memory_retrieval_embed',
  1,
  'Memory retrieval embedding',
  '',
  jsonb_build_object('kind', 'embedding'),
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
where scope = 'memory_retrieval_embed'
  and is_active = true;

insert into public.llm_rules (
  scope,
  version,
  name,
  rule,
  is_active
)
values (
  'memory_retrieval_embed',
  1,
  'Memory retrieval embedding rule',
  jsonb_build_object(
    'response_contract', 'memory_retrieval_embedding_v1',
    'dimensions', 1536,
    'normalize', 'unit'
  ),
  true
)
on conflict (scope, version) do update
set
  name = excluded.name,
  rule = excluded.rule,
  is_active = excluded.is_active;
