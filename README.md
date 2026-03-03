# Alchemy Monorepo

iOS-first AI recipe app — users set dietary/skill/equipment preferences, generate recipes via LLM, tweak them iteratively, and organize favorites. An admin console manages users, LLM config, content moderation, and observability.

## Structure

```
apps/mobile/          Expo 52 React Native (iOS-first)
apps/admin/           Next.js 15 admin dashboard (Cloudflare Workers via OpenNext)
infra/cloudflare/     Cloudflare Worker API gateway (TypeScript)
supabase/             Auth, Postgres, Edge Functions (LLM gateway)
packages/contracts/   OpenAPI schema + generated TypeScript types
packages/shared/      Shared utilities
```

## Hosts

- **API**: `https://api.cookwithalchemy.com/v1/*`
- **Admin**: `https://admin.cookwithalchemy.com`

## Mobile App (`apps/mobile/`)

Expo Router + TanStack Query + Zustand. Key screens:

| Route | Description |
|---|---|
| `/sign-in` | Auth entry |
| `/register` | New account |
| `/onboarding` | First-run preference setup |
| `/(tabs)/generate` | Prompt-to-recipe generation |
| `/(tabs)/my-cookbook` | Saved recipes + collections |
| `/preferences` | Dietary / skill / equipment |
| `/settings` | Account settings |

Design system: `components/alchemy/primitives.tsx` + `theme.ts`

## Admin Console (`apps/admin/`)

Next.js 15 App Router. All pages under `app/(admin)/`:

| Page | Description |
|---|---|
| `/dashboard` | KPI rollup — LLM cost, safety flags, image pipeline, activity feed |
| `/users` | User roster with live search, status, and reset-memory action |
| `/moderation` | Safety flag review |
| `/recipes` | Split-panel recipe audit — list + version timeline + prompt trace |
| `/provider-model` | LLM model routing per scope |
| `/prompts` | Prompt management per scope — active/inactive versions |
| `/rules` | Policy rules per scope |
| `/memory` | User memory snapshots + confidence/salience quality signals |
| `/image-pipeline` | Image job queue with retry controls |
| `/simulations` | A/B simulation runner — compare step latency across two model configs |
| `/request-trace` | Gateway event log — clickable rows, payload details, error highlighting |
| `/changelog` | Changelog event audit with action/scope distribution charts |
| `/graph` | Entity relationship graph with confidence-ranked edges |
| `/version-causality` | Recipe version causality chains |

## LLM Control Model

- Provider/model routing → `llm_model_routes` (scope-keyed)
- Prompt templates → `llm_prompts` (scope + version)
- Policy rules → `llm_rules` (scope + version)
- Runtime gateway reads active records from DB on every request — zero-deploy config changes
- 9 scopes: `generate`, `tweak`, `classify`, `onboarding`, `image`, `memory_extract`, `memory_select`, `memory_summarize`, `memory_conflict_resolve`

## API Gateway (`infra/cloudflare/api-gateway/`)

Cloudflare Worker — auth validation + routing to Supabase edge functions. Contract types from `packages/contracts/src/generated.ts`.

## Backend (`supabase/`)

- **Auth**: Supabase Auth (token-based)
- **DB**: Postgres — users, preferences, recipes, recipe_versions, collections, memories, events, changelog_events, image_jobs
- **Edge Functions** (`functions/v1/`): LLM gateway with structured output, prompt injection, memory, and image generation
- 9 DB migrations in `supabase/migrations/`

## Supabase Key Model

- `publishable` key — client-side contexts
- `secret` key — trusted server/admin contexts
- Legacy `anon` / `service_role` names remain for backward compatibility

## Setup

```bash
# 1. Install deps
pnpm install

# 2. Apply DB migrations
supabase db push

# 3. Deploy edge function
supabase functions deploy v1

# 4. Generate contract types
pnpm --filter @alchemy/contracts generate

# 5. Run apps
pnpm dev:admin
pnpm dev:mobile
```

## Admin Runtime Env

Set in `apps/admin/.env.local` and as Cloudflare Worker secrets/vars:

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SECRET_KEY` | Yes | Supabase service role key |
| `API_BASE_URL` | No | Defaults to `https://api.cookwithalchemy.com/v1` |
| `ADMIN_SIMULATION_BEARER_TOKEN` | Yes | JWT for simulation + image-job processing |

Set the token secret via Wrangler:

```bash
cd apps/admin
wrangler secret put ADMIN_SIMULATION_BEARER_TOKEN
```

## Cloudflare Deployment

```bash
cd apps/admin
pnpm cf:deploy
```

## API UX Simulation

End-to-end API simulation (full generate → tweak → save flow):

```bash
API_URL=https://api.cookwithalchemy.com/v1 \
API_BEARER_TOKEN=<jwt> \
pnpm simulate:api
```
