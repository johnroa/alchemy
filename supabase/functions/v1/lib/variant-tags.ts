/**
 * Variant tag computation and flattening for cookbook filtering.
 *
 * Canonical recipes carry metadata tags (cuisine, dietary, technique, etc.).
 * When a variant is materialized the LLM produces a tag_diff (added/removed).
 * `computeVariantTags` merges the canonical tags with the diff to produce a
 * structured VariantTags object stored on the variant row.
 *
 * `flattenVariantTags` converts raw JSONB back into a typed VariantTagSet
 * for API responses.
 */

import type { RecipePayload } from "../../_shared/types.ts";
import type { RecipeSemanticProfile } from "../../../../packages/shared/src/recipe-semantics.ts";
import type { VariantTagSet } from "../routes/shared.ts";
import {
  extractSemanticProfileFromPayload,
  extractBrowseFacetProfileFromPayload,
} from "./semantic-facets.ts";

/**
 * Structured variant tags computed from canonical recipe metadata and
 * the LLM's tag_diff. Used for fast multi-dimensional cookbook filtering.
 */
export type VariantTags = {
  cuisine: string[];
  dietary: string[];
  technique: string[];
  occasion: string[];
  time_minutes: number | null;
  difficulty: string | null;
  key_ingredients: string[];
  semantic_profile?: RecipeSemanticProfile;
  browse_facet_profile?: RecipeSemanticProfile;
};

/**
 * Computes structured variant tags by starting with canonical recipe
 * metadata tags and applying the LLM's tag_diff (added/removed).
 *
 * The tag_diff from the LLM uses flat strings like "gluten-free" or
 * "Italian" — we categorize them best-effort by checking against
 * the canonical tag categories. Unknown tags go into dietary by default
 * (safest bucket for constraint-driven additions).
 *
 * Also extracts time_minutes, difficulty, and key ingredients from
 * the variant payload for filtering dimensions beyond tags.
 */
export const computeVariantTags = (params: {
  canonicalPayload: RecipePayload;
  variantPayload: RecipePayload;
  tagDiff: { added: string[]; removed: string[] };
}): VariantTags => {
  const meta = params.variantPayload.metadata as
    | Record<string, unknown>
    | undefined;
  const canonMeta = params.canonicalPayload.metadata as
    | Record<string, unknown>
    | undefined;

  const toStringArray = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value.filter((v): v is string => typeof v === "string");
  };

  // Start with canonical tags per category.
  const cuisine = new Set(
    toStringArray(canonMeta?.cuisine_tags ?? canonMeta?.cuisine),
  );
  const dietary = new Set(toStringArray(canonMeta?.diet_tags));
  const technique = new Set(toStringArray(canonMeta?.techniques));
  const occasion = new Set(toStringArray(canonMeta?.occasion_tags));

  // Build a lookup of which category each existing tag belongs to
  // so we can categorize removals correctly.
  const tagCategory = new Map<string, Set<string>>();
  for (const t of cuisine) tagCategory.set(t.toLowerCase(), cuisine);
  for (const t of dietary) tagCategory.set(t.toLowerCase(), dietary);
  for (const t of technique) tagCategory.set(t.toLowerCase(), technique);
  for (const t of occasion) tagCategory.set(t.toLowerCase(), occasion);

  // Apply removals.
  for (const removed of params.tagDiff.removed) {
    const key = removed.toLowerCase();
    const category = tagCategory.get(key);
    if (category) {
      for (const existing of category) {
        if (existing.toLowerCase() === key) {
          category.delete(existing);
          break;
        }
      }
    }
  }

  // Apply additions. Categorize by checking variant metadata fields,
  // falling back to dietary (most additions from personalization are
  // dietary tags like "gluten-free", "dairy-free", etc.).
  const variantCuisine = new Set(
    toStringArray(meta?.cuisine_tags ?? meta?.cuisine),
  );
  const variantDietary = new Set(toStringArray(meta?.diet_tags));
  const variantTechnique = new Set(toStringArray(meta?.techniques));
  const variantOccasion = new Set(toStringArray(meta?.occasion_tags));

  for (const added of params.tagDiff.added) {
    const key = added.toLowerCase();
    if ([...variantCuisine].some((t) => t.toLowerCase() === key)) {
      cuisine.add(added);
    } else if ([...variantTechnique].some((t) => t.toLowerCase() === key)) {
      technique.add(added);
    } else if ([...variantOccasion].some((t) => t.toLowerCase() === key)) {
      occasion.add(added);
    } else {
      // Default bucket for personalization-driven additions.
      dietary.add(added);
    }
  }

  // Extract filtering dimensions from the variant payload.
  const timeMinutes = typeof meta?.time_minutes === "number"
    ? meta.time_minutes
    : typeof meta?.total_time === "number"
    ? meta.total_time
    : null;

  const difficulty = typeof meta?.difficulty === "string"
    ? meta.difficulty
    : null;

  // Key ingredients from the variant payload for ingredient-based filtering.
  const keyIngredients: string[] = [];
  if (Array.isArray(params.variantPayload.ingredients)) {
    for (const ing of params.variantPayload.ingredients.slice(0, 8)) {
      const name = typeof ing === "object" && ing !== null
        ? (ing as Record<string, unknown>).name
        : null;
      if (typeof name === "string") {
        keyIngredients.push(name.toLowerCase());
      }
    }
  }

  const semanticProfile = extractSemanticProfileFromPayload(
    params.variantPayload,
  );
  const browseFacetProfile = extractBrowseFacetProfileFromPayload(
    params.variantPayload,
  );

  return {
    cuisine: [...cuisine],
    dietary: [...dietary],
    technique: [...technique],
    occasion: [...occasion],
    time_minutes: timeMinutes,
    difficulty,
    key_ingredients: keyIngredients,
    ...(semanticProfile ? { semantic_profile: semanticProfile } : {}),
    ...(browseFacetProfile
      ? { browse_facet_profile: browseFacetProfile }
      : {}),
  };
};

/**
 * Converts raw JSONB variant_tags from the database into a typed
 * VariantTagSet for the API response. Returns empty object when
 * no tags exist.
 */
export const flattenVariantTags = (
  raw: Record<string, unknown> | undefined,
): VariantTagSet => {
  if (!raw || Object.keys(raw).length === 0) return {};
  const toStringArray = (v: unknown): string[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    const filtered = v.filter((item): item is string =>
      typeof item === "string"
    );
    return filtered.length > 0 ? filtered : undefined;
  };
  return {
    cuisine: toStringArray(raw.cuisine),
    dietary: toStringArray(raw.dietary),
    technique: toStringArray(raw.technique),
    occasion: toStringArray(raw.occasion),
    time_minutes: typeof raw.time_minutes === "number"
      ? raw.time_minutes
      : null,
    difficulty: typeof raw.difficulty === "string" ? raw.difficulty : null,
    key_ingredients: toStringArray(raw.key_ingredients),
  };
};
