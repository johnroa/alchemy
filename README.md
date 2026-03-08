# Alchemy Monorepo

iOS-first AI recipe app — users set dietary/skill/equipment preferences, chat with the assistant to converge on dishes, iterate candidate recipe tabs, and commit to cookbook. An admin console manages users, LLM config, content moderation, and observability.

## Structure

```
apps/ios/             Native SwiftUI iOS app (iOS 18+)
apps/admin/           Next.js 15 admin dashboard (Cloudflare Workers via OpenNext)
infra/cloudflare/     Cloudflare Worker API gateway (TypeScript)
supabase/             Auth, Postgres, Edge Functions (LLM gateway)
packages/contracts/   OpenAPI schema + generated TypeScript types
packages/shared/      Shared utilities
```

## Hosts

- **API**: `https://api.cookwithalchemy.com/v1/*`
- **Admin**: `https://admin.cookwithalchemy.com`

## Current TODOs

- Open [TODO.md](/Users/john/Projects/alchemy/TODO.md) for the remaining work after the shipped acquisition-ready telemetry slice.

---

## iOS App (`apps/ios/`)

Native SwiftUI rewrite of the Expo mobile app. MVVM architecture with `@Observable`, targeting iOS 18+ with iOS 26 Liquid Glass support.

### Tech stack

- **SwiftUI** — `@Observable` ViewModels, `NavigationStack`, `matchedGeometryEffect`
- **supabase-swift 2.0** — Auth with Keychain-managed sessions
- **Nuke + NukeUI** — Async image loading and caching
- **Lottie 4.4** — Recipe generation animation
- **Sentry Cocoa** — Crash reporting and performance tracing
- **SPM** — All dependencies via Swift Package Manager
- **XcodeGen** — Project generation from `project.yml`

### Screens

| Screen | Description |
|---|---|
| `SplashView` | Full-bleed kitchen image + ALCHEMY wordmark + loading spinner |
| `AuthFlowView` | Sign in / Register with cross-fade transitions |
| `OnboardingView` | Chat-based AI preference interview with progress bar |
| `TabShell` | 3-tab container with custom floating pill tab bar + Import accessory |
| `CookbookView` | Saved recipes with multi-dimensional filtering (cuisine, dietary, time, difficulty), staggered 2-column grid |
| `GenerateView` | Chat panel + recipe canvas with Lottie animation during generation |
| `ExploreView` | Full-bleed vertical discovery feed with `For You` personalization, dynamic preset chips, why-tags, and explicit search |
| `ImportView` | Recipe import flow — URL paste, text paste, photo capture |
| `RecipeDetailView` | Parallax hero, ingredients, steps, nutrition, pairings, "What did my Sous Chef change?" substitution diffs |
| `PreferencesView` | 9-field form — dietary, skill, equipment, cuisines, aversions |
| `SettingsView` | Memory stats, changelog, account management |

### Architecture

```
Alchemy/
├── App/                    Entry point, routing, environment
├── Core/
│   ├── Auth/               AuthManager (@Observable, supabase-swift)
│   └── Networking/         APIClient (URLSession + async/await), models
├── DesignSystem/
│   ├── Components/         Button, TextField, SearchBar, FilterChip, RecipeCard, TabBar
│   ├── Modifiers/          Glass (iOS 26), Haptics, Shimmer
│   └── Theme/              Colors, Typography, Spacing
├── Features/               One folder per screen (View + ViewModel pairs)
│   ├── Auth/               AuthFlowView
│   ├── Cookbook/            CookbookView with variant-based filtering
│   ├── Explore/            ExploreView with personalized `For You` feed + explicit search
│   ├── Generate/           GenerateView + chat + candidate canvas
│   ├── Import/             ImportView + ImportViewModel (URL/text/photo)
│   ├── Onboarding/         OnboardingView — AI preference interview
│   ├── Preferences/        PreferencesView
│   ├── RecipeDetail/       RecipeDetailView + substitution diffs
│   ├── Settings/           SettingsView
│   └── Shell/              TabShell — tab bar + Import accessory
├── Models/                 Shared Swift domain models
└── Resources/              Assets.xcassets, Info.plist, Lottie JSON, entitlements
```

