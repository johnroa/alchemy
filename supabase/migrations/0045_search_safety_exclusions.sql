-- ============================================================================
-- 0045_search_safety_exclusions.sql
--
-- Adds safety exclusion parameters to recipe search RPCs so the API can
-- filter out recipes containing ingredients the user is allergic to or
-- has dietary restrictions against, even in the browse/explore "all" feed.
--
-- Changes:
--   - list_recipe_search_documents: adds p_exclude_ingredient_names and
--     p_exclude_diet_restriction_tags parameters.
--   - Both parameters are optional (default empty arrays) so existing
--     callers are unaffected.
--
-- The hybrid_search_recipe_documents RPC already supports
-- p_exclude_ingredient_names, so no changes needed there.
-- ============================================================================

-- Replace the all-feed RPC with safety exclusion support.
-- We must drop and recreate because adding parameters changes the signature.
create or replace function public.list_recipe_search_documents(
  p_snapshot_cutoff_indexed_at timestamptz,
  p_explore_only boolean default false,
  p_limit int default 20,
  p_cursor_indexed_at timestamptz default null,
  p_cursor_recipe_id uuid default null,
  -- Safety exclusion: filter out recipes containing any of these ingredients
  -- (matched against canonical_ingredient_names via overlap).
  p_exclude_ingredient_names text[] default '{}',
  -- Safety exclusion: filter out recipes that do NOT have ALL of these diet tags.
  -- e.g. if user is gluten-free, pass '{"gluten-free"}' and recipes without
  -- the gluten-free tag will be excluded.
  p_require_diet_tags text[] default '{}'
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
    -- Safety: exclude recipes with restricted ingredients.
    and (
      coalesce(array_length(p_exclude_ingredient_names, 1), 0) = 0
      or not (d.canonical_ingredient_names && p_exclude_ingredient_names)
    )
    -- Safety: require specific diet tags (e.g. gluten-free, nut-free).
    and (
      coalesce(array_length(p_require_diet_tags, 1), 0) = 0
      or d.diet_tags @> p_require_diet_tags
    )
  order by d.indexed_at desc, d.recipe_id desc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

-- Grant stays the same but we need to re-grant for the new parameter
-- signature. PostgreSQL function overloading means both old and new
-- signatures coexist — the old one (without exclusion params) still works.
grant execute on function public.list_recipe_search_documents(
  timestamptz,
  boolean,
  int,
  timestamptz,
  uuid,
  text[],
  text[]
) to authenticated, service_role;
