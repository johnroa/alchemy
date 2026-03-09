# Changelog

## [Unreleased] — 2026-03-08

### Private-First Cookbook Saves + Derived Public Canon (v4.0.0)

- Re-rooted saved recipe ownership on `cookbook_entries` so newly committed chat/import recipes are stored immediately as private cookbook items with real private variant lineage before public canon exists.
- Added cookbook-entry-first backend routes for private detail, private variant refresh, canon retry, and cookbook-entry deletion, while keeping canonical recipe detail and legacy canonical variant routes as compatibility paths.
- Changed chat commit flow to create private cookbook entries and private variants synchronously, then derive public canon asynchronously without passing user-specific prompt context or memory context into canon generation.
- Updated cookbook feed/detail projection to support pending and failed canon states, keep public Explore/web canon-only, and preserve compatibility aliases during the transition (`recipe_id` alongside `canonical_recipe_id`).
- Added the new private-first database migration, updated the OpenAPI contract to `4.0.0`, regenerated generated contracts/admin API docs, and added backend route coverage for cookbook-entry detail and canon retry flows.
- Fixed iOS cookbook decoding for the private-first feed by explicitly mapping cookbook list JSON `id` to Swift `cookbookEntryId`, and documented the entry-first contract in repo and backend docs.

### Render-Driven Recipe Formatting + Candidate Projection (v3.8.2)

- Made recipe formatting fully render-driven across saved detail, variants, and fresh chat/import candidates for units, grouping, inline measurements, verbosity, and temperature units.
- Added structured per-step instruction views plus typed temperature parts in the backend normalization and projection pipeline so verbosity selection no longer pollutes canonical identity.
- Updated candidate-session responses to use the same server-side recipe projection path as persisted recipes, including projected ingredient groups in transient `RecipePayload` responses.
- Updated canonical identity hashing to stabilize across active verbosity selection by fingerprinting the structured balanced instruction view when present.
- Updated cookbook/private recipe detail to prefer variant recipe payloads when available, so personalized cookbook opens render the variant body instead of canonical-first content.
- Documented the new detail/variant query overrides in OpenAPI, bumped the contract to `3.8.2`, and added backend coverage for chat candidate projection plus detail/variant render overrides.

### Runtime Flags v1 + Admin Flags Control Plane (v3.8.1)

- Added a DB-backed runtime flags system with `feature_flag_environments`, `feature_flags`, `feature_flag_environment_configs`, and `feature_flag_state_revisions`.
- Added authenticated `POST /flags/resolve` for server-side flag resolution across `development` and `production`, with short-lived compiled-state caching keyed by per-environment revision.
- Added Admin `Operations / Flags` plus admin APIs for listing, creating, updating, archiving, and previewing runtime flags.
- Migrated the first rollout consumers off env vars: `recipe_canon_match` and `same_canon_image_judge` now resolve from runtime flags instead of process env.
- Added shared flag types/evaluator utilities, targeted backend/admin tests, and logged segment/experiment work as explicit V2 follow-up instead of shipping an overbuilt experimentation system now.

### Enterprise-Ready Demand Graph + Admin Demand Analytics (v3.8.0)

- Added internal-first demand graph storage with append-only `demand_observations`, `demand_fact_values`, `demand_outcomes`, `demand_graph_edges`, and `demand_extraction_jobs`.
- Added non-blocking demand extraction queueing across chat turns, imports, onboarding completion, candidate selection/rejection, recipe commits, recipe saves, variant refreshes, and cook/substitution telemetry.
- Added new demand extraction LLM scopes for observation extraction, iteration delta extraction, entity linking, and outcome summarization.
- Added `POST /demand-jobs/process` and `POST /demand-jobs/backfill` plus incremental demand graph refresh from the new extraction pipeline.
- Tightened behavior telemetry ingestion so rejected event types are surfaced explicitly and new demand-relevant event types are part of the canonical contract.
- Added Admin `/analytics/demand` plus internal admin demand APIs for analytics, observations, graph, trends, outcomes, and review actions.
- Added sampled review workflow primitives for extraction QA with pending/confirmed/rejected review states and an initial admin review queue.
- Updated OpenAPI to `3.8.0`, regenerated contracts/admin route inventory, and added targeted backend/admin tests around the new demand snapshot and analytics page.

### Ingredient Grouping End-to-End + Component Default (v3.7.3)

- Made ingredient grouping a fully supported presentation feature across saved recipe detail and transient Sous Chef candidate previews, limited to `List`, `By Category`, and `By Component`.
- Changed the default grouping fallback from `flat` to `component` when a user has no saved `recipe_group_by` preference, aligning backend behavior with the iOS preferences default.
- Added explicit `component` typing to backend `RecipePayload.ingredients`, fixed personalized variant projection to rebuild render-time ingredient groups from the variant payload, and kept grouping as a derived view projection instead of stored source data.
- Added a shared iOS `PresentationPreferencesStore` plus local candidate-grouping projection so generated recipes respect the current ingredient-grouping preference before save.
- Updated the iOS recipe detail ingredients section to render grouped headers only when there are 2+ groups and otherwise collapse back to the flat list.
- Updated active recipe-generation/import/personalization prompt configs to require inferable ingredient `category` and multi-part `component` labels so grouped rendering has reliable source metadata.
- Updated OpenAPI to `3.7.3`, regenerated contracts/admin API docs, and added backend coverage for default grouping and variant group rebuilding.

### Shared Semantic Facets + Server-Owned Chips (v3.7.2)

