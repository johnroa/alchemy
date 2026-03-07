-- 0043: Canonical Recipes + Private Variants + Cookbook Architecture
--
-- This migration introduces the variant layer that separates canonical (public,
-- immutable, searchable) recipes from per-user personalised editions (private,
-- mutable, preference-driven).
--
-- New tables:
--   cookbook_entries              – replaces recipe_saves as the user↔recipe relationship
--   user_recipe_variants         – one per (user, canonical recipe), tracks variant lifecycle
--   user_recipe_variant_versions – full version history for a user's variant
--   preference_change_log        – drives propagation jobs and audit trail
--
-- Schema changes:
--   preferences.extended_preferences   – JSONB for new preference categories
--   preferences.propagation_overrides  – JSONB for per-user constraint/preference overrides
--
-- Key invariants:
--   - Canonical recipes (recipes + recipe_versions) are immutable once committed.
--     owner_user_id is attribution only — no editing rights.
--   - Variants are private; they are never indexed in search or visible in Explore.
--   - Only constraint-category preference changes trigger variant staleness.
--   - Rendering-only preferences (units, temp display) never enter the variant pipeline.
--   - recipe_saves is kept for backward compatibility during migration; new saves
--     should use cookbook_entries exclusively.
--   - The preference_fingerprint on user_recipe_variants is a hash of constraint-
--     category preferences at materialization time, used for efficient stale detection.

-- ============================================================================
-- 1. cookbook_entries — the user's relationship to a canonical recipe
-- ============================================================================
-- Replaces recipe_saves. Each row means "this user has this canonical recipe in
-- their cookbook." Points to the active variant (if materialised) and controls
-- whether auto-personalisation is enabled.

create table if not exists public.cookbook_entries (
  user_id              uuid not null references public.users(id) on delete cascade,
  canonical_recipe_id  uuid not null references public.recipes(id) on delete cascade,
  active_variant_id    uuid,  -- FK added after user_recipe_variants exists
  autopersonalize      boolean not null default true,
  saved_at             timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (user_id, canonical_recipe_id)
);

comment on table public.cookbook_entries is
  'Per-user relationship to a canonical recipe. Replaces recipe_saves.';
comment on column public.cookbook_entries.autopersonalize is
  'When true, constraint preference changes automatically refresh the variant.';
comment on column public.cookbook_entries.active_variant_id is
  'Points to the user''s active variant for this recipe, or null if no variant exists.';

create index idx_cookbook_entries_recipe
  on public.cookbook_entries (canonical_recipe_id);

-- ============================================================================
-- 2. user_recipe_variants — one per (user, canonical recipe)
-- ============================================================================
-- Tracks the variant lifecycle: which canonical version it was derived from,
-- the preference fingerprint at materialisation time, and staleness state.
-- stale_status values:
--   current       – variant is up to date with user's constraint preferences
--   stale         – constraint preferences changed; needs re-personalisation
--   processing    – re-personalisation is in progress
--   failed        – re-personalisation failed (retryable)
--   needs_review  – manual edits conflict with new constraints; user must resolve

create table if not exists public.user_recipe_variants (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references public.users(id) on delete cascade,
  canonical_recipe_id         uuid not null references public.recipes(id) on delete cascade,
  current_version_id          uuid,  -- FK added after variant_versions exists
  base_canonical_version_id   uuid not null references public.recipe_versions(id) on delete restrict,
  preference_fingerprint      text,
  stale_status                text not null default 'current'
                              check (stale_status in (
                                'current', 'stale', 'processing', 'failed', 'needs_review'
                              )),
  last_materialized_at        timestamptz,
  created_at                  timestamptz not null default now(),
  unique (user_id, canonical_recipe_id)
);

comment on table public.user_recipe_variants is
  'One variant per (user, canonical recipe). Tracks lifecycle and staleness.';
comment on column public.user_recipe_variants.base_canonical_version_id is
  'The canonical recipe_version this variant was derived from. Set once (canonical is immutable).';
comment on column public.user_recipe_variants.preference_fingerprint is
  'Hash of constraint-category preferences active when variant was last materialised. '
  'Used for efficient stale detection — only constraint changes invalidate.';
comment on column public.user_recipe_variants.stale_status is
  'Variant lifecycle state. needs_review means manual edits conflict with new constraints.';

create index idx_user_recipe_variants_user
  on public.user_recipe_variants (user_id);
create index idx_user_recipe_variants_recipe
  on public.user_recipe_variants (canonical_recipe_id);
create index idx_user_recipe_variants_stale
  on public.user_recipe_variants (stale_status)
  where stale_status in ('stale', 'failed', 'needs_review');

-- ============================================================================
-- 3. user_recipe_variant_versions — full version history for a variant
-- ============================================================================
-- Separate from canonical recipe_versions. Each row is a complete recipe payload
-- as seen by the user, plus provenance tracking what was applied and how.
-- derivation_kind values:
--   auto_personalized – created from preferences only (no manual edits)
--   manual_edit       – user explicitly edited their variant
--   mixed             – auto-personalized then manually edited

create table if not exists public.user_recipe_variant_versions (
  id                          uuid primary key default gen_random_uuid(),
  variant_id                  uuid not null references public.user_recipe_variants(id) on delete cascade,
  parent_variant_version_id   uuid references public.user_recipe_variant_versions(id) on delete set null,
  source_canonical_version_id uuid not null references public.recipe_versions(id) on delete restrict,
  payload                     jsonb not null,
  derivation_kind             text not null default 'auto_personalized'
                              check (derivation_kind in (
                                'auto_personalized', 'manual_edit', 'mixed'
                              )),
  provenance                  jsonb not null default '{}'::jsonb,
  created_at                  timestamptz not null default now()
);

