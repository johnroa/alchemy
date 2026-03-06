import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../_shared/errors.ts";
import { llmGateway, type ModelOverrideMap } from "../_shared/llm-gateway.ts";
import type {
  CandidateRecipeImageStatus,
  CandidateRecipeSet,
  JsonValue,
  RecipePayload,
} from "../_shared/types.ts";
import { canonicalizeRecipePayloadMetadata } from "./recipe-preview.ts";
import { buildRecipeSearchDocument, loadRecipeSearchDocumentSource, upsertRecipeSearchDocument } from "./recipe-search.ts";

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const IMAGE_JOB_LOCK_ID = "v1_image_jobs_process";
const IMAGE_JOB_LOCK_STALE_MS = 10 * 60 * 1000;
const IMAGE_JOB_RETRY_BACKOFF_MS = 15 * 1000;
const RECIPE_IMAGES_BUCKET = "recipe-images";

/**
 * If the image URL is a base64 data URI, upload it to Supabase Storage
 * and return the public HTTPS URL. Pass-through for regular URLs.
 */
const persistImageToStorage = async (
  serviceClient: SupabaseClient,
  imageUrl: string,
  imageRequestId: string,
): Promise<string> => {
  if (!imageUrl.startsWith("data:")) {
    return imageUrl;
  }

  const match = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) {
    return imageUrl;
  }

  const extension = match[1] === "jpeg" ? "jpg" : match[1];
  const base64Data = match[2];
  const binaryData = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
  const filePath = `${imageRequestId}.${extension}`;

  const { error: uploadError } = await serviceClient.storage
    .from(RECIPE_IMAGES_BUCKET)
    .upload(filePath, binaryData, {
      contentType: `image/${match[1]}`,
      upsert: true,
    });

  if (uploadError) {
    throw new ApiError(
      500,
      "image_storage_upload_failed",
      "Could not upload image to storage",
      uploadError.message,
    );
  }

  const { data: publicUrlData } = serviceClient.storage
    .from(RECIPE_IMAGES_BUCKET)
    .getPublicUrl(filePath);

  return publicUrlData.publicUrl;
};

type ImageRequestStatus = "pending" | "processing" | "ready" | "failed";
type ResolutionSource = "generated" | "reused";

type ImageRequestRow = {
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

type ImageAssetRow = {
  id: string;
  image_url: string;
  qa_status: string;
  usage_count: number;
};

type ImageJobRow = {
  id: string;
  image_request_id: string;
  status: ImageRequestStatus;
  attempt: number;
  max_attempts: number;
  next_attempt_at: string;
  locked_at: string | null;
  last_error: string | null;
};

type CandidateBindingRow = {
  component_id: string;
  image_request_id: string;
};

type ImageRequestHydration = {
  requestId: string;
  assetId: string | null;
  imageUrl: string | null;
  status: CandidateRecipeImageStatus;
};

type ReuseCandidateRow = {
  image_request_id: string;
  asset_id: string;
  image_url: string;
  normalized_title: string;
  recipe_id: string | null;
  recipe_version_id: string | null;
  similarity: number | null;
  usage_count: number | null;
};

const asRecord = (value: unknown): Record<string, JsonValue> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, JsonValue>;
};

const normalizeText = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
};

const normalizeStatus = (value: unknown): CandidateRecipeImageStatus => {
  const normalized = normalizeText(value)?.toLowerCase();
  if (
    normalized === "pending" || normalized === "processing" ||
    normalized === "ready" || normalized === "failed"
  ) {
    return normalized;
  }
  return "pending";
};

const normalizeNumber = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeInteger = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
};

const normalizeStringList = (value: unknown): string[] => {
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

const stableStringify = (value: JsonValue): string => {
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

const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer)).map((value) =>
    value.toString(16).padStart(2, "0")
  ).join("");

const serializeVector = (vector: number[]): string => {
  return `[${vector.map((value) => Number(value).toFixed(12)).join(",")}]`;
};