- Added high-recall semantic descriptor support to recipe metadata enrichment so canonical recipes can persist a structured `semantic_profile` inventory for downstream chip generation.
- Moved Cookbook and Explore chip generation to the server, with `suggested_chips` on both cookbook and personalized Explore responses plus per-entry `matched_chip_ids` for local cookbook filtering.
- Wired Explore to accept `chip_id` while keeping `preset_id` compatibility plumbing, and updated iOS to render server-provided chips instead of hard-coded Explore presets or client-side cookbook heuristics.
- Stored variant semantic overlays inside `variant_tags.semantic_profile`, surfaced canonical semantics and variant semantic labels in Admin recipe inspection, and added metadata-pipeline/admin analytics visibility for descriptor volume and chip usage.
- Updated OpenAPI to `3.7.2`, regenerated contracts/admin API docs, and added targeted backend/admin changes for the new shared semantic contract.
### Memory Writeback Activation + Retrieval Operations (v3.7.1)

- Turned on automatic non-blocking memory queue draining after chat session creation and message turns so enqueued memory work now realizes the intended writeback pipeline during normal usage.
- Added service-role-safe memory worker execution, plus scheduled GitHub Actions backlog draining for `/memory-jobs/process` when chat traffic is low.
- Added `memory_search_documents`, hybrid per-user memory retrieval, and the `memory_retrieval_embed` LLM scope for scalable shortlist generation before optional `memory_select` reranking.
- Added `POST /memory-search/backfill` and `POST /memory-search/rebuild` for retrieval-doc repair and per-user artifact rebuilds.
- Reworked Admin `/operations/memory` into an actionable operator console with queue health, retrieval coverage, per-user repair actions, and retrieval-aware memory records.
- Replaced the admin memory rebuild proxy so it now calls the real backend rebuild path instead of only writing a placeholder snapshot flag.
- Updated OpenAPI to `3.7.1`, regenerated contracts/admin route inventory, and added targeted backend/admin tests for scheduling, retry behavior, rebuild/backfill proxies, and the new operations UI.

### Documentation / Execution Discipline

- Codified repo execution norms in `README.md` and `AGENTS.md` so deploy/build/debug precedence is explicit: repo docs first, documented repo-root workflows over ad hoc ecosystem recovery paths, and documentation updates required when the documented path is wrong.

### Explore `For You` Personalized Feed + Personalization Analytics (v3.7.0)

- Added `POST /recipes/explore/for-you` as the dedicated personalized Explore feed endpoint, backed by user taste profiles, hybrid retrieval over `recipe_search_documents`, dedicated reranking, and cursor-backed search sessions.
- Added `user_taste_profiles`, `explore_algorithm_versions`, and `explore_impression_outcomes` so Explore can track versioned serving behavior, lift, fallback rate, and why-tag distribution.
- Added new LLM scopes `explore_for_you_profile` and `explore_for_you_rank`, seeded active model routes, and activated prompt/rule configs through the admin LLM control path.
- Explore on iOS now opens on `For You`, uses personalized preset chips through the same endpoint, renders `why_tags`, and no longer uses the global `recent | popular | trending` sort flow.
- Deduplicated materially identical Explore cards before reranking/page assembly so `For You` does not surface duplicate recipe cards in the same feed.
- Reduced `For You` cold-start latency by serving from cached or fallback taste profiles immediately, refreshing richer profiles in the background, and removing synchronous preset-interpret LLM work from the Explore request hot path.
- Added version-aware Explore feed telemetry (`explore_feed_served`, `explore_skipped_recipe`, `explore_hidden_recipe`) plus save attribution with `source_session_id` and `algorithm_version`.
- Added Admin `/boards/personalization` and `/analytics/personalization` for current champion version, lift versus baseline, fallback/latency diagnostics, profile-state breakdowns, and why-tag distribution.
- Added recommender spillover stats to `/boards/operations` so feed latency and fallback pressure are still visible from the operations surface without turning it into the main personalization console.
- Updated OpenAPI to `3.7.0`, regenerated contracts/admin docs, and added targeted backend/admin tests plus iOS build verification for the new For You path.

### Preferences Embedded Sous Chef Chat (v3.6.1)

- Added focused `launch_context` support on `POST /chat` so product surfaces like Preferences can start a dedicated workflow-specific chat session instead of reusing the generic recipe loop.
- Documented `extended_preferences` on `PreferenceProfile` and the new preference-edit intent contract in OpenAPI.
- Rebuilt iOS Preferences around direct settings, display-only recipe formatting, and an embedded minimized Sous Chef chat that expands in-place for category-specific editing.
- Tightened prompt preference packing so stored preferences are truncated and summarized before prompt injection, including compact display-preference context.

### Acquisition-Ready Telemetry + Acquisition Board (v3.6.0)

- Added anonymous install-scoped telemetry via `POST /telemetry/install` for `app_first_open` and `app_session_started` before auth.
- Added `install_id` stitching on authenticated `POST /telemetry/behavior` batches and propagated `X-Install-Id` from the iOS client on authenticated API requests.
- Added `install_profiles` and `user_acquisition_profiles` tables for coarse launch attribution, first-open snapshots, and first milestone timestamps (`signed_in_at`, onboarding, first generation, first save, first cook).
- Added `auth_completed`, `onboarding_started`, and `onboarding_completed` behavior milestones to the canonical event catalog.
- Added iOS install identity persistence, anonymous install telemetry batching, first-open/session-start events, and Sign in with Apple acquisition logging.
- Added Admin `/boards/acquisition` with install cohort KPIs: first opens, sign-in rate, onboarding completion rate, first recipe rate, first save rate, first cook within 7 days, source mix, and install-week returning-cook retention.
- Updated OpenAPI to `3.6.0`, regenerated contracts/admin API docs, and refreshed board/admin route inventory.
- Added deterministic board snapshot tests plus install telemetry route tests.