### Running the iOS app

```bash
cd apps/ios

# Generate Xcode project (requires xcodegen)
xcodegen generate

# Build for simulator
xcodebuild -project Alchemy.xcodeproj -scheme Alchemy \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build

# Or open in Xcode
open Alchemy.xcodeproj
```

### Configuration

Supabase and Sentry settings are injected into `Info.plist` at build time via `Configuration/Debug.xcconfig`, `Configuration/Release.xcconfig`, and optional `Configuration/Local.xcconfig` overrides.

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Supabase publishable/anon key |
| `API_BASE_URL` | No | Defaults to `https://api.cookwithalchemy.com/v1` |
| `SENTRY_DSN` | No | Enables iOS Sentry crash + perf capture when set |
| `SENTRY_TRACES_SAMPLE_RATE` | No | Trace sample rate (`1.0` debug default, `0.2` release default) |

`SENTRY_DSN` is intentionally blank in the committed xcconfigs. Set it in `Configuration/Local.xcconfig` so local or CI secrets override the tracked defaults without leaking credentials.

## Client History

An older Expo client existed before the native SwiftUI rewrite, but it is no longer part of this repository. Current client development happens in `apps/ios/`, and API behavior should be treated as contract-driven from the OpenAPI spec plus the live `/v1/*` implementation.

---

## Admin Console (`apps/admin/`)

Next.js 15 App Router. All pages under `app/(admin)/`:

| Page | Description |
|---|---|
| `/dashboard` | KPI rollup — LLM cost, safety flags, image pipeline, import activity, activity feed |
| `/users` | User roster with live search, status, and reset-memory action |
| `/recipes` | Split-panel recipe audit — coverage snapshot cards, velocity deltas, version timeline + prompt trace |
| `/images` | Consolidated image pipeline — overview, live queue, shared assets/reuse provenance, QA tooling |
| `/imports` | Recipe import telemetry — KPI cards, source/strategy breakdown, recent imports, failure details |
| `/ingredients` | Canonical ingredient registry with semantic food icons, enrichment metadata, and ontology links |
| `/graph` | Entity relationship graph — force-directed canvas with type filters, fullscreen, and confidence-ranked edges |
| `/provider-model` | Model Assignments — LLM model routing per scope |
| `/model-usage` | Model usage analytics |
| `/models` | Model registry — available providers/models with pricing and context window |
| `/prompts` | Prompt management per scope — active/inactive versions, inline editing |
| `/rules` | Policy rules per scope — active/inactive versions, inline editing |
| `/memory` | User memory snapshots + confidence/salience quality signals |
| `/metadata-pipeline` | Metadata enrichment pipeline queue |
| `/pipeline-health` | LLM pipeline observability — per-scope stats, variant health, graph activity |
| `/boards` | Executive board landing page with curated KPI drill-downs |
| `/boards/acquisition` | Install funnels, sign-in/onboarding conversion, first recipe/save/cook milestones, and install-week returning-cook retention |
| `/boards/engagement` | North-star cooking, acceptance, cookbook revisit, and repeat-cook KPIs |
| `/boards/operations` | Generation latency, defect rate, queue pressure, failure backlog, and cost KPIs |
| `/boards/personalization` | Explore algorithm version, lift vs baseline, novelty share, cold-start coverage, and fallback diagnostics |
| `/analytics/personalization` | Per-version feed funnel, fallback reasons, why-tag distribution, and profile-state/acquisition breakouts |
| `/simulations` | Seeded simulation runner — single or concurrent A/B with full trace, latency segments, and token deltas |
| `/simulation-recipe` | Recipe-specific simulation runs |
| `/simulation-image` | Image generation simulation and comparison |
| `/development` | Destructive development reset console (dry-run preview + typed confirmation + run audit trail) |
| `/request-trace` | Gateway event log — clickable rows, payload details, error highlighting |
| `/changelog` | Changelog event audit with action/scope distribution charts |
| `/version-causality` | Recipe version causality chains |
| `/api-docs` | Auto-generated API reference from OpenAPI spec + admin route discovery |

