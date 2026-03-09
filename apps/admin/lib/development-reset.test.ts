import { describe, expect, it } from "vitest";
import { DEVELOPMENT_RESET_TARGET_TABLES } from "./development-reset";

describe("DEVELOPMENT_RESET_TARGET_TABLES", () => {
  it("recipes domain reset includes current recipe search and image artifacts", () => {
    const tables = new Set(DEVELOPMENT_RESET_TARGET_TABLES.recipes_domain_reset);

    for (const table of [
      "recipe_search_sessions",
      "recipe_search_documents",
      "recipe_image_assets",
      "recipe_image_assignments",
      "image_requests",
      "image_jobs",
      "recipe_identity_duplicate_reports",
      "recipe_identity_documents",
      "candidate_image_bindings",
      "explore_publications",
      "recipe_drafts",
      "recipe_draft_messages",
    ]) {
      expect(tables.has(table)).toBe(true);
    }

    expect(tables.has("graph_relation_types")).toBe(false);
  });

  it("full food reset includes the current full food schema", () => {
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
      "recipe_identity_duplicate_reports",
      "recipe_identity_documents",
      "candidate_image_bindings",
      "recipe_drafts",
      "recipe_draft_messages",
      "ingredients",
      "ingredient_aliases",
      "ingredient_ontology_links",
      "ontology_terms",
    ]) {
      expect(tables.has(table)).toBe(true);
    }

    expect(tables.has("graph_relation_types")).toBe(false);
  });
});
