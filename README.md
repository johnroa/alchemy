# Alchemy Monorepo

iOS-first AI recipe app — users set dietary/skill/equipment preferences, generate recipes via LLM, tweak them iteratively, and organize favorites. An admin console manages users, LLM config, content moderation, and observability.

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

### Generate Screen flow

The generate screen has two distinct LLM phases:

1. **Chat phase** (no active recipe): `api.createChat()` / `api.continueChat()` → uses the `chat` scope. The LLM explores intent, asks at most one question per turn, and includes a recipe in the response only when the user commits to an idea. The chat panel fills the screen.

2. **Tweak phase** (recipe exists): `api.tweakRecipe()` or `api.continueChat()` with active recipe in context → uses the `tweak` scope. The LLM always returns an updated recipe immediately. The panel auto-minimizes to expose the recipe canvas.

3. **Generate**: `api.generateFromChat()` triggers the `generate` scope — always outputs a complete recipe, no questions.

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
| `/recipes` | Split-panel recipe audit — list + version timeline + prompt trace |
| `/provider-model` | Model Assignments — LLM model routing per scope |
| `/models` | Model registry — available providers/models with pricing and context window |
| `/prompts` | Prompt management per scope — active/inactive versions, inline editing |
| `/rules` | Policy rules per scope — active/inactive versions, inline editing |
| `/memory` | User memory snapshots + confidence/salience quality signals |
| `/image-pipeline` | Image job queue with retry controls |
| `/simulations` | A/B simulation runner — compare step latency across two model configs |
| `/request-trace` | Gateway event log — clickable rows, payload details, error highlighting |
| `/changelog` | Changelog event audit with action/scope distribution charts |
| `/graph` | Entity relationship graph with confidence-ranked edges |
| `/version-causality` | Recipe version causality chains |

---

## LLM Control Model

All LLM configuration is **runtime DB-driven** — no redeployment required for model swaps, prompt edits, or rule changes. The gateway reads the active record for the requested scope on every call.

### Scopes

| Scope | Used by | Behavior |
|---|---|---|
| `chat` | Pre-recipe ideation conversation | Conversational. CAN ask questions. Includes recipe only when user commits. |
| `generate` | `generateFromChat()` | Always outputs a complete recipe immediately. No questions. |
| `tweak` | Post-recipe editing | Always outputs a full updated recipe. No questions. |
| `classify` | Content safety check before generate/tweak | Returns allow/deny + reason |
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
  -d '{"scope":"generate","provider":"openai","model":"gpt-4.1"}'
```

This deactivates the current active route for the scope and inserts a new active one.

### Updating a prompt (no migration needed)

Use the Admin UI at `/prompts`, or:

```bash
curl -X POST https://admin.cookwithalchemy.com/api/admin/llm/prompts \
  -H "Content-Type: application/json" \
  -d '{"action":"create","scope":"generate","name":"my_prompt_v7","template":"You are..."}'
# Then activate it:
curl -X POST https://admin.cookwithalchemy.com/api/admin/llm/prompts \
  -H "Content-Type: application/json" \
  -d '{"action":"activate","prompt_id":"<uuid>"}'
```

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

### Pushing migrations

```bash
supabase db push --project-ref dwptbjcxrsmmgjmnumpg
```

### Troubleshooting `db push` auth failures

If you see:

```text
failed SASL auth (FATAL: password authentication failed for user "postgres.<project-ref>")
```

`supabase login` is not enough by itself. CLI login authenticates Supabase Management API calls, but `supabase db push` still connects directly to Postgres and requires the database password.

Use:

```bash
# 1) Link project with DB password from Supabase Dashboard → Project Settings → Database
supabase link --project-ref dwptbjcxrsmmgjmnumpg -p '<db-password>'

# 2) Push migrations
supabase db push --linked -p '<db-password>'
```

If you only need to push seed/backfill data (not schema changes) and DB password is unavailable, use service-role + PostgREST as an emergency path:

```bash
PROJECT_REF=dwptbjcxrsmmgjmnumpg
SUPABASE_URL="https://${PROJECT_REF}.supabase.co"
SERVICE_ROLE_KEY="$(supabase projects api-keys --project-ref "$PROJECT_REF" --output json | jq -r '.[] | select(.name=="service_role") | .api_key')"

# Example: verify active onboarding prompt/rule
curl "$SUPABASE_URL/rest/v1/llm_prompts?scope=eq.onboarding&is_active=eq.true&select=id,scope,version,name" \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY"
curl "$SUPABASE_URL/rest/v1/llm_rules?scope=eq.onboarding&is_active=eq.true&select=id,scope,version,name" \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY"
```

Use this fallback only for controlled operational fixes. For normal schema + migration history, prefer `supabase db push`.

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
| `0010_chat_scope_defaults` | New `chat` scope — ideation before generate |
| `0010_model_registry` | `llm_model_registry` table — provider/model pricing + availability |
| `0011_seed_model_registry` | Seed 9 models (GPT-4.1, GPT-4o, o3, o4-mini, Claude Opus/Sonnet/Haiku) |
| `0012_seed_additional_openai_models` | Normalize OpenAI catalog to GPT-5/GPT-4.1/GPT Image and remove 4o/o-series defaults |
| `0013_backfill_onboarding_prompt_default` | Backfill active onboarding prompt/rule defaults if missing |

---

## Backend (`supabase/`)

- **Auth**: Supabase Auth (token-based)
- **DB**: Postgres — users, preferences, recipes, recipe_versions, collections, memories, events, changelog_events, image_jobs
- **Edge Functions** (`functions/v1/`): LLM gateway with structured output, prompt injection, memory, and image generation

### Deploying edge functions

```bash
# Deploy the v1 edge function
supabase functions deploy v1 --project-ref dwptbjcxrsmmgjmnumpg

# Set secrets (if not already set)
supabase secrets set OPENAI_API_KEY=<key> --project-ref dwptbjcxrsmmgjmnumpg
supabase secrets set ANTHROPIC_API_KEY=<key> --project-ref dwptbjcxrsmmgjmnumpg

# List current secrets (shows digests only)
supabase secrets list --project-ref dwptbjcxrsmmgjmnumpg
```

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
supabase login
npx wrangler login
```

### Push Supabase (schema + edge function)

```bash
supabase db push --project-ref dwptbjcxrsmmgjmnumpg
supabase functions deploy v1 --project-ref dwptbjcxrsmmgjmnumpg
```

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

# 2. Auth (one-time)
supabase login
npx wrangler login

# 3. Apply DB migrations
supabase db push --project-ref dwptbjcxrsmmgjmnumpg

# 4. Deploy edge function
supabase functions deploy v1 --project-ref dwptbjcxrsmmgjmnumpg

# 5. Deploy API gateway
npx wrangler deploy --config infra/cloudflare/api-gateway/wrangler.jsonc

# 6. Deploy admin
pnpm --filter @alchemy/admin cf:build
pnpm --filter @alchemy/admin exec opennextjs-cloudflare deploy

# 7. Generate contract types (after any OpenAPI changes)
pnpm --filter @alchemy/contracts generate

# 8. Run apps locally
pnpm dev:admin          # Next.js admin at localhost:3000
pnpm dev:mobile:ios     # Expo iOS simulator
```

---

## API UX Simulation

End-to-end API simulation (full generate → tweak → save flow):

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
