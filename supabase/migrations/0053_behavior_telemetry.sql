-- 0053_behavior_telemetry.sql
--
-- First-party product behavior telemetry for Explore, Chat, Cookbook,
-- and recipe-detail usage. Keeps product behavior separate from the
-- existing operational `events` table.

create table if not exists public.behavior_events (
  event_id text primary key,
  user_id uuid references public.users(id) on delete set null,
  event_type text not null,
  surface text not null,
  occurred_at timestamptz not null default now(),
  session_id text,
  entity_type text,
  entity_id text,
  source_surface text,
  algorithm_version text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.behavior_events is
  'Append-only first-party product behavior telemetry for Explore, Chat, Cookbook, and recipe-detail surfaces.';
comment on column public.behavior_events.event_id is
  'Client or server generated idempotency key for a behavior event.';
comment on column public.behavior_events.payload is
  'Structured behavior metadata. Keep raw chat text out of this payload.';

create index if not exists idx_behavior_events_user_time
  on public.behavior_events (user_id, occurred_at desc);

create index if not exists idx_behavior_events_type_time
  on public.behavior_events (event_type, occurred_at desc);

create index if not exists idx_behavior_events_surface_time
  on public.behavior_events (surface, occurred_at desc);

create index if not exists idx_behavior_events_session
  on public.behavior_events (session_id);

create index if not exists idx_behavior_events_entity
  on public.behavior_events (entity_type, entity_id, occurred_at desc);

create table if not exists public.behavior_semantic_facts (
  id uuid primary key default gen_random_uuid(),
  event_id text references public.behavior_events(event_id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  source_type text not null,
  source_id text not null,
  fact_type text not null,
  fact_value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.behavior_semantic_facts is
  'Derived product facts keyed to behavior events, chats, searches, and recipes.';

create index if not exists idx_behavior_semantic_source
  on public.behavior_semantic_facts (source_type, source_id, created_at desc);

create index if not exists idx_behavior_semantic_fact_type
  on public.behavior_semantic_facts (fact_type, created_at desc);

alter table public.behavior_events enable row level security;
alter table public.behavior_semantic_facts enable row level security;

create policy behavior_events_owner_read
  on public.behavior_events
  for select
  using (auth.uid() = user_id);

create policy behavior_semantic_facts_owner_read
  on public.behavior_semantic_facts
  for select
  using (auth.uid() = user_id);
