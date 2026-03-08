# Explore `For You` Guide

This document explains how Alchemy's personalized Explore feed works end to end:

- the public API
- the ranking pipeline
- the data it uses
- the telemetry it emits
- the Admin surfaces used to inspect performance

Primary implementation files:

- [for-you.ts](/Users/john/Projects/alchemy/supabase/functions/v1/search/for-you.ts)
- [search-routes.ts](/Users/john/Projects/alchemy/supabase/functions/v1/routes/recipes/search-routes.ts)
- [retrieval.ts](/Users/john/Projects/alchemy/supabase/functions/v1/search/retrieval.ts)
- [session-store.ts](/Users/john/Projects/alchemy/supabase/functions/v1/search/session-store.ts)
- [ExploreView.swift](/Users/john/Projects/alchemy/apps/ios/Alchemy/Features/Explore/ExploreView.swift)
- [personalization board](/Users/john/Projects/alchemy/apps/admin/app/(admin)/boards/personalization/page.tsx)
- [personalization analytics](/Users/john/Projects/alchemy/apps/admin/app/(admin)/analytics/personalization/page.tsx)
- [OpenAPI spec](/Users/john/Projects/alchemy/packages/contracts/openapi.yaml)

## Goal

`For You` is the default Explore feed and the main discovery surface in the app.

It is designed to:

- rank public recipes for a specific user, not globally
- stay personalized even when the user taps a dynamic Explore filter
- explain itself with short `why_tags`
- keep enough novelty that the feed does not collapse into repetition
- preserve attribution so saves and cooks can be tied back to feed sessions and algorithm versions

This is not the same thing as `/recipes/search`.

- `POST /recipes/explore/for-you` is for personalized discovery
- `POST /recipes/search` is for explicit user-entered search text

## Public API

Endpoint:

```http
POST /recipes/explore/for-you
Authorization: Bearer <token>
Content-Type: application/json
X-Install-Id: <install-id>
```

Request body:

```json
{
  "cursor": null,
  "limit": 10,
  "preset_id": null
}
```

Fields:

- `cursor`: session pagination cursor returned from a previous `For You` response
- `limit`: page size, `1..20`
- `preset_id`: optional Explore chip/filter label. `null` means plain `For You`

Response shape:

```json
{
  "feed_id": "uuid",
  "applied_context": "for_you",
  "profile_state": "warm",
  "algorithm_version": "for_you_v1",
  "items": [
    {
      "id": "uuid",
      "title": "Spicy Pan-Seared Tofu with Asparagus",
      "summary": "Crispy tofu in a zesty chili-garlic sauce with fresh asparagus.",
      "image_url": "https://...",
      "image_status": "ready",
      "category": "Auto Organized",
      "visibility": "public",
      "updated_at": "2026-03-07T01:00:09.219+00:00",
      "quick_stats": {
        "time_minutes": 27,
        "difficulty": "medium",
        "health_score": 82,
        "items": 11
      },
      "why_tags": ["Leans healthy", "Matches weeknight pace"]
    }
  ],
  "next_cursor": "opaque-cursor",
  "no_match": null
}
```

Important response fields:

- `feed_id`: the search/feed session id. This is the attribution spine for opens, saves, and cooks.
- `applied_context`: `for_you` or `preset`
- `profile_state`: `cold`, `warm`, or `established`
- `algorithm_version`: the serving version from `explore_algorithm_versions`
- `why_tags`: short user-facing rationale tags, max 4 in the contract, usually 0 to 2 shown in UI

Related OpenAPI schemas:

- [ForYouFeedRequest](/Users/john/Projects/alchemy/packages/contracts/openapi.yaml)
- [ForYouFeedResponse](/Users/john/Projects/alchemy/packages/contracts/openapi.yaml)
- [RecipePreview](/Users/john/Projects/alchemy/packages/contracts/openapi.yaml)

## High-Level Flow

```mermaid
flowchart LR
  A["iOS Explore opens"] --> B["POST /recipes/explore/for-you"]
  B --> C["Load active algorithm version"]
  C --> D["Collect preferences, memories, cookbook, behavior, semantic facts"]
  D --> E["Build or reuse user taste profile"]
  E --> F["Embed retrieval text"]
  F --> G["Hybrid candidate retrieval over recipe_search_documents"]
  G --> H["Deduplicate materially identical cards"]
  H --> I["LLM personalized rerank"]
  I --> J["Apply page-1 suppression and freshness rules"]
  J --> K["Persist session with version, profile, why-tags"]
  K --> L["Return feed response"]
  L --> M["Client logs impressions, opens, skips"]
  M --> N["Saves/cooks attribute back to feed_id + algorithm_version"]
  N --> O["Admin boards and analytics read impression outcomes"]
```

