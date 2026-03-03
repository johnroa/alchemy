# Changelog

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
