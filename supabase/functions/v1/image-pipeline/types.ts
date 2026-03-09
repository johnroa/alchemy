/**
 * Image pipeline foundation layer: types, constants, normalizer utilities,
 * row mappers, fingerprinting, and shared data-access functions.
 *
 * Every other module in image-pipeline/ imports from here. This module
 * has no dependencies on sibling modules — only on external shared code.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../../_shared/errors.ts";
import type {
  CandidateRecipeImageStatus,
  JsonValue,
  RecipePayload,
} from "../../_shared/types.ts";
import {
  buildRecipeIdentityDescriptor,
  buildRecipeImageIdentityText,
  type ImageResolutionReason,
  normalizeText,
} from "../lib/recipe-identity.ts";

export { normalizeText };

// ─── Constants ───────────────────────────────────────────────────────────────

export const IMAGE_JOB_LOCK_ID = "v1_image_jobs_process";
export const IMAGE_JOB_LOCK_STALE_MS = 10 * 60 * 1000;
export const IMAGE_JOB_RETRY_BACKOFF_MS = 15 * 1000;
export const RECIPE_IMAGES_BUCKET = "recipe-images";

// ─── Type Definitions ────────────────────────────────────────────────────────

export type ImageRequestStatus = "pending" | "processing" | "ready" | "failed";
export type ResolutionSource = "generated" | "reused";

export type ImageRequestRow = {
  id: string;
  recipe_fingerprint: string;
  image_fingerprint: string;
  normalized_title: string;
  normalized_search_text: string;
  recipe_payload: RecipePayload;
  embedding: string | null;
  asset_id: string | null;
  status: ImageRequestStatus;
  resolution_source: ResolutionSource | null;
  reuse_evaluation: JsonValue;
  attempt: number;
  max_attempts: number;
  last_error: string | null;
  matched_recipe_id: string | null;
  matched_recipe_version_id: string | null;
  resolution_reason: string | null;
  judge_invoked: boolean;
  judge_candidate_count: number;
};

export type ImageAssetRow = {
  id: string;
  image_url: string;
  qa_status: string;
  usage_count: number;
};

export type ImageJobRow = {
  id: string;
  image_request_id: string;
  status: ImageRequestStatus;
  attempt: number;
  max_attempts: number;
  next_attempt_at: string;
  locked_at: string | null;
  last_error: string | null;
};

export type CandidateBindingRow = {
  component_id: string;
  image_request_id: string;
};

export type ImageRequestHydration = {
  requestId: string;
  assetId: string | null;
  imageUrl: string | null;
  status: CandidateRecipeImageStatus;
};

export type ReuseCandidateRow = {
  image_request_id: string;
  asset_id: string;
  image_url: string;
  normalized_title: string;
  recipe_id: string | null;
  recipe_version_id: string | null;
  similarity: number | null;
  usage_count: number | null;
};

type ImageRequestDescriptor = Awaited<ReturnType<typeof buildImageRequestDescriptor>>;

// ─── Utility Functions ───────────────────────────────────────────────────────

export const asRecord = (value: unknown): Record<string, JsonValue> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, JsonValue>;
};

export const normalizeStatus = (value: unknown): CandidateRecipeImageStatus => {
  const normalized = normalizeText(value)?.toLowerCase();
  if (
    normalized === "pending" || normalized === "processing" ||
    normalized === "ready" || normalized === "failed"
  ) {
    return normalized;
  }
  return "pending";
};

export const serializeVector = (vector: number[]): string => {
  return `[${vector.map((value) => Number(value).toFixed(12)).join(",")}]`;
};

export const parseVector = (value: string | null): number[] | null => {
  const normalized = normalizeText(value);
  if (!normalized || !normalized.startsWith("[") || !normalized.endsWith("]")) {
    return null;
  }

  const parsed = normalized.slice(1, -1).split(",")
    .map((entry) => Number(entry.trim()));
  return parsed.length > 0 && parsed.every((entry) => Number.isFinite(entry))
    ? parsed
    : null;
};

// ─── Fingerprinting ──────────────────────────────────────────────────────────

/**
 * Reuse matching should focus on dish identity and appearance, not discovery
 * text like pairings or optional serving suggestions that can mention other
 * recipes and contaminate nearest-neighbor search.
 */
