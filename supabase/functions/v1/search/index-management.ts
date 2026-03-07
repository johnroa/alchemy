import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../../_shared/errors.ts";
import { llmGateway, type ModelOverrideMap } from "../../_shared/llm-gateway.ts";
import type { JsonValue, RecipePayload } from "../../_shared/types.ts";
import {
  resolveRecipeImageStatus,
  resolveRecipeImageUrl,
} from "../recipe-images.ts";
import {
  canonicalizeRecipePayloadMetadata,
  resolveSearchPreviewCategory,
} from "../recipe-preview.ts";
import type {
  RecipeSearchDifficulty,
  SearchBackfillTarget,
  SearchDocumentSource,
} from "./types.ts";
import {
  asRecord,
  normalizeDifficulty,
  normalizeFiniteInteger,
  normalizeScalarText,
  normalizeStringList,
  serializeVector,
} from "./filters.ts";

// ---------------------------------------------------------------------------
// Local helpers — only used within this module
// ---------------------------------------------------------------------------

const buildSearchDocumentSummary = (payload: RecipePayload): string => {
  return normalizeScalarText(payload.description) ??
    normalizeScalarText(payload.notes) ??
    "";
};

const listifyMetadata = (
  metadata: Record<string, JsonValue> | undefined,
  key: string,
): string[] => {
  if (!metadata) {
    return [];
  }
  return normalizeStringList(metadata[key]);
};

// ---------------------------------------------------------------------------
// Build search document from source data
// ---------------------------------------------------------------------------

export const buildRecipeSearchDocument = (
  params: SearchDocumentSource,
): {
  recipe_id: string;
  recipe_version_id: string;
  category: string | null;
  visibility: string;
  recipe_updated_at: string;
  image_url: string | null;
  image_status: string;
  explore_eligible: boolean;
  title: string;
  summary: string;
  time_minutes: number | null;
  difficulty: RecipeSearchDifficulty | null;
  health_score: number | null;
  ingredient_count: number;
  canonical_ingredient_ids: string[];
  canonical_ingredient_names: string[];
  ontology_term_keys: string[];
  cuisine_tags: string[];
  diet_tags: string[];
  occasion_tags: string[];
  technique_tags: string[];
  keyword_terms: string[];
  search_text: string;
} => {
  const metadata = canonicalizeRecipePayloadMetadata(params.payload);

  const resolvedImageUrl = resolveRecipeImageUrl(params.imageUrl);
  const resolvedImageStatus = resolveRecipeImageStatus(
    params.imageUrl,
    params.imageStatus,
  );
  const title = normalizeScalarText(params.payload.title) ?? "Untitled Recipe";
  const summary = buildSearchDocumentSummary(params.payload);
  const ingredientCount = Array.isArray(params.payload.ingredients)
    ? params.payload.ingredients.length
    : 0;
  const keywordTerms = Array.from(
    new Set(
      [
        ...listifyMetadata(metadata, "flavor_profile"),
        ...listifyMetadata(metadata, "health_flags"),
        ...normalizeStringList(params.payload.pairings),
      ].map((item) => item.toLowerCase()),
    ),
  );
  const cuisineTags = Array.from(
    new Set(
      [
        ...listifyMetadata(metadata, "cuisine_tags"),
        ...listifyMetadata(metadata, "cuisine"),
      ],
    ),
  );
  const dietTags = listifyMetadata(metadata, "diet_tags");
  const occasionTags = listifyMetadata(metadata, "occasion_tags");
  const techniqueTags = listifyMetadata(metadata, "techniques");

  const searchTextParts = [
    title,
    summary,
    normalizeScalarText(params.payload.notes),
    ...params.canonicalIngredientNames,
    ...params.ontologyTermKeys,
    ...cuisineTags,
    ...dietTags,
    ...occasionTags,
    ...techniqueTags,
    ...keywordTerms,
    normalizeScalarText(metadata?.vibe),
    normalizeScalarText(metadata?.spice_level),
  ].filter((value): value is string => Boolean(value));

  return {
    recipe_id: params.recipeId,
    recipe_version_id: params.recipeVersionId,
    category: resolveSearchPreviewCategory(params.category),
    visibility: params.visibility,
    recipe_updated_at: params.updatedAt,
    image_url: resolvedImageUrl,
    image_status: resolvedImageStatus,
    explore_eligible: params.visibility === "public" &&
      Boolean(resolvedImageUrl),
    title,
    summary,
    time_minutes: normalizeFiniteInteger(metadata?.time_minutes),
    difficulty: normalizeDifficulty(metadata?.difficulty),
    health_score: normalizeFiniteInteger(metadata?.health_score),
    ingredient_count: ingredientCount,
    canonical_ingredient_ids: params.canonicalIngredientIds,
    canonical_ingredient_names: params.canonicalIngredientNames,
    ontology_term_keys: params.ontologyTermKeys,
    cuisine_tags: cuisineTags,
    diet_tags: dietTags,
    occasion_tags: occasionTags,
    technique_tags: techniqueTags,
    keyword_terms: keywordTerms,
    search_text: searchTextParts.join("\n"),
  };
};