### Recipe Payload Summary + Long Description (v3.5.2)

- Added optional `summary` to `RecipePayload` for short preview/share copy while keeping `description` as long-form detail copy.
- Updated recipe projection and compatibility fallbacks so historical payloads without `summary` still render correctly.
- Updated search indexing, cookbook assembly, and image-reuse identity to prefer short `summary` over long `description`.
- Fixed variant responses to overlay personalized `description` as well as personalized `summary`.
- Updated iOS candidate payload decoding and detail mapping to preserve distinct short and long recipe copy.

### Executive Boards + First-Party Behavior Telemetry + iOS Sentry (v3.5.0)

- **First-party behavior ledger:** Added append-only `behavior_events` and `behavior_semantic_facts` tables for product telemetry across Explore, Chat, Cookbook, and recipe detail sessions.
- **Behavior ingestion endpoint:** Added `POST /telemetry/behavior`. OpenAPI bumped to `3.5.0`, generated contracts refreshed, and Admin API docs updated.
- **Canonical event catalog:** Added shared behavior event definitions in `packages/shared` and wired them through the iOS client and Supabase edge function.
- **iOS telemetry instrumentation:** Added Explore impressions and opens, Cookbook views/searches/chip usage, chat turn events, recipe-detail dwell heartbeats, and `recipe_cooked_inferred` after 10 minutes of cumulative foreground-active dwell.
- **Recipe save attribution:** `POST /recipes/{id}/save` now accepts `source_surface` and logs first-party `recipe_saved` behavior events.
- **Executive board surfaces:** Added Admin `/boards`, `/boards/engagement`, and `/boards/operations` routes plus a `/boards/personalization` placeholder while ranking rollups stabilize.
- **Board UI kit:** Added first-party executive cards, chart shells, and table shells inspired by the approved shadcn references and applied them to the new board pages plus selected analytics pages.
- **Board KPI rollups:** Added engagement and operations board data builders over `behavior_events` plus existing LLM and dashboard telemetry.
- **Admin navigation:** Boards are now a first-class section in the Admin shell.
- **iOS Sentry wiring:** Added Sentry Cocoa, app startup bootstrap in `AlchemyApp`, Info.plist-backed DSN/sample-rate config, MetricKit support, app-hang tracking, and privacy-safe defaults.
- **Test coverage:** Added board KPI tests, updated analytics page tests, aligned route tests with `cookbook_entries` and current OpenAPI schema, and made shared DB config lazy so route tests do not require live env vars at import time.

### Recipe Import (v3.2.0)

- **POST /chat/import endpoint:** Accepts a recipe source (URL, pasted text, or cookbook-page photo) and returns a seeded ChatSession with a CandidateRecipeSet. Imported recipes enter the existing Generate flow (iteration via `/chat/{id}/messages`, commit via `/chat/{id}/commit`).
- **URL scraping:** Built-in recipe scraper with Schema.org JSON-LD extraction, microdata fallback, and OpenGraph meta fallback. Bounded fetcher with timeout, redirect cap, byte cap, and private-network rejection (SSRF protection).
- **Text import:** Accepts pasted recipe text (up to 50k chars) and processes through LLM normalisation.
- **Photo import:** Cookbook-page photos uploaded to Supabase Storage, then extracted via `recipe_import_vision_extract` LLM scope using vision-capable models.
- **LLM pipeline scopes:** `recipe_import_transform` (ImportedRecipeDocument → RecipePayload + AssistantReply) and `recipe_import_vision_extract` (cookbook photo → ImportedRecipeDocument). Both routed through gpt-4.1.
- **Copyright compliance:** All imported recipe text is rewritten in Alchemy's voice by the transform scope — source phrasing is never reproduced verbatim. Images are always re-generated.
- **Source fingerprint deduplication:** Per-user fingerprint on normalised source content enables idempotent retry and re-share detection. Existing completed imports return the cached session.
- **import_provenance table:** Tracks import metadata, extraction strategy, confidence, error state, and telemetry. Linked to chat_sessions and recipe_versions for full audit trail.
- **Admin Imports page:** New admin page at `/imports` with KPI cards (total imports, success rate, avg latency, cache hit rate), source kind and extraction strategy breakdowns, recent imports table, and failure details.
- **Admin Dashboard integration:** Import Activity section on main dashboard with total imports, success rate, avg latency, and source breakdown.
- **iOS import entry point:** 4th tab bar button in TabShell using `Tab(role: .search)` for visually separated Liquid Glass circle. Opens confirmation dialog with Paste URL, Take Photo, and Paste Text options.
- **iOS import views:** ImportView and ImportViewModel for URL paste, text paste, and photo capture/selection flows.
- **iOS share extension:** AlchemyShareExtension accepts URLs, text, and images from other apps. Uses App Group handoff to main app via `alchemy://import` URL scheme.
- **GenerateView integration:** `importedSession` binding allows GenerateView to enter `.presenting` phase directly from an imported chat session.
- OpenAPI version bumped to 3.2.0. Added `ImportRequest` (oneOf: ImportUrlRequest, ImportTextRequest, ImportPhotoRequest) schema with discriminator.

### Recipe & Ingredient Popularity + Trending (v3.3.0)

