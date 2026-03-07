-- ============================================================================
-- 0046_accumulated_manual_edits.sql
--
-- Adds accumulated_manual_edits to user_recipe_variants for manual edit
-- replay during constraint-driven re-personalization.
--
-- When a user manually edits their variant (via Sous Chef tweak bar or
-- chat), the instruction is appended here. When constraints change and
-- the variant is re-materialized, these edits are fed back to the LLM
-- so the user's customizations survive preference changes.
--
-- Each entry: { "instruction": "...", "created_at": "..." }
-- Ordered chronologically. The full list is passed to the LLM during
-- re-personalization so it can reapply or flag conflicts.
-- ============================================================================

alter table public.user_recipe_variants
  add column if not exists accumulated_manual_edits jsonb not null default '[]'::jsonb;

comment on column public.user_recipe_variants.accumulated_manual_edits is
  'Chronological list of manual edit instructions applied to this variant. '
  'Each entry: {"instruction": "...", "created_at": "..."}. Fed back to the '
  'LLM during constraint-driven re-personalization so user customizations '
  'survive preference changes. Cleared when user explicitly resets variant.';
