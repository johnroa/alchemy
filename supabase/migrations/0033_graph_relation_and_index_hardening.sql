-- Graph relation and traversal hardening for semantic model.

insert into public.graph_relation_types(name, description)
values
  ('alternative_ingredient', 'Recipe line includes an alternative ingredient option'),
  ('alternative_to', 'Two ingredients are alternatives in the same context')
on conflict (name) do nothing;

create index if not exists recipe_ingredient_mentions_alt_group_idx
  on public.recipe_ingredient_mentions(alternative_group_key)
  where alternative_group_key is not null;

create index if not exists recipe_ingredient_ontology_links_relation_idx
  on public.recipe_ingredient_ontology_links(relation_type, confidence desc);

create index if not exists graph_edges_relation_source_idx
  on public.graph_edges(relation_type_id, source, confidence desc);
