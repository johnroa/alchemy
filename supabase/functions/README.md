# Supabase Edge Functions

## Deploy

```bash
supabase functions deploy v1 --project-ref <PROJECT_REF>
```

## Required environment variables

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- Optional: `OPENAI_RESPONSES_ENDPOINT` (defaults to OpenAI Responses API)
- Optional: `OPENAI_IMAGES_ENDPOINT` (defaults to OpenAI image generations API)

## API host

Production API is expected at:

- `https://api.cookwithalchemy.com/v1/*`

Use the Cloudflare API gateway worker in `infra/cloudflare/api-gateway` to front Supabase functions.
Direct proxied CNAME mapping to `*.functions.supabase.co` can fail with Cloudflare error `1014`.
