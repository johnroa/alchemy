import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../_shared/errors.ts";
import { llmGateway, type ModelOverrideMap } from "../_shared/llm-gateway.ts";
import type { JsonValue, RecipePayload } from "../_shared/types.ts";
import {
  resolveRecipeImageStatus,
  resolveRecipeImageUrl,
} from "./recipe-images.ts";

export type RecipeSearchSurface = "explore" | "chat";
export type RecipeSearchAppliedContext = "all" | "preset" | "query";
export type RecipeSearchDifficulty = "easy" | "medium" | "complex";

export type RecipeSearchCard = {
  id: string;
  title: string;
  summary: string;
  image_url: string | null;
  image_status: string;
  time_minutes: number | null;
  difficulty: RecipeSearchDifficulty | null;
  health_score: number | null;
  ingredient_count: number;
};

export type RecipeSearchNoMatch = {
  code: string;
  message: string;
  suggested_action: string;
};

export type RecipeSearchConversationContext = {
  latest_user_message?: string;
  thread?: Array<{ role: string; content: string }>;
  preferences?: JsonValue;
  selected_memories?: JsonValue;
  active_recipe?: JsonValue;
  candidate_recipe_set?: JsonValue;
};

export type RecipeSearchIntent = {
  normalized_query: string;
  applied_context: RecipeSearchAppliedContext;
  hard_filters: {
    cuisines: string[];
    diet_tags: string[];
    techniques: string[];
    exclude_ingredients: string[];
    max_time_minutes: number | null;
    max_difficulty: RecipeSearchDifficulty | null;
  };
  soft_targets: string[];
  exclusions: string[];
  sort_bias: string | null;
  query_style: "all" | "explicit" | "subjective" | "mixed";
};

export type RecipeSearchResponse = {
  search_id: string;
  applied_context: RecipeSearchAppliedContext;
  items: RecipeSearchCard[];
  next_cursor: string | null;
  no_match: RecipeSearchNoMatch | null;
};

export type InternalRecipeSearchResponse = RecipeSearchResponse & {
  internal: {
    interpreted_intent: RecipeSearchIntent | null;
    rerank_used: boolean;
    candidate_count: number;
    rationale_tags_by_recipe: Record<string, string[]>;
  };
};

type RecipeSearchSessionRow = {
  id: string;
  owner_user_id: string;
  surface: RecipeSearchSurface;
  applied_context: RecipeSearchAppliedContext;
  normalized_input: string | null;
  preset_id: string | null;
  interpreted_intent: JsonValue;
  query_embedding: string | null;
  snapshot_cutoff_indexed_at: string;
  page1_promoted_recipe_ids: string[] | null;
  hybrid_items: JsonValue;
  expires_at: string;
};

type AllFeedCursor = {
  v: 1;
  kind: "all";
  search_id: string;
  last_indexed_at: string;
  last_recipe_id: string;
};

type SessionCursor = {
  v: 1;
  kind: "session";
  search_id: string;
  offset: number;
};

type SearchCursor = AllFeedCursor | SessionCursor;

type SearchRpcRow = {
  recipe_id: string;
  recipe_version_id: string;
  title: string;
  summary: string | null;
  image_url: string | null;
  image_status: string;
  time_minutes: number | null;
  difficulty: string | null;
  health_score: number | null;
  ingredient_count: number | null;
  indexed_at: string;
};

type SearchDocumentSource = {
  recipeId: string;
  recipeVersionId: string;
  visibility: string;
  imageUrl: string | null;
  imageStatus: string;
  payload: RecipePayload;
  canonicalIngredientIds: string[];
  canonicalIngredientNames: string[];
  ontologyTermKeys: string[];
};

type SearchBackfillTarget = {
  recipe_id: string;
  recipe_version_id: string;
};

type SearchSessionCreateInput = {
  serviceClient: SupabaseClient;
  userId: string;
  surface: RecipeSearchSurface;
  appliedContext: RecipeSearchAppliedContext;
  normalizedInput: string | null;
  presetId: string | null;
  interpretedIntent: RecipeSearchIntent | null;
  queryEmbedding: string | null;
  snapshotCutoffIndexedAt: string;
  page1PromotedRecipeIds?: string[];
  hybridItems?: RecipeSearchCard[];
};

