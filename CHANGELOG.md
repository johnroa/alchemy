# Changelog

## [Unreleased] — 2026-03-05

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
