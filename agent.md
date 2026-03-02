# Alchemy Agent Guide

This file defines how to execute work for Alchemy. Product and architecture source-of-truth is [`codex.md`](./codex.md).

## Mission
- Build and ship a premium-feeling iOS-first, API-driven recipe app.
- Keep UX crisp, coherent, and consistent.
- Keep the client thin: no hidden business logic.

## Core Delivery Constraints
- Strict TypeScript; do not use `any`.
- Keep diffs minimal and scoped.
- Do not refactor unrelated code.
- Do not add dependencies unless explicitly asked.
- Every user-facing screen includes loading, empty, and error states.
- Offline behavior must be explicit and safe (read-only cache acceptable, no silent data loss).
- All LLM interactions must route through one server API gateway.

## Stack Defaults
- Client runtime: Expo + React Native + TypeScript.
- Navigation: Expo Router.
- Motion: Reanimated + Gesture Handler.
- Server state: TanStack Query.
- Local UI-only state: Zustand.
- Forms/validation: React Hook Form + Zod.
- UI system default: Tamagui.
- Large lists: FlashList.

## Architecture Rules
- API is source of truth.
- Client models mirror API DTOs.
- Do not invent client-only fields for server entities.
- Keep recipe rendering structured (ingredients, steps, notes, scaling, pairings).
- Preserve versioning, provenance, and reversible edits.
- Provider/model selection and all LLM instructions are admin-managed and loaded from DB at runtime.

## Screen + UX Quality Bar
- 44x44 minimum touch targets.
- Skeleton loading for primary content.
- Pull-to-refresh where appropriate.
- Smooth, consistent spring-based transitions.
- Large, high-quality recipe imagery with tasteful overlay treatment on key screens.
- Subtle haptics on high-value actions.
- Strong empty states with guided next actions.
- Keyboard-safe forms and chat inputs.
- Dark mode support from day one.

## State + Data Boundaries
Use TanStack Query for:
- `['me']`
- `['preferences']`
- `['recipes', 'feed', filters]`
- `['recipes', id]`
- `['collections']`
- `['collections', id]`
- `['search', query, filters]`

Use Zustand only for:
- presentation toggles
- ephemeral draft state
- temporary filters

Never use Zustand for canonical server-backed entities.

## Build Order (Default)
1. Navigation skeleton with placeholders.
2. Design-system primitives.
3. API client and auth session wiring.
4. Explore feed + recipe detail using mock DTOs.
5. Generate flow.
6. Tweak flow with version updates and diff highlight.
7. Save, collections, library.
8. Preferences and measurement settings.
9. Hardening: offline behavior, accessibility, reliability.

## Change Discipline
- One feature per change.
- Edit only explicitly scoped files.
- Avoid sweeping refactors.

## Prompt Template (for implementation tasks)
1. Context
- App: Alchemy (Expo RN, iOS-first, API-driven)
- UI priority: premium look and feel
- Current state: what exists and what is missing

2. Task
- One sentence

3. Files to edit
- Exact file paths only

4. Requirements
- Behaviors + UI expectations
- Loading/empty/error states
- Transitions/haptics/gestures if relevant

5. Constraints
- No unrelated refactors
- No new deps without explicit ask
- Strict TypeScript
- Minimal diffs

6. Output format
- Unified diff or full changed files
- No commentary

## When Blocked
- State exactly what is missing.
- Offer the smallest viable option set.
- Default to the simplest path that preserves premium UX and API-first correctness.
