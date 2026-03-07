-- 0050: Recipe Import infrastructure
--
-- Adds the tables, columns, and LLM model routes needed for importing
-- recipes from URLs, pasted text, and cookbook-page photos.
--
-- Import flow: POST /chat/import → extract → transform → seed chat session
-- → enroll image generation → return ChatSessionResponse.
--
-- Prompts and rules for the new scopes are NOT seeded here — they are
-- created via the admin API pipeline (scripts/admin-api.sh prompt-create /
-- rule-create) after deploy. Only model routes are seeded.

-- ============================================================================
-- import_provenance: tracks import source metadata and deduplication
-- ============================================================================

create table if not exists public.import_provenance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id),
  -- Normalised hash of the source content (URL, text hash, or photo ref hash).
  -- Unique per user to enable idempotent retry and re-share detection.
  source_fingerprint text not null,
  source_kind text not null check (source_kind in ('url', 'text', 'photo')),
  source_url text,
  -- Provenance label: "safari_share", "in_app_paste", "share_extension", etc.
  source_origin text,
  chat_session_id uuid references public.chat_sessions(id),
  extraction_strategy text,
  extraction_confidence real,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  error_code text,
  error_message text,
  -- Compact metadata for admin/audit (never raw HTML or source photos)
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_import_provenance_user_fingerprint unique (user_id, source_fingerprint)
);

create index if not exists idx_import_provenance_user on public.import_provenance(user_id);
create index if not exists idx_import_provenance_created on public.import_provenance(created_at desc);
create index if not exists idx_import_provenance_status on public.import_provenance(status);

-- RLS: users can read their own import provenance; service role has full access
alter table public.import_provenance enable row level security;

create policy "Users can view own import provenance"
  on public.import_provenance for select
  using (auth.uid() = user_id);

create policy "Service role full access to import provenance"
  on public.import_provenance for all
  using (auth.role() = 'service_role');

-- ============================================================================
-- chat_sessions: add import-related columns
-- ============================================================================

alter table public.chat_sessions
  add column if not exists source_kind text,
  add column if not exists import_provenance_id uuid references public.import_provenance(id);

-- ============================================================================
-- recipe_versions: add import provenance summary
-- ============================================================================

-- Compact JSON summary of import source (URL, site, extraction strategy).
-- Written at commit time for provenance tracking on the saved recipe.
alter table public.recipe_versions
  add column if not exists import_provenance jsonb;

-- ============================================================================
-- LLM model routes: recipe_import_transform
-- ============================================================================

-- Transform scope uses gpt-4.1 for quality. The transform must rewrite
-- source recipes into Alchemy wording (copyright avoidance) while
-- preserving culinary accuracy. Temperature 0.4 for faithful rewrites
-- with slight creativity in phrasing.
insert into public.llm_model_routes (scope, route_name, provider, model, config, is_active)
values (
  'recipe_import_transform',
  'openai_gpt-4.1',
  'openai',
  'gpt-4.1',
  '{"temperature": 0.4, "max_output_tokens": 4096, "timeout_ms": 30000}'::jsonb,
  true
)
on conflict (scope) where is_active = true
do update set
  route_name = excluded.route_name,
  provider = excluded.provider,
  model = excluded.model,
  config = excluded.config;

-- ============================================================================
-- LLM model routes: recipe_import_vision_extract
-- ============================================================================

-- Vision extraction scope uses gpt-4.1 with vision capabilities. Extracts
-- recipe data from cookbook-page photos into ImportedRecipeDocument.
-- Temperature 0.2 for accurate OCR-style extraction.
insert into public.llm_model_routes (scope, route_name, provider, model, config, is_active)
values (
  'recipe_import_vision_extract',
  'openai_gpt-4.1',
  'openai',
  'gpt-4.1',
  '{"temperature": 0.2, "max_output_tokens": 4096, "timeout_ms": 45000}'::jsonb,
  true
)
on conflict (scope) where is_active = true
do update set
  route_name = excluded.route_name,
  provider = excluded.provider,
  model = excluded.model,
  config = excluded.config;
