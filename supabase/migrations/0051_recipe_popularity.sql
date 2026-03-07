-- ============================================================================
-- 0050_recipe_popularity.sql
--
-- Adds recipe popularity and ingredient trending infrastructure.
--
-- New tables:
--   - recipe_view_events: append-only view tracking for popularity signals
--   - ingredient_trending_stats: per-ingredient popularity + substitution
--     momentum scores
--
-- Altered tables:
--   - recipe_search_documents: adds save_count, variant_count, view_count,
--     popularity_score, trending_score columns + indexes
--
-- New/replaced RPCs:
--   - refresh_recipe_popularity_stats: batch recomputes all popularity
--     and ingredient trending data
--   - list_recipe_search_documents: adds p_sort_by parameter
--
-- Design: popularity stats are pre-computed by a periodic batch job
-- (triggered via admin API or GitHub Action). The batch writes directly
-- to recipe_search_documents so the Explore RPCs can sort by popularity
-- without joins. View events are fire-and-forget inserts from the API.
-- ============================================================================

-- 1. View event tracking -------------------------------------------------

create table if not exists public.recipe_view_events (
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  user_id   uuid not null,
  viewed_at timestamptz not null default now()
);

comment on table public.recipe_view_events is
  'Append-only log of recipe detail views. Used for popularity and '
  'trending computation. Old rows can be pruned (keep 90 days). '
  'No dedup constraint — aggregation uses COUNT(DISTINCT user_id).';

create index if not exists idx_recipe_views_recipe_time
  on public.recipe_view_events (recipe_id, viewed_at);

create index if not exists idx_recipe_views_time
  on public.recipe_view_events (viewed_at);

-- No RLS — service role writes, batch job reads.
alter table public.recipe_view_events enable row level security;

create policy recipe_view_events_service_insert
  on public.recipe_view_events for insert
  to service_role
  with check (true);

create policy recipe_view_events_service_select
  on public.recipe_view_events for select
  to service_role
  using (true);

-- 2. Popularity columns on recipe_search_documents ----------------------

alter table public.recipe_search_documents
  add column if not exists save_count       int not null default 0,
  add column if not exists variant_count    int not null default 0,
  add column if not exists view_count       int not null default 0,
  add column if not exists popularity_score numeric(10,2) not null default 0,
  add column if not exists trending_score   numeric(10,2) not null default 0;

create index if not exists idx_rsd_popularity
  on public.recipe_search_documents (popularity_score desc);

create index if not exists idx_rsd_trending
  on public.recipe_search_documents (trending_score desc);

-- 3. Ingredient trending stats ------------------------------------------

create table if not exists public.ingredient_trending_stats (
  ingredient_id      uuid primary key references public.ingredients(id) on delete cascade,
  canonical_name     text not null,
  recipe_count       int not null default 0,
  trending_recipe_count int not null default 0,
  popularity_score   numeric(10,2) not null default 0,
  trending_score     numeric(10,2) not null default 0,
  -- Substitution momentum: how often this ingredient is swapped IN vs OUT
  -- across variant personalizations. Positive momentum = rising ingredient.
  sub_in_count       int not null default 0,
  sub_out_count      int not null default 0,
  sub_in_count_7d    int not null default 0,
  sub_out_count_7d   int not null default 0,
  -- Scaled momentum: (sub_in_7d - sub_out_7d) / max(sub_in_7d + sub_out_7d, 1) * 100
  -- Range: -100 (declining) to +100 (rising).
  momentum_score     numeric(10,2) not null default 0,
  updated_at         timestamptz not null default now()
);

comment on table public.ingredient_trending_stats is
  'Pre-computed ingredient popularity and substitution momentum. '
  'Recipe-derived: popularity/trending from recipes containing the ingredient. '
  'Substitution-derived: sub_in/sub_out from variant provenance diffs. '
  'Refreshed by the batch popularity job.';

create index if not exists idx_ingredient_trending
  on public.ingredient_trending_stats (trending_score desc);

create index if not exists idx_ingredient_momentum
  on public.ingredient_trending_stats (momentum_score desc);

-- 4. Refresh RPC --------------------------------------------------------
-- Batch recomputes recipe popularity + ingredient trending stats.
-- Called by POST /popularity/refresh admin endpoint.

