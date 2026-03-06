/// <reference lib="deno.ns" />
import { DEVELOPMENT_RESET_TARGET_TABLES } from "./development-reset.ts";

Deno.test("recipes domain reset includes current recipe search and image artifacts", () => {
  const tables = new Set(DEVELOPMENT_RESET_TARGET_TABLES.recipes_domain_reset);

  for (const table of [
    "recipe_search_sessions",
    "recipe_search_documents",
    "recipe_image_assets",
    "recipe_image_assignments",
    "image_requests",
    "image_jobs",
    "candidate_image_bindings",
    "explore_publications",
    "recipe_drafts",
    "recipe_draft_messages",
  ]) {
    if (!tables.has(table)) {
      throw new Error(`expected recipes_domain_reset to include ${table}`);
    }
  }

  if (tables.has("graph_relation_types")) {
    throw new Error("recipes_domain_reset should not wipe graph relation type seed data");
  }
});

Deno.test("full food reset includes the current full food schema", () => {
  const tables = new Set(DEVELOPMENT_RESET_TARGET_TABLES.full_food_reset);

  for (const table of [
    "recipes",
    "recipe_versions",
    "recipe_search_sessions",
    "recipe_search_documents",
    "recipe_image_assets",
    "recipe_image_assignments",
    "image_requests",
    "image_jobs",
    "candidate_image_bindings",
    "recipe_drafts",
    "recipe_draft_messages",
    "ingredients",
    "ingredient_aliases",
    "ingredient_ontology_links",
    "ontology_terms",
  ]) {
    if (!tables.has(table)) {
      throw new Error(`expected full_food_reset to include ${table}`);
    }
  }

  if (tables.has("graph_relation_types")) {
    throw new Error("full_food_reset should not wipe graph relation type seed data");
  }
});
