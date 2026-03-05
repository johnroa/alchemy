-- Table-driven semantic consistency constraints (diet incompatibility).

create table if not exists public.semantic_diet_incompatibility_rules (
  id uuid primary key default gen_random_uuid(),
  source_term_type text not null,
  source_term_key text not null,
  blocked_diet_tag text not null,
  reason text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_term_type, source_term_key, blocked_diet_tag)
);

create index if not exists semantic_diet_incompatibility_rules_active_idx
  on public.semantic_diet_incompatibility_rules(is_active, source_term_type, source_term_key);

insert into public.semantic_diet_incompatibility_rules(source_term_type, source_term_key, blocked_diet_tag, reason)
values
  ('food_group', 'poultry', 'pescatarian', 'Poultry is not pescatarian'),
  ('food_group', 'poultry', 'vegetarian', 'Poultry is not vegetarian'),
  ('food_group', 'poultry', 'vegan', 'Poultry is not vegan'),
  ('food_group', 'meat', 'pescatarian', 'Meat is not pescatarian'),
  ('food_group', 'meat', 'vegetarian', 'Meat is not vegetarian'),
  ('food_group', 'meat', 'vegan', 'Meat is not vegan'),
  ('food_group', 'seafood', 'vegetarian', 'Seafood is not vegetarian'),
  ('food_group', 'seafood', 'vegan', 'Seafood is not vegan'),
  ('food_group', 'fish', 'vegetarian', 'Fish is not vegetarian'),
  ('food_group', 'fish', 'vegan', 'Fish is not vegan'),
  ('food_group', 'shellfish', 'vegetarian', 'Shellfish is not vegetarian'),
  ('food_group', 'shellfish', 'vegan', 'Shellfish is not vegan'),
  ('food_group', 'dairy', 'vegan', 'Dairy is not vegan'),
  ('food_group', 'egg', 'vegan', 'Egg is not vegan'),
  ('functional_class', 'animal_derived', 'vegan', 'Animal-derived ingredient is not vegan')
on conflict (source_term_type, source_term_key, blocked_diet_tag) do update
set reason = excluded.reason,
    is_active = true,
    updated_at = now();

alter table public.semantic_diet_incompatibility_rules enable row level security;

drop policy if exists semantic_diet_incompatibility_rules_read_authenticated on public.semantic_diet_incompatibility_rules;
create policy semantic_diet_incompatibility_rules_read_authenticated on public.semantic_diet_incompatibility_rules
  for select
  using (auth.role() = 'authenticated');

alter table public.ontology_terms
  add constraint ontology_terms_term_type_not_blank
  check (length(btrim(term_type)) > 0) not valid;

alter table public.ontology_terms
  validate constraint ontology_terms_term_type_not_blank;

alter table public.ontology_terms
  add constraint ontology_terms_term_key_not_blank
  check (length(btrim(term_key)) > 0) not valid;

alter table public.ontology_terms
  validate constraint ontology_terms_term_key_not_blank;

alter table public.ontology_terms
  add constraint ontology_terms_label_not_blank
  check (length(btrim(label)) > 0) not valid;

alter table public.ontology_terms
  validate constraint ontology_terms_label_not_blank;