- **Recipe popularity scoring:** New `save_count`, `variant_count`, `view_count`, `popularity_score`, and `trending_score` columns on `recipe_search_documents`. All-time and 7-day weighted composites (saves x3, variants x2, views x0.5).
- **Explore discovery badges:** `RecipePreview` now carries `popularity_score` and `trending_score` so clients can label recipes as `Trending`, `Popular`, `New`, and `Rising` using source-of-truth discovery metrics instead of ad hoc UI-only heuristics.
- **View tracking:** New `recipe_view_events` table with fire-and-forget logging on `GET /recipes/{id}`. Append-only, deduped by `COUNT(DISTINCT user_id)` during aggregation.
- **Ingredient trending:** New `ingredient_trending_stats` table with two signals: recipe-derived popularity (sum of recipe scores) and substitution momentum (sub-in vs sub-out from variant provenance diffs). Momentum scaled -100 to +100.
- **Batch refresh RPC:** `refresh_recipe_popularity_stats()` recomputes all recipe and ingredient stats in a single transaction. Triggered via `POST /popularity/refresh`.
- **Explore sort:** `POST /recipes/search` now accepts `sort_by` parameter (`recent`, `popular`, `trending`). RPC `list_recipe_search_documents` updated with `p_sort_by`. Returns `save_count` and `variant_count` in `RecipePreview`.
- **Trending ingredients endpoint:** New `GET /ingredients/trending` with `?sort=trending|momentum&limit=N`.
- **iOS Explore updates:** Sort picker (New/Popular/Trending), social proof badges on Explore cards ("42 saves · 12 versions"), trending ingredients data loading.
- **Admin API routes:** `POST /api/admin/popularity/refresh`, `GET /api/admin/ingredients/trending`.
- OpenAPI version bumped to 3.3.0. Added `IngredientTrendingStat` schema, `sort_by` to `RecipeSearchRequest`, `save_count`/`variant_count` to `RecipePreview`.

### Pipeline Observability (v3.3.0)

- **Pipeline Health dashboard:** New admin page at `/pipeline-health` showing per-scope LLM call stats (total calls, error rate, p50/p95/max latency, tokens, cost), variant health breakdown (current/stale/processing/failed/needs_review), and graph edge creation rate.
- **`get_pipeline_observability_stats` RPC:** Aggregates LLM events, variant health, and graph activity into a single JSONB response. Supports configurable lookback window (`p_hours`, default 24).
- **`GET /observability/pipeline` endpoint** with `?hours=N` query param.
- **Admin API route** at `GET /api/admin/observability/pipeline`.

### Graph Feedback Loop (v3.1.0)

- **Graph-grounded personalization:** `personalizeRecipe` now queries the knowledge graph for proven substitution patterns (source: `variant_aggregation`) relevant to the user's constraints before calling the LLM. The LLM receives these as `graph_substitutions` grounding context.
- **Structured substitution diffs:** LLM output now includes `substitution_diffs` — each entry records `original`, `replacement`, `constraint`, and `reason` for ingredient swaps. Stored in variant version provenance.
- **Batch substitution aggregation:** New `POST /graph/substitution-aggregate` admin endpoint scans variant provenance, aggregates substitution patterns across all users, and creates/strengthens `substitutes_for` + `alternative_to` graph edges with `source: variant_aggregation`. Confidence scales logarithmically with occurrence count.
- **"What did my Sous Chef change?" view:** iOS recipe detail now shows a collapsible section listing ingredient substitutions with constraint badges and reasons. Loads from variant provenance via `GET /recipes/{id}/variant`.
- Added `SubstitutionDiff` OpenAPI schema. Updated `VariantRefreshResponse` with `substitution_diffs` and `conflicts` fields.
- Admin API route at `/api/admin/graph/substitution-aggregate` to trigger batch aggregation.

### Graph-Enabled Variant Tags + Cookbook Filtering (v3.1.0)

- **Breaking (minor):** `variant_tags` in `CookbookEntry` changed from `string[]` to structured `VariantTags` object with `cuisine`, `dietary`, `technique`, `occasion`, `time_minutes`, `difficulty`, and `key_ingredients` fields for multi-dimensional cookbook filtering.
- Added `VariantTags` OpenAPI schema.
- Added `variant_tags` JSONB column to `user_recipe_variants` with GIN index for fast server-side filtering.
- Variant tags are computed at materialization time from canonical recipe metadata + LLM tag diff (added/removed).
- Tags are re-computed on every variant refresh (constraint change, manual edit, explicit refresh).
- Dropped legacy `recipe_saves` table (all data was backfilled to `cookbook_entries` in prior migration).
- iOS Cookbook view now supports multi-dimensional filtering by cuisine, dietary, time, difficulty, and key ingredients.

### Canonical Recipes + Private Variants + Cookbook Architecture (v3.0.0)

- **Breaking:** API version bumped to 3.0.0. Major architectural change separating canonical (public, immutable) recipes from per-user private variants.
- Added `cookbook_entries` table replacing `recipe_saves` as the user-to-recipe relationship, with variant tracking and autopersonalise toggle.
- Added `user_recipe_variants` table (one per user per canonical recipe) tracking variant lifecycle, preference fingerprint, and stale status.
- Added `user_recipe_variant_versions` table for full variant version history with provenance, derivation kind, and lineage.
- Added `preference_change_log` table for audit trail and retroactive propagation job driver.
- Added `extended_preferences` and `propagation_overrides` JSONB columns to `preferences` table for new preference categories and per-user constraint/preference classification overrides.
- Added `recipe_canonicalize` LLM scope — strips user-specific adaptations from a personalised chat candidate to produce the canonical base recipe.
- Added `recipe_personalize` LLM scope — materialises a user's private variant from canonical base + preferences + explicit edits.
- Seeded DB routes, prompts, and rules for both new scopes (gpt-4.1, temperature 0.3/0.4).
- Added `derived_from` graph relation type for recipe family tree edges.
- New API endpoints: `GET /recipes/{id}/variant`, `POST /recipes/{id}/variant/refresh`, `POST /recipes/{id}/publish`.
- Updated `POST /recipes/{id}/save` to accept `autopersonalize` flag and return cookbook entry state with variant status.
- Updated `GET /recipes/cookbook` to return `CookbookEntry` objects with variant status, personalised summaries, and variant tags.
- Updated `CommitChatRecipesResponse` to include variant IDs and status per committed recipe.
- Typed `ChatResponseContext.preference_updates` as `PreferenceUpdate[]` (was untyped object) for iOS inline preference-saved cards.
- New schemas: `VariantStatus`, `CookbookEntry`, `SaveRecipeResponse`, `RecipeVariant`, `VariantRefreshResponse`, `PreferenceUpdate`.
- RLS policies ensure variants and cookbook entries are private to the owning user.