const SEARCH_SESSION_TTL_MS = 30 * 60 * 1000;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;
const HYBRID_CANDIDATE_LIMIT = 200;
const PAGE1_RERANK_LIMIT = 30;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const asRecord = (value: unknown): Record<string, JsonValue> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, JsonValue>;
};

const normalizeScalarText = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
};

const normalizeStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    const normalized = normalizeScalarText(entry);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
};

const normalizeDifficulty = (
  value: unknown,
): RecipeSearchDifficulty | null => {
  const normalized = normalizeScalarText(value)?.toLowerCase();
  if (
    normalized !== "easy" && normalized !== "medium" &&
    normalized !== "complex"
  ) {
    return null;
  }
  return normalized;
};

const normalizeFiniteInteger = (value: unknown): number | null => {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string"
    ? Number(value)
    : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.trunc(parsed);
};

const clampLimit = (value: number | null | undefined): number => {
  if (!Number.isFinite(value)) {
    return DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(Number(value))));
};

const toBase64Url = (value: string): string => {
  let binary = "";
  for (const byte of encoder.encode(value)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/g,
    "",
  );
};

const fromBase64Url = (value: string): string => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return decoder.decode(bytes);
};

export const encodeSearchCursor = (cursor: SearchCursor): string => {
  return toBase64Url(JSON.stringify(cursor));
};

export const decodeSearchCursor = (
  value: string | null | undefined,
): SearchCursor | null => {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(fromBase64Url(value)) as {
      v?: unknown;
      kind?: unknown;
      search_id?: unknown;
      last_indexed_at?: unknown;
      last_recipe_id?: unknown;
      offset?: unknown;
    };

    if (parsed.v !== 1 || typeof parsed.search_id !== "string") {
      return null;
    }
    if (
      parsed.kind === "all" && typeof parsed.last_indexed_at === "string" &&
      typeof parsed.last_recipe_id === "string"
    ) {
      return {
        v: 1,
        kind: "all",
        search_id: parsed.search_id,
        last_indexed_at: parsed.last_indexed_at,
        last_recipe_id: parsed.last_recipe_id,
      };
    }
    if (
      parsed.kind === "session" && Number.isInteger(parsed.offset) &&
      Number(parsed.offset) >= 0
    ) {
      return {
        v: 1,
        kind: "session",
        search_id: parsed.search_id,
        offset: Number(parsed.offset),
      };
    }
  } catch {
    return null;
  }

  return null;
};

const normalizeRecipeSearchCard = (
  value: unknown,
): RecipeSearchCard | null => {
  const record = asRecord(value);
  const id = normalizeScalarText(record?.id);
  const title = normalizeScalarText(record?.title);
  if (!record || !id || !title) {
    return null;
  }

  return {
    id,
    title,
    summary: normalizeScalarText(record.summary) ?? "",
    image_url: normalizeScalarText(record.image_url),
    image_status: normalizeScalarText(record.image_status) ?? "pending",
    time_minutes: normalizeFiniteInteger(record.time_minutes),
    difficulty: normalizeDifficulty(record.difficulty),
    health_score: normalizeFiniteInteger(record.health_score),
    ingredient_count: normalizeFiniteInteger(record.ingredient_count) ?? 0,
  };
};

const normalizeStoredCards = (value: unknown): RecipeSearchCard[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: RecipeSearchCard[] = [];
  for (const entry of value) {
    const item = normalizeRecipeSearchCard(entry);
    if (item) {
      result.push(item);
    }
  }
  return result;
};

const normalizeSearchText = (value: string | null | undefined): string | null => {
  const normalized = normalizeScalarText(value);
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, 400);
};

const derivePresetText = (presetId: string): string => {
  return presetId
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
};

const buildNoMatch = (
  appliedContext: RecipeSearchAppliedContext,
): RecipeSearchNoMatch => {
  if (appliedContext === "all") {
    return {
      code: "all_feed_empty",
      message: "No public recipes are available yet.",
      suggested_action: "Try again after more recipes are indexed.",
    };
  }

  return {
    code: "recipe_search_no_match",
    message: "No recipes matched that search yet.",
    suggested_action:
      "Try a broader description or remove one constraint.",
  };
};

const serializeSearchCard = (item: RecipeSearchCard): Record<string, JsonValue> => ({
  id: item.id,
  title: item.title,
  summary: item.summary,
  image_url: item.image_url,
  image_status: item.image_status,
  time_minutes: item.time_minutes,
  difficulty: item.difficulty,
  health_score: item.health_score,
  ingredient_count: item.ingredient_count,
});

