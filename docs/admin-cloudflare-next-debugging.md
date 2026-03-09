# Admin Cloudflare and Next.js Debugging Guide

This document captures the production Admin failure that surfaced on March 9, 2026 and the debugging workflow used to fix it.

It exists so future Admin 500s on `admin.cookwithalchemy.com` can be diagnosed quickly instead of rediscovering the same Cloudflare, OpenNext, and Next.js failure modes.

Primary implementation files:

- [package.json](/Users/john/Projects/alchemy/apps/admin/package.json)
- [wrangler.jsonc](/Users/john/Projects/alchemy/apps/admin/wrangler.jsonc)
- [supabase-admin.ts](/Users/john/Projects/alchemy/apps/admin/lib/supabase-admin.ts)
- [route.ts](/Users/john/Projects/alchemy/apps/admin/app/api/admin/recipes/[id]/canonical/route.ts)
- [route.ts](/Users/john/Projects/alchemy/apps/admin/app/api/admin/recipes/[id]/causality/route.ts)
- [route.ts](/Users/john/Projects/alchemy/apps/admin/app/api/admin/recipes/[id]/render/route.ts)
- [route.test.ts](/Users/john/Projects/alchemy/apps/admin/app/api/admin/recipes/[id]/render/route.test.ts)

## Incident Summary

Observed symptom:

- authenticated browser requests to `https://admin.cookwithalchemy.com/analytics/pipelines` returned a generic `Internal Server Error`

The first useful production error from Cloudflare tail was:

```text
Error: You cannot use different slug names for the same dynamic path ('recipeId' !== 'id').
```

That error came from Next.js route graph construction, not from Supabase, not from the new flags page, and not from Access itself.

## What Actually Went Wrong

There were two separate issues.

### 1. Admin Cloudflare build was not clearing `.next`

Admin's `cf:build` script originally removed only `.open-next`.

That was insufficient because stale `.next` route artifacts could survive across builds and confuse the output that OpenNext bundled for Cloudflare.

The fix was to make the build clear both:

- `.next`
- `.open-next`

### 2. The source tree still had a real dynamic-route collision

Even after the stale build issue was fixed, the live worker still crashed because the source itself contained:

- `/api/admin/recipes/[id]/canonical`
- `/api/admin/recipes/[id]/causality`
- `/api/admin/recipes/[recipeId]/render`

Next.js App Router does not allow the same dynamic path segment to use two different param names in the same route tree.

This is why the production error explicitly said:

- `'recipeId' !== 'id'`

The real code fix was to rename the render route to:

- `/api/admin/recipes/[id]/render`

Official Next.js reference:

- [Dynamic Segments](https://nextjs.org/docs/app/building-your-application/routing/dynamic-routes)

## Why The Error Was Easy To Misread

The user-facing page only showed:

- `Internal Server Error`

That is not enough to distinguish between:

- a Next route graph crash
- a missing secret
- a bad database query
- a missing Cloudflare Access header

The production tail was the decisive signal.

## Cloudflare Access Gotcha

Admin requires the Cloudflare Access identity header:

- `cf-access-authenticated-user-email`

That requirement is enforced in:

- [supabase-admin.ts](/Users/john/Projects/alchemy/apps/admin/lib/supabase-admin.ts)

Important operational consequence:

- `workers.dev` requests without Access will return a 500 caused by missing identity header
- that is expected for unauthenticated `workers.dev`
- it is not the same thing as a broken authenticated request on `admin.cookwithalchemy.com`

So do not use raw unauthenticated `workers.dev` 500s as proof that production is still broken.

## Correct Debug Workflow

When Admin shows a generic 500, use this sequence.

### 1. Tail the live worker

From repo root:

```bash
pnpm --filter @alchemy/admin exec wrangler tail --config wrangler.jsonc --format pretty
```

Then reproduce the failing request on the real custom domain:

- `https://admin.cookwithalchemy.com/...`

This is the fastest way to get the real runtime error.

### 2. Distinguish Access failures from app failures

Expected Access failure shape:

- `Cloudflare Access identity header is required`

If you see that on `workers.dev`, that only means the request bypassed Access.

It does not prove the Admin app itself is broken.

### 3. Rebuild Admin locally with the documented Cloudflare build path

From repo root:

```bash
pnpm --filter @alchemy/admin cf:build
```

Do not substitute a different build path as the final fix. The documented path is the contract.

### 4. Check the generated route inventory in the build output

If Next route graph construction is the problem, the `cf:build` output is often enough to reveal it.

For this incident, the bad route list showed both:

- `/api/admin/recipes/[id]/...`
- `/api/admin/recipes/[recipeId]/...`

That was the smoking gun.

### 5. Verify the custom domain is attached to the expected worker

Cloudflare API or Wrangler should confirm:

- hostname: `admin.cookwithalchemy.com`
- service: `alchemy-admin`
- environment: `production`

This rules out "wrong worker attached to the domain" as a cause.

### 6. If needed, run authenticated local preview

Local preview is useful after the route graph is fixed.

Preview command:

```bash
SUPABASE_SECRET_KEY="$(./scripts/admin-api.sh service-key)" \
pnpm --filter @alchemy/admin exec opennextjs-cloudflare preview
```

Then send a test request with a fake local Access header:

```bash
curl -H 'cf-access-authenticated-user-email: admin@cookwithalchemy.com' \
  http://localhost:8787/analytics/pipelines
```

That works because local preview is not the real Cloudflare Access edge.

### 7. Redeploy after the source fix

From repo root:

```bash
pnpm --filter @alchemy/admin cf:build
pnpm --filter @alchemy/admin exec opennextjs-cloudflare deploy
```

Then verify the new live version with:

```bash
pnpm --filter @alchemy/admin exec wrangler deployments list --config wrangler.jsonc
```

## Production Fixes Applied

Two fixes were required.

### Build hygiene fix

Admin `cf:build` now removes:

- `.next`
- `.open-next`

This prevents stale local build output from contaminating OpenNext packaging.

### Source route fix

Admin recipe render route was normalized from:

- `[recipeId]`

to:

- `[id]`

to match the rest of the `/api/admin/recipes/...` tree.

## Prevention Rules

### Keep dynamic segment names consistent within one route tree

If one branch is:

- `/api/admin/recipes/[id]/canonical`

then sibling branches should also use:

- `/api/admin/recipes/[id]/...`

Do not mix:

- `[id]`
- `[recipeId]`

in the same structural route family.

### Always clear both build output directories in Admin Cloudflare builds

For this repo, the safe Admin Cloudflare build behavior is:

- remove `.next`
- remove `.open-next`
- then run the documented build

### Use the real custom domain for authenticated reproduction

If the problem might involve Cloudflare Access, the custom domain matters:

- `admin.cookwithalchemy.com`

Using only `workers.dev` can hide or distort the real failure mode.

### Prefer live tail over inference

The generic 500 page is low-signal.

Live tail is high-signal.

For Admin production debugging, tail first.

## Short Rule Of Thumb

If Admin suddenly starts returning a generic 500 after a deploy:

1. tail the worker
2. reproduce on the custom domain
3. look for route graph errors before blaming data fetching
4. verify `.next` was cleared
5. check for mixed dynamic segment names in the same route family
