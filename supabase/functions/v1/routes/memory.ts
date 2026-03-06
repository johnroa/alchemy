import {
  ApiError,
  requireJsonBody,
} from "../../_shared/errors.ts";
import type { JsonValue } from "../../_shared/types.ts";
import type { RouteContext } from "./shared.ts";

type MemoryDeps = {
  getActiveMemories: (
    client: RouteContext["client"],
    userId: string,
    limit: number,
  ) => Promise<unknown[]>;
  getMemorySnapshot: (
    client: RouteContext["client"],
    userId: string,
  ) => Promise<Record<string, JsonValue>>;
  getLimit: (url: URL, defaultLimit: number) => number;
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
  processMemoryJobs: (input: {
    userClient: RouteContext["client"];
    serviceClient: RouteContext["serviceClient"];
    actorUserId: string;
    requestId: string;
    limit: number;
  }) => Promise<{
    processed: number;
    succeeded: number;
    failed: number;
    queue: Record<string, JsonValue>;
  }>;
};

export const handleMemoryRoutes = async (
  context: RouteContext,
  deps: MemoryDeps,
): Promise<Response | null> => {
  const {
    request,
    url,
    segments,
    method,
    auth,
    client,
    serviceClient,
    requestId,
    respond,
  } = context;
  const {
    getActiveMemories,
    getMemorySnapshot,
    getLimit,
    parseUuid,
    logChangelog,
    processMemoryJobs,
  } = deps;

  if (segments.length === 1 && segments[0] === "memories") {
    if (method === "GET") {
      const memories = await getActiveMemories(
        client,
        auth.userId,
        getLimit(url, 100),
      );
      const snapshot = await getMemorySnapshot(client, auth.userId);
      return respond(200, { items: memories, snapshot });
    }
  }

  if (
    segments.length === 2 &&
    segments[0] === "memories" &&
    segments[1] === "reset" &&
    method === "POST"
  ) {
    const resetResult = await client
      .from("memories")
      .update({ status: "deleted", updated_at: new Date().toISOString() })
      .eq("user_id", auth.userId)
      .eq("status", "active");

    if (resetResult.error) {
      throw new ApiError(
        500,
        "memory_reset_failed",
        "Could not reset memories",
        resetResult.error.message,
      );
    }

    const snapshotResult = await client.from("memory_snapshots").upsert({
      user_id: auth.userId,
      summary: {},
      token_estimate: 0,
      updated_at: new Date().toISOString(),
    });
    if (snapshotResult.error) {
      throw new ApiError(
        500,
        "memory_reset_failed",
        "Could not reset memory snapshot",
        snapshotResult.error.message,
      );
    }

    await logChangelog({
      serviceClient,
      actorUserId: auth.userId,
      scope: "memory",
      entityType: "memory",
      entityId: auth.userId,
      action: "reset",
      requestId,
    });

    return respond(200, { ok: true });
  }

  if (
    segments.length === 2 &&
    segments[0] === "memories" &&
    segments[1] === "forget" &&
    method === "POST"
  ) {
    const body = await requireJsonBody<{ memory_id: string }>(request);
    const memoryId = parseUuid(body.memory_id);

    const forgetResult = await client
      .from("memories")
      .update({ status: "deleted", updated_at: new Date().toISOString() })
      .eq("id", memoryId)
      .eq("user_id", auth.userId);

    if (forgetResult.error) {
      throw new ApiError(
        500,
        "memory_forget_failed",
        "Could not forget memory",
        forgetResult.error.message,
      );
    }

    await logChangelog({
      serviceClient,
      actorUserId: auth.userId,
      scope: "memory",
      entityType: "memory",
      entityId: memoryId,
      action: "forgotten",
      requestId,
    });

    return respond(200, { ok: true });
  }

  if (segments.length === 1 && segments[0] === "changelog" && method === "GET") {
    const limit = getLimit(url, 100);
    const changelogResult = await client
      .from("changelog_events")
      .select(
        "id,scope,entity_type,entity_id,action,request_id,before_json,after_json,metadata,created_at",
      )
      .eq("actor_user_id", auth.userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (changelogResult.error) {
      throw new ApiError(
        500,
        "changelog_fetch_failed",
        "Could not load changelog",
        changelogResult.error.message,
      );
    }

    return respond(200, { items: changelogResult.data ?? [] });
  }

  if (
    segments.length === 2 &&
    segments[0] === "memory-jobs" &&
    segments[1] === "process" &&
    method === "POST"
  ) {
    const body = await requireJsonBody<{ limit?: number }>(request).catch(() => ({
      limit: 25,
    }));
    const limit = Number.isFinite(Number(body.limit))
      ? Math.max(1, Math.min(100, Number(body.limit)))
      : 25;

    const result = await processMemoryJobs({
      userClient: client,
      serviceClient,
      actorUserId: auth.userId,
      requestId,
      limit,
    });

    await logChangelog({
      serviceClient,
      actorUserId: auth.userId,
      scope: "memory",
      entityType: "memory_job",
      action: "process_batch",
      requestId,
      afterJson: {
        processed: result.processed,
        succeeded: result.succeeded,
        failed: result.failed,
        queue: result.queue,
      },
    });

    return respond(200, result);
  }

  if (
    segments.length === 2 &&
    segments[0] === "memory-jobs" &&
    segments[1] === "retry" &&
    method === "POST"
  ) {
    const body = await requireJsonBody<{ job_id?: string }>(request);
    const jobId = parseUuid(body.job_id ?? "");

    const { data: retried, error: retryError } = await client
      .from("memory_jobs")
      .update({
        status: "pending",
        attempts: 0,
        next_attempt_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .select("id,status,attempts,next_attempt_at")
      .maybeSingle();

    if (retryError) {
      throw new ApiError(
        500,
        "memory_job_retry_failed",
        "Could not retry memory job",
        retryError.message,
      );
    }
    if (!retried) {
      throw new ApiError(404, "memory_job_not_found", "Memory job not found");
    }

    await logChangelog({
      serviceClient,
      actorUserId: auth.userId,
      scope: "memory",
      entityType: "memory_job",
      entityId: jobId,
      action: "manual_retry",
      requestId,
    });

    return respond(200, { ok: true, job: retried });
  }

  return null;
};