const serializeVector = (vector: number[]): string => {
  return `[${vector.map((value) => Number(value).toFixed(12)).join(",")}]`;
};

const mapRpcRowToCard = (row: SearchRpcRow): RecipeSearchCard => ({
  id: row.recipe_id,
  title: normalizeScalarText(row.title) ?? "Untitled Recipe",
  summary: normalizeScalarText(row.summary) ?? "",
  image_url: normalizeScalarText(row.image_url),
  image_status: normalizeScalarText(row.image_status) ?? "pending",
  time_minutes: normalizeFiniteInteger(row.time_minutes),
  difficulty: normalizeDifficulty(row.difficulty),
  health_score: normalizeFiniteInteger(row.health_score),
  ingredient_count: normalizeFiniteInteger(row.ingredient_count) ?? 0,
});

const normalizeSearchIntent = (params: {
  appliedContext: RecipeSearchAppliedContext;
  normalizedInput: string | null;
  raw: unknown;
}): RecipeSearchIntent => {
  const record = asRecord(params.raw);
  const hardFilters = asRecord(record?.hard_filters);

  return {
    normalized_query: normalizeScalarText(record?.normalized_query) ??
      params.normalizedInput ?? "",
    applied_context: params.appliedContext,
    hard_filters: {
      cuisines: normalizeStringList(hardFilters?.cuisines),
      diet_tags: normalizeStringList(hardFilters?.diet_tags),
      techniques: normalizeStringList(hardFilters?.techniques),
      exclude_ingredients: normalizeStringList(hardFilters?.exclude_ingredients),
      max_time_minutes: normalizeFiniteInteger(hardFilters?.max_time_minutes),
      max_difficulty: normalizeDifficulty(hardFilters?.max_difficulty),
    },
    soft_targets: normalizeStringList(record?.soft_targets),
    exclusions: normalizeStringList(record?.exclusions),
    sort_bias: normalizeScalarText(record?.sort_bias),
    query_style: params.appliedContext === "all"
      ? "all"
      : normalizeScalarText(record?.query_style) === "explicit" ||
          normalizeScalarText(record?.query_style) === "subjective" ||
          normalizeScalarText(record?.query_style) === "mixed"
      ? normalizeScalarText(record?.query_style) as
        | "explicit"
        | "subjective"
        | "mixed"
      : "mixed",
  };
};

const normalizeRerankResult = (params: {
  raw: unknown;
  candidates: RecipeSearchCard[];
}): {
  orderedItems: RecipeSearchCard[];
  rationaleTagsByRecipe: Record<string, string[]>;
} => {
  const record = asRecord(params.raw);
  const orderedRecipeIds = normalizeStringList(record?.ordered_recipe_ids);
  const rationaleRaw = asRecord(record?.rationale_tags_by_recipe);
  const rationaleTagsByRecipe: Record<string, string[]> = {};
  for (const [recipeId, value] of Object.entries(rationaleRaw ?? {})) {
    rationaleTagsByRecipe[recipeId] = normalizeStringList(value);
  }

  const itemById = new Map(params.candidates.map((item) => [item.id, item]));
  const orderedItems: RecipeSearchCard[] = [];
  const seen = new Set<string>();

  for (const recipeId of orderedRecipeIds) {
    const item = itemById.get(recipeId);
    if (!item || seen.has(recipeId)) {
      continue;
    }
    seen.add(recipeId);
    orderedItems.push(item);
  }

  for (const item of params.candidates) {
    if (seen.has(item.id)) {
      continue;
    }
    orderedItems.push(item);
  }

  return { orderedItems, rationaleTagsByRecipe };
};

const filterSessionItems = (
  items: RecipeSearchCard[],
  promotedRecipeIds: string[],
): RecipeSearchCard[] => {
  if (promotedRecipeIds.length === 0) {
    return items;
  }
  const excluded = new Set(promotedRecipeIds);
  return items.filter((item) => !excluded.has(item.id));
};

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