## 2026-03-05

### Candidate-Time Recipe Images + Admin Images Console

- Moved recipe image enrollment earlier so candidate components start resolving hero images as soon as chat generation or iteration returns a candidate set.
- Added candidate component `image_url` and `image_status` to the chat contract and updated iOS generate flow to render/poll those async states.
- Introduced shared image request orchestration with canonical image assets, candidate bindings, persisted recipe assignments, global reuse evaluation, and generic image jobs.
- Made recipe image truthfulness strict:
  - missing images no longer use placeholder URLs
  - missing images no longer surface synthetic `ready` state
  - search/explore eligibility now tracks real attached assets only
- Added a consolidated Admin `/images` page with overview, live pipeline queue, shared assets/reuse provenance, and image QA tooling.
- Added scheduled GitHub Actions queue draining for image jobs and route/test coverage for candidate image responses and persisted save attachment behavior.

### Search-Backed Explore API Cleanup

- Promoted `POST /v1/recipes/search` to the canonical recipe discovery API for search and Explore feed pagination
- Realigned `/v1/recipes/search` and `/v1/recipes/cookbook` around a shared `RecipePreview` contract
- Documented preview `quick_stats`, `visibility`, and `cookbook_insight` in the public API surface
- Extended indexed recipe search documents with category and recipe `updated_at` so previews can be served directly from the search index
- Made category precedence deterministic:
  - cookbook uses user override > highest-confidence auto category > fallback
  - search and Explore use indexed auto category > fallback
- Added preview projector tests, recipes route tests, and contract checks covering cookbook/search response alignment

### Recipe Search / RAG Backend

- Added `POST /v1/recipes/search` for shared Explore/chat recipe retrieval
- Added hybrid recipe search backend storage:
  - `recipe_search_documents`
  - `recipe_search_sessions`
  - Postgres full-text + pgvector retrieval functions
- Added graph entity identity hardening with `graph_entities.entity_key` so recipe graph nodes key off stable recipe ids instead of titles
- Extended the metadata pipeline with a `search_index` stage that rebuilds search documents after enrichment completes
- Added new LLM scopes for search:
  - `recipe_search_embed`
  - `recipe_search_interpret`
  - `recipe_search_rerank`

### Admin Console + API — Recipe and Image Simulations

- Renamed the existing admin simulation page to **Recipe Simulations** at `/simulation-recipe`
- Added `/simulations` redirect to `/simulation-recipe`
- Added new **Image Simulations** page at `/simulation-image` for curated recipe-title A/B image compares
- Added `POST /v1/image-simulations/compare` and `POST /api/admin/simulation-image/compare`
- Added optional NDJSON streaming for image compares so lane results can render as soon as each model finishes
- Added new `image_quality_eval` LLM scope for server-side pairwise image judging
- Added `image_simulation_run_started`, `image_simulation_run_completed`, and `image_simulation_run_failed` admin events
- Extended `llm_model_registry` with explicit billing metadata for image-priced models and now write image `cost_usd` into `llm_call` events

### Recipe Generation Recovery

- Canonical recipe metadata normalization is now shared across generation-time normalization, recipe metadata enrichment merge, and public recipe serialization.
- Recipe generation no longer invents fallback `difficulty` or `health_score`; missing model signals now fail normalization instead of silently defaulting.
- Added chat-loop preference-conflict state and thread-local override plumbing so explicit dish conflicts can be confirmed before generation.
- Unified diacritic-safe token normalization across ingredient keys, ontology keys, semantic diet normalization, and admin ingredient normalization views.
- Added repeatable recipe-audit tooling with persona cohorts via `scripts/run-recipe-audit.mjs`.
- Activated new admin prompt versions for `chat_ideation`, `chat_generation`, `chat_iteration`, `generate`, and `recipe_metadata_enrich`.
- Restored prior active chat/generate rules after uncovering a `scripts/admin-api.sh rule-create` failure mode that can deactivate a scope without successfully inserting the replacement rule.

### Recipe Generation — Guaranteed Quick Stats

- Generation-time recipe normalization now guarantees quick stats in `recipe.metadata`:
  - `time_minutes` (integer, derived from timing metadata or step timers)
  - `difficulty` (`easy` | `medium` | `complex`)
  - `health_score` (integer `1-100`)
  - `items` (ingredient count-style item total)
- Added `recipe.metadata.quick_stats` object with the same normalized fields for UI-friendly access.
- Updated OpenAPI contract for `RecipeMetadata` to document these fields and constrain `difficulty` to the new enum.

### Semantic Graph + Metadata Pipeline Refactor (LLM-first)

- Added ingredient-line decomposition stage using `ingredient_line_parse` scope:
  - `recipe_ingredient_mentions` persistence (mention role + alternative groups)
  - `recipe_ingredient_ontology_links` persistence (qualifier ontology links)
- Reworked canonical ingredient resolution flow to:
  - split compound lines into mentions
  - support alternatives (`alternative_group_key`)
  - persist only confidence-gated (`>= 0.85`) enrichment artifacts
