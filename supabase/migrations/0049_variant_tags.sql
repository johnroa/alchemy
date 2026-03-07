-- ============================================================================
-- 0049_variant_tags.sql
--
-- Adds materialized variant tags to user_recipe_variants for fast
-- cookbook filtering. Tags are computed at variant materialization time
-- by starting with the canonical recipe's tags and applying the LLM's
-- tag_diff (added/removed). Stored as structured JSONB for multi-
-- dimensional filtering (cuisine, dietary, technique, occasion, time,
-- difficulty, key ingredients).
--
-- The cookbook API returns these tags so the iOS client can filter
-- without additional queries. Tags are re-computed on every variant
-- re-materialization (refresh, constraint change, manual edit).
-- ============================================================================

alter table public.user_recipe_variants
  add column if not exists variant_tags jsonb not null default '{}'::jsonb;

comment on column public.user_recipe_variants.variant_tags is
  'Materialized tag set for the variant, structured by category: '
  '{"cuisine": [...], "dietary": [...], "technique": [...], "occasion": [...], '
  '"time_minutes": N, "difficulty": "...", "key_ingredients": [...]}. '
  'Computed from canonical tags + LLM tag_diff at materialization time. '
  'Used for fast cookbook filtering without graph queries.';

create index if not exists idx_variant_tags
  on public.user_recipe_variants using gin (variant_tags);