export const buildRecipeSearchDocument = (
  params: SearchDocumentSource,
): {
  recipe_id: string;
  recipe_version_id: string;
  visibility: string;
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
  const metadata = params.payload.metadata &&
      typeof params.payload.metadata === "object" &&
      !Array.isArray(params.payload.metadata)
    ? params.payload.metadata as Record<string, JsonValue>
    : undefined;

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
    visibility: params.visibility,
    image_url: resolvedImageUrl,
    image_status: resolvedImageStatus,
    explore_eligible: params.visibility === "public" &&
      resolvedImageUrl.length > 0,
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

const loadRecipeSearchDocumentSource = async (params: {
  serviceClient: SupabaseClient;
  recipeId: string;
  recipeVersionId: string;
}): Promise<SearchDocumentSource> => {
  const [
    { data: recipeRow, error: recipeError },
    { data: versionRow, error: versionError },
    { data: ingredientRows, error: ingredientRowsError },
  ] = await Promise.all([
    params.serviceClient
      .from("recipes")
      .select("id,visibility,hero_image_url,image_status")
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
    visibility: String(recipeRow.visibility ?? "private"),
    imageUrl: normalizeScalarText(recipeRow.hero_image_url),
    imageStatus: normalizeScalarText(recipeRow.image_status) ?? "pending",
    payload: versionRow.payload as RecipePayload,
    canonicalIngredientIds,
    canonicalIngredientNames,
    ontologyTermKeys,
  };
};

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

const createSearchSession = async (
  params: SearchSessionCreateInput,
): Promise<string> => {
  const expiresAt = new Date(Date.now() + SEARCH_SESSION_TTL_MS).toISOString();
  const { data, error } = await params.serviceClient
    .from("recipe_search_sessions")
    .insert({
      owner_user_id: params.userId,
      surface: params.surface,
      applied_context: params.appliedContext,
      normalized_input: params.normalizedInput,
      preset_id: params.presetId,
      interpreted_intent: params.interpretedIntent
        ? (params.interpretedIntent as unknown as JsonValue)
        : {},
      query_embedding: params.queryEmbedding,
      snapshot_cutoff_indexed_at: params.snapshotCutoffIndexedAt,
      page1_promoted_recipe_ids: params.page1PromotedRecipeIds ?? [],
      hybrid_items: (params.hybridItems ?? []).map(serializeSearchCard),
      expires_at: expiresAt,
    })
    .select(
      "id",
    )
    .single();

  if (error || !data?.id) {
    throw new ApiError(
      500,
      "recipe_search_session_create_failed",
      "Could not create search session",
      error?.message,
    );
  }

  return data.id;
};

const fetchSearchSession = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  searchId: string;
}): Promise<RecipeSearchSessionRow> => {
  const { data, error } = await params.serviceClient
    .from("recipe_search_sessions")
    .select(
      "id,owner_user_id,surface,applied_context,normalized_input,preset_id,interpreted_intent,query_embedding,snapshot_cutoff_indexed_at,page1_promoted_recipe_ids,hybrid_items,expires_at",
    )
    .eq("id", params.searchId)
    .eq("owner_user_id", params.userId)
    .maybeSingle();

  if (error || !data) {
    throw new ApiError(
      404,
      "recipe_search_session_not_found",
      "Search session was not found",
      error?.message,
    );
  }

  if (new Date(data.expires_at).getTime() < Date.now()) {
    throw new ApiError(
      410,
      "recipe_search_session_expired",
      "Search session has expired",
    );
  }

  return data as RecipeSearchSessionRow;
};

const logSearchEvent = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  searchId: string;
  surface: RecipeSearchSurface;
  appliedContext: RecipeSearchAppliedContext;
  normalizedInput: string | null;
  latencyMs: number;
  candidateCount: number;
  rerankUsed: boolean;
  noMatch: boolean;
}): Promise<void> => {
  const { error } = await params.serviceClient.from("events").insert({
    user_id: params.userId,
    event_type: "recipe_search",
    request_id: params.requestId,
    latency_ms: params.latencyMs,
    event_payload: {
      search_id: params.searchId,
      surface: params.surface,
      applied_context: params.appliedContext,
      normalized_input: params.normalizedInput,
      candidate_count: params.candidateCount,
      rerank_used: params.rerankUsed,
      no_match: params.noMatch,
    },
  });

  if (error) {
    console.error("recipe_search_event_failed", error);
  }
};