const parseVector = (value: string | null): number[] | null => {
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

const buildRecipeImageFingerprintPayload = (
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

const buildImageRequestDescriptor = async (
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
  const canonicalIngredientNames = Array.from(
    new Set(
      (recipe.ingredients ?? []).flatMap((ingredient) => {
        const normalized = normalizeText(ingredient.name);
        return normalized ? [normalized] : [];
      }),
    ),
  );
  const searchDocument = buildRecipeSearchDocument({
    recipeId: ZERO_UUID,
    recipeVersionId: ZERO_UUID,
    category: null,
    visibility: "private",
    updatedAt: new Date(0).toISOString(),
    imageUrl: null,
    imageStatus: "pending",
    payload: {
      ...recipe,
      title: normalizedTitle,
    },
    canonicalIngredientIds: [],
    canonicalIngredientNames,
    ontologyTermKeys: [],
  });

  return {
    fingerprint,
    normalizedTitle,
    normalizedSearchText: searchDocument.search_text,
    recipePayload: {
      ...recipe,
      title: normalizedTitle,
    },
  };
};

const mapImageRequestRow = (row: Record<string, unknown>): ImageRequestRow => {
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

const mapImageAssetRow = (row: Record<string, unknown>): ImageAssetRow => ({
  id: String(row.id),
  image_url: String(row.image_url),
  qa_status: String(row.qa_status ?? "unreviewed"),
  usage_count: Number(row.usage_count ?? 0),
});

const hydrateStatusFromRequest = (
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

const parseReuseMetadata = (value: JsonValue): {
  reusedFromRecipeId: string | null;
  reusedFromRecipeVersionId: string | null;
} => {
  const record = asRecord(value);
  return {
    reusedFromRecipeId: normalizeText(record?.reused_from_recipe_id),
    reusedFromRecipeVersionId: normalizeText(record?.reused_from_recipe_version_id),
  };
};

const loadImageRequestByFingerprint = async (
  serviceClient: SupabaseClient,
  fingerprint: string,
): Promise<ImageRequestRow | null> => {
  const { data, error } = await serviceClient.from("image_requests")
    .select(
      "id,recipe_fingerprint,normalized_title,normalized_search_text,recipe_payload,embedding,asset_id,status,resolution_source,reuse_evaluation,attempt,max_attempts,last_error",
    )
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

const loadImageRequestById = async (
  serviceClient: SupabaseClient,
  imageRequestId: string,
): Promise<ImageRequestRow | null> => {
  const { data, error } = await serviceClient.from("image_requests")
    .select(
      "id,recipe_fingerprint,normalized_title,normalized_search_text,recipe_payload,embedding,asset_id,status,resolution_source,reuse_evaluation,attempt,max_attempts,last_error",
    )
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

const loadImageAssets = async (
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

const createImageRequest = async (params: {
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
    .select(
      "id,recipe_fingerprint,normalized_title,normalized_search_text,recipe_payload,embedding,asset_id,status,resolution_source,reuse_evaluation,attempt,max_attempts,last_error",
    )
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

const ensureImageRequestForRecipe = async (params: {
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
      (existing.status === "pending" || existing.status === "failed") &&
      (existing.normalized_title !== descriptor.normalizedTitle ||
        existing.normalized_search_text !== descriptor.normalizedSearchText)
    ) {
      await params.serviceClient.from("image_requests").update({
        normalized_title: descriptor.normalizedTitle,
        normalized_search_text: descriptor.normalizedSearchText,
        recipe_payload: descriptor.recipePayload,
        updated_at: new Date().toISOString(),
      }).eq("id", existing.id);
      const refreshed = await loadImageRequestById(params.serviceClient, existing.id);
      if (refreshed) {
        return refreshed;
      }
    }
    return existing;
  }

  return await createImageRequest({
    serviceClient: params.serviceClient,
    descriptor,
  });
};

export const enqueueImageRequestJob = async (
  serviceClient: SupabaseClient,
  imageRequestId: string,
  errorMessage?: string,
): Promise<void> => {
  const now = new Date().toISOString();
  const { error } = await serviceClient.from("image_jobs").upsert(
    {
      image_request_id: imageRequestId,
      status: "pending",
      next_attempt_at: now,
      last_error: errorMessage ?? null,
      locked_at: null,
      locked_by: null,
      updated_at: now,
    },
    { onConflict: "image_request_id" },
  );

  if (error) {
    console.error("image_job_enqueue_failed", error);
  }
};

const touchCandidateBinding = async (params: {
  serviceClient: SupabaseClient;
  chatId: string;
  candidateId: string;
  candidateRevision: number;
  componentId: string;
  imageRequestId: string;
}): Promise<void> => {
  const { error } = await params.serviceClient.from("candidate_image_bindings")
    .upsert({
      chat_session_id: params.chatId,
      candidate_id: params.candidateId,
      candidate_revision: params.candidateRevision,
      component_id: params.componentId,
      image_request_id: params.imageRequestId,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "chat_session_id,candidate_id,candidate_revision,component_id",
    });

  if (error) {
    throw new ApiError(
      500,
      "candidate_image_binding_failed",
      "Could not store candidate image binding",
      error.message,
    );
  }
};

export const hydrateCandidateRecipeSetImages = async (params: {
  serviceClient: SupabaseClient;
  chatId: string;
  candidateSet: CandidateRecipeSet;
}): Promise<CandidateRecipeSet> => {
  const componentIds = params.candidateSet.components.map((component) =>
    component.component_id
  );
  if (componentIds.length === 0) {
    return params.candidateSet;
  }

  const { data: bindings, error: bindingsError } = await params.serviceClient
    .from("candidate_image_bindings")
    .select("component_id,image_request_id")
    .eq("chat_session_id", params.chatId)
    .eq("candidate_id", params.candidateSet.candidate_id)
    .eq("candidate_revision", params.candidateSet.revision)
    .in("component_id", componentIds);

  if (bindingsError) {
    throw new ApiError(
      500,
      "candidate_image_binding_lookup_failed",
      "Could not load candidate image bindings",
      bindingsError.message,
    );
  }

  const bindingRows = (bindings ?? []) as CandidateBindingRow[];
  const bindingByComponentId = new Map(
    bindingRows.map((row) => [String(row.component_id), String(row.image_request_id)]),
  );
  const requestIds = Array.from(
    new Set(
      bindingRows.map((row) => String(row.image_request_id)).filter((value) =>
        value.length > 0
      ),
    ),
  );

  const { data: requestRows, error: requestError } = requestIds.length === 0
    ? { data: [] as Record<string, unknown>[], error: null }
    : await params.serviceClient.from("image_requests")
      .select(
        "id,recipe_fingerprint,normalized_title,normalized_search_text,recipe_payload,embedding,asset_id,status,resolution_source,reuse_evaluation,attempt,max_attempts,last_error",
      )
      .in("id", requestIds);

  if (requestError) {
    throw new ApiError(
      500,
      "candidate_image_request_lookup_failed",
      "Could not load image requests for candidate hydration",
      requestError.message,
    );
  }

  const requestsById = new Map(
    (requestRows ?? []).map((row) => {
      const mapped = mapImageRequestRow(row as Record<string, unknown>);
      return [mapped.id, mapped];
    }),
  );
  const assetsById = await loadImageAssets(
    params.serviceClient,
    Array.from(
      new Set(
        [...requestsById.values()].flatMap((request) =>
          request.asset_id ? [request.asset_id] : []
        ),
      ),
    ),
  );

  return {
    ...params.candidateSet,
    components: params.candidateSet.components.map((component) => {
      const imageRequestId = bindingByComponentId.get(component.component_id);
      const request = imageRequestId ? requestsById.get(imageRequestId) ?? null : null;
      const asset = request?.asset_id ? assetsById.get(request.asset_id) ?? null : null;
      const hydration = hydrateStatusFromRequest(request, asset);
      return {
        ...component,
        image_url: hydration.imageUrl,
        image_status: hydration.status,
      };
    }),
  };
};

export const enrollCandidateImageRequests = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  chatId: string;
  candidateSet: CandidateRecipeSet;
}): Promise<CandidateRecipeSet> => {
  for (const component of params.candidateSet.components) {
    const request = await ensureImageRequestForRecipe({
      serviceClient: params.serviceClient,
      recipe: component.recipe,
      titleOverride: component.title,
    });

    await touchCandidateBinding({
      serviceClient: params.serviceClient,
      chatId: params.chatId,
      candidateId: params.candidateSet.candidate_id,
      candidateRevision: params.candidateSet.revision,
      componentId: component.component_id,
      imageRequestId: request.id,
    });

    if (request.status !== "ready") {
      await enqueueImageRequestJob(params.serviceClient, request.id);
    }
  }

  return await hydrateCandidateRecipeSetImages({
    serviceClient: params.serviceClient,
    chatId: params.chatId,
    candidateSet: params.candidateSet,
  });
};

const createRecipeImageAsset = async (params: {
  serviceClient: SupabaseClient;
  imageUrl: string;
  provider: string;
  model: string;
  generationPrompt: string;
  generationMetadata: Record<string, JsonValue>;
  sourceRecipeId?: string | null;
  sourceRecipeVersionId?: string | null;
}): Promise<ImageAssetRow> => {
  const { data, error } = await params.serviceClient.from("recipe_image_assets")
    .insert({
      image_url: params.imageUrl,
      source_provider: params.provider,
      source_model: params.model,
      source_recipe_id: params.sourceRecipeId ?? null,
      source_recipe_version_id: params.sourceRecipeVersionId ?? null,
      generation_prompt: params.generationPrompt,
      generation_metadata: params.generationMetadata,
      qa_status: "unreviewed",
      usage_count: 0,
    })
    .select("id,image_url,qa_status,usage_count")
    .single();

  if (error || !data) {
    throw new ApiError(
      500,
      "image_asset_create_failed",
      "Could not create image asset",
      error?.message,
    );
  }

  return mapImageAssetRow(data as Record<string, unknown>);
};

const updateAssetUsageCounts = async (params: {
  serviceClient: SupabaseClient;
  previousAssetId: string | null;
  nextAssetId: string;
}): Promise<void> => {
  if (params.previousAssetId && params.previousAssetId !== params.nextAssetId) {
    const { data: previousRow } = await params.serviceClient.from("recipe_image_assets")
      .select("usage_count")
      .eq("id", params.previousAssetId)
      .maybeSingle();
    const previousUsage = Math.max(0, Number(previousRow?.usage_count ?? 0) - 1);
    await params.serviceClient.from("recipe_image_assets").update({
      usage_count: previousUsage,
      updated_at: new Date().toISOString(),
    }).eq("id", params.previousAssetId);
  }

  if (params.previousAssetId !== params.nextAssetId) {
    const { data: nextRow } = await params.serviceClient.from("recipe_image_assets")
      .select("usage_count")
      .eq("id", params.nextAssetId)
      .maybeSingle();
    const nextUsage = Number(nextRow?.usage_count ?? 0) + 1;
    await params.serviceClient.from("recipe_image_assets").update({
      usage_count: nextUsage,
      updated_at: new Date().toISOString(),
    }).eq("id", params.nextAssetId);
  }
};

const refreshPersistedRecipeImagesForRequest = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  imageRequest: ImageRequestRow;
  asset: ImageAssetRow | null;
}): Promise<void> => {
  const { data: assignments, error: assignmentsError } = await params.serviceClient
    .from("recipe_image_assignments")
    .select("id,recipe_id,recipe_version_id")
    .eq("image_request_id", params.imageRequest.id);

  if (assignmentsError) {
    throw new ApiError(
      500,
      "recipe_image_assignments_lookup_failed",
      "Could not load recipe image assignments",
      assignmentsError.message,
    );
  }

  if (!assignments || assignments.length === 0) {
    return;
  }

  const reuseMetadata = parseReuseMetadata(params.imageRequest.reuse_evaluation);
  const assignmentUpdate =
    params.imageRequest.status === "ready" && params.imageRequest.asset_id
      ? {
        asset_id: params.imageRequest.asset_id,
        assignment_source: params.imageRequest.resolution_source,
        reused_from_recipe_id: reuseMetadata.reusedFromRecipeId,
        reused_from_recipe_version_id: reuseMetadata.reusedFromRecipeVersionId,
        reuse_evaluation: params.imageRequest.reuse_evaluation ?? {},
        updated_at: new Date().toISOString(),
      }
      : {
        asset_id: null,
        assignment_source: null,
        reused_from_recipe_id: null,
        reused_from_recipe_version_id: null,
        reuse_evaluation: params.imageRequest.reuse_evaluation ?? {},
        updated_at: new Date().toISOString(),
      };

  await params.serviceClient.from("recipe_image_assignments").update(assignmentUpdate)
    .eq("image_request_id", params.imageRequest.id);

  const recipeIds = Array.from(
    new Set(assignments.map((assignment) => String(assignment.recipe_id))),
  );
  const { data: recipes, error: recipesError } = await params.serviceClient
    .from("recipes")
    .select("id,current_version_id")
    .in("id", recipeIds);

  if (recipesError) {
    throw new ApiError(
      500,
      "recipe_projection_lookup_failed",
      "Could not load recipes for image projection",
      recipesError.message,
    );
  }

  const currentVersionByRecipe = new Map(
    (recipes ?? []).map((recipe) => [String(recipe.id), normalizeText(recipe.current_version_id)]),
  );
  const statusForRecipe = params.imageRequest.status === "ready"
    ? "ready"
    : params.imageRequest.status === "failed"
    ? "failed"
    : "pending";

  for (const assignment of assignments) {
    const recipeId = String(assignment.recipe_id);
    const recipeVersionId = String(assignment.recipe_version_id);
    if (currentVersionByRecipe.get(recipeId) !== recipeVersionId) {
      continue;
    }

    const updatePayload = params.imageRequest.status === "ready" && params.asset?.image_url
      ? {
        hero_image_url: params.asset.image_url,
        image_status: "ready",
        image_last_error: null,
        image_updated_at: new Date().toISOString(),
        image_generation_attempts: params.imageRequest.attempt,
        updated_at: new Date().toISOString(),
      }
      : {
        hero_image_url: null,
        image_status: statusForRecipe,
        image_last_error: params.imageRequest.status === "failed"
          ? params.imageRequest.last_error
          : null,
        image_updated_at: new Date().toISOString(),
        image_generation_attempts: params.imageRequest.attempt,
        updated_at: new Date().toISOString(),
      };

    const { error: recipeUpdateError } = await params.serviceClient.from("recipes")
      .update(updatePayload)
      .eq("id", recipeId);

    if (recipeUpdateError) {
      throw new ApiError(
        500,
        "recipe_image_projection_failed",
        "Could not project image state onto recipe",
        recipeUpdateError.message,
      );
    }

    const source = await loadRecipeSearchDocumentSource({
      serviceClient: params.serviceClient,
      recipeId,
      recipeVersionId,
    });

    await upsertRecipeSearchDocument({
      serviceClient: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      source,
    });
  }
};

const resolveImageRequestToAsset = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  imageRequest: ImageRequestRow;
  assetId: string;
  resolutionSource: ResolutionSource;
  reuseEvaluation: Record<string, JsonValue>;
  asset?: ImageAssetRow | null;
}): Promise<void> => {
  const previousAssetId = params.imageRequest.asset_id;
  const now = new Date().toISOString();
  const { error } = await params.serviceClient.from("image_requests").update({
    asset_id: params.assetId,
    status: "ready",
    resolution_source: params.resolutionSource,
    reuse_evaluation: params.reuseEvaluation,
    last_error: null,
    last_processed_at: now,
    updated_at: now,
  }).eq("id", params.imageRequest.id);

  if (error) {
    throw new ApiError(
      500,
      "image_request_resolution_failed",
      "Could not resolve image request",
      error.message,
    );
  }

  await updateAssetUsageCounts({
    serviceClient: params.serviceClient,
    previousAssetId,
    nextAssetId: params.assetId,
  });

  await params.serviceClient.from("image_jobs").update({
    status: "ready",
    last_error: null,
    locked_at: null,
    locked_by: null,
    updated_at: now,
  }).eq("image_request_id", params.imageRequest.id);

  const asset = params.asset ??
    (await loadImageAssets(params.serviceClient, [params.assetId])).get(params.assetId) ??
    null;
  const refreshed = await loadImageRequestById(
    params.serviceClient,
    params.imageRequest.id,
  );
  if (!refreshed) {
    throw new ApiError(
      500,
      "image_request_resolution_missing",
      "Resolved image request could not be reloaded",
    );
  }

  await refreshPersistedRecipeImagesForRequest({
    serviceClient: params.serviceClient,
    userId: params.userId,
    requestId: params.requestId,
    imageRequest: refreshed,
    asset,
  });
};

const markImageJobState = async (params: {
  serviceClient: SupabaseClient;
  jobId: string;
  status: ImageRequestStatus;
  message: string | null;
  attempt: number;
  maxAttempts: number;
}): Promise<void> => {
  const terminalFailure = params.status === "failed" || params.attempt >= params.maxAttempts;
  await params.serviceClient.from("image_jobs").update({
    status: terminalFailure ? "failed" : params.status,
    attempt: params.attempt,
    last_error: params.message,
    next_attempt_at: terminalFailure
      ? new Date().toISOString()
      : new Date(Date.now() + IMAGE_JOB_RETRY_BACKOFF_MS).toISOString(),
    locked_at: null,
    locked_by: null,
    updated_at: new Date().toISOString(),
  }).eq("id", params.jobId);
};

const shortlistReuseCandidates = async (params: {
  serviceClient: SupabaseClient;
  imageRequestId: string;
  embeddingVector: number[];
}): Promise<ReuseCandidateRow[]> => {
  const { data, error } = await params.serviceClient.rpc(
    "list_image_reuse_candidates",
    {
      p_query_embedding: serializeVector(params.embeddingVector),
      p_exclude_request_id: params.imageRequestId,
      p_limit: 5,
    },
  );

  if (error) {
    throw new ApiError(
      500,
      "image_reuse_candidates_failed",
      "Could not load image reuse candidates",
      error.message,
    );
  }

  return Array.isArray(data)
    ? (data as ReuseCandidateRow[])
    : [];
};

const resolveReuseCandidate = (
  shortlist: ReuseCandidateRow[],
  selectedCandidateId: string | null,
): ReuseCandidateRow | null => {
  if (!selectedCandidateId) {
    return null;
  }
  return shortlist.find((candidate) =>
    candidate.image_request_id === selectedCandidateId
  ) ?? null;
};

const claimImageJobs = async (params: {
  serviceClient: SupabaseClient;
  limit: number;
}): Promise<ImageJobRow[]> => {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - IMAGE_JOB_LOCK_STALE_MS).toISOString();
  const { data, error } = await params.serviceClient.from("image_jobs")
    .select(
      "id,image_request_id,status,attempt,max_attempts,next_attempt_at,locked_at,last_error",
    )
    .in("status", ["pending", "failed"])
    .lte("next_attempt_at", now.toISOString())
    .or(`locked_at.is.null,locked_at.lt.${staleBefore}`)
    .order("next_attempt_at", { ascending: true })
    .limit(params.limit);

  if (error) {
    throw new ApiError(
      500,
      "image_jobs_fetch_failed",
      "Could not fetch image jobs",
      error.message,
    );
  }

  const claimed: ImageJobRow[] = [];
  for (const row of (data ?? []) as ImageJobRow[]) {
    const nextAttempt = Number(row.attempt ?? 0) + 1;
    const { data: updated, error: updateError } = await params.serviceClient
      .from("image_jobs")
      .update({
        status: "processing",
        attempt: nextAttempt,
        locked_at: now.toISOString(),
        locked_by: IMAGE_JOB_LOCK_ID,
        updated_at: now.toISOString(),
      })
      .eq("id", String(row.id))
      .in("status", ["pending", "failed"])
      .select(
        "id,image_request_id,status,attempt,max_attempts,next_attempt_at,locked_at,last_error",
      )
      .maybeSingle();

    if (updateError) {
      throw new ApiError(
        500,
        "image_job_claim_failed",
        "Could not claim image job",
        updateError.message,
      );
    }

    if (updated) {
      claimed.push(updated as ImageJobRow);
    }
  }

  return claimed;
};

const ensureRequestEmbedding = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  imageRequest: ImageRequestRow;
  modelOverrides?: ModelOverrideMap;
}): Promise<number[]> => {
  const existing = parseVector(params.imageRequest.embedding);
  if (existing) {
    return existing;
  }

  const embedded = await llmGateway.embedRecipeSearchQuery({
    client: params.serviceClient,
    userId: params.userId,
    requestId: params.requestId,
    inputText: params.imageRequest.normalized_search_text,
    modelOverrides: params.modelOverrides,
  });

  await params.serviceClient.from("image_requests").update({
    embedding: serializeVector(embedded.vector),
    updated_at: new Date().toISOString(),
  }).eq("id", params.imageRequest.id);

  return embedded.vector;
};

