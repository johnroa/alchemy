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
import { canonicalizeRecipePayloadMetadata } from "../recipe-preview.ts";

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

export const normalizeText = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
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

export const normalizeNumber = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export const normalizeInteger = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
};

export const normalizeStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    const normalized = normalizeText(entry);
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

export const stableStringify = (value: JsonValue): string => {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  const entries = Object.entries(value)
    .filter(([, entryValue]) => typeof entryValue !== "undefined")
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entryValue]) =>
    `${JSON.stringify(key)}:${stableStringify(entryValue)}`
  ).join(",")}}`;
};

export const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer)).map((value) =>
    value.toString(16).padStart(2, "0")
  ).join("");

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

export const buildRecipeImageFingerprintPayload = (
  recipe: RecipePayload,
  titleOverride?: string | null,
): JsonValue => {
  const metadata = canonicalizeRecipePayloadMetadata(recipe) ?? {};

  return {
    title: normalizeText(titleOverride) ?? normalizeText(recipe.title) ?? "",
    description: normalizeText(recipe.description),
    servings: normalizeInteger(recipe.servings),
    ingredients: (recipe.ingredients ?? []).map((ingredient) => ({
      name: normalizeText(ingredient.name) ?? "",
      amount: normalizeNumber(ingredient.amount),
      unit: normalizeText(ingredient.unit),
      display_amount: normalizeText(ingredient.display_amount),
      preparation: normalizeText(ingredient.preparation),
      category: normalizeText(ingredient.category),
    })),
    steps: (recipe.steps ?? []).map((step) => ({
      index: normalizeInteger(step.index),
      instruction: normalizeText(step.instruction) ?? "",
      notes: normalizeText(step.notes),
      timer_seconds: normalizeInteger(step.timer_seconds),
      inline_measurements: Array.isArray(step.inline_measurements)
        ? step.inline_measurements.map((measurement) => ({
          ingredient: normalizeText(measurement.ingredient) ?? "",
          amount: normalizeNumber(measurement.amount),
          unit: normalizeText(measurement.unit),
        }))
        : [],
    })),
    notes: normalizeText(recipe.notes),
    pairings: normalizeStringList(recipe.pairings),
    metadata: {
      vibe: normalizeText(metadata.vibe),
      spice_level: normalizeText(metadata.spice_level),
      cuisine_tags: normalizeStringList(metadata.cuisine_tags),
      occasion_tags: normalizeStringList(metadata.occasion_tags),
      diet_tags: normalizeStringList(metadata.diet_tags),
      techniques: normalizeStringList(metadata.techniques),
      flavor_profile: normalizeStringList(metadata.flavor_profile),
    },
  };
};

/**
 * Reuse matching should focus on dish identity and appearance, not discovery
 * text like pairings or optional serving suggestions that can mention other
 * recipes and contaminate nearest-neighbor search.
 */
export const buildImageReuseSearchText = (
  recipe: RecipePayload,
  titleOverride?: string | null,
): string => {
  const metadata = canonicalizeRecipePayloadMetadata(recipe) ?? {};
  const lines = [
    normalizeText(titleOverride) ?? normalizeText(recipe.title) ?? "Untitled Recipe",
    normalizeText(recipe.description),
    ...Array.from(
      new Set(
        (recipe.ingredients ?? []).flatMap((ingredient) => {
          const normalized = normalizeText(ingredient.name);
          return normalized ? [normalized] : [];
        }),
      ),
    ),
    ...normalizeStringList(metadata.cuisine_tags),
    ...normalizeStringList(metadata.techniques),
    ...normalizeStringList(metadata.serving_notes),
    normalizeText(metadata.vibe),
  ];

  const seen = new Set<string>();
  return lines.flatMap((line) => {
    if (!line) {
      return [];
    }
    const key = line.toLowerCase();
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [line];
  }).join("\n");
};

export const buildImageRequestDescriptor = async (
  recipe: RecipePayload,
  titleOverride?: string | null,
): Promise<{
  fingerprint: string;
  normalizedTitle: string;
  normalizedSearchText: string;
  recipePayload: RecipePayload;
}> => {
  const normalizedTitle = normalizeText(titleOverride) ?? normalizeText(recipe.title) ??
    "Untitled Recipe";
  const fingerprintPayload = buildRecipeImageFingerprintPayload(
    recipe,
    normalizedTitle,
  );
  const fingerprint = toHex(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(stableStringify(fingerprintPayload)),
    ),
  );
  const recipePayload = {
    ...recipe,
    title: normalizedTitle,
  };

  return {
    fingerprint,
    normalizedTitle,
    normalizedSearchText: buildImageReuseSearchText(recipePayload, normalizedTitle),
    recipePayload,
  };
};

const hasImageRequestDescriptorMismatch = (
  existing: ImageRequestRow,
  descriptor: ImageRequestDescriptor,
): boolean =>
  existing.normalized_title !== descriptor.normalizedTitle ||
  existing.normalized_search_text !== descriptor.normalizedSearchText;

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
}): Promise<ImageRequestRow> => {
  if (!hasImageRequestDescriptorMismatch(params.existing, params.descriptor)) {
    return params.existing;
  }

  const resetForFreshEvaluation = shouldResetReusedReadyImageRequest(
    params.existing,
    params.descriptor,
  );
  const now = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {
    normalized_title: params.descriptor.normalizedTitle,
    normalized_search_text: params.descriptor.normalizedSearchText,
    recipe_payload: params.descriptor.recipePayload,
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
  "id,recipe_fingerprint,normalized_title,normalized_search_text,recipe_payload,embedding,asset_id,status,resolution_source,reuse_evaluation,attempt,max_attempts,last_error";

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
}): Promise<ImageRequestRow> => {
  const now = new Date().toISOString();
  const { data, error } = await params.serviceClient.from("image_requests")
    .insert({
      recipe_fingerprint: params.descriptor.fingerprint,
      normalized_title: params.descriptor.normalizedTitle,
      normalized_search_text: params.descriptor.normalizedSearchText,
      recipe_payload: params.descriptor.recipePayload,
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
      });
    }
    return existing;
  }

  return await createImageRequest({
    serviceClient: params.serviceClient,
    descriptor,
  });
};
