-- 0055_acquisition_profiles.sql
--
-- Acquisition-ready install attribution and user funnel state.
-- Keeps first-open identity separate from auth while preserving a single
-- first-party behavior ledger.

alter table public.behavior_events
  add column if not exists install_id text;

create index if not exists idx_behavior_events_install_time
  on public.behavior_events (install_id, occurred_at desc);

create table if not exists public.install_profiles (
  install_id text primary key,
  acquisition_channel text not null default 'unknown'
    check (acquisition_channel in ('organic', 'waitlist', 'friend_share', 'unknown')),
  campaign_token text,
  provider_token text,
  first_opened_at timestamptz not null,
  last_seen_at timestamptz not null,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.install_profiles is
  'Anonymous install-scoped acquisition and first-open profiles keyed by local install_id.';

create index if not exists idx_install_profiles_first_opened_at
  on public.install_profiles (first_opened_at desc);

create index if not exists idx_install_profiles_channel_first_opened_at
  on public.install_profiles (acquisition_channel, first_opened_at desc);

create table if not exists public.user_acquisition_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  install_id text references public.install_profiles(install_id) on delete set null,
  acquisition_channel text not null default 'unknown'
    check (acquisition_channel in ('organic', 'waitlist', 'friend_share', 'unknown')),
  lifecycle_stage text not null default 'new'
    check (lifecycle_stage in ('new', 'activated', 'saved', 'habit', 'at_risk')),
  signed_in_at timestamptz,
  onboarding_started_at timestamptz,
  onboarding_completed_at timestamptz,
  first_generation_at timestamptz,
  first_save_at timestamptz,
  first_cook_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_acquisition_profiles is
  'First-party acquisition funnel milestones keyed by user and stitched back to install_id.';

create index if not exists idx_user_acquisition_profiles_install_id
  on public.user_acquisition_profiles (install_id);

create index if not exists idx_user_acquisition_profiles_channel_signed_in
  on public.user_acquisition_profiles (acquisition_channel, signed_in_at desc);

create index if not exists idx_user_acquisition_profiles_lifecycle_stage
  on public.user_acquisition_profiles (lifecycle_stage, last_seen_at desc);

alter table public.install_profiles enable row level security;
alter table public.user_acquisition_profiles enable row level security;

create policy user_acquisition_profiles_owner_read
  on public.user_acquisition_profiles
  for select
  using (auth.uid() = user_id);