export const attachRecipeVersionToImageRequest = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  recipeId: string;
  recipeVersionId: string;
  imageRequestId: string;
}): Promise<void> => {
  const existingRequest = await loadImageRequestById(
    params.serviceClient,
    params.imageRequestId,
  );
  if (!existingRequest) {
    throw new ApiError(
      404,
      "image_request_not_found",
      "Image request was not found",
    );
  }

  const reuseMetadata = parseReuseMetadata(existingRequest.reuse_evaluation);
  const { error } = await params.serviceClient.from("recipe_image_assignments")
    .upsert({
      recipe_id: params.recipeId,
      recipe_version_id: params.recipeVersionId,
      image_request_id: params.imageRequestId,
      asset_id: existingRequest.asset_id,
      assignment_source: existingRequest.status === "ready"
        ? existingRequest.resolution_source
        : null,
      reused_from_recipe_id: existingRequest.status === "ready"
        ? reuseMetadata.reusedFromRecipeId
        : null,
      reused_from_recipe_version_id: existingRequest.status === "ready"
        ? reuseMetadata.reusedFromRecipeVersionId
        : null,
      reuse_evaluation: existingRequest.reuse_evaluation ?? {},
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "recipe_version_id",
    });

  if (error) {
    throw new ApiError(
      500,
      "recipe_image_assignment_failed",
      "Could not attach recipe version to image request",
      error.message,
    );
  }

  const asset = existingRequest.asset_id
    ? (await loadImageAssets(params.serviceClient, [existingRequest.asset_id]))
      .get(existingRequest.asset_id) ?? null
    : null;
  await refreshPersistedRecipeImagesForRequest({
    serviceClient: params.serviceClient,
    userId: params.userId,
    requestId: params.requestId,
    imageRequest: existingRequest,
    asset,
  });
};

