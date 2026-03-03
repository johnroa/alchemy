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
- `lib/ui-store.ts` — measurement display mode, servings scaling, ephemeral draft state

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