export const buildImageReuseSearchText = (
  recipe: RecipePayload,
  titleOverride?: string | null,
): string => {
  const normalizedTitle = normalizeText(titleOverride) ?? normalizeText(recipe.title) ??
    "Untitled Recipe";
  const canonicalIngredientNames = (recipe.ingredients ?? []).flatMap((ingredient) => {
    const normalized = normalizeText(ingredient.name);
    return normalized ? [normalized] : [];
  });
  return buildRecipeImageIdentityText(
    { ...recipe, title: normalizedTitle },
    canonicalIngredientNames,
    normalizedTitle,
  );
};

export const buildImageRequestDescriptor = async (
  recipe: RecipePayload,
  titleOverride?: string | null,
): Promise<{
  fingerprint: string;
  imageFingerprint: string;
  normalizedTitle: string;
  normalizedSearchText: string;
  recipePayload: RecipePayload;
}> => {
  const descriptor = await buildRecipeIdentityDescriptor({
    recipe,
    titleOverride,
  });

  return {
    fingerprint: descriptor.contentFingerprint,
    imageFingerprint: descriptor.imageFingerprint,
    normalizedTitle: descriptor.normalizedTitle,
    normalizedSearchText: descriptor.imageIdentityText,
    recipePayload: descriptor.recipePayload,
  };
};

const hasImageRequestDescriptorMismatch = (
  existing: ImageRequestRow,
  descriptor: ImageRequestDescriptor,
): boolean =>
  existing.image_fingerprint !== descriptor.imageFingerprint ||
  existing.normalized_title !== descriptor.normalizedTitle ||
  existing.normalized_search_text !== descriptor.normalizedSearchText;

const hasImageRequestResolutionContextMismatch = (
  existing: ImageRequestRow,
  matchedRecipeId?: string | null,
  matchedRecipeVersionId?: string | null,
  resolutionReason?: string | null,
): boolean =>
  (matchedRecipeId ?? null) !== existing.matched_recipe_id ||
  (matchedRecipeVersionId ?? null) !== existing.matched_recipe_version_id ||
  (resolutionReason ?? null) !== existing.resolution_reason;

export const shouldResetReusedReadyImageRequest = (
  existing: ImageRequestRow,
  descriptor: ImageRequestDescriptor,
): boolean =>
  existing.status === "ready" &&
  existing.resolution_source === "reused" &&
  hasImageRequestDescriptorMismatch(existing, descriptor);

export const reconcileImageRequestDescriptor = async (params: {
  serviceClient: SupabaseClient;
  existing: ImageRequestRow;
  descriptor: ImageRequestDescriptor;
  matchedRecipeId?: string | null;
  matchedRecipeVersionId?: string | null;
  resolutionReason?: string | null;
}): Promise<ImageRequestRow> => {
  if (
    !hasImageRequestDescriptorMismatch(params.existing, params.descriptor) &&
    !hasImageRequestResolutionContextMismatch(
      params.existing,
      params.matchedRecipeId,
      params.matchedRecipeVersionId,
      params.resolutionReason,
    )
  ) {
    return params.existing;
  }

  const resetForFreshEvaluation = shouldResetReusedReadyImageRequest(
    params.existing,
    params.descriptor,
  );
  const now = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {
    image_fingerprint: params.descriptor.imageFingerprint,
    normalized_title: params.descriptor.normalizedTitle,
    normalized_search_text: params.descriptor.normalizedSearchText,
    recipe_payload: params.descriptor.recipePayload,
    matched_recipe_id: params.matchedRecipeId ?? null,
    matched_recipe_version_id: params.matchedRecipeVersionId ?? null,
    resolution_reason: params.resolutionReason ?? null,
    updated_at: now,
  };

  if (resetForFreshEvaluation) {
    Object.assign(updatePayload, {
      asset_id: null,
      status: "pending",
      resolution_source: null,
      reuse_evaluation: {},
      last_error: null,
      attempt: 0,
    });
  }

  await params.serviceClient.from("image_requests").update(updatePayload).eq(
    "id",
    params.existing.id,
  );

  return await loadImageRequestById(params.serviceClient, params.existing.id) ??
    params.existing;
};

