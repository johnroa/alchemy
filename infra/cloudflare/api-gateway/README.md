# Alchemy API Gateway Worker

Cloudflare Worker that keeps a stable public API host (`api.cookwithalchemy.com`) while proxying to Supabase Edge Functions.

## Why this exists

- Avoids Cloudflare `1014 CNAME Cross-User Banned` when proxying a CNAME to Supabase (`*.functions.supabase.co`).
- Keeps client API base URL stable at `https://api.cookwithalchemy.com/v1`.
- Preserves Supabase as backend runtime for API logic.

## Required Worker secret

- `SUPABASE_FUNCTIONS_BASE_URL=https://dwptbjcxrsmmgjmnumpg.functions.supabase.co`

## Deploy

```bash
cd infra/cloudflare/api-gateway
npx wrangler secret put SUPABASE_FUNCTIONS_BASE_URL
npx wrangler deploy
```

Set custom domain on this worker: `api.cookwithalchemy.com`.