// ---------------------------------------------------------------------------
// Load source data for a single recipe version
// ---------------------------------------------------------------------------

export const loadRecipeSearchDocumentSource = async (params: {
  serviceClient: SupabaseClient;
  recipeId: string;
  recipeVersionId: string;
}): Promise<SearchDocumentSource> => {
  const [
    { data: recipeRow, error: recipeError },
    { data: versionRow, error: versionError },
    { data: ingredientRows, error: ingredientRowsError },
    { data: autoCategoryRow, error: autoCategoryError },
  ] = await Promise.all([
    params.serviceClient
      .from("recipes")
      .select("id,visibility,hero_image_url,image_status,updated_at")
      .eq("id", params.recipeId)
      .maybeSingle(),
    params.serviceClient
      .from("recipe_versions")
      .select("id,payload")
      .eq("id", params.recipeVersionId)
      .maybeSingle(),
    params.serviceClient
      .from("recipe_ingredients")
      .select("ingredient_id,source_name,metadata")
      .eq("recipe_version_id", params.recipeVersionId)
      .order("position", { ascending: true }),
    params.serviceClient
      .from("recipe_auto_categories")
      .select("category,confidence")
      .eq("recipe_id", params.recipeId)
      .order("confidence", { ascending: false, nullsFirst: false })
      .order("category", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  if (recipeError || !recipeRow) {
    throw new ApiError(
      404,
      "recipe_search_source_recipe_not_found",
      "Recipe was not found for search backfill",
      recipeError?.message,
    );
  }

  if (versionError || !versionRow?.payload) {
    throw new ApiError(
      404,
      "recipe_search_source_version_not_found",
      "Recipe version was not found for search backfill",
      versionError?.message,
    );
  }

  if (ingredientRowsError) {
    throw new ApiError(
      500,
      "recipe_search_source_ingredients_failed",
      "Could not load recipe ingredients for search backfill",
      ingredientRowsError.message,
    );
  }

  if (autoCategoryError) {
    throw new ApiError(
      500,
      "recipe_search_source_category_failed",
      "Could not load recipe category for search backfill",
      autoCategoryError.message,
    );
  }

  const canonicalIngredientIds = Array.from(
    new Set(
      (ingredientRows ?? []).flatMap((row) =>
        typeof row.ingredient_id === "string" && row.ingredient_id.length > 0
          ? [row.ingredient_id]
          : []
      ),
    ),
  );

  let ingredientMetadataRows: Array<{
    id: string;
    canonical_name: string;
    metadata: JsonValue;
  }> = [];

  if (canonicalIngredientIds.length > 0) {
    const { data, error } = await params.serviceClient
      .from("ingredients")
      .select("id,canonical_name,metadata")
      .in("id", canonicalIngredientIds);

    if (error) {
      throw new ApiError(
        500,
        "recipe_search_source_ingredient_metadata_failed",
        "Could not load canonical ingredient metadata for search backfill",
        error.message,
      );
    }

    ingredientMetadataRows = (data ?? []) as Array<{
      id: string;
      canonical_name: string;
      metadata: JsonValue;
    }>;
  }

  const ingredientNameById = new Map(
    ingredientMetadataRows.map((row) => [row.id, row.canonical_name]),
  );
  const canonicalIngredientNames = Array.from(
    new Set(
      (ingredientRows ?? []).flatMap((row) => {
        if (typeof row.ingredient_id === "string") {
          const canonicalName = ingredientNameById.get(row.ingredient_id);
          if (canonicalName && canonicalName.trim().length > 0) {
            return [canonicalName];
          }
        }

        const metadata = asRecord(row.metadata);
        const fallbackName = normalizeScalarText(metadata?.canonical_name) ??
          normalizeScalarText(row.source_name);
        return fallbackName ? [fallbackName] : [];
      }),
    ),
  );

  const ontologyTermKeys = Array.from(
    new Set(
      ingredientMetadataRows.flatMap((row) => {
        const metadata = asRecord(row.metadata);
        const ontologyIds = asRecord(metadata?.ontology_ids);
        return Array.isArray(ontologyIds?.internal_term_keys)
          ? ontologyIds.internal_term_keys.filter((value): value is string =>
            typeof value === "string" && value.trim().length > 0
          )
          : [];
      }),
    ),
  );

  return {
    recipeId: params.recipeId,
    recipeVersionId: params.recipeVersionId,
    category: resolveSearchPreviewCategory(autoCategoryRow?.category),
    visibility: String(recipeRow.visibility ?? "private"),
    updatedAt: String(recipeRow.updated_at ?? new Date(0).toISOString()),
    imageUrl: normalizeScalarText(recipeRow.hero_image_url),
    imageStatus: normalizeScalarText(recipeRow.image_status) ?? "pending",
    payload: versionRow.payload as RecipePayload,
    canonicalIngredientIds,
    canonicalIngredientNames,
    ontologyTermKeys,
  };
};

// ---------------------------------------------------------------------------
// Upsert a single search document (build + embed + persist)
// ---------------------------------------------------------------------------

export const upsertRecipeSearchDocument = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  source: SearchDocumentSource;
  modelOverrides?: ModelOverrideMap;
}): Promise<void> => {
  const document = buildRecipeSearchDocument(params.source);
  const embedding = await llmGateway.embedRecipeSearchQuery({
    client: params.serviceClient,
    userId: params.userId,
    requestId: params.requestId,
    inputText: document.search_text,
    modelOverrides: params.modelOverrides,
  });

  const { error } = await params.serviceClient.from("recipe_search_documents")
    .upsert({
      ...document,
      embedding: serializeVector(embedding.vector),
      indexed_at: new Date().toISOString(),
    }, {
      onConflict: "recipe_id",
    });

  if (error) {
    throw new ApiError(
      500,
      "recipe_search_document_upsert_failed",
      "Could not persist recipe search document",
      error.message,
    );
  }
};

// ---------------------------------------------------------------------------
// Batch backfill search documents
// ---------------------------------------------------------------------------

export const backfillRecipeSearchDocuments = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  recipeIds?: string[];
  recipeVersionIds?: string[];
  publicOnly?: boolean;
  currentVersionsOnly?: boolean;
  missingOnly?: boolean;
  limit?: number;
  modelOverrides?: ModelOverrideMap;
}): Promise<{
  processed: number;
  failed: number;
  recipe_version_ids: string[];
  failures: Array<{ recipe_version_id: string; error: string }>;
}> => {
  const limit = Math.max(
    1,
    Math.min(100, Math.trunc(Number(params.limit ?? 25))),
  );
  const recipeIds = Array.from(new Set(params.recipeIds ?? []));
  const recipeVersionIds = Array.from(new Set(params.recipeVersionIds ?? []));
  const publicOnly = params.publicOnly === true;
  const currentVersionsOnly = params.currentVersionsOnly !== false;
  const missingOnly = params.missingOnly !== false;

  let targetVersions: SearchBackfillTarget[] = [];

  if (recipeVersionIds.length > 0) {
    const { data, error } = await params.serviceClient
      .from("recipe_versions")
      .select("id,recipe_id")
      .in("id", recipeVersionIds);

    if (error) {
      throw new ApiError(
        500,
        "recipe_search_backfill_targets_failed",
        "Could not resolve recipe versions for search backfill",
        error.message,
      );
    }

    targetVersions = (data ?? []).map((row) => ({
      recipe_id: String(row.recipe_id),
      recipe_version_id: String(row.id),
    }));
  } else if (!currentVersionsOnly && recipeIds.length > 0) {
    const { data, error } = await params.serviceClient
      .from("recipe_versions")
      .select("id,recipe_id")
      .in("recipe_id", recipeIds);

    if (error) {
      throw new ApiError(
        500,
        "recipe_search_backfill_targets_failed",
        "Could not resolve recipe versions for search backfill",
        error.message,
      );
    }

    targetVersions = (data ?? []).map((row) => ({
      recipe_id: String(row.recipe_id),
      recipe_version_id: String(row.id),
    }));
  } else {
    let recipesQuery = params.serviceClient
      .from("recipes")
      .select("id,current_version_id,visibility")
      .not("current_version_id", "is", null);

    if (publicOnly) {
      recipesQuery = recipesQuery.eq("visibility", "public");
    }
    if (recipeIds.length > 0) {
      recipesQuery = recipesQuery.in("id", recipeIds);
    }

    const { data, error } = await recipesQuery;
    if (error) {
      throw new ApiError(
        500,
        "recipe_search_backfill_recipes_failed",
        "Could not resolve recipes for search backfill",
        error.message,
      );
    }

    targetVersions = (data ?? [])
      .filter((row) => typeof row.current_version_id === "string")
      .map((row) => ({
        recipe_id: String(row.id),
        recipe_version_id: String(row.current_version_id),
      }));
  }

  if (publicOnly && recipeVersionIds.length > 0) {
    const targetRecipeIds = Array.from(
      new Set(targetVersions.map((target) => target.recipe_id)),
    );
    if (targetRecipeIds.length > 0) {
      const { data, error } = await params.serviceClient
        .from("recipes")
        .select("id,visibility")
        .in("id", targetRecipeIds);

      if (error) {
        throw new ApiError(
          500,
          "recipe_search_backfill_recipe_visibility_failed",
          "Could not filter recipe visibility for search backfill",
          error.message,
        );
      }

      const publicRecipeIds = new Set(
        (data ?? [])
          .filter((row) => row.visibility === "public")
          .map((row) => String(row.id)),
      );
      targetVersions = targetVersions.filter((target) =>
        publicRecipeIds.has(target.recipe_id)
      );
    }
  }

  targetVersions = Array.from(
    new Map(
      targetVersions.map((target) => [target.recipe_version_id, target]),
    ).values(),
  );

  if (missingOnly && targetVersions.length > 0) {
    const { data, error } = await params.serviceClient
      .from("recipe_search_documents")
      .select("recipe_version_id")
      .in(
        "recipe_version_id",
        targetVersions.map((target) => target.recipe_version_id),
      );

    if (error) {
      throw new ApiError(
        500,
        "recipe_search_backfill_existing_docs_failed",
        "Could not fetch existing search documents",
        error.message,
      );
    }

    const existingVersionIds = new Set(
      (data ?? []).map((row) => String(row.recipe_version_id)),
    );
    targetVersions = targetVersions.filter((target) =>
      !existingVersionIds.has(target.recipe_version_id)
    );
  }

  targetVersions = targetVersions.slice(0, limit);

  let processed = 0;
  let failed = 0;
  const failures: Array<{ recipe_version_id: string; error: string }> = [];

  for (const target of targetVersions) {
    try {
      const source = await loadRecipeSearchDocumentSource({
        serviceClient: params.serviceClient,
        recipeId: target.recipe_id,
        recipeVersionId: target.recipe_version_id,
      });
      await upsertRecipeSearchDocument({
        serviceClient: params.serviceClient,
        userId: params.userId,
        requestId: params.requestId,
        source,
        modelOverrides: params.modelOverrides,
      });
      processed += 1;
    } catch (error) {
      failed += 1;
      failures.push({
        recipe_version_id: target.recipe_version_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    processed,
    failed,
    recipe_version_ids: targetVersions.map((target) => target.recipe_version_id),
    failures,
  };
};
