# Runtime Flags v1

This document explains the DB-backed runtime flag system that shipped in Alchemy.

It covers:

- what v1 is for
- what it deliberately does not do
- the database model
- the runtime resolution path
- the Admin control plane
- the operational rules for using it safely

Primary implementation files:

- [0060_runtime_flags.sql](/Users/john/Projects/alchemy/supabase/migrations/0060_runtime_flags.sql)
- [feature-flags.ts](/Users/john/Projects/alchemy/packages/shared/src/feature-flags.ts)
- [feature-flags.ts](/Users/john/Projects/alchemy/supabase/functions/v1/lib/feature-flags.ts)
- [flags.ts](/Users/john/Projects/alchemy/supabase/functions/v1/routes/flags.ts)
- [feature-flags-admin.ts](/Users/john/Projects/alchemy/apps/admin/lib/feature-flags-admin.ts)
- [route.ts](/Users/john/Projects/alchemy/apps/admin/app/api/admin/flags/route.ts)
- [route.ts](/Users/john/Projects/alchemy/apps/admin/app/api/admin/flags/preview/route.ts)
- [page.tsx](/Users/john/Projects/alchemy/apps/admin/app/(admin)/operations/flags/page.tsx)
- [feature-flags-panel.tsx](/Users/john/Projects/alchemy/apps/admin/components/admin/feature-flags-panel.tsx)
- [openapi.yaml](/Users/john/Projects/alchemy/packages/contracts/openapi.yaml)

## Why This Exists

Alchemy needed operational rollout control in production.

Environment variables were the wrong tool for that because:

- they are hard to inspect from Admin
- they are hard to audit
- they are awkward for per-environment values
- they are poor for remote-config payloads
- they require deploy-time changes for what should be runtime control

Runtime Flags v1 replaces env-var rollout toggles with a small control plane that is:

- DB-backed
- Admin-managed
- server-side evaluated
- environment-aware
- auditable

## Scope

Runtime Flags v1 is intentionally small.

It supports:

- one flag identity shared across environments
- `development` and `production`
- boolean enablement
- optional JSON payloads
- Admin create, edit, archive, and preview
- server-side resolution through `POST /v1/flags/resolve`
- revision-based cache invalidation

It does not support:

- segments
- weighted rollouts
- experiments
- sticky bucketing
- prerequisite flags
- client-side SDK evaluation

Those are explicitly deferred to v2 in [TODO.md](/Users/john/Projects/alchemy/TODO.md).

## The Core Model

There are two layers:

1. Global flag identity
   Stored once in `feature_flags`

2. Environment-specific runtime state
   Stored in `feature_flag_environment_configs`

That means a flag like `recipe_canon_match` exists once, but has separate values in:

- `development`
- `production`

This mirrors the best low-complexity pattern used by systems like Unleash and Flagsmith:

- one flag definition
- environment-specific config
- no duplicate flag rows per environment

Official references:

- [Unleash environments](https://docs.getunleash.io/reference/environments)
- [Flagsmith feature flags and remote config](https://docs.flagsmith.com/basic-features/overview)
- [Flipt concepts](https://docs.flipt.io/v1/concepts)

## Data Model

### `feature_flag_environments`

Seeded environments:

- `development`
- `production`

Purpose:

- defines the valid environment key space
- gives Admin a source of truth for selectable environments

### `feature_flags`

Global registry row per flag.

Important columns:

- `flag_key`
- `name`
- `description`
- `flag_type`
- `owner`
- `tags`
- `expires_at`
- `archived_at`

Allowed `flag_type` values:

- `release`
- `operational`
- `kill_switch`
- `permission`

### `feature_flag_environment_configs`

Per-flag, per-environment runtime config.

Important columns:

- `flag_id`
- `environment_key`
- `enabled`
- `payload_json`
- `revision`
- `updated_by`

Notes:

- `payload_json` must be either `null` or a JSON object
- config rows are keyed by `(flag_id, environment_key)`
- config revision increments on every update

### `feature_flag_state_revisions`

Per-environment cache invalidation row.

Important columns:

- `environment_key`
- `revision`
- `updated_at`

This is the thing the runtime checks before deciding whether its compiled cache is still valid.

## Runtime Resolution

The runtime resolver lives in:

- [feature-flags.ts](/Users/john/Projects/alchemy/supabase/functions/v1/lib/feature-flags.ts)

The flow is:

1. Infer environment from request URL
2. Normalize and validate requested keys
3. Load current environment revision
4. Reuse compiled cache if the revision still matches
5. Otherwise load all configs for that environment
6. Compile them into in-memory flag entries
7. Resolve the requested keys

### Environment inference

Environment inference is deterministic and intentionally simple:

- `localhost`
- `127.0.0.1`
- `0.0.0.0`
- `*.local`
- `*.test`

map to `development`.

Everything else maps to `production`.

There is no custom rule tree here. That is deliberate.

### Cache behavior

The runtime uses a short-lived in-memory cache:

- TTL: `5000ms`
- key: environment
- validation: revision check against `feature_flag_state_revisions`

This avoids reloading all flag rows on every request while still making Admin changes visible quickly.

### Resolution semantics

Each returned flag resolves to:

- `enabled`
- `payload`
- `reason`
- `flag_type`

`reason` is one of:

- `resolved`
- `missing`
- `archived`

Important behavior:

- missing flags resolve disabled
- archived flags resolve disabled even if old config rows still exist
- payload is returned only for the matching environment config

## Public API

Runtime flags are resolved through:

```http
POST /v1/flags/resolve
Content-Type: application/json
Authorization: Bearer <token>
```

Request body:

```json
{
  "keys": [
    "recipe_canon_match",
    "same_canon_image_judge"
  ]
}
```

Response shape:

```json
{
  "environment": "production",
  "revision": 4,
  "flags": {
    "recipe_canon_match": {
      "enabled": false,
      "payload": {
        "mode": "shadow"
      },
      "reason": "resolved",
      "flag_type": "operational"
    },
    "same_canon_image_judge": {
      "enabled": false,
      "payload": null,
      "reason": "resolved",
      "flag_type": "operational"
    }
  }
}
```

Validation rules:

- `keys` must be a non-empty array
- every key is normalized to lowercase
- keys must match `^[a-z0-9][a-z0-9._-]*$`

## Admin Control Plane

Admin management lives under:

- `Operations / Flags`
- route: `/operations/flags`

The page supports:

- list and search flags
- environment switching
- create flag
- edit metadata
- edit per-environment enablement
- edit per-environment payload JSON
- archive flag
- preview resolved output for a set of keys in a selected environment

Admin write routes:

- `GET /api/admin/flags`
- `POST /api/admin/flags`
- `PATCH /api/admin/flags`
- `POST /api/admin/flags/preview`

Admin writes are Cloudflare-Access gated and use the admin Supabase client.

## Audit and Change Tracking

Admin writes log changelog events through the existing changelog RPC.

The scope is:

- `feature_flags`

This means flags are not a sidecar control plane with separate auditing. They participate in the same Admin audit model as the rest of the system.

## Seeded Flags

Migration `0060_runtime_flags.sql` seeds two rollout flags:

- `recipe_canon_match`
- `same_canon_image_judge`

Default state:

- disabled in both `development` and `production`
- `recipe_canon_match` starts with payload `{ "mode": "shadow" }`

These replaced the env-var rollout approach for the canon/image identity work.

## How To Use Flags Well

Runtime flags are for:

- rollout control
- kill switches
- operational safety toggles
- remote config that is small and request-time relevant

They are not for:

- durable product data
- user preferences
- arbitrary business configuration
- experiment science

Practical guidance:

- every flag should have a real owner
- every flag should have tags
- use `expires_at` when the flag is temporary
- archive old flags instead of deleting live history
- prefer payloads only when a boolean is not enough
- do not create flags for one-off debugging if a changelogged admin action is clearer

## Failure Modes and Debugging

### Flag missing

Symptoms:

- resolution returns `enabled: false`
- `reason: "missing"`

Interpretation:

- the key does not exist
- the key is misspelled
- the environment has no compiled row for it

### Flag archived

Symptoms:

- resolution returns `enabled: false`
- `reason: "archived"`

Interpretation:

- the global flag row is archived

### Payload rejected in Admin

Symptoms:

- Admin validation error on create or update

Interpretation:

- payload must be a JSON object or `null`
- arrays and primitive JSON values are intentionally rejected in v1

### Stale runtime value

Symptoms:

- Admin changed a flag but runtime still returns the old value briefly

Interpretation:

- in-process compiled cache is still inside the 5 second TTL window
- revision invalidation is working, but not every process refreshes on the same millisecond

## Why v1 Stops Here

This system was intentionally kept smaller than Unleash, GrowthBook, Flagsmith, or Flipt.

That was the right call because Alchemy needed:

- reliable rollout control
- Admin visibility
- environment-specific values

It did not yet need:

- experimentation analytics
- targeting rules
- client SDKs

The system is engineered enough for current operational use without dragging in pre-launch complexity.

## V2 Deferred Work

V2 is already logged in [TODO.md](/Users/john/Projects/alchemy/TODO.md):

- segment targeting with typed built-in attributes
- multivariate experiment variants and weighted rollout
- sticky bucketing on `user_id` or `install_id`
- exposure logging and Admin experiment visibility
- app-version and per-surface targeting
- prerequisite or dependent flags
- client SDK or local evaluation if needed

## Short Rule Of Thumb

If the question is "should this change without redeploying production?", a runtime flag may be the right tool.

If the question is "should this define core product data or long-term business state?", it probably should not be a flag.
