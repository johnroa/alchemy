-- ============================================================================
-- 0047_backfill_cookbook_entries.sql
--
-- Backfills cookbook_entries from recipe_saves for all existing users.
-- After this migration, every recipe_saves row has a corresponding
-- cookbook_entries row, and the application can stop reading from
-- recipe_saves as a fallback.
--
-- Uses INSERT ... ON CONFLICT DO NOTHING so it's safe to run even if
-- some rows were already dual-written during the transition period
-- (Phases 1–5). No data is lost or overwritten.
--
-- Variant creation is NOT batch-triggered here — it happens lazily
-- when the user next views or refreshes their cookbook (per plan:
-- "lazy variant creation for backfilled entries, on next open, not batch").
--
-- After verifying the backfill, recipe_saves dual-writes can be removed
-- and the table can be deprecated (kept for rollback safety).
-- ============================================================================

-- Backfill: copy every recipe_saves row into cookbook_entries.
-- saved_at maps to recipe_saves.created_at; autopersonalize defaults true.
insert into public.cookbook_entries (
  user_id,
  canonical_recipe_id,
  autopersonalize,
  saved_at,
  updated_at
)
select
  rs.user_id,
  rs.recipe_id,
  true,
  rs.created_at,
  rs.created_at
from public.recipe_saves rs
on conflict (user_id, canonical_recipe_id) do nothing;