### Executive boards and first-party telemetry

- Boards are intentionally distinct from Analytics pages. Boards are fixed executive KPI surfaces; Analytics remains the drill-down layer.
- The shipped executive board set is `/boards/acquisition`, `/boards/engagement`, `/boards/operations`, and `/boards/personalization`.
- First-party product behavior is stored in append-only `behavior_events` and `behavior_semantic_facts` tables.
- Launch attribution and install cohorts are stored in `install_profiles` and `user_acquisition_profiles`.
- Explore personalization caches live in `user_taste_profiles`, and versioned recommender rollouts live in `explore_algorithm_versions`.
- Personalized Explore performance is analyzed through `explore_impression_outcomes`, which joins feed serves, impressions, opens, saves, and inferred cooks.
- The authenticated client ingestion endpoint for batched product events is `POST /telemetry/behavior`.
- The anonymous pre-auth install ingestion endpoint is `POST /telemetry/install`.
- iOS generates a stable local `install_id` on first launch and propagates it through both telemetry endpoints plus the `X-Install-Id` request header for authenticated API calls.

---

## LLM Control Model

All LLM configuration is **runtime DB-driven** — no redeployment required for model swaps, prompt edits, or rule changes. The gateway reads the active record for the requested scope on every call.

All LLM calls must flow through the shared pipeline:
- scope registry: `supabase/functions/_shared/llm-scope-registry.ts`
- executor: `supabase/functions/_shared/llm-executor.ts`
- provider adapters: `supabase/functions/_shared/llm-adapters/*`

No direct provider calls are allowed outside adapters.

### Scopes

| Scope | Used by | Behavior |
|---|---|---|
| `chat_ideation` | `POST /chat`, `POST /chat/{id}/messages` while no candidate is active | Conversational. Learns preferences and decides whether to trigger generation. |
| `chat_generation` | `POST /chat/{id}/messages` when generation is triggered | Returns full `candidate_recipe_set` (max 3 components). |
| `chat_iteration` | `POST /chat/{id}/messages` when candidate exists | Returns revised `candidate_recipe_set`. |
| `recipe_canonicalize` | `POST /chat/{id}/commit` | Strips user-specific adaptations from chat candidate to produce canonical base recipe. |
| `recipe_personalize` | `POST /recipes/{id}/variant/refresh`, auto on save | Materialises user's private variant from canonical base + preferences + manual edits. Graph-grounded with substitution diffs. |
| `recipe_import_transform` | `POST /chat/import` | Transforms ImportedRecipeDocument → RecipePayload + AssistantReply in Alchemy's voice. |
| `recipe_import_vision_extract` | `POST /chat/import` (photo kind) | Extracts recipe from cookbook page photo → ImportedRecipeDocument. |
| `classify` | Async audit + normalization utilities | Used for non-blocking telemetry/helpers; not a blocking gate in the core chat loop. |
| `ingredient_alias_normalize` | Canonical ingredient identity stage | Normalizes alias keys to canonical ingredient names. |
| `ingredient_phrase_split` | Canonical ingredient identity stage | Splits compound ingredient phrases into atomic items. |
| `ingredient_line_parse` | Canonical ingredient identity stage | Parses source ingredient lines into mentions + qualifiers + alternative groups. |
| `ingredient_enrich` | Metadata pipeline | Enriches ingredient metadata and ontology terms. |
| `recipe_metadata_enrich` | Metadata pipeline | Enriches recipe-level tags/metadata. |
| `ingredient_relation_infer` | Metadata pipeline | Infers ingredient graph relations. |
| `preference_normalize` | Preference pipeline | Normalizes user preference list updates. |
| `equipment_filter` | Preference pipeline | Filters durable equipment updates to explicit user claims. |
| `onboarding` | First-run preference interview | Conversational. Collects dietary, skill, equipment context. |
| `image` | Recipe image generation | Text-to-image prompt construction |
| `memory_extract` | Post-conversation memory extraction | Extracts preference signals |
| `memory_retrieval_embed` | Memory retrieval indexing + query embedding | Generates tenant-filtered retrieval embeddings for memory candidate generation. |
| `memory_select` | Context injection | Selects relevant memories for prompt injection |
| `memory_summarize` | Memory compaction | Reduces memory blob size |
| `memory_conflict_resolve` | Memory deduplication | Resolves conflicting preference records |

