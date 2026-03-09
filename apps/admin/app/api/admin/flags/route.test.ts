import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PATCH, POST } from "./route";
import { POST as previewPOST } from "./preview/route";

const mocks = vi.hoisted(() => ({
  getAdminClient: vi.fn(),
  requireCloudflareAccess: vi.fn(),
  loadFeatureFlagsAdminSnapshot: vi.fn(),
  getFeatureFlagByKey: vi.fn(),
  previewFeatureFlags: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  getAdminClient: mocks.getAdminClient,
  requireCloudflareAccess: mocks.requireCloudflareAccess,
}));

vi.mock("@/lib/feature-flags-admin", () => ({
  loadFeatureFlagsAdminSnapshot: mocks.loadFeatureFlagsAdminSnapshot,
  getFeatureFlagByKey: mocks.getFeatureFlagByKey,
  previewFeatureFlags: mocks.previewFeatureFlags,
}));

const snapshot = {
  environments: [
    {
      key: "development",
      label: "Development",
      description: "Local values",
      revision: 2,
      updated_at: "2026-03-08T12:00:00.000Z",
    },
    {
      key: "production",
      label: "Production",
      description: "Live values",
      revision: 4,
      updated_at: "2026-03-08T12:01:00.000Z",
    },
  ],
  flags: [
    {
      id: "flag-1",
      key: "recipe_canon_match",
      name: "Recipe Canon Match",
      description: "Controls canon matching.",
      flag_type: "operational",
      owner: "backend",
      tags: ["recipes", "canon"],
      expires_at: null,
      archived_at: null,
      created_at: "2026-03-08T12:00:00.000Z",
      updated_at: "2026-03-08T12:00:00.000Z",
      configs: {
        development: {
          environment_key: "development",
          enabled: false,
          payload_json: { mode: "shadow" },
          revision: 2,
          updated_by: "admin@cookwithalchemy.com",
          created_at: "2026-03-08T12:00:00.000Z",
          updated_at: "2026-03-08T12:00:00.000Z",
        },
        production: {
          environment_key: "production",
          enabled: true,
          payload_json: { mode: "shadow" },
          revision: 4,
          updated_by: "admin@cookwithalchemy.com",
          created_at: "2026-03-08T12:00:00.000Z",
          updated_at: "2026-03-08T12:01:00.000Z",
        },
      },
    },
  ],
};

const createAdminClient = () => {
  const insertFeatureFlags = vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn(async () => ({ data: { id: "flag-2" }, error: null })),
    })),
  }));
  const deleteFeatureFlags = vi.fn(() => ({
    eq: vi.fn(async () => ({ error: null })),
  }));
  const updateFeatureFlags = vi.fn(() => ({
    eq: vi.fn(async () => ({ error: null })),
  }));
  const insertConfigs = vi.fn(async () => ({ error: null }));
  const upsertConfigs = vi.fn(async () => ({ error: null }));
  const rpc = vi.fn(async () => ({ error: null }));

  return {
    client: {
      from(table: string) {
        if (table === "users") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: { id: "actor-1" },
                  error: null,
                })),
              })),
            })),
          };
        }

        if (table === "feature_flags") {
          return {
            insert: insertFeatureFlags,
            delete: deleteFeatureFlags,
            update: updateFeatureFlags,
          };
        }

        if (table === "feature_flag_environment_configs") {
          return {
            insert: insertConfigs,
            upsert: upsertConfigs,
          };
        }

        throw new Error(`unexpected table ${table}`);
      },
      rpc,
    },
    insertFeatureFlags,
    deleteFeatureFlags,
    updateFeatureFlags,
    insertConfigs,
    upsertConfigs,
    rpc,
  };
};

