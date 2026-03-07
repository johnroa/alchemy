/**
 * Image job queue management: enqueue, claim, state tracking, and the
 * main processImageJobs orchestrator that drives the generation pipeline.
 *
 * Depends on: ./types.ts (foundation), ./generation.ts (generation/resolution).
 * Depended on by: ./hydration.ts (enqueueImageRequestJob).
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../../_shared/errors.ts";
import { llmGateway, type ModelOverrideMap } from "../../_shared/llm-gateway.ts";
import {
  type ImageJobRow,
  type ImageRequestStatus,
  IMAGE_JOB_LOCK_ID,
  IMAGE_JOB_LOCK_STALE_MS,
  IMAGE_JOB_RETRY_BACKOFF_MS,
  loadImageAssets,
  loadImageRequestById,
} from "./types.ts";
import {
  createRecipeImageAsset,
  ensureRequestEmbedding,
  persistImageToStorage,
  refreshPersistedRecipeImagesForRequest,
  resolveImageRequestToAsset,
  resolveReuseCandidate,
  shortlistReuseCandidates,
} from "./generation.ts";

// ─── Job Enqueue ─────────────────────────────────────────────────────────────

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

// ─── Job Claiming ────────────────────────────────────────────────────────────

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

// ─── Job State Tracking ──────────────────────────────────────────────────────

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

// ─── Main Job Processor ──────────────────────────────────────────────────────

/**
 * Claims pending/failed image jobs and processes them through the full
 * pipeline: embedding → reuse evaluation → generation → resolution.
 * Returns counts of processed/ready/failed/pending jobs.
 */
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
