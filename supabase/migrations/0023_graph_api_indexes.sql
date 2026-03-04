-- Graph API traversal and confidence filter indexes.

create index if not exists graph_edges_from_relation_confidence_idx
  on public.graph_edges(from_entity_id, relation_type_id, confidence desc);

create index if not exists graph_edges_to_relation_confidence_idx
  on public.graph_edges(to_entity_id, relation_type_id, confidence desc);

create index if not exists graph_edges_confidence_idx
  on public.graph_edges(confidence desc);

create index if not exists graph_edges_source_idx
  on public.graph_edges(source);

create index if not exists recipe_graph_links_entity_idx
  on public.recipe_graph_links(entity_id, recipe_version_id);

create index if not exists graph_entities_entity_type_idx
  on public.graph_entities(entity_type);