### DB tables

- `llm_model_routes` — scope → provider + model mapping (one active per scope)
- `llm_prompts` — scope + version → system prompt template (one active per scope)
- `llm_rules` — scope + version → policy rule JSON (one active per scope)

### Development Reset Operations

Development-only destructive resets are executed from Admin UI at `/development` and are backed by migration-defined RPCs:

- `admin_dev_food_data_preview(preset text)` — read-only row impact preview
- `admin_dev_food_data_wipe(preset text, confirm_text text, reason text, actor_email text)` — single-transaction wipe + audit logs

Presets:

- `recipes_domain_reset`
- `ingredients_ontology_reset`
- `graph_reset`
- `full_food_reset`

Each run is recorded in `development_operation_runs` and logged to `changelog_events`.

### Changing a model (no migration needed)

Use the Admin UI at `/provider-model`, or call the API directly:

```bash
curl -X POST https://admin.cookwithalchemy.com/api/admin/llm/routes \
  -H "Content-Type: application/json" \
  -d '{"scope":"chat_generation","provider":"anthropic","model":"claude-3-5-haiku-latest"}'
```

This deactivates the current active route for the scope and inserts a new active one.

### Updating a prompt (no migration needed)

Use the Admin UI at `/prompts`, or:

```bash
curl -X POST https://admin.cookwithalchemy.com/api/admin/llm/prompts \
  -H "Content-Type: application/json" \
  -d '{"action":"create","scope":"chat_ideation","name":"chat_ideation_v1","template":"You are..."}'
# Then activate it:
curl -X POST https://admin.cookwithalchemy.com/api/admin/llm/prompts \
  -H "Content-Type: application/json" \
  -d '{"action":"activate","prompt_id":"<uuid>"}'
```

### LLM call lifecycle workflow (agent-safe)

1. Add call:
- add scope definition in `llm-scope-registry.ts`
- add migration seed rows for `llm_model_routes`
- create/activate prompt + rule through Admin API/UI (or `scripts/admin-api.sh`)
- add/update gateway wrapper to execute via `llm-executor.ts`
- wire callsite in `supabase/functions/v1/index.ts` or related service
- add tests + docs
2. Edit call:
- prompt/rule/model changes through Admin API/UI
- if response contract changes, update validators/tests and OpenAPI examples if public behavior changed
3. Remove call:
- remove callsite + wrapper + scope
- add migration that deactivates scope rows (do not hard-delete operational history)

---

## DB Migrations

Migrations live in `supabase/migrations/` and are numbered sequentially (`0001_`, `0002_`, …).

### What belongs in a migration vs the admin UI

| Change | Use |
|---|---|
| New table or schema change | Migration |
| New scope with initial model route | Migration |
| Bulk seed / backfill | Migration |
| Changing an active model for an existing scope | Admin UI / API |
| Creating or editing prompts for a scope | Admin UI / API |
| Creating or editing rules for a scope | Admin UI / API |

### Writing a migration

Migrations are plain SQL. Use `INSERT ... ON CONFLICT DO UPDATE` for idempotency:

