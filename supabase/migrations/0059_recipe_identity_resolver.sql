-- Unified recipe identity resolver:
--   - recipe_identity_documents stores exact/content + image fingerprints plus
--     canon retrieval text and embeddings.
--   - image_requests / recipe_image_assignments gain explicit durable
--     resolution fields so workflow state is not hidden in JSON blobs.
--   - canon-family lookup RPCs replace global first-seen image reuse search.
--   - backfill populates identity docs and resolution fields for existing rows.

create extension if not exists vector;
create extension if not exists pgcrypto;

create or replace function public.recipe_identity_numeric_or_null(p_text text)
returns numeric
language sql
immutable
as $$
  select case
    when nullif(trim(coalesce(p_text, '')), '') is null then null
    when trim(p_text) ~ '^-?[0-9]+(\.[0-9]+)?$' then trim(p_text)::numeric
    else null
  end
$$;

create or replace function public.recipe_identity_integer_or_null(p_text text)
returns integer
language sql
immutable
as $$
  select case
    when nullif(trim(coalesce(p_text, '')), '') is null then null
    when trim(p_text) ~ '^-?[0-9]+$' then trim(p_text)::integer
    else null
  end
$$;

create or replace function public.recipe_identity_content_payload(p_payload jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'servings',
    public.recipe_identity_numeric_or_null(p_payload ->> 'servings'),
    'ingredients',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'name', lower(trim(coalesce(item ->> 'name', ''))),
          'amount', public.recipe_identity_numeric_or_null(item ->> 'amount'),
          'unit', nullif(lower(trim(coalesce(item ->> 'unit', ''))), ''),
          'preparation', nullif(lower(trim(coalesce(item ->> 'preparation', ''))), ''),
          'category', nullif(lower(trim(coalesce(item ->> 'category', ''))), ''),
          'component', nullif(lower(trim(coalesce(item ->> 'component', ''))), '')
        )
        order by ord
      )
      from jsonb_array_elements(coalesce(p_payload -> 'ingredients', '[]'::jsonb))
        with ordinality as ingredients(item, ord)
    ), '[]'::jsonb),
    'steps',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'index', public.recipe_identity_integer_or_null(step_item ->> 'index'),
          'instruction', lower(trim(coalesce(step_item ->> 'instruction', ''))),
          'timer_seconds', public.recipe_identity_integer_or_null(step_item ->> 'timer_seconds'),
          'notes', nullif(lower(trim(coalesce(step_item ->> 'notes', ''))), ''),
          'inline_measurements', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'ingredient', lower(trim(coalesce(measurement ->> 'ingredient', ''))),
                'amount', public.recipe_identity_numeric_or_null(measurement ->> 'amount'),
                'unit', nullif(lower(trim(coalesce(measurement ->> 'unit', ''))), '')
              )
              order by measurement_ord
            )
            from jsonb_array_elements(coalesce(step_item -> 'inline_measurements', '[]'::jsonb))
              with ordinality as inline_measurements(measurement, measurement_ord)
          ), '[]'::jsonb)
        )
        order by step_ord
      )
      from jsonb_array_elements(coalesce(p_payload -> 'steps', '[]'::jsonb))
        with ordinality as steps(step_item, step_ord)
    ), '[]'::jsonb),
    'notes', nullif(lower(trim(coalesce(p_payload ->> 'notes', ''))), '')
  )
$$;

