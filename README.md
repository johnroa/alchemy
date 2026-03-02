# Alchemy Monorepo

Alchemy V1 implementation scaffold with:

- `apps/mobile`: Expo React Native iOS-first app.
- `apps/admin`: Next.js + shadcn/ui admin console.
- `packages/contracts`: OpenAPI contract for `/v1` API.
- `packages/shared`: shared TypeScript types/constants.
- `supabase/`: migrations + edge API function.
- `infra/cloudflare/`: Cloudflare DNS, Pages, and Access setup.

## API host

- `https://api.cookwithalchemy.com/v1/*`

## Admin host

- `https://admin.cookwithalchemy.com`

## LLM control model

- Provider/model routing is stored in `llm_model_routes`.
- Prompt instructions are stored in `llm_prompts`.
- Policy rules are stored in `llm_rules`.
- Runtime gateway reads active records from DB for every scope.
- Image generation route/prompt/rules are also admin-managed (`scope = image`).

## Setup

1. Install workspace dependencies:

```bash
pnpm install
```

2. Apply DB migrations:

```bash
supabase db push
```

3. Deploy API edge function:

```bash
supabase functions deploy v1
```

4. Generate contract types:

```bash
pnpm --filter @alchemy/contracts generate
```

5. Run apps:

```bash
pnpm dev:admin
pnpm dev:mobile
```
