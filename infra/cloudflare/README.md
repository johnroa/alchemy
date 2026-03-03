# Cloudflare Setup

## Zones and hostnames

- Root product domain: `cookwithalchemy.com`
- Admin UI: `admin.cookwithalchemy.com`
- API domain: `api.cookwithalchemy.com`

## Admin UI deployment (Cloudflare Workers Builds)

1. Create/connect a Cloudflare Worker build to this repo.
2. Set root directory to repository root (or keep as-is).
3. Build command:
   - `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @alchemy/admin cf:build`
4. Deploy command:
   - `pnpm --filter @alchemy/admin exec opennextjs-cloudflare deploy`
5. Version command:
   - `pnpm --filter @alchemy/admin exec opennextjs-cloudflare upload`
6. Attach custom domain: `admin.cookwithalchemy.com`.

### Required admin runtime variables/secrets

- `NEXT_PUBLIC_SUPABASE_URL` = `https://<project-ref>.supabase.co`
- `SUPABASE_SECRET_KEY` = Supabase project secret key
- `API_BASE_URL` = `https://api.cookwithalchemy.com/v1`
- `ADMIN_SIMULATION_BEARER_TOKEN` = JWT bearer token for a simulation user (used by admin simulation/image processing actions)

Note: in Cloudflare Workers UI, these can be added as `Secret` entries.

## Cloudflare Access gating (admin only)

1. Create Access application for `admin.cookwithalchemy.com`.
2. Policy: allow only approved emails/groups.
3. Ensure Access forwards `cf-access-authenticated-user-email` header.

## API domain mapping

Do not proxy a CNAME from `api.cookwithalchemy.com` to `*.functions.supabase.co` through Cloudflare. That causes `1014 CNAME Cross-User Banned`.

Use a dedicated Cloudflare Worker as gateway:

1. Deploy worker in `infra/cloudflare/api-gateway`.
2. Add worker secret:
   - `SUPABASE_FUNCTIONS_BASE_URL=https://dwptbjcxrsmmgjmnumpg.supabase.co/functions/v1/v1`
   - Optional fallback runtime var (already in `wrangler.jsonc`): `SUPABASE_PROJECT_REF=dwptbjcxrsmmgjmnumpg`
3. Attach custom domain `api.cookwithalchemy.com` directly to the worker.
4. Remove any existing proxied CNAME for `api` that points to Supabase.

### Variables/secrets keep "disappearing" in Cloudflare

Cloudflare stores worker config by both worker service and environment (`Preview` vs `Production`).
If values appear to reset, you are usually viewing a different environment or a different worker service.

- Keep non-sensitive values in `wrangler.jsonc` under `vars`.
- Keep sensitive values in Worker runtime secrets.
- Set secrets in every environment you actively deploy (`Production`, and `Preview` if used).
- Confirm custom domain is attached to the same worker service you are editing.

The worker forwards `/v1/*` to Supabase Edge Functions, so mobile/admin keep using:

- `https://api.cookwithalchemy.com/v1/*`

## Security notes

- Keep admin and API hostnames separate.
- Access gating only on admin hostname.
- API auth remains Supabase JWT-based at backend.