create or replace function public.refresh_recipe_popularity_stats()
returns jsonb
language plpgsql
security definer
as $$
declare
  v_recipe_count int := 0;
  v_ingredient_count int := 0;
  v_now timestamptz := now();
  v_7d_ago timestamptz := v_now - interval '7 days';
begin
  -- A. Recipe-level popularity -----------------------------------------

  -- Build temp table with all-time and 7-day counts per recipe.
  create temp table _pop_recipe on commit drop as
  select
    rsd.recipe_id,
    coalesce(saves.save_count, 0) as save_count,
    coalesce(saves.save_count_7d, 0) as save_count_7d,
    coalesce(variants.variant_count, 0) as variant_count,
    coalesce(variants.variant_count_7d, 0) as variant_count_7d,
    coalesce(views.view_count, 0) as view_count,
    coalesce(views.view_count_7d, 0) as view_count_7d
  from public.recipe_search_documents rsd
  left join lateral (
    select
      count(*) as save_count,
      count(*) filter (where ce.saved_at >= v_7d_ago) as save_count_7d
    from public.cookbook_entries ce
    where ce.canonical_recipe_id = rsd.recipe_id
  ) saves on true
  left join lateral (
    select
      count(*) as variant_count,
      count(*) filter (where urv.created_at >= v_7d_ago) as variant_count_7d
    from public.user_recipe_variants urv
    where urv.canonical_recipe_id = rsd.recipe_id
  ) variants on true
  left join lateral (
    select
      count(distinct rve.user_id) as view_count,
      count(distinct rve.user_id) filter (where rve.viewed_at >= v_7d_ago) as view_count_7d
    from public.recipe_view_events rve
    where rve.recipe_id = rsd.recipe_id
  ) views on true;

  -- Update recipe_search_documents with computed scores.
  -- Popularity: all-time weighted composite.
  -- Trending: 7-day weighted composite.
  -- Weights: saves=3, variants=2, views=0.5 (tunable here).
  update public.recipe_search_documents rsd
  set
    save_count       = pr.save_count,
    variant_count    = pr.variant_count,
    view_count       = pr.view_count,
    popularity_score = (pr.save_count * 3.0 + pr.variant_count * 2.0 + pr.view_count * 0.5),
    trending_score   = (pr.save_count_7d * 3.0 + pr.variant_count_7d * 2.0 + pr.view_count_7d * 0.5)
  from _pop_recipe pr
  where rsd.recipe_id = pr.recipe_id;

  get diagnostics v_recipe_count = row_count;

  -- B. Ingredient trending stats ---------------------------------------

  -- B1: Recipe-derived ingredient popularity.
  -- For each ingredient in recipe_search_documents.canonical_ingredient_ids,
  -- sum the recipe's popularity and trending scores.
  create temp table _pop_ingredient on commit drop as
  select
    unnest(rsd.canonical_ingredient_ids) as ingredient_id,
    count(*) as recipe_count,
    count(*) filter (where rsd.trending_score > 0) as trending_recipe_count,
    sum(rsd.popularity_score) as sum_popularity,
    sum(rsd.trending_score) as sum_trending
  from public.recipe_search_documents rsd
  where array_length(rsd.canonical_ingredient_ids, 1) > 0
  group by 1;

  -- B2: Substitution momentum from variant provenance.
  -- Scan substitution_diffs in provenance and count sub-in / sub-out
  -- per ingredient name, then match to ingredients table.
  create temp table _sub_momentum on commit drop as
  with diffs as (
    select
      (diff->>'replacement')::text as replacement_name,
      (diff->>'original')::text as original_name,
      vv.created_at
    from public.user_recipe_variant_versions vv,
         jsonb_array_elements(vv.provenance->'substitution_diffs') as diff
    where vv.provenance ? 'substitution_diffs'
      and jsonb_typeof(vv.provenance->'substitution_diffs') = 'array'
  )
  select
    i.id as ingredient_id,
    i.canonical_name,
    -- sub_in: this ingredient was used as a REPLACEMENT
    count(*) filter (where lower(d.replacement_name) = lower(i.canonical_name)) as sub_in_count,
    count(*) filter (where lower(d.replacement_name) = lower(i.canonical_name) and d.created_at >= v_7d_ago) as sub_in_count_7d,
    -- sub_out: this ingredient was the ORIGINAL being replaced
    count(*) filter (where lower(d.original_name) = lower(i.canonical_name)) as sub_out_count,
    count(*) filter (where lower(d.original_name) = lower(i.canonical_name) and d.created_at >= v_7d_ago) as sub_out_count_7d
  from public.ingredients i
  join diffs d on lower(d.replacement_name) = lower(i.canonical_name)
                or lower(d.original_name) = lower(i.canonical_name)
  group by i.id, i.canonical_name;

  -- B3: Upsert ingredient_trending_stats from both sources.
  insert into public.ingredient_trending_stats (
    ingredient_id, canonical_name,
    recipe_count, trending_recipe_count,
    popularity_score, trending_score,
    sub_in_count, sub_out_count,
    sub_in_count_7d, sub_out_count_7d,
    momentum_score,
    updated_at
  )
  select
    coalesce(pi.ingredient_id, sm.ingredient_id) as ingredient_id,
    coalesce(sm.canonical_name, pi.ingredient_id::text) as canonical_name,
    coalesce(pi.recipe_count, 0),
    coalesce(pi.trending_recipe_count, 0),
    coalesce(pi.sum_popularity, 0),
    coalesce(pi.sum_trending, 0),
    coalesce(sm.sub_in_count, 0),
    coalesce(sm.sub_out_count, 0),
    coalesce(sm.sub_in_count_7d, 0),
    coalesce(sm.sub_out_count_7d, 0),
    -- momentum: (in_7d - out_7d) / max(in_7d + out_7d, 1) * 100
    case when coalesce(sm.sub_in_count_7d, 0) + coalesce(sm.sub_out_count_7d, 0) > 0
      then round(
        (coalesce(sm.sub_in_count_7d, 0) - coalesce(sm.sub_out_count_7d, 0))::numeric
        / greatest(coalesce(sm.sub_in_count_7d, 0) + coalesce(sm.sub_out_count_7d, 0), 1)
        * 100, 2
      )
      else 0
    end,
    v_now
  from _pop_ingredient pi
  full outer join _sub_momentum sm on sm.ingredient_id = pi.ingredient_id
  where coalesce(pi.ingredient_id, sm.ingredient_id) is not null
  on conflict (ingredient_id)
  do update set
    canonical_name       = excluded.canonical_name,
    recipe_count         = excluded.recipe_count,
    trending_recipe_count = excluded.trending_recipe_count,
    popularity_score     = excluded.popularity_score,
    trending_score       = excluded.trending_score,
    sub_in_count         = excluded.sub_in_count,
    sub_out_count        = excluded.sub_out_count,
    sub_in_count_7d      = excluded.sub_in_count_7d,
    sub_out_count_7d     = excluded.sub_out_count_7d,
    momentum_score       = excluded.momentum_score,
    updated_at           = excluded.updated_at;

  get diagnostics v_ingredient_count = row_count;

  return jsonb_build_object(
    'recipes_updated', v_recipe_count,
    'ingredients_updated', v_ingredient_count,
    'computed_at', v_now
  );
