import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { isInstallTelemetryEventType } from "../../../../packages/shared/src/acquisition.ts";
import { requireJsonBody } from "../../_shared/errors.ts";
import type { JsonValue } from "../../_shared/types.ts";
import { logBehaviorEvents, normalizeBehaviorEventInput } from "../lib/behavior-events.ts";
import {
  lookupUserIdsForInstallIds,
  scheduleExploreForYouPreload,
} from "../lib/explore-preload.ts";

type InstallTelemetryContext = {
  request: Request;
  segments: string[];
  method: string;
  serviceClient: SupabaseClient;
  respond: (status: number, body: unknown) => Response;
};

export const handleInstallTelemetryRoutes = async (
  context: InstallTelemetryContext,
  deps: {
    lookupUserIdsForInstallIds: typeof lookupUserIdsForInstallIds;
    scheduleExploreForYouPreload: typeof scheduleExploreForYouPreload;
  } = {
    lookupUserIdsForInstallIds,
    scheduleExploreForYouPreload,
  },
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

  const appSessionInstallIds = Array.from(
    new Set(
      events
        .filter((event) => event.eventType === "app_session_started")
        .map((event) => event.installId)
        .filter((installId): installId is string => typeof installId === "string" && installId.length > 0),
    ),
  );
  const installUserMap = await deps.lookupUserIdsForInstallIds({
    serviceClient,
    installIds: appSessionInstallIds,
  });

  for (const installId of appSessionInstallIds) {
    const userId = installUserMap.get(installId);
    if (!userId) {
      continue;
    }
    deps.scheduleExploreForYouPreload({
      serviceClient,
      userId,
      requestId: `install-preload:${installId}:${crypto.randomUUID()}`,
    });
  }

  return respond(202, {
    accepted: events.length,
    rejected: Math.max(0, (body.events ?? []).length - events.length),
  });
};