create or replace function public.recipe_identity_image_payload(p_payload jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'servings',
    public.recipe_identity_numeric_or_null(p_payload ->> 'servings'),
    'ingredients',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'name', lower(trim(coalesce(item ->> 'name', ''))),
          'amount', public.recipe_identity_numeric_or_null(item ->> 'amount'),
          'unit', nullif(lower(trim(coalesce(item ->> 'unit', ''))), ''),
          'preparation', nullif(lower(trim(coalesce(item ->> 'preparation', ''))), ''),
          'category', nullif(lower(trim(coalesce(item ->> 'category', ''))), ''),
          'component', nullif(lower(trim(coalesce(item ->> 'component', ''))), '')
        )
        order by ord
      )
      from jsonb_array_elements(coalesce(p_payload -> 'ingredients', '[]'::jsonb))
        with ordinality as ingredients(item, ord)
    ), '[]'::jsonb),
    'steps',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'index', public.recipe_identity_integer_or_null(step_item ->> 'index'),
          'instruction', lower(trim(coalesce(step_item ->> 'instruction', ''))),
          'timer_seconds', public.recipe_identity_integer_or_null(step_item ->> 'timer_seconds'),
          'inline_measurements', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'ingredient', lower(trim(coalesce(measurement ->> 'ingredient', ''))),
                'amount', public.recipe_identity_numeric_or_null(measurement ->> 'amount'),
                'unit', nullif(lower(trim(coalesce(measurement ->> 'unit', ''))), '')
              )
              order by measurement_ord
            )
            from jsonb_array_elements(coalesce(step_item -> 'inline_measurements', '[]'::jsonb))
              with ordinality as inline_measurements(measurement, measurement_ord)
          ), '[]'::jsonb)
        )
        order by step_ord
      )
      from jsonb_array_elements(coalesce(p_payload -> 'steps', '[]'::jsonb))
        with ordinality as steps(step_item, step_ord)
    ), '[]'::jsonb)
  )
$$;

create or replace function public.recipe_identity_text_from_payload(p_payload jsonb)
returns text
language sql
immutable
as $$
  select trim(
    concat_ws(
      E'\n',
      nullif(trim(coalesce(p_payload ->> 'title', '')), ''),
      nullif(
        trim(
          coalesce(
            p_payload ->> 'summary',
            p_payload ->> 'description',
            ''
          )
        ),
        ''
      ),
      (
        select string_agg(
          distinct trim(coalesce(item ->> 'name', '')),
          E'\n'
          order by trim(coalesce(item ->> 'name', ''))
        )
        from jsonb_array_elements(coalesce(p_payload -> 'ingredients', '[]'::jsonb)) as ingredients(item)
        where nullif(trim(coalesce(item ->> 'name', '')), '') is not null
      ),
      (
        select string_agg(
          distinct trim(value),
          E'\n'
          order by trim(value)
        )
        from jsonb_array_elements_text(coalesce(p_payload -> 'pairings', '[]'::jsonb)) as pairings(value)
        where nullif(trim(value), '') is not null
      ),
      (
        select string_agg(
          distinct trim(value),
          E'\n'
          order by trim(value)
        )
        from jsonb_array_elements_text(coalesce(p_payload -> 'metadata' -> 'cuisine_tags', '[]'::jsonb)) as cuisine(value)
        where nullif(trim(value), '') is not null
      ),
      (
        select string_agg(
          distinct trim(value),
          E'\n'
          order by trim(value)
        )
        from jsonb_array_elements_text(coalesce(p_payload -> 'metadata' -> 'techniques', '[]'::jsonb)) as techniques(value)
        where nullif(trim(value), '') is not null
      ),
      nullif(trim(coalesce(p_payload -> 'metadata' ->> 'vibe', '')), '')
    )
  )
$$;

