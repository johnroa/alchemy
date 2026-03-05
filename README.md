# Alchemy Monorepo

iOS-first AI recipe app — users set dietary/skill/equipment preferences, chat with the assistant to converge on dishes, iterate candidate recipe tabs, and commit to cookbook. An admin console manages users, LLM config, content moderation, and observability.

## Structure

```
apps/ios/             Native SwiftUI iOS app (iOS 18+)
apps/mobile/          Expo 52 React Native (legacy, being replaced by apps/ios/)
apps/admin/           Next.js 15 admin dashboard (Cloudflare Workers via OpenNext)
infra/cloudflare/     Cloudflare Worker API gateway (TypeScript)
supabase/             Auth, Postgres, Edge Functions (LLM gateway)
packages/contracts/   OpenAPI schema + generated TypeScript types
packages/shared/      Shared utilities
```

## Hosts

- **API**: `https://api.cookwithalchemy.com/v1/*`
- **Admin**: `https://admin.cookwithalchemy.com`

---

## iOS App (`apps/ios/`)

Native SwiftUI rewrite of the Expo mobile app. MVVM architecture with `@Observable`, targeting iOS 18+ with iOS 26 Liquid Glass support.

### Tech stack

- **SwiftUI** — `@Observable` ViewModels, `NavigationStack`, `matchedGeometryEffect`
- **supabase-swift 2.0** — Auth with Keychain-managed sessions
- **Nuke + NukeUI** — Async image loading and caching
- **Lottie 4.4** — Recipe generation animation
- **SPM** — All dependencies via Swift Package Manager
- **XcodeGen** — Project generation from `project.yml`

### Screens

| Screen | Description |
|---|---|
| `SplashView` | Full-bleed kitchen image + ALCHEMY wordmark + loading spinner |
| `AuthFlowView` | Sign in / Register with cross-fade transitions |
| `OnboardingView` | Chat-based AI preference interview with progress bar |
| `TabShell` | 3-tab container with custom floating pill tab bar |
| `CookbookView` | Saved recipes — search, category filter chips, staggered 2-column grid |
| `GenerateView` | Chat panel + recipe canvas with Lottie animation during generation |
| `ExploreView` | Full-bleed vertical card stack with paging + parallax |
| `RecipeDetailView` | Parallax hero, ingredients, steps, nutrition, pairings, version history |
| `PreferencesView` | 9-field form — dietary, skill, equipment, cuisines, aversions |
| `SettingsView` | Memory stats, changelog, account management |

### Architecture

```
Alchemy/
├── App/                    Entry point, routing, environment config
├── Core/
│   ├── Auth/               AuthManager (@Observable, supabase-swift)
│   └── Networking/         APIClient (URLSession + async/await), models
├── DesignSystem/
│   ├── Components/         Button, TextField, SearchBar, FilterChip, RecipeCard, etc.
│   ├── Modifiers/          Glass (iOS 26), Haptics, Shimmer
│   └── Theme/              Colors, Typography, Spacing
├── Features/               One folder per screen (View + ViewModel pairs)
└── Resources/              Assets.xcassets, Info.plist, Lottie JSON, entitlements
```

### Running the iOS app

```bash
cd apps/ios

# Generate Xcode project (requires xcodegen)
xcodegen generate

# Build for simulator
xcodebuild -project Alchemy.xcodeproj -scheme Alchemy \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build

# Or open in Xcode
open Alchemy.xcodeproj
```

### Configuration

Supabase credentials are in `Configuration/Debug.xcconfig` and `Configuration/Release.xcconfig`, injected into `Info.plist` at build time via `$(VARIABLE_NAME)`.

---

## Mobile App (`apps/mobile/`) — Legacy

Expo Router + TanStack Query + Zustand. Key screens:

| Route | Description |
|---|---|
| `/sign-in` | Auth entry — Figma-matched dark form |
| `/register` | New account — same form component, register mode |
| `/onboarding` | First-run preference setup — conversational AI interview |
| `/(tabs)/generate` | Prompt-to-recipe workspace — chat panel + recipe canvas |
| `/(tabs)/my-cookbook` | Saved recipes + collections |
| `/preferences` | Dietary / skill / equipment |
| `/settings` | Account settings |

Design system: `components/alchemy/primitives.tsx` + `theme.ts`

### Generate Screen flow (current contract)

The loop is chat-driven and endpoint-minimal:

