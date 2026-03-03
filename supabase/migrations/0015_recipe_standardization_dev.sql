-- Dev-only recipe standardization migration.
-- Forward-only canonical pipeline; no backfill.

create table if not exists public.ingredients (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  normalized_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ingredient_aliases (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  alias_key text not null unique,
  source text not null default 'llm',
  confidence numeric(5,4) not null default 1 check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_version_id uuid not null references public.recipe_versions(id) on delete cascade,
  ingredient_id uuid references public.ingredients(id) on delete set null,
  source_name text not null,
  source_amount numeric(12,4),
  source_unit text,
  normalized_amount_si numeric(12,4),
  normalized_unit text,
  unit_kind text not null check (unit_kind in ('mass', 'volume', 'count', 'unknown')),
  normalized_status text not null check (normalized_status in ('normalized', 'needs_retry')),
  category text,
  component text,
  position int not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recipe_version_id, position)
);

create index if not exists recipe_ingredients_recipe_version_idx
  on public.recipe_ingredients(recipe_version_id, position asc);
create index if not exists recipe_ingredients_ingredient_idx
  on public.recipe_ingredients(ingredient_id);
create index if not exists recipe_ingredients_status_idx
  on public.recipe_ingredients(normalized_status);

create table if not exists public.recipe_metadata_jobs (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  recipe_version_id uuid not null references public.recipe_versions(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'ready', 'failed')),
  attempts int not null default 0 check (attempts >= 0),
  max_attempts int not null default 5 check (max_attempts >= 1),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recipe_version_id)
);

create index if not exists recipe_metadata_jobs_poll_idx
  on public.recipe_metadata_jobs(status, next_attempt_at asc);
create index if not exists recipe_metadata_jobs_recipe_idx
  on public.recipe_metadata_jobs(recipe_id);

-- Dev reset: existing recipe content is disposable.
truncate table
  public.recipe_graph_links,
  public.graph_edges,
  public.recipe_links,
  public.recipe_image_jobs,
  public.recipe_auto_categories,
  public.recipe_user_categories,
  public.collection_items,
  public.recipe_saves,
  public.memory_recipe_links,
  public.recipe_version_events,
  public.recipe_versions,
  public.recipes,
  public.recipe_metadata_jobs,
  public.recipe_ingredients,
  public.ingredient_aliases,
  public.ingredients
restart identity cascade;

alter table public.ingredients enable row level security;
alter table public.ingredient_aliases enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.recipe_metadata_jobs enable row level security;

drop policy if exists ingredients_read_authenticated on public.ingredients;
create policy ingredients_read_authenticated on public.ingredients
  for select
  using (auth.role() = 'authenticated');

drop policy if exists ingredient_aliases_read_authenticated on public.ingredient_aliases;
create policy ingredient_aliases_read_authenticated on public.ingredient_aliases
  for select
  using (auth.role() = 'authenticated');

drop policy if exists recipe_ingredients_read_visible on public.recipe_ingredients;
create policy recipe_ingredients_read_visible on public.recipe_ingredients
  for select
  using (
    exists (
      select 1
      from public.recipe_versions rv
      join public.recipes r on r.id = rv.recipe_id
      where rv.id = recipe_version_id
        and (r.owner_user_id = auth.uid() or r.visibility = 'public')
    )
  );

drop policy if exists recipe_ingredients_owner_write on public.recipe_ingredients;
create policy recipe_ingredients_owner_write on public.recipe_ingredients
  for all
  using (
    exists (
      select 1
      from public.recipe_versions rv
      join public.recipes r on r.id = rv.recipe_id
      where rv.id = recipe_version_id
        and r.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.recipe_versions rv
      join public.recipes r on r.id = rv.recipe_id
      where rv.id = recipe_version_id
        and r.owner_user_id = auth.uid()
    )
  );

drop policy if exists recipe_metadata_jobs_read_visible on public.recipe_metadata_jobs;
create policy recipe_metadata_jobs_read_visible on public.recipe_metadata_jobs
  for select
  using (
    exists (
      select 1
      from public.recipe_versions rv
      join public.recipes r on r.id = rv.recipe_id
      where rv.id = recipe_version_id
        and (r.owner_user_id = auth.uid() or r.visibility = 'public')
    )
  );

drop policy if exists recipe_metadata_jobs_owner_write on public.recipe_metadata_jobs;
create policy recipe_metadata_jobs_owner_write on public.recipe_metadata_jobs
  for all
  using (
    exists (
      select 1
      from public.recipe_versions rv
      join public.recipes r on r.id = rv.recipe_id
      where rv.id = recipe_version_id
        and r.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.recipe_versions rv
      join public.recipes r on r.id = rv.recipe_id
      where rv.id = recipe_version_id
        and r.owner_user_id = auth.uid()
    )
  );
