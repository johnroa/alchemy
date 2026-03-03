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

## Non-Negotiables
- Strict TypeScript. No `any`.
- Minimal diffs. Do not touch unrelated code.
- Do not add dependencies unless explicitly asked.
- All LLM calls go through `supabase/functions/v1/` — never from the client.
- DB schema changes → migration file in `supabase/migrations/`, then `supabase db push`.
- Seeds belong in migrations, not API endpoints or hardcoded UI.
- After any code change: deploy the affected service. Don't ask the user to do it.