```sql
-- supabase/migrations/NNNN_my_change.sql

insert into public.llm_prompts(scope, version, name, template, is_active)
values ('my_scope', 1, 'my_prompt_v1', $$...$$, true)
on conflict (scope, version) do update
set name = excluded.name,
    template = excluded.template,
    is_active = excluded.is_active;
```

### Applying migrations (CI-only)

Supabase schema/function deploys are handled by GitHub Actions only.

1. Add or update files in `supabase/migrations/**` and/or `supabase/functions/**`.
2. Push to `main`.
3. Watch `.github/workflows/supabase-deploy.yml` in GitHub Actions.

No direct local `supabase db push` / `supabase functions deploy` deploy path is used for production.

### Troubleshooting Supabase CI migration failures

If CI fails with:

```text
Found local migration files to be inserted before the last migration on remote database.
```

The migration chain is out of order relative to remote history. Fix by:

1. Ensuring migration filenames are monotonic and correctly ordered.
2. Re-running the deploy workflow with `--include-all` enabled in CI when intentionally reconciling history.
3. Avoiding ad-hoc/manual production DB pushes outside CI.

### Migration history

| Migration | Description |
|---|---|
| `0001_init` | Schema — all tables, indexes, RLS |
| `0002_memory_changelog_recipe_links` | Memory + changelog + recipe link tables |
| `0003_prompt_upgrades` | Initial prompt versions for core scopes |
| `0004_intelligent_prompt_contract` | Structured JSON contract in prompts |
| `0005_preferences_injection_and_prompt_updates` | Preference injection + prompt v5 |
| `0006_switch_primary_recipe_models_to_gpt5` | Moved generate/tweak to gpt-5 |
| `0007_onboarding_scope_defaults` | Onboarding scope route/prompt/rule |
| `0008_remove_explore` | Removed explore tab scope |
| `0009_immediate_recipe_generation` | Prompt v6 — always generate, no questions |
| `0010_chat_scope_defaults` | New `chat` scope — ideation before generate; `llm_model_registry` table |
| `0011_seed_model_registry` | Seed 9 models (GPT-4.1, GPT-4o, o3, o4-mini, Claude Opus/Sonnet/Haiku) |
| `0012_seed_additional_openai_models` | Normalize OpenAI catalog to GPT-5/GPT-4.1/GPT Image and remove 4o/o-series defaults |
| `0013_backfill_onboarding_prompt_default` | Backfill active onboarding prompt/rule defaults if missing |
| `0014_rename_draft_to_chat` | Renamed draft chat tables/fields to final chat loop naming |
| `0015_recipe_standardization_dev` | Canonical ingredients + metadata job queue + graph links |
| `0016_chat_loop_refactor_dev` | Chat-only candidate loop tables/contracts + commit path |
| `0017_chat_loop_latency_tuning` | Prompt/model-config tuning for faster chat-generation/iteration turns |
| `0018_chat_loop_contract_hardening` | Strict intent-aware chat prompt/rule contracts for ideation/generation/iteration |
| `0020_semantic_ontology_core` | Semantic ontology core for LLM-first enrichment pipeline |
| `0021_metadata_contract_v2` | Metadata contract V2 indexes and schema-version tracking |
| `0022_metadata_jobs_v2_pipeline` | Stage-aware metadata jobs for async semantic enrichment |
| `0023_graph_api_indexes` | Graph API traversal and confidence filter indexes |
| `0024_chat_loop_quality_reset` | Remove shrink constraints and token budget clamps from active chat scopes |
| `0025_llm_scope_split_hardening` | Split generic classify helper calls into explicit DB-managed scopes |
| `0026_chat_loop_prompt_deconstraint_v103` | Chat-loop prompt/rule hard reset: remove residual shrink language and recipe-size caps |
| `0027_generate_scope_deconstraint_v104` | Generate-scope hardening: remove residual shrink/budget constraints |
| `0028_chat_ideation_direct_generation_v105` | Chat ideation update: explicit dish/recipe requests move directly to generation |
| `0029_chat_loop_route_provider_stability_v106` | Pin active core routes to structured-output-capable models for JSON reliability |
| `0030_chat_greeting_scope_seed` | Add dedicated chat greeting scope seed rows for scoped first-turn behavior |
| `0031_development_ops_and_line_model` | Add development reset RPCs + operation audit table + ingredient mention decomposition model |
| `0032_ingredient_line_parse_scope_v2` | Seed and activate `ingredient_line_parse` LLM scope for mention/qualifier parsing |
| `0033_graph_relation_and_index_hardening` | Add expanded relation seeds and traversal/performance indexes for semantic graph reads |
| `0034_semantic_constraints_and_consistency_tables` | Add semantic incompatibility rules and confidence/consistency guardrail tables |
| `0035`–`0037` | Search document system, explore feed, preference pipeline refinements |
| `0038_recipe_search_preview_projection` | Search preview projection for RecipePreview contract |
| `0039_gpt_image_1_mini_billing_metadata` | Image model billing metadata |
| `0040_candidate_time_recipe_images` | Candidate-time image enrollment and resolution |
| `0041_refresh_development_reset_targets` | Refresh development reset preset targets |
| `0042_image_pipeline_storage` | Image pipeline storage and shared asset reuse |
| `0043_canonical_variants_cookbook` | Canonical recipes + private variants + cookbook architecture (v3.0.0) |
| `0044_recipe_canonicalize_personalize_scopes` | Seed `recipe_canonicalize` + `recipe_personalize` LLM scopes |
| `0045_search_safety_exclusions` | Search safety exclusion filters |
| `0046_accumulated_manual_edits` | Manual edit accumulation for variant re-personalization |
| `0047_backfill_cookbook_entries` | Backfill cookbook_entries from legacy recipe_saves |
| `0048_drop_recipe_saves` | Drop legacy recipe_saves table |
| `0049_variant_tags` | Structured variant tags (cuisine, dietary, technique, occasion, time, difficulty, key_ingredients) |
| `0050_recipe_import` | Recipe import pipeline — import_provenance, fingerprint dedup, LLM scope seeds |
| `0051_recipe_popularity` | Popularity scoring, view tracking, ingredient trending, search sort |
| `0052_pipeline_observability` | Pipeline observability RPC for admin dashboard |
| `0053_behavior_telemetry` | First-party product behavior ledger and ingestion substrate |
| `0054_restore_search_preview_projection` | Search preview projection compatibility fix after telemetry rollout |
| `0055_acquisition_profiles` | Install-scoped attribution, acquisition milestones, and acquisition board backing tables |
| `0056_explore_for_you` | Taste profiles, algorithm version registry, Explore impression outcomes, and For You session metadata |

