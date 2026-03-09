export const DEVELOPMENT_RESET_PRESET_KEYS = [
  "recipes_domain_reset",
  "ingredients_ontology_reset",
  "graph_reset",
  "full_food_reset",
] as const;

export type DevelopmentResetPresetKey = (typeof DEVELOPMENT_RESET_PRESET_KEYS)[number];

export type DevelopmentResetPreset = {
  key: DevelopmentResetPresetKey;
  label: string;
  description: string;
};

export const DEVELOPMENT_RESET_PRESETS: readonly DevelopmentResetPreset[] = [
  {
    key: "recipes_domain_reset",
    label: "Recipes Domain Reset",
    description: "Wipe recipes, drafts, search/image artifacts, links, jobs, pair stats, and graph rows.",
  },
  {
    key: "ingredients_ontology_reset",
    label: "Ingredients + Ontology Reset",
    description: "Wipe canonical ingredients, aliases, ontology links/terms, ingredient rows, and graph rows.",
  },
  {
    key: "graph_reset",
    label: "Graph Reset",
    description: "Wipe graph entities/edges/evidence plus pair-stat tables.",
  },
  {
    key: "full_food_reset",
    label: "Full Food Reset",
    description:
      "Wipe recipes, drafts, ingredients, ontology, graph, search/image artifacts, links, jobs, pair stats, and related food-domain data.",
  },
] as const;

const developmentResetPresetKeySet: ReadonlySet<string> = new Set(DEVELOPMENT_RESET_PRESET_KEYS);

export const isDevelopmentResetPreset = (value: string): value is DevelopmentResetPresetKey =>
  developmentResetPresetKeySet.has(value);

export const confirmTextForPreset = (preset: DevelopmentResetPresetKey): string =>
  `WIPE ${preset.replaceAll("_", " ").toUpperCase()}`;

// Keep these schema inventories in sync with
// supabase/migrations/0041_refresh_development_reset_targets.sql.
export const DEVELOPMENT_RESET_TARGET_TABLES: Readonly<Record<DevelopmentResetPresetKey, readonly string[]>> = {
  recipes_domain_reset: [
    "recipe_draft_messages",
    "recipe_drafts",
    "candidate_image_bindings",
    "image_jobs",
    "recipe_image_assignments",
    "image_requests",
    "recipe_identity_duplicate_reports",
    "recipe_identity_documents",
    "recipe_search_sessions",
    "recipe_search_documents",
    "explore_publications",
    "recipe_graph_links",
    "graph_edge_evidence",
    "graph_edges",
    "graph_entities",
    "ingredient_pair_stats",
    "recipe_pair_stats",
    "memory_recipe_links",
    "recipe_version_events",
    "recipe_links",
    "recipe_image_jobs",
    "recipe_image_assets",
    "recipe_auto_categories",
    "recipe_user_categories",
    "collection_items",
    "recipe_saves",
    "enrichment_runs",
    "recipe_metadata_jobs",
    "recipe_ingredient_ontology_links",
    "recipe_ingredient_mentions",
    "recipe_ingredients",
    "recipe_versions",
    "recipes",
  ],
  ingredients_ontology_reset: [
    "ingredients",
    "ingredient_aliases",
    "recipe_ingredients",
    "recipe_ingredient_mentions",
    "recipe_ingredient_ontology_links",
    "ingredient_ontology_links",
    "ontology_terms",
    "ingredient_pair_stats",
    "recipe_pair_stats",
    "recipe_graph_links",
    "graph_edge_evidence",
    "graph_edges",
    "graph_entities",
  ],
  graph_reset: [
    "recipe_graph_links",
    "graph_edge_evidence",
    "graph_edges",
    "graph_entities",
    "ingredient_pair_stats",
    "recipe_pair_stats",
  ],
  full_food_reset: [
    "recipe_draft_messages",
    "recipe_drafts",
    "candidate_image_bindings",
    "image_jobs",
    "recipe_image_assignments",
    "image_requests",
    "recipe_identity_duplicate_reports",
    "recipe_identity_documents",
    "recipe_search_sessions",
    "recipe_search_documents",
    "explore_publications",
    "recipe_graph_links",
    "graph_edge_evidence",
    "graph_edges",
    "graph_entities",
    "memory_recipe_links",
    "recipe_version_events",
    "recipe_links",
    "recipe_image_jobs",
    "recipe_image_assets",
    "recipe_auto_categories",
    "recipe_user_categories",
    "collection_items",
    "recipe_saves",
    "enrichment_runs",
    "recipe_metadata_jobs",
    "recipe_ingredient_ontology_links",
    "recipe_ingredient_mentions",
    "recipe_ingredients",
    "ingredient_pair_stats",
    "recipe_pair_stats",
    "ingredient_ontology_links",
    "ingredient_aliases",
    "ingredients",
    "ontology_terms",
    "recipe_versions",
    "recipes",
  ],
} as const;
