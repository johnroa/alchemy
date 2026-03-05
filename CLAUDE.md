# Alchemy — Claude Instructions

## Project
Alchemy is an iOS-first, API-driven recipe app. Users set dietary/skill/equipment preferences, generate recipes via LLM, iteratively tweak them, and organize favorites. An admin UI manages users, LLM config, and rules.

## Monorepo Structure
```
apps/mobile/          Expo 52 React Native (iOS-first)
apps/admin/           Next.js 15 admin dashboard
infra/cloudflare/     Cloudflare Worker API gateway (TypeScript)
supabase/             Auth, Postgres, Edge Functions (LLM gateway)
packages/contracts/   OpenAPI schema + generated TypeScript types
packages/shared/      Shared utilities
```

## Non-Negotiables
- Strict TypeScript. No `any`.
- Minimal diffs. Do not touch unrelated code.
- Do not add dependencies unless explicitly asked.
- All LLM calls must go through the LLM pipeline (`supabase/functions/_shared/llm-scope-registry.ts` + `llm-executor.ts` + `llm-adapters/*`) via `supabase/functions/v1/` — never from the client.
- Supabase deploy is GitHub CI only; do not run local `supabase db push` / `supabase functions deploy`.
- Never hit the DB directly for production changes. Use sequential, append-only migrations.
- Change LLM prompts/rules/routes via API/Admin UI (`/api/admin/llm/prompts`, `/api/admin/llm/rules`, `/api/admin/llm/routes`), never direct DB edits.
- The client is API-driven. No business logic beyond UI/UX orchestration.
- Every user-facing screen needs loading, empty, and error states.
- No silent data loss. Offline reads from cache are fine.

## LLM Pipeline Workflow
- Add LLM call: define a new scope in `llm-scope-registry.ts`, seed route/prompt/rule in sequential migration, add gateway wrapper through executor, wire callsite, add tests, update docs.
- Edit LLM call: use Admin API/UI for prompts/rules/routes; if contract shape changes, update validators/tests and public OpenAPI examples as needed.
- Remove LLM call: remove callsite/wrapper/scope and add migration deactivating corresponding scope rows.
- Direct provider endpoints (`api.openai.com`, `api.anthropic.com`) are allowed only in `supabase/functions/_shared/llm-adapters/*`.

## Mobile Stack (`apps/mobile/`)
- **Expo Router** — file-based routing
- **TanStack Query v5** — all server state, caching, retries
- **Zustand v5** — UI-only state (toggles, ephemeral chat input); never server data
- **React Native Reanimated 3 + Gesture Handler** — animations and gestures
- **Supabase JS** — auth session via `lib/auth.tsx` and `lib/supabase.ts`
- **Custom design system** — `components/alchemy/primitives.tsx` + `theme.ts`
- API calls go through `lib/api.ts` → Cloudflare Worker

### Mobile Conventions
Query keys:
```ts
['me']
['preferences']
['recipes', 'feed', filters]
['recipes', id]
['collections']
['collections', id]
['search', query, filters]
```

Zustand (`lib/ui-store.ts`) is for: measurement display mode, servings scaling, ephemeral chat text, temporary filter state. Not for recipes or preferences.

Route structure:
```
/sign-in, /register, /onboarding       auth/setup flows
/(tabs)/generate                        prompt-to-recipe
/(tabs)/my-cookbook                     saved recipes + collections
/preferences, /settings                 user config
```

UI standards:
- Touch targets ≥ 44×44
- Skeleton loaders for primary content
- Pull-to-refresh where appropriate
- Subtle haptics for key actions (save, generate, tweak)
- Keyboard avoidance on all inputs
- Dark mode supported

## Admin Stack (`apps/admin/`)
- **Next.js 15** (App Router)
- **Tailwind CSS + shadcn/ui** (Radix UI + CVA + tailwind-merge)
- **Lucide React** icons
- **Sonner** for toasts
- Deployed via OpenNext on Cloudflare

Admin route structure: `app/(admin)/` — dashboard, moderation, provider-model, changelog, image-pipeline, memory, request-trace, simulations, version-causality.

## API Gateway (`infra/cloudflare/api-gateway/`)
- Cloudflare Worker, TypeScript
- Routes requests to Supabase edge functions
- Auth validation at the gateway level
- Contract types from `packages/contracts/src/generated.ts`

## Backend (`supabase/`)
- **Auth**: Supabase Auth (token-based; client uses `lib/auth.tsx`)
- **DB**: Postgres — users, preferences, recipes, recipe_versions, collections, memories, events
- **Edge Functions** (`functions/v1/`): LLM gateway, structured output, prompt templates
- LLM config (models, prompts, rules) lives in DB and is loaded at runtime — editable via admin UI

## Security
- No secrets in client code
- Tokens in platform secure storage only
- LLM prompts not logged client-side

## Deployment

All commands run from repo root. Always deploy after making changes — never tell the user to run commands.

### Deployment policy (required)
- No local Supabase deploy path in this project.
- Supabase schema/functions deploy via GitHub CI workflow: `.github/workflows/supabase-deploy.yml`.
- Cloudflare deploys are direct from this repo.

### One-time auth
```bash
npx wrangler login
```

### Supabase (GitHub CI only)
- Push to `main` with changes under `supabase/migrations/**` and/or `supabase/functions/**`.
- CI runs migration + function deploy.

### Push Cloudflare API gateway
```bash
npx wrangler deploy --config infra/cloudflare/api-gateway/wrangler.jsonc
```

### Push Cloudflare admin worker
```bash
pnpm --filter @alchemy/admin cf:build
pnpm --filter @alchemy/admin exec opennextjs-cloudflare deploy
```

### Quick verify
```bash
curl https://api.cookwithalchemy.com/v1/healthz
```

## Code Comments (Required)
Write detailed inline comments in all code you touch. This codebase is maintained by multiple AI agents across sessions — comments are the primary way context survives between them. Specifically:
- **Why, not what**: explain the reasoning behind non-obvious decisions, edge cases handled, and constraints that shaped the implementation.
- **Data flow**: at the top of functions/modules with complex orchestration, summarize the flow (inputs → transforms → outputs) and key invariants.
- **Contract boundaries**: document what callers can expect (preconditions, postconditions, error behavior) at public function/component interfaces.
- **Gotchas and coupling**: flag hidden dependencies, ordering requirements, or places where a change here requires a coordinated change elsewhere.
- **Magic values**: explain thresholds, timeouts, retry counts, opacity values, padding constants — any literal that isn't self-evident.
- **Migration/DB context**: in migration SQL, explain what the migration enables and any rollback considerations.
- **Swift/iOS specifics**: in SwiftUI views and modifiers, annotate animation parameters, gesture thresholds, and layout assumptions that affect visual behavior.

Do not add trivial comments that restate the code. Focus on information that would save a future agent 5+ minutes of investigation.

## When Blocked
State what is missing, give the smallest set of options, default to the simplest option that preserves API-first correctness and premium UI feel.