---

## Backend (`supabase/`)

- **Auth**: Supabase Auth (token-based)
- **DB**: Postgres — users, preferences, recipes, recipe_versions, cookbook_entries, user_recipe_variants, user_recipe_variant_versions, preference_change_log, collections, memories, events, behavior_events, behavior_semantic_facts, install_profiles, user_acquisition_profiles, user_taste_profiles, explore_algorithm_versions, recipe_search_documents, recipe_view_events, ingredient_trending_stats, graph_entities, graph_edges, ingredients, import_provenance
- **Edge Functions** (`functions/v1/`): LLM gateway with structured output, prompt injection, memory, image generation, recipe canonicalization/personalization, import pipeline, acquisition telemetry, and personalized Explore retrieval/reranking

### Deploying edge functions

Edge function deploys are performed by GitHub Actions (`.github/workflows/supabase-deploy.yml`) from `main` pushes. Do not deploy Supabase functions directly from local machines.

---

## API Gateway (`infra/cloudflare/api-gateway/`)

Cloudflare Worker — auth validation + routing to Supabase edge functions. Contract types from `packages/contracts/src/generated.ts`.

```bash
npx wrangler deploy --config infra/cloudflare/api-gateway/wrangler.jsonc
```

---

## Admin Deployment

```bash
pnpm --filter @alchemy/admin cf:build
pnpm --filter @alchemy/admin exec opennextjs-cloudflare deploy
```

