-- Restore the full RecipePreview projection for the explore/search RPC.
--
-- Why this exists:
-- 0051_recipe_popularity.sql added sort support plus save/variant counts, but
-- it also narrowed the returned row shape to only scalar stat columns. The
-- API/search layer and iOS Explore UI still consume the richer preview-shaped
-- contract (`category`, `visibility`, `updated_at`, `quick_stats`), so Explore
-- silently fell back to missing stats and "1970" dates. That removed the
-- right-rail gauges and suppressed recency-based badges like "New".
--
-- This migration restores the original preview projection while preserving the
-- popularity/trending sort behavior and count columns introduced in 0051.

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
  category text,
  visibility text,
  updated_at timestamptz,
  quick_stats jsonb,
  indexed_at timestamptz,
  save_count int,
  variant_count int,
  popularity_score numeric,
  trending_score numeric
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
    d.indexed_at,
    d.save_count,
    d.variant_count,
    d.popularity_score,
    d.trending_score
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