## Data Inputs

The feed is personalized from first-party product state, not from a global trend list.

Main inputs:

- user preferences
- memory snapshot
- active memories
- cookbook history
- saved, opened, cooked recipe behavior
- substitution behavior
- chat semantic facts
- recent Explore interaction history
- public recipe search index (`recipe_search_documents`)

Relevant storage:

- `user_taste_profiles`
- `behavior_events`
- `behavior_semantic_facts`
- `cookbook_entries`
- `recipe_search_documents`
- `recipe_search_sessions`
- `explore_algorithm_versions`
- `explore_impression_outcomes`

Schema source:

- [0056_explore_for_you.sql](/Users/john/Projects/alchemy/supabase/migrations/0056_explore_for_you.sql)

## Stage 1: Load the Active Algorithm Version

The feed never hard-codes its production version in the handler. It loads the active record from `explore_algorithm_versions`.

Current seeded version:

- `version`: `for_you_v1`
- `novelty_policy`: `balanced`
- `candidate_pool_limit`: `160`
- `page1_rerank_limit`: `30`
- `page1_limit`: `10`
- `exploration_ratio`: `0.2`
- `suppress_saved_on_page1`: `true`
- `freshness_window_hours`: `48`

This gives the system a real serving registry and lets Admin compare behavior by algorithm version.

## Stage 2: Collect User Signals

The handler pulls the user's recent signal set before retrieval:

- cookbook entries
- behavior events relevant to Explore and downstream outcomes
- semantic facts from prior chat behavior

Behavior events used directly in profile building include:

- `explore_impression`
- `explore_opened_recipe`
- `explore_saved_recipe`
- `recipe_saved`
- `recipe_cooked_inferred`
- `ingredient_substitution_applied`
- `cookbook_recipe_opened`
- `chat_commit_completed`

Event definitions live in:

- [behavior-events.ts](/Users/john/Projects/alchemy/packages/shared/src/behavior-events.ts)

## Stage 3: Compute `profile_state`

`profile_state` is a coarse maturity label, not the ranking model itself.

Current states:

- `cold`
- `warm`
- `established`

The bucket is computed from recent behavior and cookbook depth in [for-you.ts](/Users/john/Projects/alchemy/supabase/functions/v1/search/for-you.ts). It is used for:

- feed diagnostics
- admin breakdowns
- fallback analysis
- cold-start coverage reporting

The ranking still uses the full taste profile, not just this bucket.

## Stage 4: Build or Reuse the User Taste Profile

The handler checks `user_taste_profiles` first.

A profile is rebuilt when:

- there is no cached profile
- the active algorithm version changed
- the cached profile has no retrieval text or embedding
- the source event watermark moved forward
- the profile is stale by age

Profile generation path:

1. Gather structured inputs:
   - preferences
   - memory snapshot
   - active memories
   - signal summary
   - recent positive recipes
   - recent behavior events
   - recent semantic facts
2. Call LLM scope `explore_for_you_profile`
3. Normalize the model output into:
   - `retrieval_text`
   - `profile_json`
   - `signal_summary`
4. Generate an embedding using `recipe_search_embed`
5. Persist the materialized profile to `user_taste_profiles`

The request path is optimized for first paint:

- if a usable cached profile exists, the feed uses it immediately
- if the cached profile is stale, the feed still uses it immediately and schedules a background refresh
- if there is no usable cached profile, the feed builds a fallback retrieval text immediately, embeds it, serves the feed, and schedules the richer model-built profile in the background

If the profile scope fails, the system does not abort. It falls back to a deterministic retrieval-text builder assembled from preferences, memories, and positive recipe history.

LLM wrapper:

- [llm-gateway/search.ts](/Users/john/Projects/alchemy/supabase/functions/_shared/llm-gateway/search.ts)

LLM scope registry:

- [llm-scope-registry.ts](/Users/john/Projects/alchemy/supabase/functions/_shared/llm-scope-registry.ts)

## Stage 5: Resolve Optional Preset Filters

If the client sends `preset_id`, the feed still stays personalized.

The current hot path does not run a second LLM interpretation pass just to understand the Explore chip. Instead, it augments the profile retrieval text with the preset label and re-embeds that combined retrieval query. This means:

- `For You` without a preset is general personalized discovery
- `For You` with a preset is personalized discovery inside that narrowed space

This is why Explore filters are described as "personalized within filter", not as static tabs, while still keeping Explore latency low enough for app startup.

## Stage 6: Candidate Retrieval

