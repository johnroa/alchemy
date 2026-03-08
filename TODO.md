# TODO

Remaining work after the shipped acquisition-ready telemetry slice. This file is the live backlog for work that is still open or intentionally deferred.

## Must Finish Before User Acquisition

- Verify the live acquisition board end to end through the protected admin domain at `admin.cookwithalchemy.com`, not just local/admin build output.
- Add acquisition filtering to executive surfaces so `lifecycle_stage` and `acquisition_channel` can be used as board and analytics filters instead of remaining backend-only computed states.
- Capture and persist optional App Store `campaign_token` and `provider_token` fields when launch links actually use them.
- Add the remaining acquisition telemetry tests that are still missing or only partially covered:
  - `auth_completed` idempotency on repeat sign-in attempts
  - session-restore must not count as a new acquisition auth
  - reinstall / new `install_id` behavior
  - onboarding start/completion idempotency across retries
  - first-milestone timestamp updates exactly once for generation/save/cook
- Validate Sentry end to end in a non-production environment with a real captured event, transaction, and release mapping.

## Personalization Foundations

- Build ranking-ready rollups from `behavior_events` and `behavior_semantic_facts`.
- Ship the real `/boards/personalization` board instead of the current placeholder.
- Add `impression_outcomes` and `user_taste_profile` datasets for Explore ranking and model training.
- Expand behavior semantics for chat asks and recipe outcomes where current facts are still too thin for model training.
- Add negative-feedback signals and attribution coverage anywhere still missing in Explore, Chat, or Cookbook flows.

## Segments And Control Plane

- Implement the first real segment engine and UI.
- Expose `lifecycle_stage` and `acquisition_channel` as first-class admin filters.
- Add the next segment families:
  - `engagement_band`
  - `cooking_status`
  - `personalization_maturity`
  - `taste_cluster`
  - `monetization_state`
- Add feature flags and experiments with deterministic assignment, exposure logging, and kill switches.
- Add first-party lifecycle/campaign primitives that replace Customer.io-like orchestration inside Alchemy admin.

## Delivery And Monetization Adapters

- Add a OneSignal delivery adapter only when push or in-app delivery is actually needed.
- Add a RevenueCat entitlement adapter only when subscriptions are in scope.
- Add an Appfigures integration only when ASO becomes an active operating lever.

## Admin UX Retrofit

- Finish the board-style UI retrofit across the remaining admin surfaces:
  - `/`
  - `/analytics`
  - `/analytics/pipelines`
  - `/operations`
  - `/content`
  - `/system`
- Replace remaining utilitarian KPI cards, tables, and chart shells with the stronger executive board kit where appropriate.
- Continue refining the LLM admin pages after the unrelated local work there is reconciled.

## Reliability And Cleanup

- Fix the pre-existing unrelated Deno test failures so the full `supabase/functions/v1` suite passes cleanly.
- Investigate the direct worker URL behavior for the acquisition board and confirm only the Cloudflare Access-protected domain is part of the supported path.
- Decide whether Sentry release/environment configuration should also be wired in CI secrets and build metadata, not only local overrides.
- Reconcile unrelated local worktree changes before the next deploy batch so future releases are easier to reason about.

## Not Planned Right Now

- Full MMP / Branch / AppsFlyer / Adjust-style attribution before PMF.
- Per-user App Store attribution that pretends to be more precise than Apple’s aggregate reporting.
- Household / shared-kitchen metrics before there is a real shared-household product surface.
