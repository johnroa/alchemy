# Alchemy Codex

## App
Alchemy: AI Recipes for Chefs

An iOS-first, API-driven app for creating, exploring, and managing recipes using an LLM. Users set preferences (dietary, skill, equipment, cuisines, aversions), generate recipes, iteratively tweak them, and save and organize favorites. The LLM keeps recipes tidy, learns preferences over time, and suggests complementary dishes. An admin UI manages users, LLM behavior, and rules.

## Primary Objective
Ship a premium-feeling iOS app with excellent UX, fast iteration, and a clean API-first architecture. No Apple-native platform dependencies required.

## Non-negotiables
- UI must feel premium: fast, crisp, coherent, and consistent.
- App is fully API-driven. No business logic hidden in the client beyond UI/UX orchestration.
- Strict TypeScript. Avoid `any`.
- Minimal diffs. Do not refactor unrelated code.
- Do not add dependencies unless explicitly asked.
- Every user-facing screen has loading, empty, and error states.
- Offline behavior must be intentional (read-only cache is fine, but no silent data loss).
- Avoid LLM spaghetti: all model calls go through a single server API.

## Product Pillars
- Creation: generate recipes from preferences and prompts.
- Iteration: tweak recipes via chat-like edits while maintaining structured output.
- Organization: save, tag, folders/collections, search.
- Presentation: toggle measurement formats, scaling, step layout, inline vs separated ingredient lists.
- Learning: preference memory that improves over time (server-managed).
- Trust: clear provenance, versioning, and reversible edits.

## Recommended Client Stack (iOS App)
### Runtime
- Expo (React Native) + TypeScript
- Expo Router (navigation)
- React Native Reanimated + Gesture Handler (premium motion)
- TanStack Query (server state, caching, pagination, retries)
- Zustand (small local UI state only: toggles, ephemeral editor state, draft UI)
- React Hook Form + Zod (preference forms and validation)

### UI Layer (choose one and commit)
Option A (recommended for premium speed): Tamagui
- Fast to build polished components and consistent design system.

Option B: NativeWind
- Great for custom layouts; requires more discipline to keep consistent.

Default: Tamagui unless explicitly changed.

### Lists
- FlashList for large recipe feeds / search results.

### Rich Text / Markdown
- Render structured recipe content (steps, timers, ingredients, notes) via a controlled renderer.
- Avoid arbitrary HTML rendering.

### Analytics + Observability (client)
- Basic event tracking (screen views, recipe generated, tweak applied, save, share).
- Error reporting (crash + non-fatal) via a single provider once chosen.
- Do not add vendors until explicitly requested.

## Backend/API Requirements (contract assumptions)
The iOS app is API-driven and assumes a server that:
- Handles auth, user profiles, and preference persistence.
- Orchestrates LLM calls and enforces rules/guardrails.
- Stores recipes, versions, and edit history.
- Manages memory and learning (preference refinement) server-side.
- Provides structured recipe objects and stable schemas.
- Supports search and collections.

The client must treat the backend as the source of truth.

## Recommended Server Stack (for alignment)
### API
- Node.js (TypeScript) with a typed API layer (tRPC or OpenAPI).
- If choosing OpenAPI: generate client types and keep them in sync.

### Auth
- Supabase Auth or Clerk (pick one).
- Token-based auth; refresh handled cleanly.

### Database
- Postgres (Supabase or managed Postgres).
- Core tables: users, preferences, recipes, recipe_versions, collections, collection_items, memories, events.

### Storage
- Object storage for images (recipe photos) and exports (PDF, grocery list, etc.).

### LLM Orchestration
A single server LLM Gateway service:
- prompt templates and policies
- tools / function calling
- schema enforcement
- output validation
- model routing (fast vs quality)
- cost + latency tracking
- safety filters and retries
- provider + model selection managed in admin UI
- all LLM instructions managed in admin UI and loaded from database at runtime

Never call the LLM directly from the iOS client.

### Search
- Postgres FTS initially.
- Upgrade path: Meilisearch or Typesense if needed.

### Admin UI
- Web app: Next.js + a component library.
- Protected routes with RBAC.
- Features:
  - user management
  - recipe audit + version diff
  - prompt/template editor
  - rule configuration
  - model routing and cost dashboards
  - abuse monitoring and rate limits

## Client Architecture (how we build the iOS app)
### Route structure (Expo Router)
- /(auth)
  - sign-in
  - onboarding
- /(tabs)
  - home (feed / explore)
  - create (prompt-to-recipe)
  - library (saved / collections)
  - profile (preferences, settings)