// ─── Row Mappers ─────────────────────────────────────────────────────────────

export const mapImageRequestRow = (row: Record<string, unknown>): ImageRequestRow => {
  return {
    id: String(row.id),
    recipe_fingerprint: String(row.recipe_fingerprint),
    image_fingerprint: String(row.image_fingerprint ?? ""),
    normalized_title: String(row.normalized_title ?? ""),
    normalized_search_text: String(row.normalized_search_text ?? ""),
    recipe_payload: (row.recipe_payload as RecipePayload) ?? {
      title: "",
      servings: 1,
      ingredients: [],
      steps: [],
    },
    embedding: typeof row.embedding === "string" ? row.embedding : null,
    asset_id: typeof row.asset_id === "string" ? row.asset_id : null,
    status: normalizeStatus(row.status),
    resolution_source: row.resolution_source === "generated" ||
        row.resolution_source === "reused"
      ? row.resolution_source
      : null,
    reuse_evaluation: row.reuse_evaluation as JsonValue,
    attempt: Number(row.attempt ?? 0),
    max_attempts: Number(row.max_attempts ?? 5),
    last_error: normalizeText(row.last_error),
    matched_recipe_id: normalizeText(row.matched_recipe_id),
    matched_recipe_version_id: normalizeText(row.matched_recipe_version_id),
    resolution_reason: normalizeText(row.resolution_reason),
    judge_invoked: Boolean(row.judge_invoked),
    judge_candidate_count: Number(row.judge_candidate_count ?? 0),
  };
};

export const mapImageAssetRow = (row: Record<string, unknown>): ImageAssetRow => ({
  id: String(row.id),
  image_url: String(row.image_url),
  qa_status: String(row.qa_status ?? "unreviewed"),
  usage_count: Number(row.usage_count ?? 0),
});

export const hydrateStatusFromRequest = (
  request: ImageRequestRow | null,
  asset: ImageAssetRow | null,
): ImageRequestHydration => {
  if (!request) {
    return {
      requestId: "",
      assetId: null,
      imageUrl: null,
      status: "pending",
    };
  }

  return {
    requestId: request.id,
    assetId: request.asset_id,
    imageUrl: request.status === "ready" && asset?.image_url
      ? asset.image_url
      : null,
    status: request.status,
  };
};

export const parseReuseMetadata = (value: JsonValue): {
  reusedFromRecipeId: string | null;
  reusedFromRecipeVersionId: string | null;
} => {
  const record = asRecord(value);
  return {
    reusedFromRecipeId: normalizeText(record?.reused_from_recipe_id),
    reusedFromRecipeVersionId: normalizeText(record?.reused_from_recipe_version_id),
  };
};

// ─── Data Access ─────────────────────────────────────────────────────────────

/** Select column list reused by all image_requests queries. */
const IMAGE_REQUEST_COLUMNS =
  "id,recipe_fingerprint,image_fingerprint,normalized_title,normalized_search_text,recipe_payload,embedding,asset_id,status,resolution_source,reuse_evaluation,attempt,max_attempts,last_error,matched_recipe_id,matched_recipe_version_id,resolution_reason,judge_invoked,judge_candidate_count";

export const loadImageRequestByFingerprint = async (
  serviceClient: SupabaseClient,
  fingerprint: string,
): Promise<ImageRequestRow | null> => {
  const { data, error } = await serviceClient.from("image_requests")
    .select(IMAGE_REQUEST_COLUMNS)
    .eq("recipe_fingerprint", fingerprint)
    .maybeSingle();

  if (error) {
    throw new ApiError(
      500,
      "image_request_lookup_failed",
      "Could not load image request",
      error.message,
    );
  }

  return data ? mapImageRequestRow(data as Record<string, unknown>) : null;
};

export const loadImageRequestById = async (
  serviceClient: SupabaseClient,
  imageRequestId: string,
): Promise<ImageRequestRow | null> => {
  const { data, error } = await serviceClient.from("image_requests")
    .select(IMAGE_REQUEST_COLUMNS)
    .eq("id", imageRequestId)
    .maybeSingle();

  if (error) {
    throw new ApiError(
      500,
      "image_request_lookup_failed",
      "Could not load image request",
      error.message,
    );
  }

  return data ? mapImageRequestRow(data as Record<string, unknown>) : null;
};

