# Alchemy — Claude Instructions

## Project
Alchemy is an iOS-first, API-driven recipe app. Users set dietary/skill/equipment preferences, generate recipes via LLM, iteratively tweak them, and organize favorites. An admin UI manages users, LLM config, and rules.

## Monorepo Structure
```
apps/ios/             Native SwiftUI iOS app
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
- Direct provider endpoints (`api.openai.com`, `api.anthropic.com`, `generativelanguage.googleapis.com`) are allowed only in `supabase/functions/_shared/llm-adapters/*`.

## iOS App (`apps/ios/`)
- **SwiftUI** — native iOS views and navigation
- **Observable state** — view-local state and feature orchestration
- **XcodeGen** — project generation from `apps/ios/project.yml`
- **SPM** — package management for iOS dependencies
- API calls go through the Cloudflare gateway at `https://api.cookwithalchemy.com/v1`

### iOS Conventions
- Keep product logic server-side; the app should remain API-driven.
- Treat `apps/ios/Alchemy/Features/*` as the main feature boundaries.
- Keep shared visual primitives under `apps/ios/Alchemy/DesignSystem/*`.
- Preserve loading, empty, and error states for user-facing flows.

## Recipe Import Pipeline
- **Endpoint:** `POST /chat/import` with `kind: url|text|photo`.
- **Flow:** Extract (URL scraper / vision LLM / raw text) → Transform via `recipe_import_transform` scope → Seed chat session with CandidateRecipeSet → Enroll image generation → Return ChatSessionResponse.
- **LLM scopes:** `recipe_import_transform` (ImportedRecipeDocument → RecipePayload), `recipe_import_vision_extract` (cookbook photo → ImportedRecipeDocument). Prompts/rules managed via admin API only.
- **Scraper:** `supabase/functions/_shared/recipe-scraper.ts` — Schema.org JSON-LD first, microdata fallback, OpenGraph fallback. No site-specific scrapers.
- **Copyright:** Transform scope rewrites all text in Alchemy's voice. Source images never stored or reused.
- **Dedup:** Per-user source fingerprint in `import_provenance` table. Re-importing same URL returns cached session.
- **Admin:** Imports page at `/imports` with telemetry KPIs. Dashboard has Import Activity section.
- **iOS:** Tab bar accessory button opens import dialog. Share extension uses App Group handoff + `alchemy://import` URL scheme.

## Canonical Recipes + Private Variants ("Sous Chef")

Core architecture separating public canonical recipes from per-user private variants.

- **Canonical recipes**: immutable public base version. Created by `recipe_canonicalize` LLM scope which strips user-specific adaptations from chat output. Visible in Explore.
- **User variants**: private personalized version per user per canonical recipe. Created by `recipe_personalize` LLM scope. Visible in Cookbook. Title stays canonical; ingredients/steps/summary are personalized.
- **Preference categories**: "Constraints" (dietary_restrictions, aversions — retroactive, impact `preference_fingerprint`) vs "Preferences" (cuisines, equipment — forward-only). Constraint changes mark variants `stale` for re-personalization.
- **Variant lifecycle**: `current` → `stale` (constraint changed) → `processing` → `current`. Also: `failed` (retry), `needs_review` (manual edits conflict with constraints).
- **Manual edits**: `POST /recipes/{id}/variant/refresh` with `instructions` accumulates edits in `accumulated_manual_edits`. Replayed on re-personalization. Conflicts with constraints → `needs_review`.
- **Graph-grounded personalization**: Before calling LLM, the system queries the knowledge graph for proven substitution patterns (`substitutes_for` edges with `source: variant_aggregation`) relevant to the user's constraints. These are passed as `graphSubstitutions` grounding context.
- **Substitution diffs**: Every personalization produces structured `substitution_diffs` (original, replacement, constraint, reason) stored in variant version provenance. Surfaced in iOS "What did my Sous Chef change?" view.
- **Substitution aggregation**: `POST /graph/substitution-aggregate` admin endpoint scans variant provenance, aggregates patterns across users, and creates/strengthens graph edges.
- **Variant tags**: Structured JSONB tags (cuisine, dietary, technique, occasion, time, difficulty, key_ingredients) materialized on variants at personalization time. Powers multi-dimensional Cookbook filtering.

### Key tables
- `cookbook_entries` — user-to-canonical-recipe relationship (replaces old `recipe_saves`)
- `user_recipe_variants` — one per user per canonical recipe, tracks lifecycle + preference fingerprint + variant_tags
- `user_recipe_variant_versions` — full version history with provenance and substitution diffs
- `preference_change_log` — audit trail for preference changes, drives retroactive propagation

### Key endpoints
- `GET /recipes/{id}/variant` — fetch variant detail with substitution diffs
- `POST /recipes/{id}/variant/refresh` — create/refresh variant (optional `instructions` for manual edits)
- `POST /recipes/{id}/publish` — publish variant as new canonical recipe
- `GET /recipes/cookbook` — returns `CookbookEntry[]` with variant status and personalized summaries

## Popularity & Trending

Pre-computed popularity scores for recipes and ingredient trending stats.

- **Signals**: save count (from `cookbook_entries`), variant count (from `user_recipe_variants`), unique view count (from `recipe_view_events`).
- **Scores**: `popularity_score` (all-time weighted: saves x3, variants x2, views x0.5) and `trending_score` (7-day window same weights) on `recipe_search_documents`.
- **View tracking**: Fire-and-forget insert to `recipe_view_events` on `GET /recipes/{id}`. Append-only, aggregated by `COUNT(DISTINCT user_id)`.
- **Ingredient trending**: `ingredient_trending_stats` table with recipe-derived popularity (sum of recipe scores) and substitution momentum (sub-in vs sub-out from variant diffs). Momentum scaled -100 to +100.
- **Batch refresh**: `refresh_recipe_popularity_stats()` RPC recomputes all stats. Triggered via `POST /popularity/refresh`.
- **Search sort**: `POST /recipes/search` accepts `sort_by: recent|popular|trending`.
- **iOS**: Explore sort picker, social proof badges on cards.

### Key endpoints
- `POST /popularity/refresh` — batch recompute all popularity + ingredient stats
- `GET /ingredients/trending?sort=trending|momentum&limit=N` — trending ingredients

## Pipeline Observability

- **`GET /observability/pipeline?hours=N`** — aggregated per-scope LLM call stats (counts, latency percentiles, error rates, cost, tokens), variant health breakdown, and graph edge creation rate.
- **Admin page**: `/pipeline-health` dashboard with summary cards, scope breakdown table, variant health grid, graph activity panel. Configurable time window (1h to 7d).
- **Backed by**: `get_pipeline_observability_stats(p_hours)` RPC aggregating from `events` table + `user_recipe_variants` + `graph_edges`.

## Admin Stack (`apps/admin/`)
- **Next.js 15** (App Router)
- **Tailwind CSS + shadcn/ui** (Radix UI + CVA + tailwind-merge)
- **Lucide React** icons
- **Sonner** for toasts
- Deployed via OpenNext on Cloudflare

Admin pages: dashboard, users, images, imports, development, provider-model, model-usage, models, prompts, rules, memory, recipes, ingredients, graph, metadata-pipeline, changelog, request-trace, pipeline-health, version-causality, api-docs, simulation-recipe, simulation-image, simulations.

## API Gateway (`infra/cloudflare/api-gateway/`)
- Cloudflare Worker, TypeScript
- Routes requests to Supabase edge functions
- Auth validation at the gateway level
- Contract types from `packages/contracts/src/generated.ts`

## Backend (`supabase/`)
- **Auth**: Supabase Auth (token-based; client uses `lib/auth.tsx`)
- **DB**: Postgres — users, preferences, recipes, recipe_versions, cookbook_entries, user_recipe_variants, user_recipe_variant_versions, collections, memories, events, recipe_view_events, ingredient_trending_stats, recipe_search_documents, graph_entities, graph_edges, ingredients, import_provenance
- **Edge Functions** (`functions/v1/`): LLM gateway, structured output, prompt templates
- LLM config (models, prompts, rules) lives in DB and is loaded at runtime — editable via admin UI
- **LLM scopes**: `recipe_generate`, `recipe_search_interpret`, `recipe_canonicalize`, `recipe_personalize`, `recipe_import_transform`, `recipe_import_vision_extract`, `memory_extract`, `metadata_enrich`

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

## API Contract & Spec Workflow (Required)

The OpenAPI spec is the single source of truth for all API contracts. When you change any API endpoint behavior, you MUST keep the spec, generated types, admin API docs page, and changelog in sync.

### Files in the chain
```
packages/contracts/openapi.yaml          ← source of truth (edit this)
packages/contracts/openapi.json          ← generated (do not edit)
packages/contracts/src/generated.ts      ← generated (do not edit)
apps/admin/lib/openapi-spec.json         ← copy for admin API docs page (do not edit)
apps/admin/lib/admin-routes.ts           ← generated admin route inventory (do not edit)
```

### When to update
- **Adding/removing/changing a public API endpoint** (request/response shape, new path, removed path)
- **Adding/removing an admin API route** (also regenerate `apps/admin/lib/admin-routes.ts`)
- **Changing authentication, error codes, or shared schemas**

### Step-by-step
1. **Edit the spec**: `packages/contracts/openapi.yaml`
2. **Bump the version**: increment `info.version` using semver — patch for fixes, minor for new endpoints, major for breaking changes
3. **Regenerate derived files**:
   ```bash
   pnpm --filter @alchemy/contracts generate        # openapi.yaml → src/generated.ts
   pnpm --filter @alchemy/contracts generate:json    # openapi.yaml → openapi.json
   pnpm admin:routes:generate
   cp packages/contracts/openapi.json apps/admin/lib/openapi-spec.json
   ```
4. **Update admin routes** (if admin API routes changed): regenerate `apps/admin/lib/admin-routes.ts`
5. **Update CHANGELOG.md**: add entry under `[Unreleased]` describing the API change
6. **Deploy affected services**: if the gateway contract changed, deploy the gateway; if admin routes changed, deploy admin
7. **Commit all generated files together** with the source change

### Version format
`info.version` in `openapi.yaml` uses semver: `MAJOR.MINOR.PATCH`
- **PATCH** (1.2.0 → 1.2.1): fix a schema description, add an optional field to an existing response
- **MINOR** (1.2.1 → 1.3.0): add a new endpoint, add a new required response field
- **MAJOR** (1.3.0 → 2.0.0): remove an endpoint, rename a field, change a required field type

### Do NOT
- Edit `openapi.json`, `generated.ts`, or `openapi-spec.json` directly — they are generated
- Skip the version bump — the admin API docs page displays the version
- Forget to copy `openapi.json` → `apps/admin/lib/openapi-spec.json` (the admin page reads this copy)
- Add an admin API route without regenerating `apps/admin/lib/admin-routes.ts`

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

## Admin API Helper (`scripts/admin-api.sh`)

Streamlined CLI for managing LLM config and running queries against the Supabase Management API. Auto-resolves the Supabase CLI token from macOS keychain — no manual auth needed.

```bash
# Run SQL queries
./scripts/admin-api.sh sql "SELECT * FROM llm_prompts WHERE is_active = true"
./scripts/admin-api.sh sql-file /path/to/query.sql

# Prompt management (versioned, append-only)
./scripts/admin-api.sh prompt-list [scope]                      # List all prompts (>>> = active)
./scripts/admin-api.sh prompt-create <scope> <ver> <name> <file> # Create & activate prompt from file
./scripts/admin-api.sh prompt-activate <scope> <version>         # Activate existing version

# Rule management
./scripts/admin-api.sh rule-list [scope]
./scripts/admin-api.sh rule-create <scope> <ver> <name> <file>

# Route inspection
./scripts/admin-api.sh route-list                                # Active model routes

# Auth tokens
./scripts/admin-api.sh service-key                               # Print service role key
./scripts/admin-api.sh sim-token                                 # Get sim user access token
```

Use this for all LLM prompt/rule/route operations instead of raw curl or the Supabase Management API directly.

## When Blocked
State what is missing, give the smallest set of options, default to the simplest option that preserves API-first correctness and premium UI feel.