- Expanded graph relationship wiring:
  - recipe→ingredient: `primary_ingredient`, `optional_ingredient`, `alternative_ingredient`
  - ingredient↔ingredient: `alternative_to` edges from alternative groups
  - recipe↔recipe: attachment-derived directional relations (`is_side_of`, `is_appetizer_of`, `is_dessert_of`, `is_drink_of`, `pairs_with`)
- Added metadata recompute targeting endpoint:
  - `POST /v1/metadata-jobs/recompute-scope`
  - supports `recipe_ids`, `recipe_version_ids`, `leaked_only`, `current_versions_only`, `limit`

### Consistency and Guardrails

- Replaced heuristic diet-compatibility patching with table-driven semantic rules:
  - new `semantic_diet_incompatibility_rules` table
  - new compatibility module + tests:
    - `supabase/functions/v1/semantic-diet-compatibility.ts`
    - `supabase/functions/v1/semantic-diet-compatibility.test.ts`
- Removed legacy keyword heuristics:
  - deleted `ingredient-enrichment-guards.ts` and tests
- Tightened semantic scope behavior:
  - alias/line/enrichment inference paths no longer merge deterministic fallback outputs
  - missing confidence now resolves to `0` (dropped by confidence gate), not optimistic defaults

### Development Reset Console

- Added migration-backed reset framework:
  - `development_operation_runs`
  - `admin_dev_food_data_preview(...)`
  - `admin_dev_food_data_wipe(...)`
- Added admin endpoints:
  - `POST /api/admin/development/reset/preview`
  - `POST /api/admin/development/reset/execute`
  - `GET /api/admin/development/runs`
- Added Admin UI page:
  - `/development` with preset selection, dry-run preview, typed confirmation, execute, and run audit table
- Refreshed reset target coverage for the current food schema so recipe/full resets now count and wipe newer search, image, publication, and draft artifacts instead of silently reporting `0` when only those tables contain rows.

### Admin API Helper (`scripts/admin-api.sh`)

New CLI tool for managing LLM config and running ad-hoc queries against the Supabase Management API. Auto-resolves the Supabase CLI token from macOS keychain.

- `sql` / `sql-file` — run SQL queries directly
- `prompt-list` / `prompt-create` / `prompt-activate` — versioned prompt management
- `rule-list` / `rule-create` — versioned rule management
- `route-list` — inspect active model routes per scope
- `service-key` / `sim-token` — auth token helpers for testing

### Admin Console — API Reference Page (`/api-docs`)

New auto-generated API reference page powered directly from the OpenAPI spec (`packages/contracts/openapi.json`). Admin routes are discovered by scanning the filesystem at render time.

- Two tabs: Main API (from OpenAPI spec) and Admin API (from route handler discovery)
- Grouped by tag/path prefix with method badges, search, expandable request/response details
- Schema preview with `$ref` resolution
- Auto-updates on OpenAPI spec changes — no manual sync needed
- `yaml-to-json.mjs` script added to `packages/contracts/` for spec conversion

### LLM Gateway — Prompt & Parsing Overhaul

Fixed Haiku generation failures (`chat_schema_invalid`) and reduced latency by ~50%.

#### Root cause fixes
- Removed contradictory `runtimeConstraints` in `llm-gateway.ts` — "Do not enforce artificial ingredient, step, or token budgets" and "Prefer complete and practical recipe outputs over compressed outlines" were appended after the prompt template, causing Haiku to ignore conciseness constraints and produce invalid output
- Kept only essential runtime constraints: strict JSON, no markdown, match contract schema

#### Prompt versions (via versioning system, not code changes)
- `chat_ideation` v108 — inline recipe generation when `trigger_recipe=true`, eliminating the second LLM call; concrete JSON shape examples; 1 component default
- `chat_generation` v110 — simplified with explicit JSON shape, 1 component default
- `chat_iteration` v107 — simplified, matching format

#### Context slimming (`index.ts`)
- Removed `memory_snapshot` from both ideation and generation contexts (redundant with `selected_memories`)
- Removed `ideation_response` from generation context (redundant with user message)

#### Route config
- Set `max_tokens: 4096` for `chat_generation`, `chat_iteration`, `chat_ideation`, `chat` routes (down from default 8096)

### Admin Console — Semantic Ingredient Icons

Ingredient icons across admin pages now resolve to food-specific SVG icons based on canonical name, normalized key, and enrichment metadata.

#### New Shared Package Exports (`packages/shared/`)
- `resolveIngredientIconKey` — maps ingredient context to one of 35+ icon categories (seafood, poultry, herb, grain, etc.)
- `resolveIngredientSemanticIconId` — fuzzy-matches ingredient names against a 230-entry semantic index for exact food icons
- `SHADCN_FOOD_ICON_CATALOG` / `INGREDIENT_SEMANTIC_ICON_INDEX` — icon and index catalogs

#### New Admin Components
- `ShadcnFoodIcon` — renders SVG food icons from generated sprite components
- `DeltaBadge` — shared velocity badge (up/down/flat with absolute + percent labels); used on Recipes and Ingredients pages
- `deltaFromWindow(current, previous)` — shared delta computation helper
- `EntityTypeIcon` — expanded: resolves semantic food icons for ingredients, falls back to category-based icons, then generic

#### Updated Pages
- **Recipes** (`/recipes`) — data-driven coverage snapshot cards with progress bars, velocity section with DeltaBadge, failed image rate metric, wider split-panel layout
- **Ingredients** (`/ingredients`) — semantic food icons in alias table and page header
- **Graph** (`/graph`) — overflow-x fix, page no longer breaks layout on wide graphs

### Admin Console — Graph Visualizer Improvements

