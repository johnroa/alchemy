import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../../_shared/errors.ts";
import type { JsonValue, RecipePayload } from "../../_shared/types.ts";
import {
  enrichRecipeMetadataAsync,
  fetchCanonicalIngredientRows,
  fetchRecipeIngredientMentions,
  inferIngredientRelationsAsync,
  listifyMaybeText,
  loadIngredientNameById,
  loadSemanticDietIncompatibilityRules,
  resolveCanonicalRecipeIngredientsAsync,
  upsertIngredientEnrichment,
  upsertMetadataGraph,
  ENRICHMENT_PERSIST_CONFIDENCE,
} from "./recipe-enrichment.ts";
import { isRlsError } from "./routing-utils.ts";
import {
  canonicalizeRecipePayloadMetadata,
} from "../recipe-preview.ts";
import { upsertRecipeSearchDocument } from "../recipe-search.ts";
import { logChangelog } from "./user-profile.ts";

/**
 * Enqueue a recipe metadata enrichment job for async processing.
 * Upserts into `recipe_metadata_jobs` keyed by recipe_version_id,
 * so re-enqueuing for the same version resets the job to pending.
 */
export const enqueueRecipeMetadataJob = async (params: {
  serviceClient: SupabaseClient;
  recipeId: string;
  recipeVersionId: string;
}): Promise<void> => {
  const nowIso = new Date().toISOString();
  const { error } = await params.serviceClient.from("recipe_metadata_jobs")
    .upsert(
      {
        recipe_id: params.recipeId,
        recipe_version_id: params.recipeVersionId,
        status: "pending",
        stage: "queued",
        attempts: 0,
        max_attempts: 5,
        next_attempt_at: nowIso,
        locked_at: null,
        locked_by: null,
        last_error: null,
        last_stage_error: null,
        stage_attempts: {},
        rejection_counts: {},
        current_run_id: null,
        updated_at: nowIso,
      },
      { onConflict: "recipe_version_id" },
    );

  if (error) {
    throw new ApiError(
      500,
      "recipe_metadata_enqueue_failed",
      "Could not enqueue metadata job",
      error.message,
    );
  }
};

/**
 * Atomically patch a metadata job row with an updated_at timestamp.
 * Silently ignores RLS errors (job may have been deleted/reassigned).
 */
