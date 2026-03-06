import {
  ApiError,
  requireJsonBody,
} from "../../_shared/errors.ts";
import type { JsonValue } from "../../_shared/types.ts";
import type { RouteContext } from "./shared.ts";

type MetadataDeps = {
  parseUuid: (value: string) => string;
  logChangelog: (input: {
    serviceClient: RouteContext["serviceClient"];
    actorUserId: string;
    scope: string;
    entityType: string;
    entityId?: string;
    action: string;
    requestId: string;
    afterJson?: JsonValue;
  }) => Promise<void>;
  processImageJobs: (input: {
    userClient: RouteContext["client"];
    serviceClient: RouteContext["serviceClient"];
    userId: string;
    requestId: string;
    limit: number;
  }) => Promise<{
    processed: number;
    ready: number;
    failed: number;
    pending: number;
  }>;
  processMetadataJobs: (input: {
    serviceClient: RouteContext["serviceClient"];
    actorUserId: string;
    requestId: string;
    limit: number;
  }) => Promise<{
    reaped: number;
    claimed: number;
    processed: number;
    ready: number;
    failed: number;
    pending: number;
    queue: Record<string, JsonValue>;
  }>;
  backfillRecipeSearchDocuments: (input: {
    serviceClient: RouteContext["serviceClient"];
    userId: string;
    requestId: string;
    recipeIds?: string[];
    recipeVersionIds?: string[];
    publicOnly?: boolean;
    currentVersionsOnly?: boolean;
    missingOnly?: boolean;
    limit?: number;
  }) => Promise<{
    processed: number;
    failed: number;
    recipe_version_ids: string[];
    failures: Array<{ recipe_version_id: string; error: string }>;
  }>;
  enqueueRecipeMetadataJob: (input: {
    serviceClient: RouteContext["serviceClient"];
    recipeId: string;
    recipeVersionId: string;
  }) => Promise<void>;
  scheduleMetadataQueueDrain: (input: {
    serviceClient: RouteContext["serviceClient"];
    actorUserId: string;
    requestId: string;
    limit: number;
  }) => void;
};

