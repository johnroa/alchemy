# Alchemy — Agent Instructions

## Project
Alchemy is an iOS-first, API-driven recipe app. Admin UI at `admin.cookwithalchemy.com`, API at `api.cookwithalchemy.com/v1`.

## Monorepo Structure
```
apps/mobile/          Expo 52 React Native (iOS-first)
apps/admin/           Next.js 15 admin dashboard (Cloudflare Workers via OpenNext)
infra/cloudflare/     Cloudflare Worker API gateway (TypeScript)
supabase/             Auth, Postgres, Edge Functions (LLM gateway)
packages/contracts/   OpenAPI schema + generated TypeScript types
packages/shared/      Shared utilities
```

## Deployment

All commands run from repo root (`/Users/john/Projects/alchemy`). **Always deploy after making changes — never tell the user to run commands.**

### Deployment policy (required)
- No local Supabase deploy path in this project.
- Supabase schema/functions deploy through GitHub CI only: `.github/workflows/supabase-deploy.yml`.
- Cloudflare deploys are direct (`wrangler`) from this repo.
- Never run direct DB edits in production workflows.
- Migrations must be append-only and sequential in `supabase/migrations/`.
- LLM prompts/rules must be changed via API/Admin UI, never by direct DB edits.

### Supabase (GitHub CI only)
- Push to `main` with changes under `supabase/migrations/**` and/or `supabase/functions/**`.
- CI workflow handles `db push` and function deploy.

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

## Non-Negotiables
- Strict TypeScript. No `any`.
- Minimal diffs. Do not touch unrelated code.
- Do not add dependencies unless explicitly asked.
- All LLM calls must go through the LLM pipeline (`supabase/functions/_shared/llm-scope-registry.ts` + `llm-executor.ts` + `llm-adapters/*`) via `supabase/functions/v1/` — never from the client.
- DB schema changes must be sequential, append-only migrations in `supabase/migrations/` (no direct DB edits).
- Supabase deploy is GitHub CI only; do not run local `supabase db push` / `supabase functions deploy`.
- LLM model routing/prompt/rule updates must go through Admin API/UI (`/api/admin/llm/prompts`, `/api/admin/llm/rules`, `/api/admin/llm/routes`), never direct DB edits.
- Seeds belong in migrations, not API endpoints or hardcoded UI.
- After any code change: deploy the affected service. Don't ask the user to do it.

## LLM Call Workflow (Required)
- Add LLM call: add scope in `supabase/functions/_shared/llm-scope-registry.ts`, add migration seeds for route/prompt/rule, add gateway wrapper using executor, wire callsite, add tests, update docs.
- Edit LLM call: prompt/rule/model edits through Admin API/UI only; if output contract changes, update validator/tests and OpenAPI examples if public behavior changes.
- Remove LLM call: remove callsite + wrapper + scope, add migration that deactivates scope config rows, and update docs/tests.
- Never place direct provider endpoint calls outside `supabase/functions/_shared/llm-adapters/`.
