import { requireJsonBody } from "../../_shared/errors.ts";
import type { JsonValue } from "../../_shared/types.ts";
import { logBehaviorEvents, normalizeBehaviorEventInput } from "../lib/behavior-events.ts";
import type { RouteContext } from "./shared.ts";

export const handleTelemetryRoutes = async (
  context: RouteContext,
): Promise<Response | null> => {
  const { request, segments, method, auth, serviceClient, respond } = context;

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

    const normalizedEvents = (body.events ?? [])
      .map((event) =>
        normalizeBehaviorEventInput({
          eventId: event.event_id,
          installId: body.install_id,
          eventType: event.event_type,
          surface: event.surface,
          occurredAt: event.occurred_at,
          sessionId: event.session_id,
          entityType: event.entity_type,
          entityId: event.entity_id,
          sourceSurface: event.source_surface,
          algorithmVersion: event.algorithm_version,
          payload: event.payload,
          userId: auth.userId,
        })
      )
      .filter((event) => event !== null);

    await logBehaviorEvents({
      serviceClient,
      events: normalizedEvents,
    });

    return respond(202, {
      accepted: normalizedEvents.length,
      rejected: Math.max(0, (body.events ?? []).length - normalizedEvents.length),
    });
  }

  return null;
};
