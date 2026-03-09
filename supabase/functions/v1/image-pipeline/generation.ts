/**
 * Image generation, reuse evaluation, asset lifecycle, and resolution.
 *
 * Handles the core image production workflow: persisting images to storage,
 * creating/managing image assets, evaluating reuse candidates via embedding
 * similarity + LLM, resolving image requests to assets, and projecting
 * resolved images onto persisted recipe rows and search documents.
 *
 * Depends on: ./types.ts (foundation), external shared modules.
 * Depended on by: ./queue.ts (processImageJobs), ./hydration.ts (attachment).
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../../_shared/errors.ts";
import { llmGateway, type ModelOverrideMap } from "../../_shared/llm-gateway.ts";
import type { JsonValue } from "../../_shared/types.ts";
import {
  type ImageResolutionReason,
  logImageIdentityResolution,
  resolveSameCanonImageJudgeEnabled,
} from "../lib/recipe-identity.ts";
import { loadRecipeSearchDocumentSource, upsertRecipeSearchDocument } from "../recipe-search.ts";
import {
  type ImageAssetRow,
  type ImageRequestRow,
  type ResolutionSource,
  type ReuseCandidateRow,
  RECIPE_IMAGES_BUCKET,
  loadImageAssets,
  loadImageRequestById,
  mapImageAssetRow,
  normalizeText,
  parseReuseMetadata,
  parseVector,
  serializeVector,
} from "./types.ts";

// ─── Image Storage ───────────────────────────────────────────────────────────

/**
 * If the image URL is a base64 data URI, upload it to Supabase Storage
 * and return the public HTTPS URL. Pass-through for regular URLs.
 */
export const persistImageToStorage = async (
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

// ─── Asset CRUD ──────────────────────────────────────────────────────────────

export const createRecipeImageAsset = async (params: {
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

export const updateAssetUsageCounts = async (params: {
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

// ─── Recipe Image Projection ─────────────────────────────────────────────────

/**
 * After an image request is resolved (or fails), project the new state
 * onto all persisted recipe rows that reference it via recipe_image_assignments,
 * updating hero_image_url, image_status, and the search document.
 */
export const refreshPersistedRecipeImagesForRequest = async (params: {
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
        matched_recipe_id: params.imageRequest.matched_recipe_id,
        matched_recipe_version_id: params.imageRequest.matched_recipe_version_id,
        resolution_reason: params.imageRequest.resolution_reason,
        judge_invoked: params.imageRequest.judge_invoked,
        judge_candidate_count: params.imageRequest.judge_candidate_count,
        updated_at: new Date().toISOString(),
      }
      : {
        asset_id: null,
        assignment_source: null,
        reused_from_recipe_id: null,
        reused_from_recipe_version_id: null,
        reuse_evaluation: params.imageRequest.reuse_evaluation ?? {},
        matched_recipe_id: params.imageRequest.matched_recipe_id,
        matched_recipe_version_id: params.imageRequest.matched_recipe_version_id,
        resolution_reason: params.imageRequest.resolution_reason,
        judge_invoked: params.imageRequest.judge_invoked,
        judge_candidate_count: params.imageRequest.judge_candidate_count,
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

// ─── Image Request Resolution ────────────────────────────────────────────────

/**
 * Marks an image request as resolved with a specific asset, updates usage
 * counts, clears the job lock, and projects the result onto persisted recipes.
 */
export const resolveImageRequestToAsset = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  imageRequest: ImageRequestRow;
  assetId: string;
  resolutionSource: ResolutionSource;
  resolutionReason: ImageResolutionReason;
  reuseEvaluation: Record<string, JsonValue>;
  asset?: ImageAssetRow | null;
  matchedRecipeId?: string | null;
  matchedRecipeVersionId?: string | null;
  judgeInvoked?: boolean;
  judgeCandidateCount?: number;
}): Promise<void> => {
  const previousAssetId = params.imageRequest.asset_id;
  const now = new Date().toISOString();
  const { error } = await params.serviceClient.from("image_requests").update({
    asset_id: params.assetId,
    status: "ready",
    resolution_source: params.resolutionSource,
    reuse_evaluation: params.reuseEvaluation,
    matched_recipe_id: params.matchedRecipeId ?? params.imageRequest.matched_recipe_id,
    matched_recipe_version_id: params.matchedRecipeVersionId ??
      params.imageRequest.matched_recipe_version_id,
    resolution_reason: params.resolutionReason,
    judge_invoked: params.judgeInvoked ?? params.imageRequest.judge_invoked,
    judge_candidate_count: params.judgeCandidateCount ??
      params.imageRequest.judge_candidate_count,
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

  await logImageIdentityResolution({
    serviceClient: params.serviceClient,
    userId: params.userId,
    requestId: params.requestId,
    imageRequestId: params.imageRequest.id,
    recipeId: refreshed.matched_recipe_id,
    recipeVersionId: refreshed.matched_recipe_version_id,
    reason: params.resolutionReason,
    judgeInvoked: params.judgeInvoked ?? refreshed.judge_invoked,
    judgeCandidateCount: params.judgeCandidateCount ??
      refreshed.judge_candidate_count,
    assetId: params.assetId,
  });
};

// ─── Reuse Evaluation ────────────────────────────────────────────────────────

export const shortlistReuseCandidates = async (params: {
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

export const findCanonicalImageExactReuseCandidate = async (params: {
  serviceClient: SupabaseClient;
  recipeId: string;
  imageFingerprint: string;
  excludeImageRequestId?: string | null;
}): Promise<ReuseCandidateRow | null> => {
  const { data, error } = await params.serviceClient.rpc(
    "find_canonical_image_exact_match",
    {
      p_recipe_id: params.recipeId,
      p_image_fingerprint: params.imageFingerprint,
      p_exclude_request_id: params.excludeImageRequestId ?? null,
    },
  );

  if (error) {
    throw new ApiError(
      500,
      "canonical_image_exact_match_failed",
      "Could not load canonical image exact match",
      error.message,
    );
  }

  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }

  const row = data[0] as Record<string, unknown>;
  return {
    image_request_id: String(row.image_request_id ?? ""),
    asset_id: String(row.asset_id ?? ""),
    image_url: String(row.image_url ?? ""),
    normalized_title: String(row.normalized_title ?? ""),
    recipe_id: normalizeText(row.recipe_id),
    recipe_version_id: normalizeText(row.recipe_version_id),
    similarity: null,
    usage_count: null,
  };
};

export const shortlistCanonicalReuseCandidates = async (params: {
  serviceClient: SupabaseClient;
  recipeId: string;
  imageRequestId: string;
  embeddingVector: number[];
}): Promise<ReuseCandidateRow[]> => {
  const { data, error } = await params.serviceClient.rpc(
    "list_canonical_image_reuse_candidates",
    {
      p_recipe_id: params.recipeId,
      p_query_embedding: serializeVector(params.embeddingVector),
      p_exclude_request_id: params.imageRequestId,
      p_limit: 3,
    },
  );

  if (error) {
    throw new ApiError(
      500,
      "canonical_image_reuse_candidates_failed",
      "Could not load canonical image reuse candidates",
      error.message,
    );
  }

  return Array.isArray(data)
    ? (data as ReuseCandidateRow[])
    : [];
};

export const resolveReuseCandidate = (
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

// ─── Embedding ───────────────────────────────────────────────────────────────

export const ensureRequestEmbedding = async (params: {
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

export { resolveSameCanonImageJudgeEnabled };