1. Start session: `POST /chat` with `{ message }`.
2. Continue loop: `POST /chat/{id}/messages` for all user turns (ideation + tweaks).
3. Candidate tab actions: `PATCH /chat/{id}/candidate` with:
   - `set_active_component`
   - `delete_component`
   - `clear_candidate`
4. Save all remaining tabs: `POST /chat/{id}/commit`.
5. Read committed recipes: `GET /recipes/{id}` and `GET /recipes/cookbook`.

Deprecated loop endpoints are removed:

- `POST /recipes/generate`
- `POST /recipes/{id}/tweak`
- `POST /chat/{id}/generate`

UI state mapping from `ChatSession.loop_state`:

- `ideation`: full chat panel, no recipe tabs shown.
- `candidate_presented`: collapse chat panel, show generation animation once, render tabs from `candidate_recipe_set.components`.
- `iterating`: show tweak chat overlay while waiting, then return to candidate presentation on response.

Out-of-scope behavior:

- Non-cooking asks (for example directions/travel/history) stay in `ideation`.
- API returns `candidate_recipe_set=null` and `response_context.intent=out_of_scope`.
- Assistant replies with a concise refusal + redirect back to cooking support.
- Generation is never triggered from out-of-scope turns.

Core response fields to wire:

- `assistant_reply.text`
- `candidate_recipe_set` (`candidate_id`, `revision`, `active_component_id`, `components[]`)
- `ui_hints.show_generation_animation`
- `ui_hints.focus_component_id`
- `memory_context_ids`

Commit UX contract (`POST /chat/{id}/commit`):

- `commit.recipes[]`: committed recipe ids per tab/component
- `commit.links[]`: parent/child links across committed components
- `commit.post_save_options`: `continue_chat | restart_chat | go_to_cookbook`

Mobile UI handoff checklist:

1. Send first turn to `POST /chat`; all later turns to `POST /chat/{id}/messages`.
2. Never call removed endpoints (`/recipes/generate`, `/recipes/{id}/tweak`, `/chat/{id}/generate`).
3. Use `PATCH /chat/{id}/candidate` for `set_active_component`, `delete_component`, `clear_candidate`.
4. Keep `Add All to Cookbook` wired only to `POST /chat/{id}/commit`.
5. Interpret `response_context.intent=out_of_scope` as ideation-only (no generation animation, no candidate tabs).
6. Keep three post-save actions only: continue chat, restart chat, go to cookbook.

### Running the app

```bash
# Dev server (interactive, hot reload)
pnpm dev:mobile:ios

# With cache clear
pnpm dev:mobile:ios:clear

# iOS logs
pnpm logs:mobile:ios
```

---

## Admin Console (`apps/admin/`)

Next.js 15 App Router. All pages under `app/(admin)/`:

| Page | Description |
|---|---|
| `/dashboard` | KPI rollup — LLM cost, safety flags, image pipeline, activity feed |
| `/users` | User roster with live search, status, and reset-memory action |
| `/moderation` | Safety flag review |
| `/recipes` | Split-panel recipe audit — coverage snapshot cards, velocity deltas, version timeline + prompt trace |
| `/provider-model` | Model Assignments — LLM model routing per scope |
| `/models` | Model registry — available providers/models with pricing and context window |
| `/prompts` | Prompt management per scope — active/inactive versions, inline editing |
| `/rules` | Policy rules per scope — active/inactive versions, inline editing |
| `/memory` | User memory snapshots + confidence/salience quality signals |
| `/image-pipeline` | Image job queue with retry controls |
| `/simulations` | Seeded simulation runner — single or concurrent A/B with full trace, latency segments, and token deltas |
| `/request-trace` | Gateway event log — clickable rows, payload details, error highlighting |
| `/changelog` | Changelog event audit with action/scope distribution charts |
| `/ingredients` | Canonical ingredient registry with semantic food icons, enrichment metadata, and ontology links |
| `/graph` | Entity relationship graph — force-directed canvas with type filters, fullscreen, and confidence-ranked edges |
| `/version-causality` | Recipe version causality chains |

---

## LLM Control Model

All LLM configuration is **runtime DB-driven** — no redeployment required for model swaps, prompt edits, or rule changes. The gateway reads the active record for the requested scope on every call.

All LLM calls must flow through the shared pipeline:
- scope registry: `supabase/functions/_shared/llm-scope-registry.ts`
- executor: `supabase/functions/_shared/llm-executor.ts`
- provider adapters: `supabase/functions/_shared/llm-adapters/*`

