import { requireJsonBody } from "../../_shared/errors.ts";
import type { JsonValue } from "../../_shared/types.ts";
import { isBehaviorSurface } from "../../../../packages/shared/src/behavior-events.ts";
import { logBehaviorEvents, normalizeBehaviorEventInput } from "../lib/behavior-events.ts";
import { enqueueDemandExtractionJob } from "../lib/demand/index.ts";
import { scheduleDemandQueueDrain } from "../lib/background-tasks.ts";
import type { RouteContext } from "./shared.ts";

export const handleTelemetryRoutes = async (
  context: RouteContext,
): Promise<Response | null> => {
  const { request, segments, method, auth, serviceClient, requestId, respond } = context;

  if (
    segments.length === 2 &&
    segments[0] === "telemetry" &&
    segments[1] === "behavior" &&
    method === "POST"
  ) {
    const body = await requireJsonBody<{
      install_id?: string;
      events?: Array<{
        event_id?: string;
        event_type: string;
        surface?: string;
        occurred_at?: string;
        session_id?: string;
        entity_type?: string;
        entity_id?: string;
        source_surface?: string;
        algorithm_version?: string;
        payload?: Record<string, JsonValue>;
      }>;
    }>(request);

    const normalizedEvents = [];
    const rejectedEventTypes: string[] = [];
    for (const event of body.events ?? []) {
      const normalized = normalizeBehaviorEventInput({
        eventId: event.event_id,
        installId: body.install_id,
        eventType: event.event_type,
        surface: event.surface && isBehaviorSurface(event.surface) ? event.surface : null,
        occurredAt: event.occurred_at,
        sessionId: event.session_id,
        entityType: event.entity_type,
        entityId: event.entity_id,
        sourceSurface: event.source_surface,
        algorithmVersion: event.algorithm_version,
        payload: event.payload,
        userId: auth.userId,
      });

      if (!normalized) {
        rejectedEventTypes.push(event.event_type);
        continue;
      }
      normalizedEvents.push(normalized);
    }

    await logBehaviorEvents({
      serviceClient,
      events: normalizedEvents,
    });

    for (const event of normalizedEvents) {
      if (event.eventType !== "recipe_cooked_inferred" && event.eventType !== "ingredient_substitution_applied") {
        continue;
      }
      if (!event.eventId) {
        continue;
      }

      await enqueueDemandExtractionJob({
        serviceClient,
        sourceKind: "behavior_event",
        sourceId: event.eventId,
        userId: auth.userId,
        stage: event.eventType === "recipe_cooked_inferred" ? "consumption" : "feedback",
        extractorScope: "demand_summarize_outcome_reason",
        observedAt: event.occurredAt,
        payload: {
          event_type: event.eventType,
          entity_id: event.entityId ?? null,
          session_id: event.sessionId ?? null,
          payload: (event.payload ?? {}) as JsonValue,
        },
      });
    }

    if (normalizedEvents.some((event) =>
      event.eventType === "recipe_cooked_inferred" ||
      event.eventType === "ingredient_substitution_applied"
    )) {
      scheduleDemandQueueDrain({
        serviceClient,
        actorUserId: auth.userId,
        requestId,
        limit: 2,
      });
    }

    return respond(202, {
      accepted: normalizedEvents.length,
      rejected: Math.max(0, (body.events ?? []).length - normalizedEvents.length),
      rejected_event_types: Array.from(new Set(rejectedEventTypes)),
    });
  }

  return null;
};
