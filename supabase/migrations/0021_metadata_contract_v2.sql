-- Metadata contract V2 indexes and schema-version tracking.

alter table public.ingredients
  add column if not exists metadata_schema_version int not null default 2 check (metadata_schema_version >= 1);

alter table public.recipe_versions
  add column if not exists metadata_schema_version int not null default 2 check (metadata_schema_version >= 1);

create index if not exists ingredients_metadata_gin_idx
  on public.ingredients using gin (metadata);

create index if not exists ingredients_primary_role_idx
  on public.ingredients ((metadata ->> 'primary_role'));

create index if not exists ingredients_allergens_gin_idx
  on public.ingredients using gin ((metadata -> 'allergen_profile'));

create index if not exists recipe_versions_metadata_gin_idx
  on public.recipe_versions using gin ((payload -> 'metadata'));

create index if not exists recipe_versions_spice_level_idx
  on public.recipe_versions ((payload -> 'metadata' ->> 'spice_level'));

create index if not exists recipe_versions_difficulty_idx
  on public.recipe_versions ((payload -> 'metadata' ->> 'difficulty'));

create index if not exists recipe_versions_diet_tags_gin_idx
  on public.recipe_versions using gin ((payload -> 'metadata' -> 'diet_tags'));

create index if not exists recipe_versions_health_flags_gin_idx
  on public.recipe_versions using gin ((payload -> 'metadata' -> 'health_flags'));
