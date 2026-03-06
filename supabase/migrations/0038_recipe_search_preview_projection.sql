alter table public.recipe_search_documents
  add column if not exists category text,
  add column if not exists recipe_updated_at timestamptz not null default now();

update public.recipe_search_documents documents
set
  category = top_auto_category.category,
  recipe_updated_at = recipes.updated_at,
  updated_at = now()
from public.recipes recipes
left join lateral (
  select category
  from public.recipe_auto_categories
  where recipe_id = recipes.id
  order by confidence desc nulls last, category asc
  limit 1
) as top_auto_category
  on true
where recipes.id = documents.recipe_id
  and (
    documents.category is distinct from top_auto_category.category
    or documents.recipe_updated_at is distinct from recipes.updated_at
  );

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
  category text,
  visibility text,
  updated_at timestamptz,
  quick_stats jsonb,
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
    d.category,
    d.visibility,
    d.recipe_updated_at as updated_at,
    case
      when d.time_minutes is not null
        and d.difficulty is not null
        and d.health_score is not null
        and d.ingredient_count is not null
      then jsonb_build_object(
        'time_minutes', d.time_minutes,
        'difficulty', d.difficulty,
        'health_score', d.health_score,
        'items', d.ingredient_count
      )
      else null::jsonb
    end as quick_stats,
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
  category text,
  visibility text,
  updated_at timestamptz,
  quick_stats jsonb,
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
    d.category,
    d.visibility,
    d.recipe_updated_at as updated_at,
    case
      when d.time_minutes is not null
        and d.difficulty is not null
        and d.health_score is not null
        and d.ingredient_count is not null
      then jsonb_build_object(
        'time_minutes', d.time_minutes,
        'difficulty', d.difficulty,
        'health_score', d.health_score,
        'items', d.ingredient_count
      )
      else null::jsonb
    end as quick_stats,
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
