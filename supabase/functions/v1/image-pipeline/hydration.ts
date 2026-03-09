/**
 * Candidate image hydration, enrollment, and recipe-version attachment.
 *
 * Manages the lifecycle of image bindings for candidate recipe sets:
 * hydrating image status onto candidates, enrolling new image requests
 * during chat generation, carrying forward prior revision images on
 * iterations, and attaching images to committed/persisted recipes.
 *
 * Depends on: ./types.ts (foundation), ./generation.ts (projection),
 *             ./queue.ts (enqueueImageRequestJob).
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../../_shared/errors.ts";
import type {
  CandidateRecipeSet,
  RecipePayload,
} from "../../_shared/types.ts";
import {
  logImageIdentityResolution,
  type ImageResolutionReason,
} from "../lib/recipe-identity.ts";
import {
  buildImageRequestDescriptor,
  type CandidateBindingRow,
  ensureImageRequestForRecipe,
  hydrateStatusFromRequest,
  loadImageAssets,
  loadImageRequestById,
  mapImageRequestRow,
  parseReuseMetadata,
  reconcileImageRequestDescriptor,
} from "./types.ts";
import { refreshPersistedRecipeImagesForRequest } from "./generation.ts";
import { enqueueImageRequestJob } from "./queue.ts";

// ─── Candidate Binding ───────────────────────────────────────────────────────

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

/**
 * Finds the most recent image binding for each component from any prior
 * revision of the same candidate. Returns a map of component_id → image_request_id.
 * If no prior revision exists (first generation), returns an empty map.
 */
const loadPriorRevisionBindings = async (params: {
  serviceClient: SupabaseClient;
  chatId: string;
  candidateId: string;
  currentRevision: number;
  componentIds: string[];
}): Promise<Map<string, string>> => {
  if (params.componentIds.length === 0 || params.currentRevision <= 0) {
    return new Map();
  }

  const { data, error } = await params.serviceClient
    .from("candidate_image_bindings")
    .select("component_id,image_request_id,candidate_revision")
    .eq("chat_session_id", params.chatId)
    .eq("candidate_id", params.candidateId)
    .lt("candidate_revision", params.currentRevision)
    .in("component_id", params.componentIds)
    .order("candidate_revision", { ascending: false });

  if (error || !data) {
    return new Map();
  }

  // Take the highest-revision binding per component
  const result = new Map<string, string>();
  for (const row of data as Array<Record<string, unknown>>) {
    const componentId = String(row.component_id);
    if (!result.has(componentId)) {
      result.set(componentId, String(row.image_request_id));
    }
  }
  return result;
};

// ─── Candidate Set Hydration ─────────────────────────────────────────────────

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
        "id,recipe_fingerprint,image_fingerprint,normalized_title,normalized_search_text,recipe_payload,embedding,asset_id,status,resolution_source,reuse_evaluation,attempt,max_attempts,last_error,matched_recipe_id,matched_recipe_version_id,resolution_reason,judge_invoked,judge_candidate_count",
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

// ─── Candidate Image Enrollment ──────────────────────────────────────────────

export const enrollCandidateImageRequests = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  chatId: string;
  candidateSet: CandidateRecipeSet;
}): Promise<CandidateRecipeSet> => {
  // On iterations (revision > 0), look up prior bindings so we can
  // carry forward existing ready images instead of regenerating them
  // for every minor tweak. New images are only created when there's
  // no prior binding at all (first generation).
  const priorBindings = await loadPriorRevisionBindings({
    serviceClient: params.serviceClient,
    chatId: params.chatId,
    candidateId: params.candidateSet.candidate_id,
    currentRevision: params.candidateSet.revision,
    componentIds: params.candidateSet.components.map((c) => c.component_id),
  });

  for (const component of params.candidateSet.components) {
    const priorRequestId = priorBindings.get(component.component_id);

    if (priorRequestId) {
      // Carry forward the existing image binding — don't regenerate
      // unless the prior request failed permanently.
      const priorRequest = await loadImageRequestById(
        params.serviceClient,
        priorRequestId,
      );
      if (priorRequest && priorRequest.status !== "failed") {
        await touchCandidateBinding({
          serviceClient: params.serviceClient,
          chatId: params.chatId,
          candidateId: params.candidateSet.candidate_id,
          candidateRevision: params.candidateSet.revision,
          componentId: component.component_id,
          imageRequestId: priorRequestId,
        });
        if (priorRequest.status !== "ready") {
          await enqueueImageRequestJob(params.serviceClient, priorRequestId);
        }
        continue;
      }
    }

    // No prior binding or it failed — create a fresh image request
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

// ─── Recipe Version Attachment ───────────────────────────────────────────────

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
      matched_recipe_id: existingRequest.matched_recipe_id,
      matched_recipe_version_id: existingRequest.matched_recipe_version_id,
      resolution_reason: existingRequest.resolution_reason,
      judge_invoked: existingRequest.judge_invoked,
      judge_candidate_count: existingRequest.judge_candidate_count,
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

  if (existingRequest.status === "ready" && existingRequest.asset_id) {
    await logImageIdentityResolution({
      serviceClient: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      imageRequestId: existingRequest.id,
      recipeId: existingRequest.matched_recipe_id,
      recipeVersionId: existingRequest.matched_recipe_version_id,
      reason: (
        existingRequest.resolution_reason ??
          "persisted_exact_fingerprint"
      ) as ImageResolutionReason,
      judgeInvoked: existingRequest.judge_invoked,
      judgeCandidateCount: existingRequest.judge_candidate_count,
      assetId: existingRequest.asset_id,
    });
  }
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

  const recipePayload = version.payload as RecipePayload;
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
    const existingRequest = await loadImageRequestById(
      params.serviceClient,
      String(existingAssignment.data.image_request_id),
    );
    let requestToAttach = existingRequest;
    if (existingRequest) {
      const descriptor = await buildImageRequestDescriptor(recipePayload);
      requestToAttach = await reconcileImageRequestDescriptor({
        serviceClient: params.serviceClient,
        existing: existingRequest,
        descriptor,
        matchedRecipeId: params.recipeId,
        matchedRecipeVersionId: params.recipeVersionId,
        resolutionReason: "persisted_exact_fingerprint",
      });
    }

    if (
      existingRequest &&
      requestToAttach &&
      existingRequest.status === "ready" &&
      requestToAttach.status !== "ready"
    ) {
      await refreshPersistedRecipeImagesForRequest({
        serviceClient: params.serviceClient,
        userId: params.userId,
        requestId: params.requestId,
        imageRequest: requestToAttach,
        asset: null,
      });
    }

    await attachRecipeVersionToImageRequest({
      serviceClient: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      recipeId: params.recipeId,
      recipeVersionId: params.recipeVersionId,
      imageRequestId: requestToAttach?.id ?? String(existingAssignment.data.image_request_id),
    });
    if (requestToAttach && requestToAttach.status !== "ready") {
      await enqueueImageRequestJob(params.serviceClient, requestToAttach.id);
    }
    return;
  }

  const imageRequest = await ensureImageRequestForRecipe({
    serviceClient: params.serviceClient,
    recipe: recipePayload,
    matchedRecipeId: params.recipeId,
    matchedRecipeVersionId: params.recipeVersionId,
    resolutionReason: "persisted_exact_fingerprint",
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
