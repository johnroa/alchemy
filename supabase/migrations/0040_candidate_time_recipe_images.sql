-- Candidate-time recipe images: canonical assets, fingerprint-owned requests,
-- shared jobs, candidate bindings, persisted assignments, and reuse evaluation.

create extension if not exists vector;

create table if not exists public.recipe_image_assets (
  id uuid primary key default gen_random_uuid(),
  image_url text not null,
  source_provider text not null,
  source_model text not null,
  source_recipe_id uuid references public.recipes(id) on delete set null,
  source_recipe_version_id uuid references public.recipe_versions(id) on delete set null,
  generation_prompt text,
  generation_metadata jsonb not null default '{}'::jsonb,
  qa_status text not null default 'unreviewed'
    check (qa_status in ('unreviewed', 'approved', 'rejected')),
  usage_count int not null default 0 check (usage_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists recipe_image_assets_created_idx
  on public.recipe_image_assets(created_at desc);

create index if not exists recipe_image_assets_qa_status_idx
  on public.recipe_image_assets(qa_status, created_at desc);

create table if not exists public.image_requests (
  id uuid primary key default gen_random_uuid(),
  recipe_fingerprint text not null unique,
  normalized_title text not null default '',
  normalized_search_text text not null default '',
  recipe_payload jsonb not null default '{}'::jsonb,
  embedding vector(1536),
  asset_id uuid references public.recipe_image_assets(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'ready', 'failed')),
  resolution_source text
    check (resolution_source in ('generated', 'reused')),
  reuse_evaluation jsonb not null default '{}'::jsonb,
  attempt int not null default 0 check (attempt >= 0),
  max_attempts int not null default 5 check (max_attempts >= 1),
  last_error text,
  last_processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists image_requests_status_idx
  on public.image_requests(status, updated_at desc);

create index if not exists image_requests_asset_idx
  on public.image_requests(asset_id);

create index if not exists image_requests_embedding_hnsw_idx
  on public.image_requests using hnsw (embedding vector_cosine_ops);

create table if not exists public.image_jobs (
  id uuid primary key default gen_random_uuid(),
  image_request_id uuid not null references public.image_requests(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'ready', 'failed')),
  attempt int not null default 0 check (attempt >= 0),
  max_attempts int not null default 5 check (max_attempts >= 1),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists image_jobs_unique_open
  on public.image_jobs(image_request_id)
  where status in ('pending', 'processing');

create index if not exists image_jobs_poll_idx
  on public.image_jobs(status, next_attempt_at asc);

create table if not exists public.candidate_image_bindings (
  id uuid primary key default gen_random_uuid(),
  chat_session_id uuid not null references public.chat_sessions(id) on delete cascade,
  candidate_id text not null,
  candidate_revision int not null check (candidate_revision >= 1),
  component_id text not null,
  image_request_id uuid not null references public.image_requests(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chat_session_id, candidate_id, candidate_revision, component_id)
);

create index if not exists candidate_image_bindings_chat_idx
  on public.candidate_image_bindings(chat_session_id, created_at desc);

create index if not exists candidate_image_bindings_request_idx
  on public.candidate_image_bindings(image_request_id, created_at desc);

create table if not exists public.recipe_image_assignments (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  recipe_version_id uuid not null references public.recipe_versions(id) on delete cascade,
  image_request_id uuid not null references public.image_requests(id) on delete cascade,
  asset_id uuid references public.recipe_image_assets(id) on delete set null,
  assignment_source text
    check (assignment_source in ('generated', 'reused')),
  reused_from_recipe_id uuid references public.recipes(id) on delete set null,
  reused_from_recipe_version_id uuid references public.recipe_versions(id) on delete set null,
  reuse_evaluation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recipe_version_id)
);

create index if not exists recipe_image_assignments_recipe_idx
  on public.recipe_image_assignments(recipe_id, created_at desc);

create index if not exists recipe_image_assignments_request_idx
  on public.recipe_image_assignments(image_request_id, created_at desc);

alter table public.recipe_image_assets enable row level security;
alter table public.image_requests enable row level security;
alter table public.image_jobs enable row level security;
alter table public.candidate_image_bindings enable row level security;
alter table public.recipe_image_assignments enable row level security;

create or replace view public.v_image_request_rollup as
select
  date_trunc('hour', created_at) as hour_bucket,
  count(*) filter (where status = 'pending') as pending_count,
  count(*) filter (where status = 'processing') as processing_count,
  count(*) filter (where status = 'ready') as ready_count,
  count(*) filter (where status = 'failed') as failed_count,
  count(*) filter (where resolution_source = 'generated') as generated_count,
  count(*) filter (where resolution_source = 'reused') as reused_count,
  avg(attempt)::numeric(6,2) as avg_attempt
from public.image_requests
group by 1
order by 1 desc;

create or replace function public.list_image_reuse_candidates(
  p_query_embedding vector(1536),
  p_exclude_request_id uuid default null,
  p_limit int default 5
)
returns table (
  image_request_id uuid,
  asset_id uuid,
  image_url text,
  normalized_title text,
  recipe_id uuid,
  recipe_version_id uuid,
  similarity double precision,
  usage_count int
)
language sql
stable
security definer
set search_path = public
as $$
  with ranked_candidates as (
    select
      requests.id as image_request_id,
      requests.asset_id,
      assets.image_url,
      requests.normalized_title,
      assignments.recipe_id,
      assignments.recipe_version_id,
      1 - (requests.embedding <=> p_query_embedding) as similarity,
      assets.usage_count,
      row_number() over (
        partition by requests.asset_id
        order by requests.embedding <=> p_query_embedding asc,
                 requests.updated_at desc,
                 requests.id asc
      ) as asset_rank
    from public.image_requests requests
    join public.recipe_image_assets assets
      on assets.id = requests.asset_id
    left join public.recipe_image_assignments assignments
      on assignments.image_request_id = requests.id
    where requests.status = 'ready'
      and requests.asset_id is not null
      and requests.embedding is not null
      and assets.qa_status <> 'rejected'
      and (p_exclude_request_id is null or requests.id <> p_exclude_request_id)
  )
  select
    image_request_id,
    asset_id,
    image_url,
    normalized_title,
    recipe_id,
    recipe_version_id,
    similarity,
    usage_count
  from ranked_candidates
  where asset_rank = 1
  order by similarity desc, usage_count desc, image_request_id asc
  limit greatest(1, least(coalesce(p_limit, 5), 10));
$$;

grant execute on function public.list_image_reuse_candidates(
  vector(1536),
  uuid,
  int
) to authenticated;

insert into public.llm_model_routes(scope, route_name, provider, model, config, is_active)
values (
  'image_reuse_eval',
  'image_reuse_eval_default',
  'openai',
  'gpt-4.1-mini',
  '{"temperature":0.1,"max_output_tokens":256}'::jsonb,
  true
)
on conflict (scope, route_name) do update
set provider = excluded.provider,
    model = excluded.model,
    config = excluded.config,
    is_active = excluded.is_active;

insert into public.llm_prompts(scope, version, name, template, metadata, is_active)
values (
  'image_reuse_eval',
  1,
  'image_reuse_eval_v1',
  $$You are Alchemy's recipe-image reuse evaluator.

You will receive a target recipe plus up to five candidate hero images that already exist in the system.
Return ONLY one strict JSON object:
{
  "decision": "reuse" | "generate_new",
  "selected_candidate_id": string | null,
  "rationale": string,
  "confidence": number | null
}

Evaluation rules:
- Reuse only when the candidate image would still look correct for the target recipe.
- Prioritize dish identity, plating style, ingredient visibility, and overall visual fit.
- If more than one candidate works, choose the strongest fit.
- If none fit clearly, choose "generate_new".
- selected_candidate_id must be one of the supplied candidate ids when decision = "reuse".
- Keep rationale concise and specific. No markdown or code fences.$$,
  '{"contract":"image_reuse_eval_v1","strict_json":true}'::jsonb,
  true
)
on conflict (scope, version) do update
set name = excluded.name,
    template = excluded.template,
    metadata = excluded.metadata,
    is_active = excluded.is_active;

insert into public.llm_rules(scope, version, name, rule, is_active)
values (
  'image_reuse_eval',
  1,
  'image_reuse_eval_rule_v1',
  '{"response_contract":"image_reuse_eval_v1","strict_json_only":true,"allowed_decisions":["reuse","generate_new"]}'::jsonb,
  true
)
on conflict (scope, version) do update
set name = excluded.name,
    rule = excluded.rule,
    is_active = excluded.is_active;