No direct provider calls are allowed outside adapters.

### Scopes

| Scope | Used by | Behavior |
|---|---|---|
| `chat_ideation` | `POST /chat`, `POST /chat/{id}/messages` while no candidate is active | Conversational. Learns preferences and decides whether to trigger generation. |
| `chat_generation` | `POST /chat/{id}/messages` when generation is triggered | Returns full `candidate_recipe_set` (max 3 components). |
| `chat_iteration` | `POST /chat/{id}/messages` when candidate exists | Returns revised `candidate_recipe_set`. |
| `classify` | Async audit + normalization utilities | Used for non-blocking telemetry/helpers; not a blocking gate in the core chat loop. |
| `ingredient_alias_normalize` | Canonical ingredient identity stage | Normalizes alias keys to canonical ingredient names. |
| `ingredient_phrase_split` | Canonical ingredient identity stage | Splits compound ingredient phrases into atomic items. |
| `ingredient_enrich` | Metadata pipeline | Enriches ingredient metadata and ontology terms. |
| `recipe_metadata_enrich` | Metadata pipeline | Enriches recipe-level tags/metadata. |
| `ingredient_relation_infer` | Metadata pipeline | Infers ingredient graph relations. |
| `preference_normalize` | Preference pipeline | Normalizes user preference list updates. |
| `equipment_filter` | Preference pipeline | Filters durable equipment updates to explicit user claims. |
| `onboarding` | First-run preference interview | Conversational. Collects dietary, skill, equipment context. |
| `image` | Recipe image generation | Text-to-image prompt construction |
| `memory_extract` | Post-conversation memory extraction | Extracts preference signals |
| `memory_select` | Context injection | Selects relevant memories for prompt injection |
| `memory_summarize` | Memory compaction | Reduces memory blob size |
| `memory_conflict_resolve` | Memory deduplication | Resolves conflicting preference records |

### DB tables

- `llm_model_routes` — scope → provider + model mapping (one active per scope)
- `llm_prompts` — scope + version → system prompt template (one active per scope)
- `llm_rules` — scope + version → policy rule JSON (one active per scope)

### Changing a model (no migration needed)

Use the Admin UI at `/provider-model`, or call the API directly:

```bash
curl -X POST https://admin.cookwithalchemy.com/api/admin/llm/routes \
  -H "Content-Type: application/json" \
  -d '{"scope":"chat_generation","provider":"anthropic","model":"claude-3-5-haiku-latest"}'
```

This deactivates the current active route for the scope and inserts a new active one.

### Updating a prompt (no migration needed)

Use the Admin UI at `/prompts`, or:

```bash
curl -X POST https://admin.cookwithalchemy.com/api/admin/llm/prompts \
  -H "Content-Type: application/json" \
  -d '{"action":"create","scope":"chat_ideation","name":"chat_ideation_v1","template":"You are..."}'
# Then activate it:
curl -X POST https://admin.cookwithalchemy.com/api/admin/llm/prompts \
  -H "Content-Type: application/json" \
  -d '{"action":"activate","prompt_id":"<uuid>"}'
```

### LLM call lifecycle workflow (agent-safe)

1. Add call:
- add scope definition in `llm-scope-registry.ts`
- add migration seed rows for `llm_model_routes`, `llm_prompts`, `llm_rules`
- add/update gateway wrapper to execute via `llm-executor.ts`
- wire callsite in `supabase/functions/v1/index.ts` or related service
- add tests + docs
2. Edit call:
- prompt/rule/model changes through Admin API/UI
- if response contract changes, update validators/tests and OpenAPI examples if public behavior changed
3. Remove call:
- remove callsite + wrapper + scope
- add migration that deactivates scope rows (do not hard-delete operational history)

---

## DB Migrations

Migrations live in `supabase/migrations/` and are numbered sequentially (`0001_`, `0002_`, …).

### What belongs in a migration vs the admin UI

| Change | Use |
|---|---|
| New table or schema change | Migration |
| New scope with initial route/prompt/rule | Migration |
| Bulk seed / backfill | Migration |
| Changing an active model for an existing scope | Admin UI / API |
| Editing a prompt for an existing scope | Admin UI / API |
| Tweaking a rule for an existing scope | Admin UI / API |

### Writing a migration

Migrations are plain SQL. Use `INSERT ... ON CONFLICT DO UPDATE` for idempotency:

