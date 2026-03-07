# Alchemy — Agent Instructions

## Project
Alchemy is an iOS-first, API-driven recipe app. Admin UI at `admin.cookwithalchemy.com`, API at `api.cookwithalchemy.com/v1`.

## Monorepo Structure
```
apps/ios/             Native SwiftUI iOS app
apps/admin/           Next.js 15 admin dashboard (Cloudflare Workers via OpenNext)
infra/cloudflare/     Cloudflare Worker API gateway (TypeScript)
supabase/             Auth, Postgres, Edge Functions (LLM gateway)
packages/contracts/   OpenAPI schema + generated TypeScript types
packages/shared/      Shared utilities (ingredient icon resolution, food icon catalogs, common types)
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
- Add LLM call: add scope in `supabase/functions/_shared/llm-scope-registry.ts`, add migration seeds for model routes (prompts/rules via admin API), add gateway wrapper using executor, wire callsite, add tests, update docs.
- Edit LLM call: prompt/rule/model edits through Admin API/UI only; if output contract changes, update validator/tests and OpenAPI examples if public behavior changes.
- Remove LLM call: remove callsite + wrapper + scope, add migration that deactivates scope config rows, and update docs/tests.
- Never place direct provider endpoint calls outside `supabase/functions/_shared/llm-adapters/`.

## Canonical Recipes + Private Variants ("Sous Chef")

Core architecture: canonical (public, immutable) recipes + per-user private variants.

- **Canonical**: created by `recipe_canonicalize` scope from chat output. Immutable, visible in Explore.
- **Variants**: created by `recipe_personalize` scope. Private per user. Title stays canonical; content is personalized.
- **Constraints vs preferences**: Constraints (dietary_restrictions, aversions) are retroactive — changes mark variants `stale`. Preferences (cuisines, equipment) are forward-only.
- **Variant lifecycle**: `current` → `stale` → `processing` → `current`. Also `failed`, `needs_review`.
- **Graph-grounded personalization**: queries knowledge graph for proven substitution patterns before LLM call.
- **Substitution diffs**: structured records of ingredient swaps stored in provenance. Surfaced in iOS.
- **Variant tags**: materialized JSONB tags for multi-dimensional Cookbook filtering.
- **Tables**: `cookbook_entries`, `user_recipe_variants`, `user_recipe_variant_versions`, `preference_change_log`.
- **Endpoints**: `GET /recipes/{id}/variant`, `POST /recipes/{id}/variant/refresh`, `POST /recipes/{id}/publish`, `GET /recipes/cookbook`.

## Popularity & Trending

- Pre-computed `popularity_score` and `trending_score` on `recipe_search_documents`. Weights: saves x3, variants x2, views x0.5.
- `recipe_view_events` table — fire-and-forget on `GET /recipes/{id}`.
- `ingredient_trending_stats` table — recipe-derived popularity + substitution momentum (-100 to +100).
- `POST /popularity/refresh` — batch recompute. `GET /ingredients/trending?sort=trending|momentum`.
- `POST /recipes/search` accepts `sort_by: recent|popular|trending`.

## Pipeline Observability

- `GET /observability/pipeline?hours=N` — per-scope LLM stats, variant health, graph activity.
- Admin `/pipeline-health` dashboard with configurable time window.

## Recipe Import Pipeline
- **Endpoint:** `POST /chat/import` — accepts url/text/photo kind, returns seeded ChatSession.
- **LLM scopes:** `recipe_import_transform`, `recipe_import_vision_extract`. Prompts/rules managed via admin API only (not migration-seeded).
- **Scraper module:** `supabase/functions/_shared/recipe-scraper.ts` — bounded URL fetcher + Schema.org/microdata/meta extraction.
- **Import route:** `supabase/functions/v1/routes/import.ts` — fingerprint dedup, extraction, LLM transform, session seeding, image enrollment.
- **Provenance:** `import_provenance` table tracks source, strategy, confidence, errors. Linked to `chat_sessions` and `recipe_versions`.
- **Admin:** `/imports` page with telemetry. Dashboard has Import Activity section.
- **iOS:** Tab bar accessory → dialog → ImportView. Share extension via App Group + `alchemy://import` URL scheme.

## API Contract & Spec Workflow (Required)

The OpenAPI spec is the single source of truth for all API contracts. When changing any API endpoint, keep everything in sync:

### Files
- `packages/contracts/openapi.yaml` — source of truth (edit this)
- `packages/contracts/openapi.json` — generated, do not edit
- `packages/contracts/src/generated.ts` — generated, do not edit
- `apps/admin/lib/openapi-spec.json` — copy for admin API docs page, do not edit
- `apps/admin/lib/admin-routes.ts` — generated admin route inventory, do not edit by hand

### Steps (every API change)
1. Edit `packages/contracts/openapi.yaml`
2. Bump `info.version` (semver: patch=fix, minor=new endpoint, major=breaking)
3. Regenerate:
   ```bash
   pnpm --filter @alchemy/contracts generate
   pnpm --filter @alchemy/contracts generate:json
   pnpm admin:routes:generate
   cp packages/contracts/openapi.json apps/admin/lib/openapi-spec.json
   ```
4. If admin routes changed: regenerate `apps/admin/lib/admin-routes.ts`
5. Add CHANGELOG.md entry under `[Unreleased]`
6. Deploy affected services
7. Commit all generated files with the source change

### Do NOT
- Edit generated files directly (`openapi.json`, `generated.ts`, `openapi-spec.json`)
- Skip the version bump
- Add an admin route without regenerating `apps/admin/lib/admin-routes.ts`

## Admin API Helper (`scripts/admin-api.sh`)

CLI tool for LLM config management and database queries. Auto-resolves Supabase CLI token from macOS keychain.

```bash
./scripts/admin-api.sh sql "<query>"                             # Run SQL
./scripts/admin-api.sh sql-file <file>                           # Run SQL from file
./scripts/admin-api.sh prompt-list [scope]                       # List prompts (>>> = active)
./scripts/admin-api.sh prompt-create <scope> <ver> <name> <file> # Create & activate prompt
./scripts/admin-api.sh prompt-activate <scope> <version>         # Activate existing version
./scripts/admin-api.sh rule-list [scope]                         # List rules
./scripts/admin-api.sh rule-create <scope> <ver> <name> <file>   # Create & activate rule
./scripts/admin-api.sh route-list                                # Active model routes
./scripts/admin-api.sh service-key                               # Print service role key
./scripts/admin-api.sh sim-token                                 # Get sim user access token
```

Use this for all LLM prompt/rule/route operations instead of raw curl.

## Development Reset Workflow (Required)

- Destructive food-domain resets must run through Admin API routes only:
  - `POST /api/admin/development/reset/preview`
  - `POST /api/admin/development/reset/execute`
  - `GET /api/admin/development/runs`
- Reset operations are backed by migration-defined RPCs:
  - `admin_dev_food_data_preview(...)`
  - `admin_dev_food_data_wipe(...)`
- Never run ad-hoc destructive SQL in production workflows.
- Always run a dry-run preview before execute.
- Execute requires exact confirmation text: `WIPE <PRESET UPPERCASE WITH SPACES>`.