const fetchAllFeedPage = async (params: {
  serviceClient: SupabaseClient;
  searchId: string;
  surface: RecipeSearchSurface;
  snapshotCutoffIndexedAt: string;
  limit: number;
  cursor: AllFeedCursor | null;
}): Promise<Pick<RecipeSearchResponse, "items" | "next_cursor" | "no_match">> => {
  const { data, error } = await params.serviceClient.rpc(
    "list_recipe_search_documents",
    {
      p_snapshot_cutoff_indexed_at: params.snapshotCutoffIndexedAt,
      p_explore_only: params.surface === "explore",
      p_limit: params.limit + 1,
      p_cursor_indexed_at: params.cursor?.last_indexed_at ?? null,
      p_cursor_recipe_id: params.cursor?.last_recipe_id ?? null,
    },
  );

  if (error) {
    throw new ApiError(
      500,
      "recipe_search_all_feed_failed",
      "Could not load the explore feed",
      error.message,
    );
  }

  const rows = Array.isArray(data) ? data as SearchRpcRow[] : [];
  const pageRows = rows.slice(0, params.limit);
  const items = pageRows.map(mapRpcRowToCard);
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor = rows.length > params.limit && lastRow
    ? encodeSearchCursor({
      v: 1,
      kind: "all",
      search_id: params.searchId,
      last_indexed_at: lastRow.indexed_at,
      last_recipe_id: lastRow.recipe_id,
    })
    : null;

  return {
    items,
    next_cursor: nextCursor,
    no_match: items.length === 0 ? buildNoMatch("all") : null,
  };
};

const fetchHybridCandidates = async (params: {
  serviceClient: SupabaseClient;
  surface: RecipeSearchSurface;
  snapshotCutoffIndexedAt: string;
  intent: RecipeSearchIntent;
  embeddingVector: number[];
}): Promise<RecipeSearchCard[]> => {
  const { data, error } = await params.serviceClient.rpc(
    "hybrid_search_recipe_documents",
    {
      p_query_text: params.intent.normalized_query,
      p_query_embedding: serializeVector(params.embeddingVector),
      p_snapshot_cutoff_indexed_at: params.snapshotCutoffIndexedAt,
      p_explore_only: params.surface === "explore",
      p_limit: HYBRID_CANDIDATE_LIMIT,
      p_cuisine_tags: params.intent.hard_filters.cuisines,
      p_diet_tags: params.intent.hard_filters.diet_tags,
      p_technique_tags: params.intent.hard_filters.techniques,
      p_exclude_ingredient_names: params.intent.hard_filters.exclude_ingredients,
      p_max_time_minutes: params.intent.hard_filters.max_time_minutes,
      p_max_difficulty: params.intent.hard_filters.max_difficulty,
    },
  );

  if (error) {
    throw new ApiError(
      500,
      "recipe_search_hybrid_failed",
      "Could not load recipe search candidates",
      error.message,
    );
  }

  return Array.isArray(data)
    ? (data as SearchRpcRow[]).map(mapRpcRowToCard)
    : [];
};

const buildInterpretSearchContext = (params: {
  surface: RecipeSearchSurface;
  appliedContext: RecipeSearchAppliedContext;
  normalizedInput: string;
  presetId: string | null;
  conversationContext?: RecipeSearchConversationContext;
}): Record<string, JsonValue> => {
  return {
    surface: params.surface,
    applied_context: params.appliedContext,
    normalized_input: params.normalizedInput,
    preset_id: params.presetId,
    latest_user_message: params.conversationContext?.latest_user_message ?? null,
    thread: params.conversationContext?.thread as unknown as JsonValue ?? null,
    preferences: params.conversationContext?.preferences ?? null,
    selected_memories: params.conversationContext?.selected_memories ?? null,
    active_recipe: params.conversationContext?.active_recipe ?? null,
    candidate_recipe_set: params.conversationContext?.candidate_recipe_set ??
      null,
  };
};

const paginateSessionItems = (params: {
  searchId: string;
  items: RecipeSearchCard[];
  promotedRecipeIds: string[];
  offset: number;
  limit: number;
}): Pick<RecipeSearchResponse, "items" | "next_cursor" | "no_match"> => {
  const remainingItems = filterSessionItems(params.items, params.promotedRecipeIds);
  const pageItems = remainingItems.slice(params.offset, params.offset + params.limit);
  const nextCursor = remainingItems.length > params.offset + params.limit
    ? encodeSearchCursor({
      v: 1,
      kind: "session",
      search_id: params.searchId,
      offset: params.offset + params.limit,
    })
    : null;

  return {
    items: pageItems,
    next_cursor: nextCursor,
    no_match: pageItems.length === 0 ? buildNoMatch("query") : null,
  };
};