```sql
-- supabase/migrations/NNNN_my_change.sql

insert into public.llm_prompts(scope, version, name, template, is_active)
values ('my_scope', 1, 'my_prompt_v1', $$...$$, true)
on conflict (scope, version) do update
set name = excluded.name,
    template = excluded.template,
    is_active = excluded.is_active;
```

### Applying migrations (CI-only)

Supabase schema/function deploys are handled by GitHub Actions only.

1. Add or update files in `supabase/migrations/**` and/or `supabase/functions/**`.
2. Push to `main`.
3. Watch `.github/workflows/supabase-deploy.yml` in GitHub Actions.

No direct local `supabase db push` / `supabase functions deploy` deploy path is used for production.

### Troubleshooting Supabase CI migration failures

If CI fails with:

```text
Found local migration files to be inserted before the last migration on remote database.
```

The migration chain is out of order relative to remote history. Fix by:

1. Ensuring migration filenames are monotonic and correctly ordered.
2. Re-running the deploy workflow with `--include-all` enabled in CI when intentionally reconciling history.
3. Avoiding ad-hoc/manual production DB pushes outside CI.

### Migration history

| Migration | Description |
|---|---|
| `0001_init` | Schema — all tables, indexes, RLS |
| `0002_memory_changelog_recipe_links` | Memory + changelog + recipe link tables |
| `0003_prompt_upgrades` | Initial prompt versions for core scopes |
| `0004_intelligent_prompt_contract` | Structured JSON contract in prompts |
| `0005_preferences_injection_and_prompt_updates` | Preference injection + prompt v5 |
| `0006_switch_primary_recipe_models_to_gpt5` | Moved generate/tweak to gpt-5 |
| `0007_onboarding_scope_defaults` | Onboarding scope route/prompt/rule |
| `0008_remove_explore` | Removed explore tab scope |
| `0009_immediate_recipe_generation` | Prompt v6 — always generate, no questions |
| `0010_chat_scope_defaults` | New `chat` scope — ideation before generate; `llm_model_registry` table |
| `0011_seed_model_registry` | Seed 9 models (GPT-4.1, GPT-4o, o3, o4-mini, Claude Opus/Sonnet/Haiku) |
| `0012_seed_additional_openai_models` | Normalize OpenAI catalog to GPT-5/GPT-4.1/GPT Image and remove 4o/o-series defaults |
| `0013_backfill_onboarding_prompt_default` | Backfill active onboarding prompt/rule defaults if missing |
| `0014_rename_draft_to_chat` | Renamed draft chat tables/fields to final chat loop naming |
| `0015_recipe_standardization_dev` | Canonical ingredients + metadata job queue + graph links |
| `0016_chat_loop_refactor_dev` | Chat-only candidate loop tables/contracts + commit path |
| `0017_chat_loop_latency_tuning` | Prompt/model-config tuning for faster chat-generation/iteration turns |
| `0018_chat_loop_contract_hardening` | Strict intent-aware chat prompt/rule contracts for ideation/generation/iteration |
| `0020_semantic_ontology_core` | Semantic ontology core for LLM-first enrichment pipeline |
| `0021_metadata_contract_v2` | Metadata contract V2 indexes and schema-version tracking |
| `0022_metadata_jobs_v2_pipeline` | Stage-aware metadata jobs for async semantic enrichment |
| `0023_graph_api_indexes` | Graph API traversal and confidence filter indexes |
| `0024_chat_loop_quality_reset` | Remove shrink constraints and token budget clamps from active chat scopes |
| `0025_llm_scope_split_hardening` | Split generic classify helper calls into explicit DB-managed scopes |
| `0026_chat_loop_prompt_deconstraint_v103` | Chat-loop prompt/rule hard reset: remove residual shrink language and recipe-size caps |
| `0027_generate_scope_deconstraint_v104` | Generate-scope hardening: remove residual shrink/budget constraints |
| `0028_chat_ideation_direct_generation_v105` | Chat ideation update: explicit dish/recipe requests move directly to generation |
| `0029_chat_loop_route_provider_stability_v106` | Pin active core routes to structured-output-capable models for JSON reliability |

---

## Backend (`supabase/`)

- **Auth**: Supabase Auth (token-based)
- **DB**: Postgres — users, preferences, recipes, recipe_versions, collections, memories, events, changelog_events, image_jobs
- **Edge Functions** (`functions/v1/`): LLM gateway with structured output, prompt injection, memory, and image generation

### Deploying edge functions