export const loadImageAssets = async (
  serviceClient: SupabaseClient,
  assetIds: string[],
): Promise<Map<string, ImageAssetRow>> => {
  if (assetIds.length === 0) {
    return new Map();
  }

  const { data, error } = await serviceClient.from("recipe_image_assets")
    .select("id,image_url,qa_status,usage_count")
    .in("id", assetIds);

  if (error) {
    throw new ApiError(
      500,
      "image_asset_lookup_failed",
      "Could not load image assets",
      error.message,
    );
  }

  return new Map(
    (data ?? []).map((row) => {
      const mapped = mapImageAssetRow(row as Record<string, unknown>);
      return [mapped.id, mapped];
    }),
  );
};

// ─── Image Request CRUD ──────────────────────────────────────────────────────

export const createImageRequest = async (params: {
  serviceClient: SupabaseClient;
  descriptor: Awaited<ReturnType<typeof buildImageRequestDescriptor>>;
  matchedRecipeId?: string | null;
  matchedRecipeVersionId?: string | null;
  resolutionReason?: ImageResolutionReason | null;
}): Promise<ImageRequestRow> => {
  const now = new Date().toISOString();
  const { data, error } = await params.serviceClient.from("image_requests")
    .insert({
      recipe_fingerprint: params.descriptor.fingerprint,
      image_fingerprint: params.descriptor.imageFingerprint,
      normalized_title: params.descriptor.normalizedTitle,
      normalized_search_text: params.descriptor.normalizedSearchText,
      recipe_payload: params.descriptor.recipePayload,
      matched_recipe_id: params.matchedRecipeId ?? null,
      matched_recipe_version_id: params.matchedRecipeVersionId ?? null,
      resolution_reason: params.resolutionReason ?? null,
      status: "pending",
      updated_at: now,
    })
    .select(IMAGE_REQUEST_COLUMNS)
    .single();

  if (error) {
    const fallback = await loadImageRequestByFingerprint(
      params.serviceClient,
      params.descriptor.fingerprint,
    );
    if (fallback) {
      return fallback;
    }
    throw new ApiError(
      500,
      "image_request_create_failed",
      "Could not create image request",
      error.message,
    );
  }

  return mapImageRequestRow(data as Record<string, unknown>);
};

export const ensureImageRequestForRecipe = async (params: {
  serviceClient: SupabaseClient;
  recipe: RecipePayload;
  titleOverride?: string | null;
  matchedRecipeId?: string | null;
  matchedRecipeVersionId?: string | null;
  resolutionReason?: ImageResolutionReason | null;
}): Promise<ImageRequestRow> => {
  const descriptor = await buildImageRequestDescriptor(
    params.recipe,
    params.titleOverride,
  );
  const existing = await loadImageRequestByFingerprint(
    params.serviceClient,
    descriptor.fingerprint,
  );
  if (existing) {
    if (
      existing.status === "pending" ||
      existing.status === "failed" ||
      shouldResetReusedReadyImageRequest(existing, descriptor)
    ) {
      return await reconcileImageRequestDescriptor({
        serviceClient: params.serviceClient,
        existing,
        descriptor,
        matchedRecipeId: params.matchedRecipeId,
        matchedRecipeVersionId: params.matchedRecipeVersionId,
        resolutionReason: params.resolutionReason,
      });
    }
    if (
      hasImageRequestResolutionContextMismatch(
        existing,
        params.matchedRecipeId,
        params.matchedRecipeVersionId,
        params.resolutionReason,
      )
    ) {
      return await reconcileImageRequestDescriptor({
        serviceClient: params.serviceClient,
        existing,
        descriptor,
        matchedRecipeId: params.matchedRecipeId,
        matchedRecipeVersionId: params.matchedRecipeVersionId,
        resolutionReason: params.resolutionReason,
      });
    }
    return existing;
  }

  return await createImageRequest({
    serviceClient: params.serviceClient,
    descriptor,
    matchedRecipeId: params.matchedRecipeId,
    matchedRecipeVersionId: params.matchedRecipeVersionId,
    resolutionReason: params.resolutionReason,
  });
};
