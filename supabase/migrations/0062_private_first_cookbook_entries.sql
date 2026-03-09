-- 0059_private_first_cookbook_entries.sql
--
-- Re-roots recipe saves on private cookbook entries so newly created recipes
-- can exist before a public canonical recipe is derived. Canonical linkage is
-- now nullable and filled in asynchronously after canon derivation succeeds.

alter table public.cookbook_entries
  add column if not exists id uuid default gen_random_uuid();

update public.cookbook_entries
set id = gen_random_uuid()
where id is null;

alter table public.cookbook_entries
  alter column id set not null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'cookbook_entries_pkey'
      and conrelid = 'public.cookbook_entries'::regclass
  ) then
    alter table public.cookbook_entries
      drop constraint cookbook_entries_pkey;
  end if;
end $$;

alter table public.cookbook_entries
  add constraint cookbook_entries_pkey primary key (id);

alter table public.cookbook_entries
  alter column canonical_recipe_id drop not null;

alter table public.cookbook_entries
  add column if not exists source_kind text not null default 'saved_canonical',
  add column if not exists canonical_status text not null default 'ready',
  add column if not exists canonical_attempted_at timestamptz,
  add column if not exists canonical_ready_at timestamptz,
  add column if not exists canonical_failed_at timestamptz,
  add column if not exists canonical_failure_reason text,
  add column if not exists preview_image_url text,
  add column if not exists preview_image_status text not null default 'pending',
  add column if not exists source_chat_id uuid references public.chat_sessions(id) on delete set null;

update public.cookbook_entries
set
  source_kind = 'saved_canonical',
  canonical_status = 'ready',
  canonical_ready_at = coalesce(canonical_ready_at, updated_at),
  preview_image_status = coalesce(nullif(preview_image_status, ''), 'pending')
where canonical_recipe_id is not null;

alter table public.cookbook_entries
  drop constraint if exists cookbook_entries_source_kind_check;

alter table public.cookbook_entries
  add constraint cookbook_entries_source_kind_check
  check (source_kind in ('created_private', 'saved_canonical', 'imported_private'));

alter table public.cookbook_entries
  drop constraint if exists cookbook_entries_canonical_status_check;

alter table public.cookbook_entries
  add constraint cookbook_entries_canonical_status_check
  check (canonical_status in ('pending', 'processing', 'ready', 'failed'));

alter table public.cookbook_entries
  drop constraint if exists cookbook_entries_preview_image_status_check;

alter table public.cookbook_entries
  add constraint cookbook_entries_preview_image_status_check
  check (preview_image_status in ('pending', 'processing', 'ready', 'failed'));

create unique index if not exists idx_cookbook_entries_user_canonical_unique
  on public.cookbook_entries (user_id, canonical_recipe_id)
  where canonical_recipe_id is not null;

create index if not exists idx_cookbook_entries_user_saved_at
  on public.cookbook_entries (user_id, saved_at desc);

create index if not exists idx_cookbook_entries_canonical_status
  on public.cookbook_entries (canonical_status);

alter table public.user_recipe_variants
  add column if not exists cookbook_entry_id uuid;

update public.user_recipe_variants urv
set cookbook_entry_id = ce.id
from public.cookbook_entries ce
where urv.cookbook_entry_id is null
  and ce.user_id = urv.user_id
  and ce.canonical_recipe_id = urv.canonical_recipe_id;

alter table public.user_recipe_variants
  alter column cookbook_entry_id set not null;

alter table public.user_recipe_variants
  add constraint user_recipe_variants_cookbook_entry_fk
  foreign key (cookbook_entry_id)
  references public.cookbook_entries(id)
  on delete cascade;

alter table public.user_recipe_variants
  alter column canonical_recipe_id drop not null;

alter table public.user_recipe_variants
  alter column base_canonical_version_id drop not null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'user_recipe_variants_user_id_canonical_recipe_id_key'
      and conrelid = 'public.user_recipe_variants'::regclass
  ) then
    alter table public.user_recipe_variants
      drop constraint user_recipe_variants_user_id_canonical_recipe_id_key;
  end if;
end $$;

create unique index if not exists idx_user_recipe_variants_cookbook_entry_unique
  on public.user_recipe_variants (cookbook_entry_id);

create unique index if not exists idx_user_recipe_variants_user_canonical_unique
  on public.user_recipe_variants (user_id, canonical_recipe_id)
  where canonical_recipe_id is not null;

create index if not exists idx_user_recipe_variants_cookbook_entry
  on public.user_recipe_variants (cookbook_entry_id);

alter table public.user_recipe_variant_versions
  alter column source_canonical_version_id drop not null;

alter table public.user_recipe_variant_versions
  add column if not exists seed_origin text not null default 'canonical_personalization',
  add column if not exists selected_memory_ids jsonb not null default '[]'::jsonb,
  add column if not exists seed_provenance jsonb not null default '{}'::jsonb;

alter table public.user_recipe_variant_versions
  drop constraint if exists user_recipe_variant_versions_seed_origin_check;

alter table public.user_recipe_variant_versions
  add constraint user_recipe_variant_versions_seed_origin_check
  check (
    seed_origin in (
      'canonical_personalization',
      'chat_generation',
      'chat_import',
      'manual_edit',
      'publish_merge'
    )
  );