### Admin runtime env

Set in `apps/admin/.env.local` for local dev, and as Cloudflare Worker secrets/vars for production:

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SECRET_KEY` | Yes | Supabase service role key |
| `API_BASE_URL` | No | Defaults to `https://api.cookwithalchemy.com/v1` |
| `ADMIN_SIMULATION_USER_EMAIL` | Yes | Simulation user email for admin-triggered processing flows |
| `ADMIN_SIMULATION_BEARER_TOKEN` | No | Optional pre-minted override token for simulation + image-job processing |

```bash
cd apps/admin
wrangler secret put SUPABASE_SECRET_KEY
wrangler secret put ADMIN_SIMULATION_USER_EMAIL
```

---

## Deployment

All commands run from repo root (`/Users/john/Projects/alchemy`).

### Execution Norms

- Follow this file first for project-specific operational workflows. Do not substitute generic framework habits for documented repo procedure.
- Operational precedence is: `README.md` -> `AGENTS.md` -> repo scripts/config -> ecosystem defaults.
- If a documented deploy/build command fails, debug that documented path and repair it. Do not silently switch the final workflow to a different cwd or alternate command.
- Alternate commands or direct service URLs may be used for diagnosis, but the final deploy should still run through the documented repo-root path.
- Prefer validating against the documented public hosts (`api.cookwithalchemy.com`, `admin.cookwithalchemy.com`) before relying on lower-level worker/dev URLs.
- If the documented workflow is incomplete or wrong, update the docs in the same change so the corrected path becomes the new default.

### One-time auth

```bash
npx wrangler login
```

### Supabase deploys (GitHub CI only)

Workflow: `.github/workflows/supabase-deploy.yml`

Required GitHub repository secrets:

| Secret | Description |
|---|---|
| `SUPABASE_PAT` | Supabase personal access token for CLI/Management API |
| `SUPABASE_DB_PASSWORD` | Postgres DB password for project `dwptbjcxrsmmgjmnumpg` |

Notes:

- `publishable` / `secret` project API keys are for your app's data/API calls.
- GitHub CI deploys via Supabase CLI require a **management access token** (PAT) from Supabase account settings.

Recommended setup:

1. Create a GitHub environment named `production`.
2. Move both secrets into that environment.
3. Add required reviewers to the environment so deploys need approval.

Trigger behavior:

- Auto-runs on `main` pushes that change `supabase/migrations/**` or `supabase/functions/**`.
- Manual run available via **Actions → Supabase Deploy → Run workflow**.

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

---

## API Contract & Spec Management

The OpenAPI spec is the single source of truth for all API contracts. The admin API docs page at `/api-docs` renders directly from this spec.

### File chain

| File | Role | Edit? |
|---|---|---|
| `packages/contracts/openapi.yaml` | Source of truth | Yes |
| `packages/contracts/openapi.json` | JSON copy for tooling | Generated |
| `packages/contracts/src/generated.ts` | TypeScript types for gateway + client | Generated |
| `apps/admin/lib/openapi-spec.json` | Copy bundled into admin app for `/api-docs` | Generated |
| `apps/admin/lib/admin-routes.ts` | Generated admin route inventory for `/api-docs` | Generated |

### Updating the spec

Any time an API endpoint is added, removed, or changed:

