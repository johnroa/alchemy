import { assertEquals } from "jsr:@std/assert";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { handleInstallTelemetryRoutes } from "./routes/install-telemetry.ts";

type InstallProfileState = {
  install_id: string;
  acquisition_channel: string | null;
  campaign_token: string | null;
  provider_token: string | null;
  first_opened_at: string | null;
  last_seen_at: string | null;
  snapshot: Record<string, unknown>;
};

const createServiceClient = () => {
  const installProfiles = new Map<string, InstallProfileState>();
  const behaviorEvents: Array<Record<string, unknown>> = [];

  return {
    behaviorEvents,
    installProfiles,
    client: {
      from(table: string) {
        if (table === "behavior_events") {
          return {
            async upsert(payload: Record<string, unknown>[]) {
              behaviorEvents.push(...payload);
              return { error: null };
            },
          };
        }

        if (table === "install_profiles") {
          return {
            select(_columns: string) {
              return {
                eq(_column: string, installId: string) {
                  return {
                    async maybeSingle() {
                      return { data: installProfiles.get(installId) ?? null, error: null };
                    },
                  };
                },
              };
            },
            insert(payload: InstallProfileState) {
              return {
                select(_columns: string) {
                  return {
                    async single() {
                      installProfiles.set(payload.install_id, payload);
                      return { data: payload, error: null };
                    },
                  };
                },
              };
            },
            update(payload: InstallProfileState) {
              return {
                eq(_column: string, installId: string) {
                  return {
                    select(_columns: string) {
                      return {
                        async single() {
                          installProfiles.set(installId, payload);
                          return { data: payload, error: null };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        }

        throw new Error(`unexpected table: ${table}`);
      },
    },
  };
};

const createContext = (body: unknown, serviceClient: SupabaseClient) => ({
  request: new Request("https://api.cookwithalchemy.com/v1/telemetry/install", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }),
  segments: ["telemetry", "install"],
  method: "POST",
  serviceClient,
  respond: (status: number, responseBody: unknown) =>
    new Response(JSON.stringify(responseBody), {
      status,
      headers: { "content-type": "application/json" },
    }),
});

Deno.test("POST /telemetry/install accepts anonymous install events and rejects non-install types", async () => {
  const state = createServiceClient();
  const response = await handleInstallTelemetryRoutes(
    createContext(
      {
        install_id: "install-1",
        events: [
          {
            event_id: "event-1",
            event_type: "app_first_open",
            occurred_at: "2026-03-07T12:00:00.000Z",
            payload: {
              acquisition_channel: "waitlist",
              campaign_token: "launch-week-1",
            },
          },
          {
            event_id: "event-2",
            event_type: "chat_turn_submitted",
            occurred_at: "2026-03-07T12:01:00.000Z",
          },
        ],
      },
      state.client as unknown as SupabaseClient,
    ),
  );

  assertEquals(response?.status, 202);
  assertEquals(await response?.json(), { accepted: 1, rejected: 1 });
  assertEquals(state.behaviorEvents.length, 1);
  assertEquals(state.behaviorEvents[0]?.["install_id"], "install-1");
  assertEquals(state.installProfiles.size, 1);
  assertEquals(state.installProfiles.get("install-1")?.acquisition_channel, "waitlist");
});

Deno.test("POST /telemetry/install keeps a single install profile across repeated first-open sends", async () => {
  const state = createServiceClient();

  const firstResponse = await handleInstallTelemetryRoutes(
    createContext(
      {
        install_id: "install-2",
        events: [{
          event_id: "event-1",
          event_type: "app_first_open",
          occurred_at: "2026-03-07T12:00:00.000Z",
          payload: { acquisition_channel: "organic" },
        }],
      },
      state.client as unknown as SupabaseClient,
    ),
  );

  const secondResponse = await handleInstallTelemetryRoutes(
    createContext(
      {
        install_id: "install-2",
        events: [{
          event_id: "event-2",
          event_type: "app_first_open",
          occurred_at: "2026-03-07T12:05:00.000Z",
          payload: { acquisition_channel: "waitlist" },
        }],
      },
      state.client as unknown as SupabaseClient,
    ),
  );

  assertEquals(firstResponse?.status, 202);
  assertEquals(secondResponse?.status, 202);
  assertEquals(state.installProfiles.size, 1);
  assertEquals(state.installProfiles.get("install-2")?.acquisition_channel, "organic");
  assertEquals(state.installProfiles.get("install-2")?.first_opened_at, "2026-03-07T12:00:00.000Z");
  assertEquals(state.installProfiles.get("install-2")?.last_seen_at, "2026-03-07T12:05:00.000Z");
});

Deno.test("POST /telemetry/install schedules a For You preload for linked app sessions", async () => {
  const state = createServiceClient();
  const lookupCalls: string[][] = [];
  const preloadUserIds: string[] = [];

  const response = await handleInstallTelemetryRoutes(
    createContext(
      {
        install_id: "install-linked",
        events: [{
          event_id: "event-1",
          event_type: "app_session_started",
          occurred_at: "2026-03-07T12:00:00.000Z",
        }],
      },
      state.client as unknown as SupabaseClient,
    ),
    {
      lookupUserIdsForInstallIds: async ({ installIds }) => {
        lookupCalls.push(installIds);
        return new Map([["install-linked", "user-123"]]);
      },
      scheduleExploreForYouPreload: ({ userId }) => {
        preloadUserIds.push(userId);
      },
    },
  );

  assertEquals(response?.status, 202);
  assertEquals(lookupCalls, [["install-linked"]]);
  assertEquals(preloadUserIds, ["user-123"]);
});