export const attachCommittedCandidateImages = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  chatId: string;
  candidateSet: CandidateRecipeSet;
  committedRecipes: Array<{
    component_id: string;
    recipe_id: string;
    recipe_version_id: string;
    recipe: RecipePayload;
    title: string;
  }>;
}): Promise<void> => {
  const componentIds = params.committedRecipes.map((component) => component.component_id);
  const { data: bindings, error: bindingsError } = await params.serviceClient
    .from("candidate_image_bindings")
    .select("component_id,image_request_id")
    .eq("chat_session_id", params.chatId)
    .eq("candidate_id", params.candidateSet.candidate_id)
    .eq("candidate_revision", params.candidateSet.revision)
    .in("component_id", componentIds);

  if (bindingsError) {
    throw new ApiError(
      500,
      "candidate_image_binding_lookup_failed",
      "Could not load candidate image bindings for commit",
      bindingsError.message,
    );
  }

  const bindingByComponentId = new Map(
    ((bindings ?? []) as CandidateBindingRow[]).map((binding) => [
      String(binding.component_id),
      String(binding.image_request_id),
    ]),
  );

  for (const committed of params.committedRecipes) {
    let imageRequestId = bindingByComponentId.get(committed.component_id) ?? null;
    if (!imageRequestId) {
      const fallbackRequest = await ensureImageRequestForRecipe({
        serviceClient: params.serviceClient,
        recipe: committed.recipe,
        titleOverride: committed.title,
      });
      imageRequestId = fallbackRequest.id;
      await enqueueImageRequestJob(params.serviceClient, fallbackRequest.id);
    }

    await attachRecipeVersionToImageRequest({
      serviceClient: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      recipeId: committed.recipe_id,
      recipeVersionId: committed.recipe_version_id,
      imageRequestId,
    });
  }
};