```bash
# 1. Edit the source
$EDITOR packages/contracts/openapi.yaml

# 2. Bump info.version (semver)
#    patch (1.2.0 → 1.2.1): fix schema description, add optional response field
#    minor (1.2.1 → 1.3.0): add new endpoint, add required response field
#    major (1.3.0 → 2.0.0): remove endpoint, rename field, change required field type

# 3. Regenerate derived files
pnpm --filter @alchemy/contracts generate          # → src/generated.ts
pnpm --filter @alchemy/contracts generate:json      # → openapi.json
pnpm admin:routes:generate                          # → admin-routes.ts
cp packages/contracts/openapi.json apps/admin/lib/openapi-spec.json

# 4. If admin API routes were added/removed, regenerate:
pnpm admin:routes:generate

# 5. Add a CHANGELOG.md entry under [Unreleased]

# 6. Deploy affected services
npx wrangler deploy --config infra/cloudflare/api-gateway/wrangler.jsonc   # if gateway changed
pnpm --filter @alchemy/admin cf:build && pnpm --filter @alchemy/admin exec opennextjs-cloudflare deploy  # if admin changed

# 7. Commit everything together (source + generated files)
```

### Rules

- Never edit generated files directly (`openapi.json`, `generated.ts`, `openapi-spec.json`)
- Always bump the version — the admin API docs page displays it
- Always copy `openapi.json` → `apps/admin/lib/openapi-spec.json` after regenerating
- Always add a CHANGELOG entry when the API contract changes

---

## Full Setup (fresh environment)

```bash
# 1. Install deps
pnpm install

# 2. Auth (one-time for Cloudflare deploys)
npx wrangler login

# 3. Deploy API gateway
npx wrangler deploy --config infra/cloudflare/api-gateway/wrangler.jsonc

# 4. Deploy admin
pnpm --filter @alchemy/admin cf:build
pnpm --filter @alchemy/admin exec opennextjs-cloudflare deploy

# 5. Generate contract types (after any OpenAPI changes)
pnpm --filter @alchemy/contracts generate

# 6. Run apps locally
pnpm dev:admin          # Next.js admin at localhost:3000
cd apps/ios && xcodegen generate
```

Supabase schema/functions are deployed by CI from `main` pushes (not from local CLI).

---

## API UX Simulation

End-to-end API simulation covering the full chat-driven candidate loop:

1. `chat_start` — open ideation session
2. `chat_refine` — send specific recipe constraints
3. `chat_generate_trigger` — trigger candidate generation
4. `chat_iterate_candidate` — iterate on candidate
5. `commit_candidate_set` — commit to cookbook
6. `fetch_committed_recipe` — read committed recipe with unit/grouping params
7. `fetch_cookbook` — verify cookbook listing
8. `chat_out_of_scope_guard` — verify out-of-scope stays in ideation

```bash
API_URL=https://api.cookwithalchemy.com/v1 \
API_BEARER_TOKEN=<jwt> \
pnpm simulate:api
```

---

## Admin API Helper

`scripts/admin-api.sh` — streamlined CLI for managing LLM config and running queries against the Supabase Management API. Auto-resolves the Supabase CLI token from macOS keychain.

```bash
# SQL queries
./scripts/admin-api.sh sql "SELECT * FROM llm_prompts WHERE is_active = true"
./scripts/admin-api.sh sql-file /path/to/query.sql

# Prompt management (versioned, append-only)
./scripts/admin-api.sh prompt-list [scope]                       # List all (>>> = active)
./scripts/admin-api.sh prompt-create <scope> <ver> <name> <file> # Create & activate from file
./scripts/admin-api.sh prompt-activate <scope> <version>         # Activate existing version

# Rule management
./scripts/admin-api.sh rule-list [scope]
./scripts/admin-api.sh rule-create <scope> <ver> <name> <file>

# Routes and auth
./scripts/admin-api.sh route-list        # Active model routes per scope
./scripts/admin-api.sh service-key       # Print service role key
./scripts/admin-api.sh sim-token         # Get sim user access token for API testing
```

---

## Supabase Key Model

- `publishable` key — client-side contexts (mobile app, browser)
- `secret` key — trusted server/admin contexts (edge functions, admin API)
- Legacy `anon` / `service_role` names remain for backward compatibility
