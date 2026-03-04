-- Semantic ontology core for LLM-first enrichment pipeline.

create table if not exists public.ontology_terms (
  id uuid primary key default gen_random_uuid(),
  term_type text not null,
  term_key text not null,
  label text not null,
  source text not null default 'alchemy_llm',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (term_type, term_key)
);

create table if not exists public.ingredient_ontology_links (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  ontology_term_id uuid not null references public.ontology_terms(id) on delete cascade,
  relation_type text not null default 'classified_as',
  source text not null default 'llm',
  confidence numeric(5,4) not null default 0.5 check (confidence between 0 and 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ingredient_id, ontology_term_id, relation_type, source)
);

create table if not exists public.graph_edge_evidence (
  id uuid primary key default gen_random_uuid(),
  graph_edge_id uuid not null references public.graph_edges(id) on delete cascade,
  evidence_type text not null,
  evidence_ref text,
  excerpt text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ingredient_pair_stats (
  ingredient_a_id uuid not null references public.ingredients(id) on delete cascade,
  ingredient_b_id uuid not null references public.ingredients(id) on delete cascade,
  co_occurrence_count int not null default 0 check (co_occurrence_count >= 0),
  recipe_count int not null default 0 check (recipe_count >= 0),
  pmi numeric(10,6),
  lift numeric(10,6),
  last_computed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (ingredient_a_id, ingredient_b_id),
  check (ingredient_a_id <> ingredient_b_id)
);

create table if not exists public.enrichment_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.recipe_metadata_jobs(id) on delete set null,
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  recipe_version_id uuid not null references public.recipe_versions(id) on delete cascade,
  stage text not null check (stage in ('ingredient_resolution', 'ingredient_enrichment', 'recipe_enrichment', 'edge_inference', 'finalize')),
  status text not null check (status in ('processing', 'ready', 'failed', 'discarded')),
  model_provider text,
  model_name text,
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb not null default '{}'::jsonb,
  confidence_summary jsonb not null default '{}'::jsonb,
  rejection_count int not null default 0 check (rejection_count >= 0),
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ontology_terms_type_idx
  on public.ontology_terms(term_type, label);
create index if not exists ingredient_ontology_links_ingredient_idx
  on public.ingredient_ontology_links(ingredient_id);
create index if not exists ingredient_ontology_links_term_idx
  on public.ingredient_ontology_links(ontology_term_id);
create index if not exists ingredient_ontology_links_confidence_idx
  on public.ingredient_ontology_links(confidence desc);
create index if not exists graph_edge_evidence_edge_idx
  on public.graph_edge_evidence(graph_edge_id);
create index if not exists ingredient_pair_stats_cooccurrence_idx
  on public.ingredient_pair_stats(co_occurrence_count desc);
create index if not exists ingredient_pair_stats_updated_idx
  on public.ingredient_pair_stats(updated_at desc);
create index if not exists enrichment_runs_job_idx
  on public.enrichment_runs(job_id, created_at desc);
create index if not exists enrichment_runs_recipe_idx
  on public.enrichment_runs(recipe_id, created_at desc);
create index if not exists enrichment_runs_stage_status_idx
  on public.enrichment_runs(stage, status, created_at desc);

insert into public.graph_relation_types(name, description)
values
  ('primary_ingredient', 'Recipe uses ingredient as primary component'),
  ('optional_ingredient', 'Recipe uses ingredient optionally'),
  ('contains_allergen', 'Recipe contains allergen marker'),
  ('compatible_with_diet', 'Recipe is compatible with diet marker'),
  ('co_occurs_with', 'Ingredients frequently occur together'),
  ('complements', 'Ingredients complement each other in flavor/use'),
  ('same_family_as', 'Ingredients are in the same ingredient family'),
  ('derived_from', 'Ingredient is derived from another ingredient'),
  ('conflicts_with', 'Ingredients conflict for dietary or culinary reasons'),
  ('variant_of', 'Recipe is a variation of another recipe'),
  ('similar_to', 'Recipe is similar to another recipe'),
  ('is_drink_of', 'Recipe can be served as a drink pairing'),
  ('uses_technique', 'Recipe uses a cooking technique'),
  ('requires_equipment', 'Recipe requires equipment'),
  ('belongs_to_cuisine', 'Recipe belongs to cuisine category'),
  ('fits_occasion', 'Recipe fits an occasion'),
  ('has_spice_level', 'Recipe has a spice level classifier'),
  ('has_difficulty', 'Recipe has a difficulty classifier')
on conflict (name) do nothing;

alter table public.ontology_terms enable row level security;
alter table public.ingredient_ontology_links enable row level security;
alter table public.graph_edge_evidence enable row level security;
alter table public.ingredient_pair_stats enable row level security;
alter table public.enrichment_runs enable row level security;

drop policy if exists ontology_terms_read_authenticated on public.ontology_terms;
create policy ontology_terms_read_authenticated on public.ontology_terms
  for select
  using (auth.role() = 'authenticated');

drop policy if exists ingredient_ontology_links_read_authenticated on public.ingredient_ontology_links;
create policy ingredient_ontology_links_read_authenticated on public.ingredient_ontology_links
  for select
  using (auth.role() = 'authenticated');

drop policy if exists graph_edge_evidence_read_authenticated on public.graph_edge_evidence;
create policy graph_edge_evidence_read_authenticated on public.graph_edge_evidence
  for select
  using (auth.role() = 'authenticated');

drop policy if exists ingredient_pair_stats_read_authenticated on public.ingredient_pair_stats;
create policy ingredient_pair_stats_read_authenticated on public.ingredient_pair_stats
  for select
  using (auth.role() = 'authenticated');

drop policy if exists enrichment_runs_read_authenticated on public.enrichment_runs;
create policy enrichment_runs_read_authenticated on public.enrichment_runs
  for select
  using (auth.role() = 'authenticated');
