---
name: frontend
description: Build admin dashboard UI components and pages following Alchemy conventions. Use when creating new components, pages, or modifying the admin frontend. Covers shadcn/ui patterns, component splitting, data fetching, and layout.
argument-hint: [task-description]
---

# Frontend Skill — Alchemy Admin Dashboard

You are building UI for the Alchemy admin dashboard (`apps/admin/`). Follow these conventions exactly.

## Stack

- **Next.js 15** App Router with server components by default
- **Tailwind CSS** + **shadcn/ui** (Radix UI primitives + CVA)
- **Lucide React** icons only
- **Sonner** for toasts
- No recharts — use CSS/div-based visuals for charts and distribution bars

## Layout & Spacing

- Pages live under `apps/admin/app/(admin)/<section>/page.tsx`
- Max content width: `max-w-[1280px] px-8 py-8`
- Use `<PageHeader>` at the top of every page, with optional `actions` prop for right-side controls
- Full-height flex layout with sticky sidebar (`w-60`)

## Component Patterns

### Shared Components
- `KpiCard` — metric cards with `icon`, `variant` (default/success/warning/danger/muted)
- `PageHeader` — page title with optional `actions` slot
- `DeltaBadge` — velocity indicator (up/down/flat) with absolute + percent
- `deltaFromWindow(current, previous)` — returns `{ current, previous, absolute, percent }`
- `EntityTypeIcon` — semantic ingredient icons

### Visual Conventions
- Status colors: emerald=success, amber=warning, red=danger, blue=info, violet=AI/LLM
- Distribution bars: colored `<div>` sections, no charting library
- Confidence/salience bars: 16px-wide div with % width fill
- IDs in tables: `font-mono text-xs text-muted-foreground`
- Use `cn()` from `lib/utils` for conditional class merging

### Data Fetching
- All data fetched **server-side** in page components via functions in `lib/admin-data/` or `lib/admin-data.ts`
- Use the Supabase admin client (`createAdminClient()`) for DB queries
- Client components only for interactivity (search, filters, modals, forms)
- Mark client components with `"use client"` directive

## Component Splitting Pattern

When a component exceeds ~400 lines, split into a subdirectory:

```
components/admin/<name>/
├── types.ts              # Shared types and interfaces
├── <sub-component>.tsx   # Focused sub-components
├── <name>.tsx            # Main orchestrating component
└── index.ts              # Public exports
```

Original file becomes a thin re-export shim. New code imports from the subdirectory.

## New Page Checklist

1. Create `app/(admin)/<section>/page.tsx` as a server component
2. Add data-fetching function in `lib/admin-data/` (or extend `lib/admin-data.ts`)
3. Use `<PageHeader>` + KPI cards at top, tables/details below
4. Handle loading, empty, and error states
5. Add the route to the sidebar nav if it's a new section

## New Component Checklist

1. Place under `components/admin/` (or subdirectory if complex)
2. Use TypeScript interfaces for all props — no `any`
3. Prefer server components; only add `"use client"` when needed for interactivity
4. Use shadcn/ui primitives (`Card`, `Table`, `Badge`, `Button`, `Dialog`, etc.)
5. Keep styling in Tailwind classes — no inline styles or CSS modules

## Strict Rules

- **No `any` types.** Use proper TypeScript throughout.
- **No new dependencies** unless explicitly requested.
- **Minimal diffs.** Don't touch unrelated code.
- **No emojis** unless the user asks for them.
- **Detailed comments** explaining non-obvious decisions, data flow, and gotchas.

## Task

$ARGUMENTS