- Removed hover state tracking (cleaner interaction model — click to select)
- Camera control tracking: auto-fit only fires once after simulation settles; user interactions (drag, zoom, click) disable auto-fit
- Fullscreen uses native `requestFullscreen()` on the canvas surface instead of manual CSS positioning
- Memoized `forceGraphData` to prevent unnecessary re-renders
- Overflow fixes (`min-w-0`) throughout the graph layout

### Admin Console — Simulation Runner Enhancements

- `chat_generation_trigger` step: inverted logic to correctly handle the case where refine already produced candidates vs needing a fresh trigger API call
- New `candidate_set_active_component` step: switches active tab to the second component to verify multi-tab operations
- Snapshot comparison in `chat_iterate_candidate` now uses the post-active-component snapshot

### LLM Gateway — Recipe Normalization Improvements

- `numericToDisplayFraction` — new helper that converts numeric amounts back to display fractions (e.g., `1.5` → `"1 1/2"`); used as fallback when `display_amount` is missing from LLM output
- Fraction regex relaxed: `^(\d+)\/(\d+)$` → `^(\d+)\/(\d+)` to match fractions followed by trailing text
- Removed hardcoded `max_output_tokens` / `max_tokens` overrides and timeout floor from runtime model config — these are now fully DB-driven via route config
- Legacy constraint fields (`token_budget`, `ingredient_budget`, `max_ingredients`, `max_steps`) cleaned up via shared `cleanLegacyModelConfig` helper

### LLM Scope Registry — Retry Policy Changes

- `chat_generation` and `chat_iteration` scopes: retry reduced from 2 attempts to 1, retryable codes cleared
- Retry logic moved to `converseChatWithRetry` in `v1/index.ts` — retries on schema validation errors (422, `chat_schema_invalid`, `llm_invalid_json`, `llm_json_truncated`, `llm_empty_output`) with a single retry

### Chat Orchestration — Generation Failure Resilience

- When generation fails in `orchestrateChatTurn`, the response now includes `trigger_recipe: true` and `response_context.mode: "generation"` so the client knows generation was intended but failed — enables "generation failed, tap to retry" UX

### API UX Simulation Script

Complete rewrite of `scripts/simulate-api-ux.mjs` to match the current chat-driven candidate loop:

- `chat_start` — opens with an ideation message ("I want dinner ideas")
- `chat_refine` — sends a specific recipe request with constraints
- `chat_generate_trigger` — triggers generation ("Generate the recipe now with a side")
- `chat_iterate_candidate` — iterates on the candidate ("Make it spicier and quicker")
- `commit_candidate_set` — commits the candidate via `POST /chat/{id}/commit`
- `fetch_committed_recipe` — reads the committed recipe with unit/grouping params
- `fetch_cookbook` — verifies recipe appears in cookbook
- `chat_out_of_scope_guard` — verifies out-of-scope message stays in ideation

### iOS App — Visual Polish

- Glass modifier: reduced opacity/intensity for user bubbles and composer surfaces (more subtle, less frosted)
- Panel background: slower animation cycle (54s vs 20s), reduced gradient/bloom/stroke intensity
- Header top inset increased from 20pt to 24pt
- Recipe canvas: dynamic top inset (108pt when candidate active, 24pt otherwise)
- Generation animation dismissal now uses `withAnimation(.easeInOut)` for smooth fade
- Tab bar visibility: consolidated into single `updateTabVisibility` helper, removed redundant `onChange(of: keyboard.isVisible)` handler

### iOS App — Data Model

- `ChatMessageItem` now includes optional `metadata: [String: JSONValue]?` field
- `JSONValue` gains `objectValue` computed property for dictionary access

---

## [Unreleased] — 2026-03-03

### Admin Console — Full Overhaul

Complete redesign and expansion of the admin dashboard at `apps/admin/`.

#### New Pages
- **Changelog** (`/changelog`) — audit log of all system mutations with action/scope distribution bar charts
- **Image Pipeline** (`/image-pipeline`) — image job queue with status badges, attempt progress, and per-job retry
- **Memory** (`/memory`) — user memory snapshots with confidence/salience quality charts, type distribution, and full content preview
- **Request Trace** (`/request-trace`) — gateway event log with expandable rows, inline error highlighting, scope/model shown per event, and a request inspector that loads the full event trace by ID
- **Simulations** (`/simulations`) — A/B simulation runner: two independent model config lanes with a side-by-side step latency comparison table and delta highlighting
- **Version Causality** (`/version-causality`) — recipe version causal chains with attachment links

#### Redesigned Pages
- **Dashboard** — smart cost formatting, image pipeline stacked bar chart, recent activity feed, two-column layout
- **Recipes** — split-panel layout: sticky recipe list on left, tabbed detail panel on right (timeline, prompts, revision map, changelog)
- **Prompts / Rules** — scope-picker with active-indicator dots, active version shown prominently in readable card, inactive versions collapsible, inline "New Version" form
- **Graph** — edges show entity labels instead of raw UUIDs, sorted by confidence descending
- **Memory** — user emails, actual memory content text, quality charts

#### New API Routes
- `POST /api/admin/changelog` — paginated changelog query
- `GET/POST /api/admin/image/jobs` — image job queue
- `POST /api/admin/image/jobs/process` — trigger queue processing
- `POST /api/admin/image/jobs/retry` — retry a failed job
- `POST /api/admin/memories` — query user memories
- `POST /api/admin/memories/rebuild` — rebuild a user's memory snapshot
- `POST /api/admin/memories/reset` — reset all memories for a user
- `GET /api/admin/recipes/[id]/causality` — version causality for a recipe
- `GET /api/admin/request-trace/[requestId]` — fetch full event trace by request ID
- `POST /api/admin/simulations/run` — run a 9-step simulation