export const ensurePersistedRecipeImageRequest = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  recipeId: string;
  recipeVersionId: string;
}): Promise<void> => {
  const existingAssignment = await params.serviceClient
    .from("recipe_image_assignments")
    .select("image_request_id")
    .eq("recipe_version_id", params.recipeVersionId)
    .maybeSingle();

  if (existingAssignment.error) {
    throw new ApiError(
      500,
      "recipe_image_assignment_lookup_failed",
      "Could not load recipe image assignment",
      existingAssignment.error.message,
    );
  }

  if (existingAssignment.data?.image_request_id) {
    await attachRecipeVersionToImageRequest({
      serviceClient: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      recipeId: params.recipeId,
      recipeVersionId: params.recipeVersionId,
      imageRequestId: String(existingAssignment.data.image_request_id),
    });
    return;
  }

  const { data: version, error: versionError } = await params.serviceClient
    .from("recipe_versions")
    .select("payload")
    .eq("id", params.recipeVersionId)
    .maybeSingle();

  if (versionError || !version?.payload) {
    throw new ApiError(
      404,
      "recipe_version_not_found",
      "Recipe version was not found for image fallback",
      versionError?.message,
    );
  }

  const imageRequest = await ensureImageRequestForRecipe({
    serviceClient: params.serviceClient,
    recipe: version.payload as RecipePayload,
  });
  await attachRecipeVersionToImageRequest({
    serviceClient: params.serviceClient,
    userId: params.userId,
    requestId: params.requestId,
    recipeId: params.recipeId,
    recipeVersionId: params.recipeVersionId,
    imageRequestId: imageRequest.id,
  });
  if (imageRequest.status !== "ready") {
    await enqueueImageRequestJob(params.serviceClient, imageRequest.id);
  }
};