Candidate generation reuses the existing hybrid retrieval stack. It does not maintain a separate recommendation index.

Source:

- `recipe_search_documents`
- `hybrid_search_recipe_documents` RPC

The retrieval query is built from:

- the taste profile's `retrieval_text`
- the taste profile embedding
- any hard filter constraints from `preset_id`
- safety exclusions derived from user preferences

Implementation:

- [retrieval.ts](/Users/john/Projects/alchemy/supabase/functions/v1/search/retrieval.ts)

Important point:

- popularity and trending still exist in the system as metadata and tie-break support
- they are no longer top-level Explore modes in the client

## Stage 7: Candidate Cleanup Before Rerank

Before ranking, the candidate list is cleaned up in deterministic ways that protect product quality:

- materially identical recipe cards are deduped by content signature
- recently exposed or opened recipes are tracked for freshness suppression
- saved recipes can be suppressed from page 1

The duplicate-card dedupe uses a content signature based on:

- normalized title
- normalized summary
- image url

That logic lives in:

- [for-you.ts](/Users/john/Projects/alchemy/supabase/functions/v1/search/for-you.ts)

## Stage 8: Personalized Rerank

The top candidate subset is reranked with the dedicated `explore_for_you_rank` LLM scope.

Inputs to rerank include:

- `algorithm_version`
- `profile_state`
- configured `exploration_ratio`
- structured taste profile JSON
- signal summary
- `preset_id`
- hard filters
- recent exposure set
- saved recipe ids
- serialized candidate cards

Outputs:

- ordered recipe ids
- `why_tags` per recipe

The rerank is intentionally separate from the generic search rerank. Explore is not treated as a search sort.

The request path uses a tight rerank hot-path budget. If rerank does not return quickly enough, the feed falls back immediately to retrieval order instead of making the client wait on a long model timeout.

If reranking fails:

- the request still succeeds
- retrieval order is used
- `fallback_path` records the degraded path

## Stage 9: Page-1 Assembly

After rerank, the feed assembles the visible page with additional product constraints:

- prefers unseen items over recent exposures
- suppresses saved recipes on page 1 when configured
- keeps result order stable
- limits page 1 to the configured `page1_limit`

The current algorithm targets a balanced feed with roughly:

- `80%` high-confidence profile matches
- `20%` controlled novelty

The novelty target is configuration-driven through `explore_algorithm_versions.config`, not hard-coded in the client.

## Stage 10: Session Persistence and Pagination

The handler persists the feed as a `recipe_search_sessions` row.

Stored metadata includes:

- `algorithm_version`
- `profile_state`
- `rationale_tags_by_recipe`
- the retrieved candidate set
- page-1 promoted ids
- applied context and preset metadata

This lets later cursor requests reuse the session instead of rebuilding the feed from scratch on every page.

Session TTL is currently:

- `30 minutes`

Session helpers:

- [session-store.ts](/Users/john/Projects/alchemy/supabase/functions/v1/search/session-store.ts)

## Stage 10.5: Warm Reuse and Preload

`For You` no longer assumes the user will wait for a fresh feed build after landing on Explore.

Two warm paths now exist:

- the API reuses the latest matching `recipe_search_sessions` row when the same user, algorithm version, preset, and normalized retrieval text already have a fresh session
- the app preloads the default `For You` feed as the main shell becomes active, so Explore usually opens against a warm response instead of a cold request

There is also a server-side warm trigger for already-linked installs:

- `app_session_started` install telemetry can resolve back to a known user via `user_acquisition_profiles.install_id`
- when that happens, the backend schedules a background `For You` warmup before the user opens Explore

This makes the first Explore paint rely on stale-while-revalidate cache behavior instead of blocking entirely on retrieval plus rerank.

## Client Behavior

The iOS Explore screen:

- opens on `For You`
- uses `POST /recipes/explore/for-you` for the first chip
- uses the same endpoint for dynamic Explore filters via `preset_id`
- uses `POST /recipes/search` only for typed search text
- renders `why_tags` on cards
- passes `feedSessionId` and `algorithmVersion` into recipe detail/save attribution
- uses a local `ExploreFeedPreloader` cache so the screen can render a warm `For You` feed immediately when available

Client implementation:

- [ExploreView.swift](/Users/john/Projects/alchemy/apps/ios/Alchemy/Features/Explore/ExploreView.swift)
- [APIClient.swift](/Users/john/Projects/alchemy/apps/ios/Alchemy/Core/Networking/APIClient.swift)

## Telemetry and Attribution

### Server-side feed event

Every feed serve logs:

