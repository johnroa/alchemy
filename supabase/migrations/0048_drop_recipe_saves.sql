-- ============================================================================
-- 0048_drop_recipe_saves.sql
--
-- Drops the legacy recipe_saves table. All data was backfilled into
-- cookbook_entries in migration 0047, and all application code paths
-- now read/write exclusively from cookbook_entries.
-- ============================================================================

drop table if exists public.recipe_saves;