export const updateMetadataJobState = async (params: {
  serviceClient: SupabaseClient;
  jobId: string;
  patch: Record<string, JsonValue>;
}): Promise<void> => {
  const { error } = await params.serviceClient
    .from("recipe_metadata_jobs")
    .update({
      ...params.patch,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.jobId);

  if (error && !isRlsError(error)) {
    throw new ApiError(
      500,
      "metadata_job_update_failed",
      "Could not update metadata job state",
      error.message,
    );
  }
};

/**
 * Main metadata job processor. Reaps stale locks, claims due jobs, and runs
 * the full enrichment pipeline per job:
 *   1. ingredient_resolution — resolve canonical ingredients
 *   2. ingredient_enrichment — enrich ingredient metadata + diet compat
 *   3. recipe_enrichment — LLM-based recipe metadata enrichment
 *   4. edge_inference — infer ingredient relation graph edges
 *   5. search_index — upsert recipe search document
 *   6. finalize — mark job ready with aggregated metadata
 *
 * Uses exponential backoff with jitter on transient failures.
 * Jobs exceeding max_attempts are marked terminal "failed".
 */
export const processMetadataJobs = async (params: {
  serviceClient: SupabaseClient;
  actorUserId: string;
  requestId: string;
  limit: number;
}): Promise<{
  reaped: number;
  claimed: number;
  processed: number;
  ready: number;
  failed: number;
  pending: number;
  queue: {
    pending: number;
    processing: number;
    ready: number;
    failed: number;
  };
}> => {
  const now = new Date();
  const staleThreshold = new Date(now.getTime() - 10 * 60 * 1000).toISOString();

  const { data: staleJobs, error: staleJobsError } = await params.serviceClient
    .from("recipe_metadata_jobs")
    .select("id")
    .eq("status", "processing")
    .lt("locked_at", staleThreshold);

  if (staleJobsError) {
    throw new ApiError(
      500,
      "metadata_jobs_stale_fetch_failed",
      "Could not fetch stale metadata jobs",
      staleJobsError.message,
    );
  }

  const staleIds = (staleJobs ?? []).map((job) => job.id);
  let reaped = 0;
  if (staleIds.length > 0) {
    const { error: reapError } = await params.serviceClient
      .from("recipe_metadata_jobs")
      .update({
        status: "pending",
        stage: "queued",
        locked_at: null,
        locked_by: null,
        current_run_id: null,
        last_stage_error: null,
        next_attempt_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .in("id", staleIds);

    if (reapError) {
      throw new ApiError(
        500,
        "metadata_jobs_reap_failed",
        "Could not reap stale metadata locks",
        reapError.message,
      );
    }
    reaped = staleIds.length;
  }

  if (params.limit <= 0) {
    const { data: queueRows } = await params.serviceClient.from(
      "recipe_metadata_jobs",
    ).select("status");
    const queue = {
      pending: (queueRows ?? []).filter((row) =>
        row.status === "pending"
      ).length,
      processing: (queueRows ?? []).filter((row) =>
        row.status === "processing"
      ).length,
      ready: (queueRows ?? []).filter((row) => row.status === "ready").length,
      failed: (queueRows ?? []).filter((row) => row.status === "failed").length,
    };
    return {
      reaped,
      claimed: 0,
      processed: 0,
      ready: 0,
      failed: 0,
      pending: 0,
      queue,
    };
  }

  const { data: dueJobs, error: dueJobsError } = await params.serviceClient
    .from("recipe_metadata_jobs")
    .select(
      "id,recipe_id,recipe_version_id,status,attempts,max_attempts,next_attempt_at",
    )
    .in("status", ["pending", "failed"])
    .lte("next_attempt_at", now.toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(params.limit);

  if (dueJobsError) {
    throw new ApiError(
      500,
      "metadata_jobs_due_fetch_failed",
      "Could not fetch due metadata jobs",
      dueJobsError.message,
    );
  }

  const jobs = dueJobs ?? [];
  const dietIncompatibilityRules = await loadSemanticDietIncompatibilityRules(
    params.serviceClient,
  );
  let claimed = 0;
  let processed = 0;
  let ready = 0;
  let failed = 0;
  let pending = 0;

  for (const job of jobs) {
    const nextAttempt = Number(job.attempts ?? 0) + 1;
    let lockResult = await params.serviceClient
      .from("recipe_metadata_jobs")
      .update({
        status: "processing",
        attempts: nextAttempt,
        stage: "queued",
        current_run_id: null,
        locked_at: now.toISOString(),
        locked_by: "v1_metadata_jobs_process",
        updated_at: now.toISOString(),
      })
      .eq("id", job.id)
      .eq("status", job.status)
      .select("id")
      .maybeSingle();

    if (lockResult.error) {
      throw new ApiError(
        500,
        "metadata_job_lock_failed",
        "Could not claim metadata job",
        lockResult.error.message,
      );
    }
    if (!lockResult.data) {
      continue;
    }
    claimed += 1;

    try {
      let versionResult = await params.serviceClient
        .from("recipe_versions")
        .select("id,payload,metadata_schema_version")
        .eq("id", job.recipe_version_id)
        .maybeSingle();
      const version = versionResult.data;
      const versionError = versionResult.error;

      if (versionError || !version?.payload) {
        throw new Error("recipe_version_payload_missing");
      }

      let payload = version.payload as RecipePayload;

      await updateMetadataJobState({
        serviceClient: params.serviceClient,
        jobId: job.id,
        patch: {
          stage: "ingredient_resolution",
          last_stage_error: null,
        },
      });

      const ingredientResolution = await resolveCanonicalRecipeIngredientsAsync(
        {
          serviceClient: params.serviceClient,
          userId: params.actorUserId,
          requestId: params.requestId,
          jobId: job.id,
          recipeId: job.recipe_id,
          recipeVersionId: job.recipe_version_id,
        },
      );

      const canonicalRows = await fetchCanonicalIngredientRows(
        params.serviceClient,
        job.recipe_version_id,
      );
      const ingredientIds = Array.from(
        new Set(
          canonicalRows.map((row) => row.ingredient_id).filter((
            id,
          ): id is string => Boolean(id)),
        ),
      );
      const canonicalIngredientNameById = await loadIngredientNameById(
        params.serviceClient,
        ingredientIds,
      );
      const mentionRows = await fetchRecipeIngredientMentions(
        params.serviceClient,
        job.recipe_version_id,
      );
      const ingredientNames = Array.from(
        new Set(
          (
            mentionRows.length > 0
              ? mentionRows.map((mention) => {
                if (mention.ingredient_id) {
                  return canonicalIngredientNameById.get(mention.ingredient_id) ??
                    String(mention.metadata?.canonical_name ?? "");
                }
                return String(mention.metadata?.canonical_name ?? "");
              })
              : canonicalRows.map((row) => {
                if (row.ingredient_id) {
                  return canonicalIngredientNameById.get(row.ingredient_id) ??
                    row.source_name;
                }
                return row.source_name;
              })
          ).map((value) => value.trim()).filter((value) => value.length > 0),
        ),
      );

      await updateMetadataJobState({
        serviceClient: params.serviceClient,
        jobId: job.id,
        patch: {
          stage: "ingredient_enrichment",
          last_stage_error: null,
        },
      });

      const ingredientEnrichment = await upsertIngredientEnrichment({
        serviceClient: params.serviceClient,
        userId: params.actorUserId,
        requestId: params.requestId,
        jobId: job.id,
        recipeId: job.recipe_id,
        recipeVersionId: job.recipe_version_id,
        canonicalRows,
        canonicalIngredientNameById,
        dietIncompatibilityRules,
      });

      await updateMetadataJobState({
        serviceClient: params.serviceClient,
        jobId: job.id,
        patch: {
          stage: "recipe_enrichment",
          last_stage_error: null,
        },
      });

      const recipeEnrichment = await enrichRecipeMetadataAsync({
        serviceClient: params.serviceClient,
        userId: params.actorUserId,
        requestId: params.requestId,
        jobId: job.id,
        recipeId: job.recipe_id,
        recipeVersionId: job.recipe_version_id,
        payload,
        ingredientNames,
      });

      if (Object.keys(recipeEnrichment.metadataPatch).length > 0) {
        const mergedMetadata = canonicalizeRecipePayloadMetadata({
          ...payload,
          metadata: {
            ...(payload.metadata ?? {}),
            ...recipeEnrichment.metadataPatch,
          },
        });
        payload = {
          ...payload,
          metadata: mergedMetadata,
        };
        let { error: payloadUpdateError } = await params.serviceClient
          .from("recipe_versions")
          .update({
            payload,
            metadata_schema_version: 2,
          })
          .eq("id", job.recipe_version_id);
        if (payloadUpdateError) {
          throw new Error(payloadUpdateError.message);
        }
      }

      await updateMetadataJobState({
        serviceClient: params.serviceClient,
        jobId: job.id,
        patch: {
          stage: "edge_inference",
          last_stage_error: null,
        },
      });

      const ingredientRelationInference = await inferIngredientRelationsAsync({
        serviceClient: params.serviceClient,
        userId: params.actorUserId,
        requestId: params.requestId,
        jobId: job.id,
        recipeId: job.recipe_id,
        recipeVersionId: job.recipe_version_id,
        ingredientNames,
      });

      const categories = Array.from(
        new Set(
          [
            ...canonicalRows.map((row) => row.category).filter((
              value,
            ): value is string => Boolean(value)),
            ...listifyMaybeText(payload.metadata?.cuisine_tags),
            ...listifyMaybeText(payload.metadata?.occasion_tags),
            ...listifyMaybeText(payload.metadata?.cuisine),
            ...listifyMaybeText(payload.metadata?.course_type),
          ]
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
        ),
      );
      const keywords = Array.from(
        new Set(
          [
            ...listifyMaybeText(payload.metadata?.flavor_profile),
            ...listifyMaybeText(payload.pairings),
            ...listifyMaybeText(payload.metadata?.pairing_rationale),
            ...listifyMaybeText(payload.metadata?.health_flags),
          ]
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
        ),
      );

      await upsertMetadataGraph({
        serviceClient: params.serviceClient,
        recipeId: job.recipe_id,
        recipeVersionId: job.recipe_version_id,
        payload,
        canonicalRows,
        mentionRows,
        canonicalIngredientNameById,
        recipeMetadataPatch: recipeEnrichment.metadataPatch,
        ingredientRelations: ingredientRelationInference.relations,
      });

      await updateMetadataJobState({
        serviceClient: params.serviceClient,
        jobId: job.id,
        patch: {
          stage: "search_index",
          last_stage_error: null,
        },
      });

      const [
        { data: searchRecipeRow, error: searchRecipeError },
        { data: searchCategoryRow, error: searchCategoryError },
      ] = await Promise.all([
        params
          .serviceClient
          .from("recipes")
          .select("id,visibility,hero_image_url,image_status,updated_at")
          .eq("id", job.recipe_id)
          .maybeSingle(),
        params.serviceClient
          .from("recipe_auto_categories")
          .select("category,confidence")
          .eq("recipe_id", job.recipe_id)
          .order("confidence", { ascending: false, nullsFirst: false })
          .order("category", { ascending: true })
          .limit(1)
          .maybeSingle(),
      ]);

      if (searchRecipeError || !searchRecipeRow) {
        throw new Error(
          searchRecipeError?.message ?? "recipe_search_source_missing",
        );
      }

      if (searchCategoryError) {
        throw new Error(searchCategoryError.message);
      }

      let ontologyTermKeys: string[] = [];
      if (ingredientIds.length > 0) {
        const { data: ingredientMetadataRows, error: ingredientMetadataError } =
          await params.serviceClient
            .from("ingredients")
            .select("id,metadata")
            .in("id", ingredientIds);

        if (ingredientMetadataError) {
          throw new Error(ingredientMetadataError.message);
        }

        ontologyTermKeys = Array.from(
          new Set(
            (ingredientMetadataRows ?? []).flatMap((row) => {
              const metadata = row.metadata &&
                  typeof row.metadata === "object" && !Array.isArray(row.metadata)
                ? row.metadata as Record<string, JsonValue>
                : null;
              const ontologyIds = metadata?.ontology_ids &&
                  typeof metadata.ontology_ids === "object" &&
                  !Array.isArray(metadata.ontology_ids)
                ? metadata.ontology_ids as Record<string, JsonValue>
                : null;
              return Array.isArray(ontologyIds?.internal_term_keys)
                ? ontologyIds.internal_term_keys.filter((value): value is string =>
                  typeof value === "string" && value.trim().length > 0
                )
                : [];
            }),
          ),
        );
      }

      await upsertRecipeSearchDocument({
        serviceClient: params.serviceClient,
        userId: params.actorUserId,
        requestId: params.requestId,
        source: {
          recipeId: job.recipe_id,
          recipeVersionId: job.recipe_version_id,
          category: searchCategoryRow?.category ?? null,
          visibility: searchRecipeRow.visibility,
          updatedAt: searchRecipeRow.updated_at,
          imageUrl: searchRecipeRow.hero_image_url,
          imageStatus: searchRecipeRow.image_status,
          payload,
          canonicalIngredientIds: ingredientIds,
          canonicalIngredientNames: ingredientNames,
          ontologyTermKeys,
        },
      });

      const readyMetadata = {
        categories,
        keywords,
        nutrition: payload.metadata?.nutrition ?? null,
        ingredient_resolution: ingredientResolution,
        rejection_counts: {
          ingredient_resolution: ingredientResolution.rejectedCount,
          ingredient_enrichment: ingredientEnrichment.rejectedCount,
          recipe_enrichment: recipeEnrichment.rejectedCount,
          edge_inference: ingredientRelationInference.rejectedCount,
        },
        confidence_threshold: ENRICHMENT_PERSIST_CONFIDENCE,
        search_indexed_at: new Date().toISOString(),
        processed_at: new Date().toISOString(),
      };

      let { error: readyError } = await params.serviceClient
        .from("recipe_metadata_jobs")
        .update({
          status: "ready",
          stage: "finalize",
          locked_at: null,
          locked_by: null,
          last_error: null,
          last_stage_error: null,
          metadata: readyMetadata,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      if (readyError) {
        throw new Error(readyError.message);
      }

      await logChangelog({
        serviceClient: params.serviceClient,
        actorUserId: params.actorUserId,
        scope: "metadata",
        entityType: "metadata_job",
        entityId: job.id,
        action: "ready",
        requestId: params.requestId,
        afterJson: {
          recipe_id: job.recipe_id,
          recipe_version_id: job.recipe_version_id,
        },
      });

      processed += 1;
      ready += 1;
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "metadata_job_failed";
      const maxAttempts = Number(job.max_attempts ?? 5);
      const terminal = nextAttempt >= maxAttempts;
      const baseDelayMs = Math.min(
        60 * 60 * 1000,
        1000 * (2 ** Math.max(0, nextAttempt - 1)),
      );
      const jitterMs = Math.floor(Math.random() * 2000);
      const nextAttemptAt = new Date(Date.now() + baseDelayMs + jitterMs)
        .toISOString();

      let { error: failureUpdateError } = await params.serviceClient
        .from("recipe_metadata_jobs")
        .update({
          status: terminal ? "failed" : "pending",
          stage: "queued",
          next_attempt_at: terminal ? now.toISOString() : nextAttemptAt,
          locked_at: null,
          locked_by: null,
          last_error: message,
          last_stage_error: message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      if (failureUpdateError) {
        throw new ApiError(
          500,
          "metadata_job_failure_update_failed",
          "Could not update metadata job failure",
          failureUpdateError.message,
        );
      }

      await logChangelog({
        serviceClient: params.serviceClient,
        actorUserId: params.actorUserId,
        scope: "metadata",
        entityType: "metadata_job",
        entityId: job.id,
        action: terminal ? "failed" : "retry_scheduled",
        requestId: params.requestId,
        afterJson: {
          attempt: nextAttempt,
          max_attempts: maxAttempts,
          terminal,
          error: message,
        },
      });

      processed += 1;
      if (terminal) {
        failed += 1;
      } else {
        pending += 1;
      }
    }
  }

  const { data: queueRows } = await params.serviceClient.from(
    "recipe_metadata_jobs",
  ).select("status");
  const queue = {
    pending: (queueRows ?? []).filter((row) => row.status === "pending").length,
    processing:
      (queueRows ?? []).filter((row) => row.status === "processing").length,
    ready: (queueRows ?? []).filter((row) => row.status === "ready").length,
    failed: (queueRows ?? []).filter((row) => row.status === "failed").length,
  };

  return { reaped, claimed, processed, ready, failed, pending, queue };
};