create table if not exists public.recipe_identity_documents (
  recipe_version_id uuid primary key
    references public.recipe_versions(id) on delete cascade,
  recipe_id uuid not null
    references public.recipes(id) on delete cascade,
  is_current_version boolean not null default false,
  content_fingerprint text not null,
  image_fingerprint text not null,
  canonical_ingredient_ids uuid[] not null default '{}',
  canonical_ingredient_names text[] not null default '{}',
  identity_text text not null default '',
  embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists recipe_identity_documents_content_fingerprint_idx
  on public.recipe_identity_documents(content_fingerprint);

create index if not exists recipe_identity_documents_recipe_current_idx
  on public.recipe_identity_documents(recipe_id, is_current_version, updated_at desc);

create index if not exists recipe_identity_documents_embedding_hnsw_idx
  on public.recipe_identity_documents using hnsw (embedding vector_cosine_ops);

alter table public.recipe_identity_documents enable row level security;

drop policy if exists recipe_identity_documents_service_read on public.recipe_identity_documents;
create policy recipe_identity_documents_service_read
  on public.recipe_identity_documents
  for select
  using (auth.role() = 'service_role');

create table if not exists public.recipe_identity_duplicate_reports (
  id uuid primary key default gen_random_uuid(),
  report_kind text not null default 'content_fingerprint',
  content_fingerprint text not null,
  recipe_ids uuid[] not null default '{}',
  recipe_version_ids uuid[] not null default '{}',
  duplicate_count integer not null check (duplicate_count >= 2),
  created_at timestamptz not null default now()
);

create index if not exists recipe_identity_duplicate_reports_created_idx
  on public.recipe_identity_duplicate_reports(created_at desc);

alter table public.recipe_identity_duplicate_reports enable row level security;

drop policy if exists recipe_identity_duplicate_reports_service_read on public.recipe_identity_duplicate_reports;
create policy recipe_identity_duplicate_reports_service_read
  on public.recipe_identity_duplicate_reports
  for select
  using (auth.role() = 'service_role');

alter table public.image_requests
  add column if not exists image_fingerprint text not null default '',
  add column if not exists matched_recipe_id uuid references public.recipes(id) on delete set null,
  add column if not exists matched_recipe_version_id uuid references public.recipe_versions(id) on delete set null,
  add column if not exists resolution_reason text,
  add column if not exists judge_invoked boolean not null default false,
  add column if not exists judge_candidate_count integer not null default 0
    check (judge_candidate_count >= 0);

alter table public.recipe_image_assignments
  add column if not exists matched_recipe_id uuid references public.recipes(id) on delete set null,
  add column if not exists matched_recipe_version_id uuid references public.recipe_versions(id) on delete set null,
  add column if not exists resolution_reason text,
  add column if not exists judge_invoked boolean not null default false,
  add column if not exists judge_candidate_count integer not null default 0
    check (judge_candidate_count >= 0);

create index if not exists image_requests_matched_recipe_idx
  on public.image_requests(matched_recipe_id, status, updated_at desc);

create index if not exists image_requests_image_fingerprint_idx
  on public.image_requests(image_fingerprint, updated_at desc);

create index if not exists recipe_image_assignments_matched_recipe_idx
  on public.recipe_image_assignments(matched_recipe_id, created_at desc);

with ingredient_rollup as (
  select
    ri.recipe_version_id,
    array_remove(array_agg(distinct ri.ingredient_id order by ri.ingredient_id), null) as canonical_ingredient_ids,
    array_remove(
      array_agg(
        distinct nullif(
          trim(
            coalesce(
              ingredients.canonical_name,
              ri.metadata ->> 'canonical_name',
              ri.source_name
            )
          ),
          ''
        )
        order by nullif(
          trim(
            coalesce(
              ingredients.canonical_name,
              ri.metadata ->> 'canonical_name',
              ri.source_name
            )
          ),
          ''
        )
      ),
      null
    ) as canonical_ingredient_names
  from public.recipe_ingredients ri
  left join public.ingredients ingredients
    on ingredients.id = ri.ingredient_id
  group by ri.recipe_version_id
),
current_versions as (
  select
    recipes.id as recipe_id,
    versions.id as recipe_version_id,
    versions.payload,
    versions.created_at,
    recipes.current_version_id = versions.id as is_current_version,
    coalesce(ingredient_rollup.canonical_ingredient_ids, '{}'::uuid[]) as canonical_ingredient_ids,
    coalesce(ingredient_rollup.canonical_ingredient_names, '{}'::text[]) as canonical_ingredient_names
  from public.recipe_versions versions
  join public.recipes recipes
    on recipes.id = versions.recipe_id
  left join ingredient_rollup
    on ingredient_rollup.recipe_version_id = versions.id
)
insert into public.recipe_identity_documents (
  recipe_version_id,
  recipe_id,
  is_current_version,
  content_fingerprint,
  image_fingerprint,
  canonical_ingredient_ids,
  canonical_ingredient_names,
  identity_text,
  embedding,
  created_at,
  updated_at
)
select
  recipe_version_id,
  recipe_id,
  is_current_version,
  encode(digest(public.recipe_identity_content_payload(payload)::text, 'sha256'), 'hex'),
  encode(digest(public.recipe_identity_image_payload(payload)::text, 'sha256'), 'hex'),
  canonical_ingredient_ids,
  canonical_ingredient_names,
  trim(
    concat_ws(
      E'\n',
      public.recipe_identity_text_from_payload(payload),
      array_to_string(canonical_ingredient_names, E'\n')
    )
  ),
  null,
  created_at,
  now()
from current_versions
where is_current_version = true
on conflict (recipe_version_id) do update
set
  recipe_id = excluded.recipe_id,
  is_current_version = excluded.is_current_version,
  content_fingerprint = excluded.content_fingerprint,
  image_fingerprint = excluded.image_fingerprint,
  canonical_ingredient_ids = excluded.canonical_ingredient_ids,
  canonical_ingredient_names = excluded.canonical_ingredient_names,
  identity_text = excluded.identity_text,
  updated_at = now();

with ingredient_rollup as (
  select
    ri.recipe_version_id,
    array_remove(array_agg(distinct ri.ingredient_id order by ri.ingredient_id), null) as canonical_ingredient_ids,
    array_remove(
      array_agg(
        distinct nullif(
          trim(
            coalesce(
              ingredients.canonical_name,
              ri.metadata ->> 'canonical_name',
              ri.source_name
            )
          ),
          ''
        )
        order by nullif(
          trim(
            coalesce(
              ingredients.canonical_name,
              ri.metadata ->> 'canonical_name',
              ri.source_name
            )
          ),
          ''
        )
      ),
      null
    ) as canonical_ingredient_names
  from public.recipe_ingredients ri
  left join public.ingredients ingredients
    on ingredients.id = ri.ingredient_id
  group by ri.recipe_version_id
),
historical_versions as (
  select
    recipes.id as recipe_id,
    versions.id as recipe_version_id,
    versions.payload,
    versions.created_at,
    recipes.current_version_id = versions.id as is_current_version,
    coalesce(ingredient_rollup.canonical_ingredient_ids, '{}'::uuid[]) as canonical_ingredient_ids,
    coalesce(ingredient_rollup.canonical_ingredient_names, '{}'::text[]) as canonical_ingredient_names
  from public.recipe_versions versions
  join public.recipes recipes
    on recipes.id = versions.recipe_id
  left join ingredient_rollup
    on ingredient_rollup.recipe_version_id = versions.id
)
insert into public.recipe_identity_documents (
  recipe_version_id,
  recipe_id,
  is_current_version,
  content_fingerprint,
  image_fingerprint,
  canonical_ingredient_ids,
  canonical_ingredient_names,
  identity_text,
  embedding,
  created_at,
  updated_at
)
select
  recipe_version_id,
  recipe_id,
  is_current_version,
  encode(digest(public.recipe_identity_content_payload(payload)::text, 'sha256'), 'hex'),
  encode(digest(public.recipe_identity_image_payload(payload)::text, 'sha256'), 'hex'),
  canonical_ingredient_ids,
  canonical_ingredient_names,
  trim(
    concat_ws(
      E'\n',
      public.recipe_identity_text_from_payload(payload),
      array_to_string(canonical_ingredient_names, E'\n')
    )
  ),
  null,
  created_at,
  now()
from historical_versions
where is_current_version = false
on conflict (recipe_version_id) do update
set
  recipe_id = excluded.recipe_id,
  is_current_version = excluded.is_current_version,
  content_fingerprint = excluded.content_fingerprint,
  image_fingerprint = excluded.image_fingerprint,
  canonical_ingredient_ids = excluded.canonical_ingredient_ids,
  canonical_ingredient_names = excluded.canonical_ingredient_names,
  identity_text = excluded.identity_text,
  updated_at = now();

create temp table tmp_image_request_fingerprint_map on commit drop as
with ranked as (
  select
    requests.id as duplicate_request_id,
    first_value(requests.id) over (
      partition by encode(
        digest(public.recipe_identity_content_payload(requests.recipe_payload)::text, 'sha256'),
        'hex'
      )
      order by
        case when requests.status = 'ready' then 0 else 1 end,
        requests.updated_at desc,
        requests.id asc
    ) as canonical_request_id
  from public.image_requests requests
)
select
  duplicate_request_id,
  canonical_request_id
from ranked
where duplicate_request_id <> canonical_request_id;

insert into public.candidate_image_bindings (
  chat_session_id,
  candidate_id,
  candidate_revision,
  component_id,
  image_request_id,
  created_at,
  updated_at
)
select
  bindings.chat_session_id,
  bindings.candidate_id,
  bindings.candidate_revision,
  bindings.component_id,
  map.canonical_request_id,
  bindings.created_at,
  now()
from public.candidate_image_bindings bindings
join tmp_image_request_fingerprint_map map
  on map.duplicate_request_id = bindings.image_request_id
on conflict (chat_session_id, candidate_id, candidate_revision, component_id) do update
set
  image_request_id = excluded.image_request_id,
  updated_at = excluded.updated_at;

delete from public.candidate_image_bindings bindings
using tmp_image_request_fingerprint_map map
where bindings.image_request_id = map.duplicate_request_id;

update public.recipe_image_assignments assignments
set
  image_request_id = map.canonical_request_id,
  updated_at = now()
from tmp_image_request_fingerprint_map map
where assignments.image_request_id = map.duplicate_request_id;

delete from public.image_requests requests
using tmp_image_request_fingerprint_map map
where requests.id = map.duplicate_request_id;

update public.image_requests
set
  recipe_fingerprint = encode(
    digest(public.recipe_identity_content_payload(recipe_payload)::text, 'sha256'),
    'hex'
  ),
  image_fingerprint = encode(
    digest(public.recipe_identity_image_payload(recipe_payload)::text, 'sha256'),
    'hex'
  ),
  matched_recipe_id = coalesce(
    matched_recipe_id,
    nullif(reuse_evaluation ->> 'reused_from_recipe_id', '')::uuid
  ),
  matched_recipe_version_id = coalesce(
    matched_recipe_version_id,
    nullif(reuse_evaluation ->> 'reused_from_recipe_version_id', '')::uuid
  ),
  resolution_reason = coalesce(
    resolution_reason,
    case
      when status <> 'ready' then 'legacy'
      when resolution_source = 'reused' then 'legacy_reuse'
      when resolution_source = 'generated' then 'legacy_generate'
      else 'legacy'
    end
  ),
  judge_invoked = coalesce(
    judge_invoked,
    (reuse_evaluation ? 'decision')
  ),
  judge_candidate_count = coalesce(judge_candidate_count, 0),
  updated_at = now();

update public.recipe_image_assignments
set
  matched_recipe_id = coalesce(
    matched_recipe_id,
    reused_from_recipe_id
  ),
  matched_recipe_version_id = coalesce(
    matched_recipe_version_id,
    reused_from_recipe_version_id
  ),
  resolution_reason = coalesce(
    resolution_reason,
    case
      when asset_id is null then 'legacy'
      when assignment_source = 'reused' then 'legacy_reuse'
      when assignment_source = 'generated' then 'legacy_generate'
      else 'legacy'
    end
  ),
  judge_invoked = coalesce(
    judge_invoked,
    (reuse_evaluation ? 'decision')
  ),
  judge_candidate_count = coalesce(judge_candidate_count, 0),
  updated_at = now();

insert into public.recipe_identity_duplicate_reports (
  report_kind,
  content_fingerprint,
  recipe_ids,
  recipe_version_ids,
  duplicate_count
)
select
  'content_fingerprint',
  documents.content_fingerprint,
  array_agg(distinct documents.recipe_id order by documents.recipe_id),
  array_agg(distinct documents.recipe_version_id order by documents.recipe_version_id),
  count(distinct documents.recipe_id)::integer
from public.recipe_identity_documents documents
where documents.is_current_version = true
group by documents.content_fingerprint
having count(distinct documents.recipe_id) >= 2
on conflict do nothing;

create or replace function public.list_recipe_identity_candidates(
  p_query_embedding vector(1536),
  p_exclude_recipe_id uuid default null,
  p_limit integer default 5
)
returns table (
  recipe_id uuid,
  recipe_version_id uuid,
  title text,
  summary text,
  canonical_ingredient_names text[],
  similarity double precision
)
language sql
stable
security definer
set search_path = public
as $$
  with ranked as (
    select
      documents.recipe_id,
      documents.recipe_version_id,
      coalesce(versions.payload ->> 'title', recipes.title, 'Untitled Recipe') as title,
      coalesce(
        nullif(trim(coalesce(versions.payload ->> 'summary', '')), ''),
        nullif(trim(coalesce(versions.payload ->> 'description', '')), ''),
        ''
      ) as summary,
      documents.canonical_ingredient_names,
      1 - (
        coalesce(documents.embedding, search.embedding) <=> p_query_embedding
      ) as similarity
    from public.recipe_identity_documents documents
    join public.recipes recipes
      on recipes.id = documents.recipe_id
    join public.recipe_versions versions
      on versions.id = documents.recipe_version_id
    left join public.recipe_search_documents search
      on search.recipe_version_id = documents.recipe_version_id
    where documents.is_current_version = true
      and recipes.visibility = 'public'
      and coalesce(documents.embedding, search.embedding) is not null
      and (p_exclude_recipe_id is null or documents.recipe_id <> p_exclude_recipe_id)
  )
  select
    recipe_id,
    recipe_version_id,
    title,
    summary,
    canonical_ingredient_names,
    similarity
  from ranked
  order by similarity desc, recipe_id asc
  limit greatest(1, least(coalesce(p_limit, 5), 10));
$$;

grant execute on function public.list_recipe_identity_candidates(
  vector(1536),
  uuid,
  integer
) to authenticated;

create or replace function public.find_canonical_image_exact_match(
  p_recipe_id uuid,
  p_image_fingerprint text,
  p_exclude_request_id uuid default null
)
returns table (
  image_request_id uuid,
  asset_id uuid,
  image_url text,
  recipe_id uuid,
  recipe_version_id uuid,
  normalized_title text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    requests.id as image_request_id,
    requests.asset_id,
    assets.image_url,
    assignments.recipe_id,
    assignments.recipe_version_id,
    requests.normalized_title
  from public.recipe_image_assignments assignments
  join public.image_requests requests
    on requests.id = assignments.image_request_id
  join public.recipe_image_assets assets
    on assets.id = requests.asset_id
  where assignments.recipe_id = p_recipe_id
    and requests.status = 'ready'
    and requests.asset_id is not null
    and requests.image_fingerprint = p_image_fingerprint
    and assets.qa_status <> 'rejected'
    and (p_exclude_request_id is null or requests.id <> p_exclude_request_id)
  order by requests.updated_at desc, requests.id asc
  limit 1;
$$;

grant execute on function public.find_canonical_image_exact_match(
  uuid,
  text,
  uuid
) to authenticated;

create or replace function public.list_canonical_image_reuse_candidates(
  p_recipe_id uuid,
  p_query_embedding vector(1536),
  p_exclude_request_id uuid default null,
  p_limit integer default 3
)
returns table (
  image_request_id uuid,
  asset_id uuid,
  image_url text,
  normalized_title text,
  recipe_id uuid,
  recipe_version_id uuid,
  similarity double precision,
  usage_count integer
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
    from public.recipe_image_assignments assignments
    join public.image_requests requests
      on requests.id = assignments.image_request_id
    join public.recipe_image_assets assets
      on assets.id = requests.asset_id
    where assignments.recipe_id = p_recipe_id
      and requests.status = 'ready'
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
  limit greatest(1, least(coalesce(p_limit, 3), 5));
$$;

grant execute on function public.list_canonical_image_reuse_candidates(
  uuid,
  vector(1536),
  uuid,
  integer
) to authenticated;

create or replace function public.admin_dev_food_reset_targets(preset text)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  normalized text := lower(trim(coalesce(preset, '')));
begin
  case normalized
    when 'recipes_domain_reset' then
      return array[
        'recipe_draft_messages',
        'recipe_drafts',
        'candidate_image_bindings',
        'image_jobs',
        'recipe_image_assignments',
        'image_requests',
        'recipe_identity_duplicate_reports',
        'recipe_identity_documents',
        'recipe_search_sessions',
        'recipe_search_documents',
        'explore_publications',
        'recipe_graph_links',
        'graph_edge_evidence',
        'graph_edges',
        'graph_entities',
        'ingredient_pair_stats',
        'recipe_pair_stats',
        'memory_recipe_links',
        'recipe_version_events',
        'recipe_links',
        'recipe_image_jobs',
        'recipe_image_assets',
        'recipe_auto_categories',
        'recipe_user_categories',
        'collection_items',
        'recipe_saves',
        'enrichment_runs',
        'recipe_metadata_jobs',
        'recipe_ingredient_ontology_links',
        'recipe_ingredient_mentions',
        'recipe_ingredients',
        'recipe_versions',
        'recipes'
      ];
    when 'ingredients_ontology_reset' then
      return array[
        'ingredients',
        'ingredient_aliases',
        'recipe_ingredients',
        'recipe_ingredient_mentions',
        'recipe_ingredient_ontology_links',
        'ingredient_ontology_links',
        'ontology_terms',
        'ingredient_pair_stats',
        'recipe_pair_stats',
        'recipe_graph_links',
        'graph_edge_evidence',
        'graph_edges',
        'graph_entities'
      ];
    when 'graph_reset' then
      return array[
        'recipe_graph_links',
        'graph_edge_evidence',
        'graph_edges',
        'graph_entities',
        'ingredient_pair_stats',
        'recipe_pair_stats'
      ];
    when 'full_food_reset' then
      return array[
        'recipe_draft_messages',
        'recipe_drafts',
        'candidate_image_bindings',
        'image_jobs',
        'recipe_image_assignments',
        'image_requests',
        'recipe_identity_duplicate_reports',
        'recipe_identity_documents',
        'recipe_search_sessions',
        'recipe_search_documents',
        'explore_publications',
        'recipe_graph_links',
        'graph_edge_evidence',
        'graph_edges',
        'graph_entities',
        'memory_recipe_links',
        'recipe_version_events',
        'recipe_links',
        'recipe_image_jobs',
        'recipe_image_assets',
        'recipe_auto_categories',
        'recipe_user_categories',
        'collection_items',
        'recipe_saves',
        'enrichment_runs',
        'recipe_metadata_jobs',
        'recipe_ingredient_ontology_links',
        'recipe_ingredient_mentions',
        'recipe_ingredients',
        'ingredient_pair_stats',
        'recipe_pair_stats',
        'ingredient_ontology_links',
        'ingredient_aliases',
        'ingredients',
        'ontology_terms',
        'recipe_versions',
        'recipes'
      ];
    else
      raise exception using
        errcode = '22023',
        message = 'invalid preset',
        detail = 'Supported presets: recipes_domain_reset, ingredients_ontology_reset, graph_reset, full_food_reset';
  end case;
end;
$$;
