import { assertEquals } from "jsr:@std/assert";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  clearFeatureFlagCacheForTests,
  inferFeatureFlagEnvironmentFromUrl,
  resolveRuntimeFlags,
} from "./lib/feature-flags.ts";
import { handleFeatureFlagRoutes } from "./routes/flags.ts";
import type { RouteContext } from "./routes/shared.ts";

type FlagConfigFixture = {
  environment_key: "development" | "production";
  enabled: boolean;
  payload_json: Record<string, unknown> | null;
  feature_flags: {
    flag_key: string;
    flag_type: "release" | "operational" | "kill_switch" | "permission";
    archived_at: string | null;
  };
};

type FakeFeatureFlagState = {
  revisions: Record<"development" | "production", number>;
  configs: FlagConfigFixture[];
  revisionReads: number;
  configReads: number;
};

const createFeatureFlagServiceClient = (
  state: FakeFeatureFlagState,
): SupabaseClient =>
  ({
    from(table: string) {
      if (table === "feature_flag_state_revisions") {
        return {
          select(_columns: string) {
            return {
              eq(_column: string, environment: string) {
                return {
                  async maybeSingle() {
                    state.revisionReads += 1;
                    return {
                      data: { revision: state.revisions[environment as "development" | "production"] ?? 1 },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "feature_flag_environment_configs") {
        return {
          select(_columns: string) {
            return {
              async eq(_column: string, environment: string) {
                state.configReads += 1;
                return {
                  data: state.configs.filter((config) => config.environment_key === environment),
                  error: null,
                };
              },
            };
          },
        };
      }

      throw new Error(`unexpected table: ${table}`);
    },
  }) as unknown as SupabaseClient;

const createRouteContext = (params: {
  url: string;
  body: unknown;
  serviceClient: SupabaseClient;
}): RouteContext => ({
  request: new Request(params.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params.body),
  }),
  url: new URL(params.url),
  segments: ["flags", "resolve"],
  method: "POST",
  requestId: "req-1",
  auth: {
    authHeader: "Bearer token",
    userId: "user-1",
    email: "user@alchemy.test",
    fullName: null,
    avatarUrl: null,
  },
  client: {} as SupabaseClient,
  serviceClient: params.serviceClient,
  respond: (status: number, responseBody: unknown) =>
    new Response(JSON.stringify(responseBody), {
      status,
      headers: { "content-type": "application/json" },
    }),
});

Deno.test("inferFeatureFlagEnvironmentFromUrl distinguishes development hosts", () => {
  assertEquals(
    inferFeatureFlagEnvironmentFromUrl("http://localhost:8787/v1/flags/resolve"),
    "development",
  );
  assertEquals(
    inferFeatureFlagEnvironmentFromUrl("https://api.cookwithalchemy.com/v1/flags/resolve"),
    "production",
  );
});

Deno.test("resolveRuntimeFlags returns resolved, missing, archived, and payload values", async () => {
  clearFeatureFlagCacheForTests();
  const state: FakeFeatureFlagState = {
    revisions: { development: 1, production: 1 },
    revisionReads: 0,
    configReads: 0,
    configs: [
      {
        environment_key: "production",
        enabled: true,
        payload_json: { mode: "shadow" },
        feature_flags: {
          flag_key: "recipe_canon_match",
          flag_type: "operational",
          archived_at: null,
        },
      },
      {
        environment_key: "production",
        enabled: true,
        payload_json: { note: "legacy" },
        feature_flags: {
          flag_key: "legacy_flag",
          flag_type: "release",
          archived_at: "2026-03-08T12:00:00.000Z",
        },
      },
    ],
  };

  const resolved = await resolveRuntimeFlags({
    serviceClient: createFeatureFlagServiceClient(state),
    environment: "production",
    keys: ["recipe_canon_match", "missing_flag", "legacy_flag"],
  });

  assertEquals(resolved.environment, "production");
  assertEquals(resolved.revision, 1);
  assertEquals(resolved.flags.recipe_canon_match, {
    enabled: true,
    payload: { mode: "shadow" },
    reason: "resolved",
    flag_type: "operational",
  });
  assertEquals(resolved.flags.missing_flag, {
    enabled: false,
    payload: null,
    reason: "missing",
    flag_type: null,
  });
  assertEquals(resolved.flags.legacy_flag, {
    enabled: false,
    payload: null,
    reason: "archived",
    flag_type: "release",
  });
});

Deno.test("resolveRuntimeFlags uses revisions to invalidate cached compiled state", async () => {
  clearFeatureFlagCacheForTests();
  const state: FakeFeatureFlagState = {
    revisions: { development: 1, production: 1 },
    revisionReads: 0,
    configReads: 0,
    configs: [{
      environment_key: "production",
      enabled: false,
      payload_json: null,
      feature_flags: {
        flag_key: "same_canon_image_judge",
        flag_type: "operational",
        archived_at: null,
      },
    }],
  };
  const serviceClient = createFeatureFlagServiceClient(state);
  const originalDateNow = Date.now;
  let currentTime = 0;
  Date.now = () => currentTime;

  try {
    await resolveRuntimeFlags({
      serviceClient,
      environment: "production",
      keys: ["same_canon_image_judge"],
    });
    assertEquals(state.revisionReads, 1);
    assertEquals(state.configReads, 1);

    currentTime = 1_000;
    await resolveRuntimeFlags({
      serviceClient,
      environment: "production",
      keys: ["same_canon_image_judge"],
    });
    assertEquals(state.revisionReads, 1);
    assertEquals(state.configReads, 1);

    currentTime = 6_000;
    await resolveRuntimeFlags({
      serviceClient,
      environment: "production",
      keys: ["same_canon_image_judge"],
    });
    assertEquals(state.revisionReads, 2);
    assertEquals(state.configReads, 1);

    state.revisions.production = 2;
    currentTime = 12_000;
    await resolveRuntimeFlags({
      serviceClient,
      environment: "production",
      keys: ["same_canon_image_judge"],
    });
    assertEquals(state.revisionReads, 3);
    assertEquals(state.configReads, 2);
  } finally {
    Date.now = originalDateNow;
    clearFeatureFlagCacheForTests();
  }
});

Deno.test("POST /flags/resolve resolves using the request host environment", async () => {
  clearFeatureFlagCacheForTests();
  const state: FakeFeatureFlagState = {
    revisions: { development: 2, production: 4 },
    revisionReads: 0,
    configReads: 0,
    configs: [
      {
        environment_key: "development",
        enabled: false,
        payload_json: null,
        feature_flags: {
          flag_key: "same_canon_image_judge",
          flag_type: "operational",
          archived_at: null,
        },
      },
      {
        environment_key: "production",
        enabled: true,
        payload_json: null,
        feature_flags: {
          flag_key: "same_canon_image_judge",
          flag_type: "operational",
          archived_at: null,
        },
      },
    ],
  };
  const serviceClient = createFeatureFlagServiceClient(state);

  const productionResponse = await handleFeatureFlagRoutes(
    createRouteContext({
      url: "https://api.cookwithalchemy.com/v1/flags/resolve",
      body: { keys: ["same_canon_image_judge"] },
      serviceClient,
    }),
  );
  const developmentResponse = await handleFeatureFlagRoutes(
    createRouteContext({
      url: "http://localhost:54321/v1/flags/resolve",
      body: { keys: ["same_canon_image_judge"] },
      serviceClient,
    }),
  );

  assertEquals(productionResponse?.status, 200);
  assertEquals(await productionResponse?.json(), {
    environment: "production",
    revision: 4,
    flags: {
      same_canon_image_judge: {
        enabled: true,
        payload: null,
        reason: "resolved",
        flag_type: "operational",
      },
    },
  });

  assertEquals(developmentResponse?.status, 200);
  assertEquals(await developmentResponse?.json(), {
    environment: "development",
    revision: 2,
    flags: {
      same_canon_image_judge: {
        enabled: false,
        payload: null,
        reason: "resolved",
        flag_type: "operational",
      },
    },
  });
});
