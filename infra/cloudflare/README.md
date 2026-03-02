# Cloudflare Setup

## Zones and hostnames

- Root product domain: `cookwithalchemy.com`
- Admin UI: `admin.cookwithalchemy.com`
- API domain: `api.cookwithalchemy.com`

## Admin UI deployment

1. Create a Cloudflare Pages project for `apps/admin`.
2. Build command: `pnpm --filter @alchemy/admin build`.
3. Output directory: `.next` (via Pages Next.js support).
4. Attach custom domain: `admin.cookwithalchemy.com`.

## Cloudflare Access gating (admin only)

1. Create Access application for `admin.cookwithalchemy.com`.
2. Policy: allow only approved emails/groups.
3. Ensure Access forwards `cf-access-authenticated-user-email` header.

## API domain mapping

1. Create `api.cookwithalchemy.com` DNS record.
2. Point to Supabase Edge Function entrypoint with proxy enabled.
3. Route requests to `v1` edge function so paths resolve under `/v1/*`.

## Security notes

- Keep admin and API hostnames separate.
- Access gating only on admin hostname.
- API auth remains Supabase JWT-based at backend.