#### Data Layer (`lib/admin-data.ts`)
- `getDashboardData` — added image counts, recent activity from changelog_events
- `getGraphData` — entity label map, graceful missing-table handling, edges with from/to labels
- `getMemoryData` — user email join, memory content field
- `getRequestTraceData` — event_payload and latency_ms added to events

#### Infrastructure
- `NEXT_PUBLIC_SUPABASE_URL` added to `wrangler.jsonc` vars (fixes Cloudflare build)
- `ADMIN_SIMULATION_BEARER_TOKEN` required for simulation and image-job processing endpoints

---

### LLM Model Registry

New `llm_model_registry` table as the single source of truth for all known AI models — pricing, context window, availability.

#### Database
- **`0010_model_registry`** — `llm_model_registry` table: `provider`, `model`, `display_name`, `input_cost_per_1m_tokens`, `output_cost_per_1m_tokens`, `context_window_tokens`, `max_output_tokens`, `is_available`, `notes`; `unique(provider, model)`
- **`0011_seed_model_registry`** — 9 seeded models: GPT-4.1, GPT-4.1 Mini, GPT-4o, GPT-4o Mini, o3, o4-mini, Claude Opus 4.6, Claude Sonnet 4.6, Claude Haiku 4.5

#### Admin Console
- **Models page** (`/models`) — full CRUD: add/remove models, toggle availability, edit cost fields inline
- **`GET/POST/PATCH/DELETE /api/admin/llm/models`** — model registry CRUD API
- **DB-driven dropdowns** — provider/model selects in Model Assignments and simulation overrides now derive from registry; zero hardcoded values
- **Navigation** — "Provider & Model" renamed to "Model Assignments"; "Models" added to side nav; `LlmSubnav` tab bar removed (all pages now use left nav)

#### Gateway Token & Cost Tracking
- `TokenAccum` — mutable `{ input, output, costUsd }` accumulator threaded through all gateway calls
- `ProviderResult<T>` — new `callProvider` return type that extracts token counts from provider API responses
- `addTokens` helper — accumulates counts and computes `costUsd` via per-model pricing from registry
- `GatewayConfig` extended with `inputCostPer1m` and `outputCostPer1m` loaded from `llm_model_registry`
- `logLlmEvent` writes `token_input`, `token_output`, `token_total`, `cost_usd` on every LLM call

---

### Admin Console — Prompt & Rule Inline Editing

- Edit button on active and inactive prompt/rule versions pre-fills an inline textarea with the current content
- "Save as New Version" POSTs with `auto_activate: true` — deactivates the current active version and immediately activates the new one
- `auto_activate?: boolean` added to both `/api/admin/llm/prompts` and `/api/admin/llm/rules` create action

---

### Simulation Auto-Token

- Simulation runner no longer requires `ADMIN_SIMULATION_BEARER_TOKEN` to be pre-set as a secret
- `getSimToken()` generates a fresh magic-link OTP for the sim user (`sim-1772428603705@cookwithalchemy.com`), verifies it to obtain a short-lived access token; falls back to password sign-in
- Uses existing `SUPABASE_SECRET_KEY` — no new secrets needed
- `ADMIN_SIMULATION_BEARER_TOKEN` still works as an override if present

---

### Deployment Documentation

- `README.md` — added full Deployment section with all four deploy commands, one-time auth, and migration history table updated through `0011`
- `CLAUDE.md` — deployment commands added before "When Blocked"
- `AGENTS.md` (new) — project overview, monorepo structure, deployment commands, non-negotiables

---

### Mobile App — Major Feature Build

#### New Screens
- **Register** (`/register`) — new account creation with validation
- **Onboarding** (`/onboarding`) — first-run preference setup flow
- Design system: `components/alchemy/primitives.tsx`, `auth-screen.tsx`, `intro-screen.tsx`, `theme.ts`

#### Overhauled Screens
- **Generate** (`/(tabs)/generate`) — full prompt-to-recipe generation flow with streaming, tweak mode, and error states
- **My Cookbook** (`/(tabs)/my-cookbook`) — saved recipes + collections with search, pull-to-refresh, and skeleton loaders
- **Sign In** — redesigned with design system components, haptics, keyboard avoidance
- **Preferences** — dietary/skill/equipment pickers with TanStack Query persistence
- **Settings** — account management with Supabase auth sign-out

#### Infrastructure
- Removed `/explore` tab; tabs simplified to Generate + My Cookbook
- `lib/api.ts` — full API client covering all v1 endpoints
- `lib/auth.tsx` — hardened: real access token required for authenticated state, local sign-out on failure
- `lib/ui-store.ts` — measurement display mode, servings scaling, ephemeral chat input state

---

### Backend

#### Database Migrations
- `0002` — memory, changelog, recipe links tables
- `0003` — prompt upgrades
- `0004` — intelligent prompt contract
- `0005` — preferences injection and prompt updates
- `0006` — switch primary recipe models to GPT-5
- `0007` — onboarding scope defaults
- `0008` — remove explore feed
- `0009` — immediate recipe generation config

#### LLM Gateway (`supabase/functions/`)
- Structured output with Zod validation
- Memory extract/select/summarize/conflict-resolve scopes
- Image generation scope
- Preferences injection into generation prompts
- Cost tracking per request

#### API Contract (`packages/contracts/`)
- OpenAPI schema extended with all v1 endpoints
- Generated TypeScript types updated

#### Cloudflare API Gateway (`infra/cloudflare/api-gateway/`)
- Auth validation at gateway level
- Full v1 route proxying to Supabase edge functions
- `NEXT_PUBLIC_SUPABASE_URL` added to wrangler vars
