import { requireJsonBody } from "../../_shared/errors.ts";
import type { JsonValue } from "../../_shared/types.ts";
import type { RouteContext } from "./shared.ts";

type DemandDeps = {
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
  processDemandExtractionJobs: (input: {
    serviceClient: RouteContext["serviceClient"];
    actorUserId: string;
    requestId: string;
    limit: number;
  }) => Promise<{
    reaped: number;
    claimed: number;
    processed: number;
    completed: number;
    failed: number;
    deadLettered: number;
    graph: Record<string, JsonValue>;
    queue: Record<string, JsonValue>;
  }>;
  backfillDemandExtractionJobs: (input: {
    serviceClient: RouteContext["serviceClient"];
    requestId: string;
    userId?: string;
    hours?: number;
    limit: number;
  }) => Promise<{
    chatMessages: number;
    imports: number;
    behaviorEvents: number;
  }>;
};

export const handleDemandRoutes = async (
  context: RouteContext,
  deps: DemandDeps,
): Promise<Response | null> => {
  const { request, segments, method, auth, serviceClient, requestId, respond } = context;
  const { parseUuid, logChangelog, processDemandExtractionJobs, backfillDemandExtractionJobs } = deps;

  if (
    segments.length === 2 &&
    segments[0] === "demand-jobs" &&
    segments[1] === "process" &&
    method === "POST"
  ) {
    const body = await requireJsonBody<{ limit?: number }>(request).catch(() => ({
      limit: 10,
    }));
    const limit = Number.isFinite(Number(body.limit))
      ? Math.max(1, Math.min(100, Number(body.limit)))
      : 10;
    const result = await processDemandExtractionJobs({
      serviceClient,
      actorUserId: auth.userId,
      requestId,
      limit,
    });

    await logChangelog({
      serviceClient,
      actorUserId: auth.userId,
      scope: "demand",
      entityType: "demand_job",
      action: "processed",
      requestId,
      afterJson: result as unknown as JsonValue,
    });

    return respond(200, result);
  }

  if (
    segments.length === 2 &&
    segments[0] === "demand-jobs" &&
    segments[1] === "backfill" &&
    method === "POST"
  ) {
    const body: {
      user_id?: string;
      hours?: number;
      limit?: number;
      process_now?: boolean;
    } = await requireJsonBody<{
      user_id?: string;
      hours?: number;
      limit?: number;
      process_now?: boolean;
    }>(request).catch(() => ({}));

    const userId = typeof body.user_id === "string" && body.user_id.trim().length > 0
      ? parseUuid(body.user_id)
      : undefined;
    const limit = Number.isFinite(Number(body.limit))
      ? Math.max(1, Math.min(500, Number(body.limit)))
      : 200;
    const hours = Number.isFinite(Number(body.hours))
      ? Math.max(1, Math.min(24 * 30, Number(body.hours)))
      : 24 * 7;
    const backfill = await backfillDemandExtractionJobs({
      serviceClient,
      requestId,
      userId,
      hours,
      limit,
    });

    let processed: Record<string, JsonValue> | null = null;
    if (body.process_now === true) {
      const processResult = await processDemandExtractionJobs({
        serviceClient,
        actorUserId: auth.userId,
        requestId,
        limit: Math.min(limit, 50),
      });
      processed = processResult as unknown as Record<string, JsonValue>;
    }

    const payload = {
      ...backfill,
      processed,
    };

    await logChangelog({
      serviceClient,
      actorUserId: auth.userId,
      scope: "demand",
      entityType: "demand_job",
      action: "backfilled",
      requestId,
      afterJson: payload as unknown as JsonValue,
    });

    return respond(200, payload);
  }

  return null;
};