export const processImageJobs = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  limit: number;
  modelOverrides?: ModelOverrideMap;
}): Promise<{
  processed: number;
  ready: number;
  failed: number;
  pending: number;
}> => {
  const jobs = await claimImageJobs({
    serviceClient: params.serviceClient,
    limit: params.limit,
  });

  if (jobs.length === 0) {
    return { processed: 0, ready: 0, failed: 0, pending: 0 };
  }

  let ready = 0;
  let failed = 0;
  let pending = 0;

  for (const job of jobs) {
    const imageRequest = await loadImageRequestById(
      params.serviceClient,
      String(job.image_request_id),
    );
    if (!imageRequest) {
      await markImageJobState({
        serviceClient: params.serviceClient,
        jobId: String(job.id),
        status: "failed",
        message: "image_request_missing",
        attempt: Number(job.attempt ?? 0),
        maxAttempts: Number(job.max_attempts ?? 5),
      });
      failed += 1;
      continue;
    }

    if (imageRequest.status === "ready" && imageRequest.asset_id) {
      await markImageJobState({
        serviceClient: params.serviceClient,
        jobId: String(job.id),
        status: "ready",
        message: null,
        attempt: Number(job.attempt ?? 0),
        maxAttempts: Number(job.max_attempts ?? 5),
      });
      ready += 1;
      continue;
    }

    try {
      const embeddingVector = await ensureRequestEmbedding({
        serviceClient: params.serviceClient,
        userId: params.userId,
        requestId: params.requestId,
        imageRequest,
        modelOverrides: params.modelOverrides,
      });
      const shortlist = await shortlistReuseCandidates({
        serviceClient: params.serviceClient,
        imageRequestId: imageRequest.id,
        embeddingVector,
      });

      let resolved = false;
      if (shortlist.length > 0) {
        try {
          const evaluation = await llmGateway.evaluateRecipeImageReuse({
            client: params.serviceClient,
            userId: params.userId,
            requestId: params.requestId,
            targetRecipe: imageRequest.recipe_payload,
            targetTitle: imageRequest.normalized_title,
            targetSearchText: imageRequest.normalized_search_text,
            candidates: shortlist.map((candidate) => ({
              id: candidate.image_request_id,
              title: candidate.normalized_title,
              imageUrl: candidate.image_url,
              recipeId: candidate.recipe_id,
              recipeVersionId: candidate.recipe_version_id,
            })),
            modelOverrides: params.modelOverrides?.image_reuse_eval,
          });
          const selected = evaluation.decision === "reuse"
            ? resolveReuseCandidate(shortlist, evaluation.selectedCandidateId)
            : null;
          if (evaluation.decision === "reuse" && selected) {
            const selectedAsset = (
              await loadImageAssets(params.serviceClient, [selected.asset_id])
            ).get(selected.asset_id) ?? null;
            await resolveImageRequestToAsset({
              serviceClient: params.serviceClient,
              userId: params.userId,
              requestId: params.requestId,
              imageRequest,
              assetId: selected.asset_id,
              resolutionSource: "reused",
              reuseEvaluation: {
                decision: "reuse",
                selected_candidate_id: selected.image_request_id,
                rationale: evaluation.rationale,
                confidence: evaluation.confidence,
                reused_from_recipe_id: selected.recipe_id,
                reused_from_recipe_version_id: selected.recipe_version_id,
              },
              asset: selectedAsset,
            });
            ready += 1;
            resolved = true;
          }
        } catch (error) {
          console.error("image_reuse_eval_failed", {
            request_id: params.requestId,
            image_request_id: imageRequest.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (!resolved) {
        const generated = await llmGateway.generateRecipeImageDetailed({
          client: params.serviceClient,
          userId: params.userId,
          requestId: params.requestId,
          recipe: imageRequest.recipe_payload,
          context: {
            image_request_id: imageRequest.id,
            normalized_search_text: imageRequest.normalized_search_text,
          },
          modelOverride: params.modelOverrides?.image,
          eventPayload: {
            image_request_id: imageRequest.id,
            stage: "candidate_time_recipe_image",
          },
        });

        // Upload base64 data URIs to Supabase Storage so the client
        // receives a lightweight HTTPS URL instead of a 2MB inline blob.
        const storedImageUrl = await persistImageToStorage(
          params.serviceClient,
          generated.imageUrl,
          imageRequest.id,
        );

        const asset = await createRecipeImageAsset({
          serviceClient: params.serviceClient,
          imageUrl: storedImageUrl,
          provider: generated.provider,
          model: generated.model,
          generationPrompt: generated.prompt,
          generationMetadata: {
            latency_ms: generated.latencyMs,
            cost_usd: generated.costUsd,
            model_config: generated.config.modelConfig,
            request_id: params.requestId,
          },
        });

        await resolveImageRequestToAsset({
          serviceClient: params.serviceClient,
          userId: params.userId,
          requestId: params.requestId,
          imageRequest,
          assetId: asset.id,
          resolutionSource: "generated",
          reuseEvaluation: {
            decision: "generate_new",
            selected_candidate_id: null,
            rationale: "No existing image fit the recipe closely enough.",
            confidence: null,
          },
          asset,
        });
        ready += 1;
      }
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "image_generation_failed";
      const nextAttempt = Number(job.attempt ?? 0);
      const maxAttempts = Number(job.max_attempts ?? 5);
      const terminalFailure = nextAttempt >= maxAttempts;
      await params.serviceClient.from("image_requests").update({
        status: terminalFailure ? "failed" : "pending",
        attempt: nextAttempt,
        last_error: message,
        last_processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", imageRequest.id);
      const refreshed = await loadImageRequestById(
        params.serviceClient,
        imageRequest.id,
      );
      if (refreshed) {
        await refreshPersistedRecipeImagesForRequest({
          serviceClient: params.serviceClient,
          userId: params.userId,
          requestId: params.requestId,
          imageRequest: refreshed,
          asset: null,
        });
      }
      await markImageJobState({
        serviceClient: params.serviceClient,
        jobId: String(job.id),
        status: terminalFailure ? "failed" : "pending",
        message,
        attempt: nextAttempt,
        maxAttempts,
      });
      if (terminalFailure) {
        failed += 1;
      } else {
        pending += 1;
      }
    }
  }

  return {
    processed: jobs.length,
    ready,
    failed,
    pending,
  };
};
