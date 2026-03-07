import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { isInstallTelemetryEventType } from "../../../../packages/shared/src/acquisition.ts";
import { requireJsonBody } from "../../_shared/errors.ts";
import type { JsonValue } from "../../_shared/types.ts";
import { logBehaviorEvents, normalizeBehaviorEventInput } from "../lib/behavior-events.ts";

type InstallTelemetryContext = {
  request: Request;
  segments: string[];
  method: string;
  serviceClient: SupabaseClient;
  respond: (status: number, body: unknown) => Response;
};

export const handleInstallTelemetryRoutes = async (
  context: InstallTelemetryContext,
): Promise<Response | null> => {
  const { request, segments, method, serviceClient, respond } = context;

  if (
    segments.length !== 2 ||
    segments[0] !== "telemetry" ||
    segments[1] !== "install" ||
    method !== "POST"
  ) {
    return null;
  }

  const body = await requireJsonBody<{
    install_id?: string;
    events?: Array<{
      event_id?: string;
      event_type?: string;
      occurred_at?: string;
      payload?: Record<string, JsonValue>;
    }>;
  }>(request);

  const installId = typeof body.install_id === "string" ? body.install_id : null;
  const events = (body.events ?? [])
    .filter((event) => isInstallTelemetryEventType(String(event.event_type ?? "")))
    .map((event) =>
      normalizeBehaviorEventInput({
        eventId: event.event_id,
        installId,
        eventType: String(event.event_type),
        occurredAt: event.occurred_at,
        payload: event.payload,
      })
    )
    .filter((event) => event !== null);

  await logBehaviorEvents({
    serviceClient,
    events,
  });

  return respond(202, {
    accepted: events.length,
    rejected: Math.max(0, (body.events ?? []).length - events.length),
  });
};