export const searchRecipes = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  surface: RecipeSearchSurface;
  query?: string | null;
  presetId?: string | null;
  cursor?: string | null;
  limit?: number | null;
  conversationContext?: RecipeSearchConversationContext;
  modelOverrides?: ModelOverrideMap;
}): Promise<InternalRecipeSearchResponse> => {
  const startedAt = Date.now();
  const limit = clampLimit(params.limit);
  const decodedCursor = decodeSearchCursor(params.cursor);
  if (params.cursor && !decodedCursor) {
    throw new ApiError(
      400,
      "recipe_search_cursor_invalid",
      "Cursor is invalid",
    );
  }

  if (decodedCursor?.kind === "session") {
    const session = await fetchSearchSession({
      serviceClient: params.serviceClient,
      userId: params.userId,
      searchId: decodedCursor.search_id,
    });
    const items = normalizeStoredCards(session.hybrid_items);
    const promotedRecipeIds = Array.isArray(session.page1_promoted_recipe_ids)
      ? session.page1_promoted_recipe_ids
      : [];
    const page = paginateSessionItems({
      searchId: session.id,
      items,
      promotedRecipeIds,
      offset: decodedCursor.offset,
      limit,
    });

    await logSearchEvent({
      serviceClient: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      searchId: session.id,
      surface: session.surface,
      appliedContext: session.applied_context,
      normalizedInput: session.normalized_input,
      latencyMs: Date.now() - startedAt,
      candidateCount: items.length,
      rerankUsed: promotedRecipeIds.length > 0,
      noMatch: page.items.length === 0,
    });

    return {
      search_id: session.id,
      applied_context: session.applied_context,
      items: page.items,
      next_cursor: page.next_cursor,
      no_match: page.no_match,
      internal: {
        interpreted_intent: normalizeSearchIntent({
          appliedContext: session.applied_context,
          normalizedInput: session.normalized_input,
          raw: session.interpreted_intent,
        }),
        rerank_used: promotedRecipeIds.length > 0,
        candidate_count: items.length,
        rationale_tags_by_recipe: {},
      },
    };
  }

  if (decodedCursor?.kind === "all") {
    const session = await fetchSearchSession({
      serviceClient: params.serviceClient,
      userId: params.userId,
      searchId: decodedCursor.search_id,
    });
    const page = await fetchAllFeedPage({
      serviceClient: params.serviceClient,
      searchId: session.id,
      surface: session.surface,
      snapshotCutoffIndexedAt: session.snapshot_cutoff_indexed_at,
      limit,
      cursor: decodedCursor,
    });

    await logSearchEvent({
      serviceClient: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      searchId: session.id,
      surface: session.surface,
      appliedContext: session.applied_context,
      normalizedInput: session.normalized_input,
      latencyMs: Date.now() - startedAt,
      candidateCount: page.items.length,
      rerankUsed: false,
      noMatch: page.items.length === 0,
    });

    return {
      search_id: session.id,
      applied_context: session.applied_context,
      items: page.items,
      next_cursor: page.next_cursor,
      no_match: page.no_match,
      internal: {
        interpreted_intent: null,
        rerank_used: false,
        candidate_count: page.items.length,
        rationale_tags_by_recipe: {},
      },
    };
  }

  const normalizedQuery = normalizeSearchText(params.query);
  const normalizedPresetId = !normalizedQuery
    ? normalizeSearchText(params.presetId)
    : null;
  const appliedContext: RecipeSearchAppliedContext = normalizedQuery
    ? "query"
    : normalizedPresetId
    ? "preset"
    : "all";
  const normalizedInput = normalizedQuery ??
    (normalizedPresetId ? derivePresetText(normalizedPresetId) : null);
  const snapshotCutoffIndexedAt = new Date().toISOString();

  if (appliedContext === "all") {
    const searchId = await createSearchSession({
      serviceClient: params.serviceClient,
      userId: params.userId,
      surface: params.surface,
      appliedContext,
      normalizedInput: null,
      presetId: null,
      interpretedIntent: null,
      queryEmbedding: null,
      snapshotCutoffIndexedAt,
    });

    const page = await fetchAllFeedPage({
      serviceClient: params.serviceClient,
      searchId,
      surface: params.surface,
      snapshotCutoffIndexedAt,
      limit,
      cursor: null,
    });

    await logSearchEvent({
      serviceClient: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      searchId,
      surface: params.surface,
      appliedContext,
      normalizedInput: null,
      latencyMs: Date.now() - startedAt,
      candidateCount: page.items.length,
      rerankUsed: false,
      noMatch: page.items.length === 0,
    });

    return {
      search_id: searchId,
      applied_context: appliedContext,
      items: page.items,
      next_cursor: page.next_cursor,
      no_match: page.no_match,
      internal: {
        interpreted_intent: null,
        rerank_used: false,
        candidate_count: page.items.length,
        rationale_tags_by_recipe: {},
      },
    };
  }

  const interpretedRaw = await llmGateway.interpretRecipeSearch({
    client: params.serviceClient,
    userId: params.userId,
    requestId: params.requestId,
    context: buildInterpretSearchContext({
      surface: params.surface,
      appliedContext,
      normalizedInput: normalizedInput ?? "",
      presetId: normalizedPresetId,
      conversationContext: params.conversationContext,
    }),
    modelOverrides: params.modelOverrides,
  });
  const interpretedIntent = normalizeSearchIntent({
    appliedContext,
    normalizedInput,
    raw: interpretedRaw,
  });

  const embedding = await llmGateway.embedRecipeSearchQuery({
    client: params.serviceClient,
    userId: params.userId,
    requestId: params.requestId,
    inputText: interpretedIntent.normalized_query,
    modelOverrides: params.modelOverrides,
  });
  const hybridItems = await fetchHybridCandidates({
    serviceClient: params.serviceClient,
    surface: params.surface,
    snapshotCutoffIndexedAt,
    intent: interpretedIntent,
    embeddingVector: embedding.vector,
  });

  let page1Items = hybridItems.slice(0, limit);
  let rerankUsed = false;
  let rationaleTagsByRecipe: Record<string, string[]> = {};

  if (hybridItems.length > 1) {
    const rerankCandidates = hybridItems.slice(0, PAGE1_RERANK_LIMIT);
    try {
      const rerankRaw = await llmGateway.rerankRecipeSearch({
        client: params.serviceClient,
        userId: params.userId,
        requestId: params.requestId,
        context: {
          intent: interpretedIntent as unknown as JsonValue,
          candidates: rerankCandidates.map(serializeSearchCard),
        },
        timeoutMs: params.surface === "chat" ? 2_000 : 1_200,
        modelOverrides: params.modelOverrides,
      });
      const reranked = normalizeRerankResult({
        raw: rerankRaw,
        candidates: rerankCandidates,
      });
      rerankUsed = true;
      rationaleTagsByRecipe = reranked.rationaleTagsByRecipe;
      page1Items = reranked.orderedItems.slice(0, limit);
    } catch {
      rerankUsed = false;
    }
  }

  const searchId = await createSearchSession({
    serviceClient: params.serviceClient,
    userId: params.userId,
    surface: params.surface,
    appliedContext,
    normalizedInput: interpretedIntent.normalized_query,
    presetId: normalizedPresetId,
    interpretedIntent,
    queryEmbedding: serializeVector(embedding.vector),
    snapshotCutoffIndexedAt,
    page1PromotedRecipeIds: page1Items.map((item) => item.id),
    hybridItems,
  });

  const nextCursor = filterSessionItems(
      hybridItems,
      page1Items.map((item) => item.id),
    ).length > 0
    ? encodeSearchCursor({
      v: 1,
      kind: "session",
      search_id: searchId,
      offset: 0,
    })
    : null;
  const noMatch = hybridItems.length === 0 ? buildNoMatch(appliedContext) : null;

  await logSearchEvent({
    serviceClient: params.serviceClient,
    userId: params.userId,
    requestId: params.requestId,
    searchId,
    surface: params.surface,
    appliedContext,
    normalizedInput: interpretedIntent.normalized_query,
    latencyMs: Date.now() - startedAt,
    candidateCount: hybridItems.length,
    rerankUsed,
    noMatch: hybridItems.length === 0,
  });

  return {
    search_id: searchId,
    applied_context: appliedContext,
    items: page1Items,
    next_cursor: nextCursor,
    no_match: noMatch,
    internal: {
      interpreted_intent: interpretedIntent,
      rerank_used: rerankUsed,
      candidate_count: hybridItems.length,
      rationale_tags_by_recipe: rationaleTagsByRecipe,
    },
  };
};