describe("admin flags routes", () => {
  beforeEach(() => {
    mocks.requireCloudflareAccess.mockResolvedValue({
      email: "admin@cookwithalchemy.com",
    });
    mocks.loadFeatureFlagsAdminSnapshot.mockReset();
    mocks.getFeatureFlagByKey.mockReset();
    mocks.previewFeatureFlags.mockReset();
  });

  it("returns the current snapshot on GET", async () => {
    const admin = createAdminClient();
    mocks.getAdminClient.mockReturnValue(admin.client);
    mocks.loadFeatureFlagsAdminSnapshot.mockResolvedValue(snapshot);

    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      environments: snapshot.environments,
      flags: snapshot.flags,
      key: null,
    });
  });

  it("creates a new flag with per-environment configs", async () => {
    const admin = createAdminClient();
    mocks.getAdminClient.mockReturnValue(admin.client);
    const createdSnapshot = {
      ...snapshot,
      flags: [
        ...snapshot.flags,
        {
          id: "flag-2",
          key: "same_canon_image_judge",
          name: "Same Canon Image Judge",
          description: "Controls judge reuse.",
          flag_type: "operational",
          owner: "backend",
          tags: ["images"],
          expires_at: null,
          archived_at: null,
          created_at: "2026-03-08T12:02:00.000Z",
          updated_at: "2026-03-08T12:02:00.000Z",
          configs: {
            development: null,
            production: null,
          },
        },
      ],
    };
    mocks.loadFeatureFlagsAdminSnapshot.mockResolvedValue(createdSnapshot);
    mocks.getFeatureFlagByKey.mockReturnValue(createdSnapshot.flags[1]);

    const response = await POST(new Request("https://admin.cookwithalchemy.com/api/admin/flags", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key: "same_canon_image_judge",
        name: "Same Canon Image Judge",
        description: "Controls judge reuse.",
        flag_type: "operational",
        owner: "backend",
        tags: ["images"],
        environment_configs: [
          {
            environment_key: "production",
            enabled: true,
            payload_json: null,
          },
        ],
      }),
    }));

    expect(response.status).toBe(200);
    expect(admin.insertFeatureFlags).toHaveBeenCalled();
    expect(admin.insertConfigs).toHaveBeenCalledWith([
      {
        flag_id: "flag-2",
        environment_key: "development",
        enabled: false,
        payload_json: null,
        updated_by: "admin@cookwithalchemy.com",
      },
      {
        flag_id: "flag-2",
        environment_key: "production",
        enabled: true,
        payload_json: null,
        updated_by: "admin@cookwithalchemy.com",
      },
    ]);
    expect(admin.rpc).toHaveBeenCalled();
  });

  it("updates metadata, environment config, and archive state on PATCH", async () => {
    const admin = createAdminClient();
    mocks.getAdminClient.mockReturnValue(admin.client);
    const archivedSnapshot = {
      ...snapshot,
      flags: [{
        ...snapshot.flags[0],
        archived_at: "2026-03-08T14:00:00.000Z",
      }],
    };
    mocks.loadFeatureFlagsAdminSnapshot
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(archivedSnapshot);
    mocks.getFeatureFlagByKey
      .mockReturnValueOnce(snapshot.flags[0])
      .mockReturnValueOnce(archivedSnapshot.flags[0]);

    const response = await PATCH(new Request("https://admin.cookwithalchemy.com/api/admin/flags", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key: "recipe_canon_match",
        name: "Recipe Canon Match",
        archived: true,
        environment_configs: [{
          environment_key: "production",
          enabled: false,
          payload_json: { mode: "shadow" },
        }],
      }),
    }));

    expect(response.status).toBe(200);
    expect(admin.updateFeatureFlags).toHaveBeenCalled();
    expect(admin.upsertConfigs).toHaveBeenCalledWith(
      [{
        flag_id: "flag-1",
        environment_key: "production",
        enabled: false,
        payload_json: { mode: "shadow" },
        updated_by: "admin@cookwithalchemy.com",
      }],
      { onConflict: "flag_id,environment_key" },
    );
    expect(admin.rpc).toHaveBeenCalled();
  });

  it("returns preview resolution for the selected environment", async () => {
    const admin = createAdminClient();
    mocks.getAdminClient.mockReturnValue(admin.client);
    mocks.loadFeatureFlagsAdminSnapshot.mockResolvedValue(snapshot);
    mocks.previewFeatureFlags.mockReturnValue({
      environment: "production",
      revision: 4,
      flags: {
        recipe_canon_match: {
          enabled: true,
          payload: { mode: "shadow" },
          reason: "resolved",
          flag_type: "operational",
        },
      },
    });

    const response = await previewPOST(new Request("https://admin.cookwithalchemy.com/api/admin/flags/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        environment: "production",
        keys: ["recipe_canon_match"],
      }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      resolution: {
        environment: "production",
        revision: 4,
        flags: {
          recipe_canon_match: {
            enabled: true,
            payload: { mode: "shadow" },
            reason: "resolved",
            flag_type: "operational",
          },
        },
      },
    });
  });
});