- `event_type`: `explore_feed_served`
- `session_id`: `feed_id`
- `algorithm_version`
- `applied_context`
- `preset_id`
- `profile_state`
- `candidate_count`
- `rerank_used`
- `fallback_path`
- `feed_latency_ms`

Logged in:

- [search-routes.ts](/Users/john/Projects/alchemy/supabase/functions/v1/routes/recipes/search-routes.ts)

### Client-side feed interaction events

The Explore client logs:

- `explore_impression`
- `explore_opened_recipe`
- `explore_skipped_recipe`

Payloads include:

- rank
- current filter
- `preset_id`
- `profile_state`
- applied context
- save and variant counts when available
- up to 2 `why_tag` values on impression events

### Save and cook attribution

When a save originates from Explore, the client/server carry:

- `source_surface`
- `source_session_id`
- `algorithm_version`

This is why the save route supports:

- `source_surface`
- `source_session_id`
- `algorithm_version`

Source:

- [SaveRecipeRequest schema](/Users/john/Projects/alchemy/packages/contracts/openapi.yaml)
- [save.ts](/Users/john/Projects/alchemy/supabase/functions/v1/routes/recipes/save.ts)

That attribution enables downstream joins from:

- served
- impressed
- opened
- saved
- cooked

## Admin Visibility

### Executive board

`/boards/personalization` is the high-level operational board for the recommender.

It shows:

- current champion algorithm
- save lift vs baseline
- cook lift vs baseline
- negative feedback rate
- novelty budget
- preference learning velocity
- cold-start coverage
- fallback rate
- personalized filter coverage
- median feed latency

Page:

- [boards/personalization/page.tsx](/Users/john/Projects/alchemy/apps/admin/app/(admin)/boards/personalization/page.tsx)

### Analytics page

`/analytics/personalization` is the deeper diagnostic surface.

It shows:

- version timeline
- feed funnel by version
- fallback reasons
- breakdown by profile state
- breakdown by Explore preset/filter
- breakdown by lifecycle stage
- breakdown by acquisition channel

Page:

- [analytics/personalization/page.tsx](/Users/john/Projects/alchemy/apps/admin/app/(admin)/analytics/personalization/page.tsx)

Data builder:

- [personalization.ts](/Users/john/Projects/alchemy/apps/admin/lib/admin-data/personalization.ts)

### Rollup view

Admin relies on:

- `explore_impression_outcomes`

This view joins impression telemetry to downstream outcomes and exposes:

- `opened`
- `skipped`
- `hidden`
- `saved`
- `cooked`
- `profile_state`
- `preset_id`
- `fallback_path`
- `why_tag_1`
- `why_tag_2`

Definition:

- [0056_explore_for_you.sql](/Users/john/Projects/alchemy/supabase/migrations/0056_explore_for_you.sql)

## Failure and Degradation Model

The feed is designed to degrade cleanly instead of hard-failing:

- if the profile scope is stale: use the cached profile now and refresh it in the background
- if there is no usable profile yet: build deterministic retrieval text and refresh the richer profile in the background
- if the rerank scope fails: return retrieval order
- if there are no candidates: return a structured `no_match`
- if a cursor is invalid: reject the request
- if a session is expired: reject the cursor request

This keeps Explore available while preserving observability into degraded paths through `fallback_path`.

## What `For You` Is Not

`For You` is not:

- a global recent/popular/trending feed
- a static scoring formula over popularity fields
- a search sort
- a fully online bandit or live experiment system

Current production shape:

- retrieval + cached taste profile + dedicated rerank + telemetry-backed admin visibility

## Safe Extension Points

If this system evolves, the safest levers are:

- tune `explore_algorithm_versions.config`
- ship a new algorithm version row instead of mutating history
- improve `explore_for_you_profile` prompt/rules
- improve `explore_for_you_rank` prompt/rules
- expand `explore_impression_outcomes` analytics
- improve suppression/diversity rules only where they protect product quality

Do not:

- reintroduce global Explore sort modes as the primary Explore experience
- bypass the LLM pipeline with direct provider calls
- add client-side ranking logic
- break attribution by dropping `feed_id` or `algorithm_version` from downstream events

## Quick Reference

- API endpoint: `POST /recipes/explore/for-you`
- Default UI surface: iOS Explore first chip
- Search endpoint: `POST /recipes/search` for explicit search only
- Active version registry: `explore_algorithm_versions`
- Cached profile table: `user_taste_profiles`
- Session table: `recipe_search_sessions`
- Outcome rollup: `explore_impression_outcomes`
- Admin board: `/boards/personalization`
- Admin analytics: `/analytics/personalization`