comment on table public.user_recipe_variant_versions is
  'Full version history for a user''s recipe variant. Separate from canonical recipe_versions.';
comment on column public.user_recipe_variant_versions.provenance is
  'Structured record of what was applied: applied_constraints, applied_preferences, '
  'manual_edit_diff (JSON Patch), manual_edit_instructions, preference_fingerprint.';
comment on column public.user_recipe_variant_versions.derivation_kind is
  'How this version was created: auto from preferences, manual user edit, or both.';

create index idx_variant_versions_variant
  on public.user_recipe_variant_versions (variant_id);

-- ============================================================================
-- 4. Add deferred foreign keys now that all tables exist
-- ============================================================================

alter table public.cookbook_entries
  add constraint cookbook_entries_variant_fk
  foreign key (active_variant_id)
  references public.user_recipe_variants(id)
  on delete set null;

alter table public.user_recipe_variants
  add constraint user_recipe_variants_current_version_fk
  foreign key (current_version_id)
  references public.user_recipe_variant_versions(id)
  on delete set null;

-- ============================================================================
-- 5. preference_change_log — audit trail and propagation driver
-- ============================================================================
-- Every preference change (from chat, settings, or onboarding) is logged here.
-- Rows with propagation = 'retroactive' drive background variant refresh jobs.
-- Rows with propagation = 'forward_only' are informational audit trail.

create table if not exists public.preference_change_log (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  field         text not null,
  old_value     jsonb,
  new_value     jsonb,
  category      text not null check (category in ('constraint', 'preference', 'rendering')),
  propagation   text not null check (propagation in ('retroactive', 'forward_only', 'none')),
  source        text not null check (source in ('chat', 'settings', 'onboarding')),
  processed_at  timestamptz,
  created_at    timestamptz not null default now()
);

comment on table public.preference_change_log is
  'Audit trail for preference changes. Rows with propagation=retroactive drive variant refresh jobs.';
comment on column public.preference_change_log.processed_at is
  'Timestamp when the propagation job processed this change. Null = pending.';

create index idx_preference_change_log_user
  on public.preference_change_log (user_id);
create index idx_preference_change_log_pending
  on public.preference_change_log (created_at)
  where processed_at is null and propagation = 'retroactive';

-- ============================================================================
-- 6. Extend preferences table with new columns
-- ============================================================================
-- extended_preferences: structured JSONB for new preference categories that
-- don't warrant their own columns (kitchen_environment, religious_rules,
-- spice_tolerance, time_budget, budget, flavor_affinities, cooking_style,
-- pantry_staples, health_goals, household_detail). Each key maps to
-- { values: [...], propagation: "constraint" | "preference" }.
--
-- propagation_overrides: per-user overrides for default constraint/preference
-- classification. Example: { "vegetarian": "constraint", "low_sodium": "preference" }
-- These override the system defaults when the assistant classifies a gray-zone item.

alter table public.preferences
  add column if not exists extended_preferences jsonb not null default '{}'::jsonb;

alter table public.preferences
  add column if not exists propagation_overrides jsonb not null default '{}'::jsonb;

comment on column public.preferences.extended_preferences is
  'Structured JSONB for preference categories beyond the typed columns. '
  'Keys are category slugs (e.g. kitchen_environment, spice_tolerance). '
  'Values are { values: [...], propagation: "constraint" | "preference" }.';
comment on column public.preferences.propagation_overrides is
  'Per-user overrides for default constraint/preference classification. '
  'Example: { "vegetarian": "constraint" } to make vegetarian retroactive for this user.';

-- ============================================================================
-- 7. RLS policies
-- ============================================================================
-- cookbook_entries, user_recipe_variants, and variant_versions are private to
-- the owning user. Admin service role bypasses RLS.

alter table public.cookbook_entries enable row level security;
alter table public.user_recipe_variants enable row level security;
alter table public.user_recipe_variant_versions enable row level security;
alter table public.preference_change_log enable row level security;

-- cookbook_entries: users can read/write their own entries
create policy "Users can manage their own cookbook entries"
  on public.cookbook_entries
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- user_recipe_variants: users can read/write their own variants
create policy "Users can manage their own recipe variants"
  on public.user_recipe_variants
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- user_recipe_variant_versions: users can read/write versions of their own variants
create policy "Users can manage their own variant versions"
  on public.user_recipe_variant_versions
  for all
  using (
    variant_id in (
      select id from public.user_recipe_variants
      where user_id = auth.uid()
    )
  )
  with check (
    variant_id in (
      select id from public.user_recipe_variants
      where user_id = auth.uid()
    )
  );

-- preference_change_log: users can read their own log (writes are service-role only)
create policy "Users can read their own preference change log"
  on public.preference_change_log
  for select
  using (auth.uid() = user_id);

-- ============================================================================
-- 8. Seed new graph relation types for variant/canonical edges
-- ============================================================================
-- derived_from: links a new canonical recipe to the one that inspired it
-- (e.g., user says "add carrots to this rigatoni" → new canonical with
-- derived_from edge to the original). Builds recipe family trees.

insert into public.graph_relation_types (name, description)
values
  ('derived_from', 'Links a new canonical recipe to the canonical it was derived from (recipe family tree)')
on conflict (name) do nothing;