end;
$$;

grant execute on function public.refresh_recipe_popularity_stats()
  to service_role;

-- 5. Updated list_recipe_search_documents with sort support -------------
-- Adds p_sort_by parameter: 'recent' (default), 'popular', 'trending'.
-- Also returns save_count, variant_count for client display.

create or replace function public.list_recipe_search_documents(
  p_snapshot_cutoff_indexed_at timestamptz,
  p_explore_only boolean default false,
  p_limit int default 20,
  p_cursor_indexed_at timestamptz default null,
  p_cursor_recipe_id uuid default null,
  p_exclude_ingredient_names text[] default '{}',
  p_require_diet_tags text[] default '{}',
  p_sort_by text default 'recent'
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
  save_count int,
  variant_count int
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
    d.indexed_at,
    d.save_count,
    d.variant_count
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
    and (
      coalesce(array_length(p_exclude_ingredient_names, 1), 0) = 0
      or not (d.canonical_ingredient_names && p_exclude_ingredient_names)
    )
    and (
      coalesce(array_length(p_require_diet_tags, 1), 0) = 0
      or d.diet_tags @> p_require_diet_tags
    )
  order by
    case p_sort_by
      when 'popular' then d.popularity_score
      when 'trending' then d.trending_score
      else 0
    end desc nulls last,
    d.indexed_at desc,
    d.recipe_id desc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

grant execute on function public.list_recipe_search_documents(
  timestamptz, boolean, int, timestamptz, uuid, text[], text[], text
) to authenticated, service_role;