export const handleMetadataRoutes = async (
  context: RouteContext,
  deps: MetadataDeps,
): Promise<Response | null> => {
  const {
    request,
    segments,
    method,
    auth,
    client,
    serviceClient,
    requestId,
    respond,
  } = context;
  const {
    parseUuid,
    logChangelog,
    processImageJobs,
    processMetadataJobs,
    backfillRecipeSearchDocuments,
    enqueueRecipeMetadataJob,
    scheduleMetadataQueueDrain,
  } = deps;

  if (
    segments.length === 3 &&
    segments[0] === "metadata-jobs" &&
    segments[1] === "search-index" &&
    segments[2] === "backfill" &&
    method === "POST"
  ) {
    const parsedBody = await requireJsonBody<{
      recipe_ids?: string[];
      recipe_version_ids?: string[];
      public_only?: boolean;
      current_versions_only?: boolean;
      missing_only?: boolean;
      limit?: number;
    }>(request).catch(() => ({}));
    const body: {
      recipe_ids?: string[];
      recipe_version_ids?: string[];
      public_only?: boolean;
      current_versions_only?: boolean;
      missing_only?: boolean;
      limit?: number;
    } = parsedBody;

    const result = await backfillRecipeSearchDocuments({
      serviceClient,
      userId: auth.userId,
      requestId,
      recipeIds: Array.isArray(body.recipe_ids)
        ? body.recipe_ids
            .filter((value: string): value is string =>
              typeof value === "string" && value.trim().length > 0
            )
            .map((value: string) => parseUuid(value))
        : undefined,
      recipeVersionIds: Array.isArray(body.recipe_version_ids)
        ? body.recipe_version_ids
            .filter((value: string): value is string =>
              typeof value === "string" && value.trim().length > 0
            )
            .map((value: string) => parseUuid(value))
        : undefined,
      publicOnly: body.public_only,
      currentVersionsOnly: body.current_versions_only,
      missingOnly: body.missing_only,
      limit: body.limit,
    });

    await logChangelog({
      serviceClient,
      actorUserId: auth.userId,
      scope: "metadata",
      entityType: "recipe_search_document",
      action: "manual_backfill",
      requestId,
      afterJson: {
        processed: result.processed,
        failed: result.failed,
        recipe_version_ids: result.recipe_version_ids,
      },
    });

    return respond(200, { ok: true, ...result });
  }

  if (
    segments.length === 2 &&
    segments[0] === "image-jobs" &&
    segments[1] === "process" &&
    method === "POST"
  ) {
    const body = await requireJsonBody<{ limit?: number }>(request).catch(() => ({
      limit: 5,
    }));
    const limit = Number.isFinite(Number(body.limit))
      ? Math.max(1, Math.min(20, Number(body.limit)))
      : 5;

    const result = await processImageJobs({
      userClient: client,
      serviceClient,
      userId: auth.userId,
      requestId,
      limit,
    });

    await logChangelog({
      serviceClient,
      actorUserId: auth.userId,
      scope: "image",
      entityType: "image_job",
      action: "process_batch",
      requestId,
      afterJson: {
        processed: result.processed,
        ready: result.ready,
        failed: result.failed,
        pending: result.pending,
      },
    });

    return respond(200, result);
  }

  if (
    segments.length === 2 &&
    segments[0] === "metadata-jobs" &&
    segments[1] === "process" &&
    method === "POST"
  ) {
    const body = await requireJsonBody<{ limit?: number }>(request).catch(() => ({
      limit: 10,
    }));
    const limit = Number.isFinite(Number(body.limit))
      ? Math.max(0, Math.min(50, Number(body.limit)))
      : 10;

    const result = await processMetadataJobs({
      serviceClient,
      actorUserId: auth.userId,
      requestId,
      limit,
    });

    await logChangelog({
      serviceClient,
      actorUserId: auth.userId,
      scope: "metadata",
      entityType: "metadata_job",
      action: "process_batch",
      requestId,
      afterJson: {
        reaped: result.reaped,
        claimed: result.claimed,
        processed: result.processed,
        ready: result.ready,
        failed: result.failed,
        pending: result.pending,
        queue: result.queue,
      },
    });

    return respond(200, result);
  }

  if (
    segments.length === 2 &&
    segments[0] === "metadata-jobs" &&
    segments[1] === "recompute" &&
    method === "POST"
  ) {
    const body = await requireJsonBody<{
      recipe_id?: string;
      recipe_version_id?: string;
    }>(request);

    const recipeVersionIdInput = typeof body.recipe_version_id === "string" &&
        body.recipe_version_id.length > 0
      ? parseUuid(body.recipe_version_id)
      : null;
    const recipeIdInput = typeof body.recipe_id === "string" &&
        body.recipe_id.length > 0
      ? parseUuid(body.recipe_id)
      : null;

    let recipeId = recipeIdInput;
    let recipeVersionId = recipeVersionIdInput;
    if (!recipeVersionId) {
      if (!recipeId) {
        throw new ApiError(
          400,
          "metadata_recompute_missing_target",
          "recipe_id or recipe_version_id is required",
        );
      }

      const { data: recipe, error: recipeError } = await client
        .from("recipes")
        .select("id,current_version_id")
        .eq("id", recipeId)
        .maybeSingle();
      if (recipeError || !recipe?.current_version_id) {
        throw new ApiError(
          404,
          "metadata_recompute_recipe_not_found",
          "Recipe version was not found for recompute",
          recipeError?.message,
        );
      }
      recipeVersionId = recipe.current_version_id;
    }

    if (!recipeId) {
      const { data: version, error: versionError } = await client
        .from("recipe_versions")
        .select("recipe_id")
        .eq("id", recipeVersionId)
        .maybeSingle();
      if (versionError || !version?.recipe_id) {
        throw new ApiError(
          404,
          "metadata_recompute_version_not_found",
          "Recipe version was not found",
          versionError?.message,
        );
      }
      recipeId = version.recipe_id;
    }

    if (!recipeId || !recipeVersionId) {
      throw new ApiError(
        400,
        "metadata_recompute_missing_target",
        "recipe_id and recipe_version_id are required",
      );
    }

    await enqueueRecipeMetadataJob({
      serviceClient,
      recipeId,
      recipeVersionId,
    });
    scheduleMetadataQueueDrain({
      serviceClient,
      actorUserId: auth.userId,
      requestId,
      limit: 5,
    });

    await logChangelog({
      serviceClient,
      actorUserId: auth.userId,
      scope: "metadata",
      entityType: "metadata_job",
      entityId: recipeVersionId,
      action: "manual_recompute",
      requestId,
      afterJson: {
        recipe_id: recipeId,
        recipe_version_id: recipeVersionId,
      },
    });

    return respond(200, {
      ok: true,
      recipe_id: recipeId,
      recipe_version_id: recipeVersionId,
    });
  }

  if (
    segments.length === 2 &&
    segments[0] === "metadata-jobs" &&
    segments[1] === "retry" &&
    method === "POST"
  ) {
    const body = await requireJsonBody<{ job_id?: string }>(request);
    const jobId = parseUuid(body.job_id ?? "");

    const { data: retried, error: retryError } = await serviceClient
      .from("recipe_metadata_jobs")
      .update({
        status: "pending",
        stage: "queued",
        attempts: 0,
        next_attempt_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
        last_error: null,
        last_stage_error: null,
        current_run_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .in("status", ["pending", "processing", "failed"])
      .select("id,status,attempts,next_attempt_at")
      .maybeSingle();

    if (retryError) {
      throw new ApiError(
        500,
        "metadata_job_retry_failed",
        "Could not retry metadata job",
        retryError.message,
      );
    }
    if (!retried) {
      throw new ApiError(
        404,
        "metadata_job_not_found",
        "Metadata job not found",
      );
    }

    await logChangelog({
      serviceClient,
      actorUserId: auth.userId,
      scope: "metadata",
      entityType: "metadata_job",
      entityId: jobId,
      action: "manual_retry",
      requestId,
    });
    scheduleMetadataQueueDrain({
      serviceClient,
      actorUserId: auth.userId,
      requestId,
      limit: 5,
    });

    return respond(200, { ok: true, job: retried });
  }

  if (
    segments.length === 2 &&
    segments[0] === "metadata-jobs" &&
    segments[1] === "recompute-scope" &&
    method === "POST"
  ) {
    const body = await requireJsonBody<{
      recipe_ids?: string[];
      recipe_version_ids?: string[];
      leaked_only?: boolean;
      current_versions_only?: boolean;
      limit?: number;
    }>(request);

    const limit = Number.isFinite(Number(body.limit))
      ? Math.max(1, Math.min(500, Number(body.limit)))
      : 500;
    const leakedOnly = body.leaked_only === true;
    const currentVersionsOnly = body.current_versions_only !== false;

    const requestedRecipeVersionIds = new Set<string>();
    for (const value of Array.isArray(body.recipe_version_ids)
      ? body.recipe_version_ids
      : []) {
      if (typeof value !== "string" || value.trim().length === 0) continue;
      requestedRecipeVersionIds.add(parseUuid(value));
    }

    const requestedRecipeIds = Array.from(
      new Set(
        (Array.isArray(body.recipe_ids) ? body.recipe_ids : [])
          .filter((value): value is string =>
            typeof value === "string" && value.trim().length > 0
          )
          .map((value) => parseUuid(value)),
      ),
    );

    if (requestedRecipeIds.length > 0) {
      if (currentVersionsOnly) {
        const { data: recipes, error: recipeError } = await serviceClient
          .from("recipes")
          .select("id,current_version_id")
          .in("id", requestedRecipeIds);
        if (recipeError) {
          throw new ApiError(
            500,
            "metadata_recompute_scope_recipe_fetch_failed",
            "Could not fetch requested recipes for recompute scope",
            recipeError.message,
          );
        }
        for (const recipe of recipes ?? []) {
          if (recipe.current_version_id) {
            requestedRecipeVersionIds.add(String(recipe.current_version_id));
          }
        }
      } else {
        const { data: versions, error: versionsError } = await serviceClient
          .from("recipe_versions")
          .select("id")
          .in("recipe_id", requestedRecipeIds);
        if (versionsError) {
          throw new ApiError(
            500,
            "metadata_recompute_scope_versions_fetch_failed",
            "Could not fetch recipe versions for recompute scope",
            versionsError.message,
          );
        }
        for (const version of versions ?? []) {
          requestedRecipeVersionIds.add(String(version.id));
        }
      }
    }

    let leakedVersionIds = new Set<string>();
    if (leakedOnly) {
      const { data: leakedRows, error: leakedError } = await serviceClient
        .from("recipe_ingredients")
        .select("recipe_version_id")
        .eq("normalized_status", "needs_retry")
        .not("ingredient_id", "is", null);
      if (leakedError) {
        throw new ApiError(
          500,
          "metadata_recompute_scope_leaked_fetch_failed",
          "Could not fetch leaked ingredient rows for recompute scope",
          leakedError.message,
        );
      }
      leakedVersionIds = new Set(
        (leakedRows ?? []).map((row) => String(row.recipe_version_id)),
      );
    }

    let currentVersionIds = new Set<string>();
    if (currentVersionsOnly) {
      const { data: currentRows, error: currentRowsError } = await serviceClient
        .from("recipes")
        .select("current_version_id")
        .not("current_version_id", "is", null);
      if (currentRowsError) {
        throw new ApiError(
          500,
          "metadata_recompute_scope_current_versions_fetch_failed",
          "Could not fetch current versions for recompute scope",
          currentRowsError.message,
        );
      }
      currentVersionIds = new Set(
        (currentRows ?? []).map((row) => String(row.current_version_id)),
      );
    }

    let targetVersionIds = Array.from(requestedRecipeVersionIds);
    if (leakedOnly) {
      targetVersionIds = targetVersionIds.length > 0
        ? targetVersionIds.filter((id) => leakedVersionIds.has(id))
        : Array.from(leakedVersionIds);
    }
    if (currentVersionsOnly) {
      targetVersionIds = targetVersionIds.length > 0
        ? targetVersionIds.filter((id) => currentVersionIds.has(id))
        : Array.from(currentVersionIds);
    }

    if (targetVersionIds.length === 0) {
      return respond(200, {
        ok: true,
        enqueued: 0,
        recipe_version_ids: [],
        note: "No matching recipe versions for requested scope",
      });
    }
    targetVersionIds = targetVersionIds.slice(0, limit);

    const { data: targetVersions, error: targetVersionsError } =
      await serviceClient
        .from("recipe_versions")
        .select("id,recipe_id")
        .in("id", targetVersionIds);
    if (targetVersionsError) {
      throw new ApiError(
        500,
        "metadata_recompute_scope_targets_fetch_failed",
        "Could not resolve recompute scope targets",
        targetVersionsError.message,
      );
    }

    let enqueued = 0;
    for (const version of targetVersions ?? []) {
      await enqueueRecipeMetadataJob({
        serviceClient,
        recipeId: String(version.recipe_id),
        recipeVersionId: String(version.id),
      });
      enqueued += 1;
    }

    if (enqueued > 0) {
      scheduleMetadataQueueDrain({
        serviceClient,
        actorUserId: auth.userId,
        requestId,
        limit: Math.min(50, Math.max(5, enqueued)),
      });
    }

    await logChangelog({
      serviceClient,
      actorUserId: auth.userId,
      scope: "metadata",
      entityType: "metadata_job",
      action: "manual_recompute_scope",
      requestId,
      afterJson: {
        enqueued,
        leaked_only: leakedOnly,
        current_versions_only: currentVersionsOnly,
        recipe_version_ids: (targetVersions ?? []).map((row) => row.id),
      },
    });

    return respond(200, {
      ok: true,
      enqueued,
      recipe_version_ids: (targetVersions ?? []).map((row) => row.id),
    });
  }

  return null;
};