Edge function deploys are performed by GitHub Actions (`.github/workflows/supabase-deploy.yml`) from `main` pushes. Do not deploy Supabase functions directly from local machines.

---

## API Gateway (`infra/cloudflare/api-gateway/`)

Cloudflare Worker — auth validation + routing to Supabase edge functions. Contract types from `packages/contracts/src/generated.ts`.

```bash
npx wrangler deploy --config infra/cloudflare/api-gateway/wrangler.jsonc
```

---

## Admin Deployment

```bash
pnpm --filter @alchemy/admin cf:build
pnpm --filter @alchemy/admin exec opennextjs-cloudflare deploy
```

### Admin runtime env

Set in `apps/admin/.env.local` for local dev, and as Cloudflare Worker secrets/vars for production:

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SECRET_KEY` | Yes | Supabase service role key |
| `API_BASE_URL` | No | Defaults to `https://api.cookwithalchemy.com/v1` |
| `ADMIN_SIMULATION_BEARER_TOKEN` | Yes | JWT for simulation + image-job processing |

```bash
cd apps/admin
wrangler secret put SUPABASE_SECRET_KEY
wrangler secret put ADMIN_SIMULATION_BEARER_TOKEN
```

---

## Deployment

All commands run from repo root (`/Users/john/Projects/alchemy`).

### One-time auth

```bash
npx wrangler login
```

### Supabase deploys (GitHub CI only)

Workflow: `.github/workflows/supabase-deploy.yml`

Required GitHub repository secrets:

| Secret | Description |
|---|---|
| `SUPABASE_PAT` | Supabase personal access token for CLI/Management API |
| `SUPABASE_DB_PASSWORD` | Postgres DB password for project `dwptbjcxrsmmgjmnumpg` |

Notes:

- `publishable` / `secret` project API keys are for your app's data/API calls.
- GitHub CI deploys via Supabase CLI require a **management access token** (PAT) from Supabase account settings.

Recommended setup:

1. Create a GitHub environment named `production`.
2. Move both secrets into that environment.
3. Add required reviewers to the environment so deploys need approval.

Trigger behavior:

- Auto-runs on `main` pushes that change `supabase/migrations/**` or `supabase/functions/**`.
- Manual run available via **Actions → Supabase Deploy → Run workflow**.

### Push Cloudflare API gateway (`api.cookwithalchemy.com`)

```bash
npx wrangler deploy --config infra/cloudflare/api-gateway/wrangler.jsonc
```

### Push Cloudflare admin worker (`admin.cookwithalchemy.com`)

```bash
pnpm --filter @alchemy/admin cf:build
pnpm --filter @alchemy/admin exec opennextjs-cloudflare deploy
```

### Quick verify

```bash
curl https://api.cookwithalchemy.com/v1/healthz
```

---

## Full Setup (fresh environment)

```bash
# 1. Install deps
pnpm install

# 2. Auth (one-time for Cloudflare deploys)
npx wrangler login

# 3. Deploy API gateway
npx wrangler deploy --config infra/cloudflare/api-gateway/wrangler.jsonc

# 4. Deploy admin
pnpm --filter @alchemy/admin cf:build
pnpm --filter @alchemy/admin exec opennextjs-cloudflare deploy

# 5. Generate contract types (after any OpenAPI changes)
pnpm --filter @alchemy/contracts generate

# 6. Run apps locally
pnpm dev:admin          # Next.js admin at localhost:3000
pnpm dev:mobile:ios     # Expo iOS simulator
```

Supabase schema/functions are deployed by CI from `main` pushes (not from local CLI).

---

## API UX Simulation

End-to-end API simulation covering the full chat-driven candidate loop:

1. `chat_start` — open ideation session
2. `chat_refine` — send specific recipe constraints
3. `chat_generate_trigger` — trigger candidate generation
4. `chat_iterate_candidate` — iterate on candidate
5. `commit_candidate_set` — commit to cookbook
6. `fetch_committed_recipe` — read committed recipe with unit/grouping params
7. `fetch_cookbook` — verify cookbook listing
8. `chat_out_of_scope_guard` — verify out-of-scope stays in ideation

```bash
API_URL=https://api.cookwithalchemy.com/v1 \
API_BEARER_TOKEN=<jwt> \
pnpm simulate:api
```

---

## Supabase Key Model

- `publishable` key — client-side contexts (mobile app, browser)
- `secret` key — trusted server/admin contexts (edge functions, admin API)
- Legacy `anon` / `service_role` names remain for backward compatibility