- /(modals)
  - recipe/[id] (full screen detail)
  - recipe-edit/[id] (tweak flow)
  - preferences-editor
  - measurement-settings
  - share/export

### Data model (client)
- Client models mirror API DTOs.
- Never invent fields client-side; add via API schema first.
- Normalize only when necessary; TanStack Query cache is usually enough.

### Query strategy (TanStack Query)
Use query keys:
- `['me']`
- `['preferences']`
- `['recipes', 'feed', filters]`
- `['recipes', id]`
- `['collections']`
- `['collections', id]`
- `['search', query, filters]`

Mutations:
- generate recipe
- tweak recipe
- save/unsave
- add to collection
- update preferences

Use optimistic updates for save/unsave and collection membership.

### Local state (Zustand)
Only for:
- UI toggles (measurement display mode, inline units, servings scaling UI state)
- ephemeral draft state (current tweak prompt draft, temporary filters)

Not for:
- server-backed data
- recipe objects
- preference canonical state

### Recipe representation in UI
- Recipes are structured objects, not plain text.
- Render using a controlled RecipeRenderer:
  - ingredients (with units, conversions, optional inline toggles)
  - steps (with timers, notes, technique highlights)
  - serving size / scaling
  - suggested pairings (server-provided)
- Maintain recipe version history:
  - show last updated
  - allow revert to prior version (server action)

## UI Standards (premium feel)
- One coherent design system:
  - spacing scale
  - typography scale
  - radius scale
  - shadow system
- Touch targets minimum 44x44.
- Pull-to-refresh where appropriate.
- Skeleton loaders for primary content.
- Subtle haptics for key actions (save, generate, apply tweak).
- Smooth transitions, consistent animation language (springs).
- Large, beautiful imagery with layered overlays / liquid-glass surfaces across primary screens.
- Excellent empty states: helpful suggestions, not dead ends.
- Keyboard avoidance on all forms and chat inputs.
- Dark mode supported from day one.

## Security + Privacy Constraints
- Do not store secrets in the client.
- Tokens stored securely (platform secure storage).
- No raw LLM prompts logged client-side unless explicitly enabled.
- Provide user controls for data deletion and memory reset (server actions).

## Performance Rules
- Prefer FlashList for feeds and search results.
- Avoid inline functions in big lists.
- Memoize renderItem where it matters.
- Optimize images and enable caching.
- Keep screens responsive during generation:
  - streaming UI or staged progress states if supported by API.

## Vibe Coding Workflow
### Default sequence
1. Build the full navigation skeleton with placeholder screens.
2. Implement design system primitives (Button, Text, Card, Input, Sheet, Toast).
3. Implement the API client + auth session wiring.
4. Build Explore feed and Recipe Detail with mock DTOs.
5. Add Generate flow (create prompt -> API -> render result).
6. Add Tweak flow (chat-like edits -> new version -> diff highlight).
7. Add Save/Collections/Library.
8. Add Preferences + measurement presentation settings.
9. Harden states, offline cache behavior, accessibility.

### Change discipline
- One feature per change.
- Limit edits to the files listed.
- Avoid sweeping refactors.

## Prompt Template (use every time)
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
- Include loading/empty/error states
- Include transitions, haptics, gestures if relevant

5. Constraints
- Do not refactor unrelated code
- Do not add dependencies
- Strict TypeScript
- Keep diffs minimal

6. Output format
- Return unified diff OR full file contents per changed file
- No commentary

## Default Components to Build Early
- AppShell (safe area, background, base paddings)
- Typography (Text variants)
- Button (primary/secondary/ghost, loading)
- Input (with label, error, helper)
- Card
- ListItem
- Divider
- Toast
- Sheet / BottomSheet
- Modal
- RecipeRenderer (ingredients + steps + notes)
- SaveButton (optimistic)
- SegmentedControl (presentation toggles)

## Core Screens (MVP)
- Onboarding: set baseline preferences (diet, skill, equipment).
- Explore: curated feed + categories + search entry.
- Create: prompt + constraints -> generate.
- Recipe Detail: render structured recipe, save, share, tweak.
- Tweak: chat-like edit input, show updated version, optional diff.
- Library: saved recipes, collections, tags.
- Preferences: edit profile + presentation toggles.
- Settings: memory reset, export, account.

## If blocked
If information is missing:
- State what is missing.
- Provide the smallest set of options.
- Default to the simplest option that preserves premium UI and API-first correctness.
