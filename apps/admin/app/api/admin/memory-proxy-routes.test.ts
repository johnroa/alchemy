import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postMemoryBackfill } from "./memory/search/backfill/route";
import { POST as postMemoryRebuild } from "./memories/rebuild/route";

const mocks = vi.hoisted(() => ({
  normalizeApiBase: vi.fn((value: string | undefined) => value ?? "https://api.test/v1"),
  proxyJsonRequest: vi.fn(),
  getAdminSimulationBearerToken: vi.fn(),
  requireCloudflareAccess: vi.fn(),
}));

vi.mock("@/lib/admin-api-base", () => ({
  normalizeApiBase: mocks.normalizeApiBase,
}));

vi.mock("@/lib/admin-http", () => ({
  proxyJsonRequest: mocks.proxyJsonRequest,
}));

vi.mock("@/lib/admin-simulation-token", () => ({
  getAdminSimulationBearerToken: mocks.getAdminSimulationBearerToken,
}));

vi.mock("@/lib/supabase-admin", () => ({
  requireCloudflareAccess: mocks.requireCloudflareAccess,
}));

describe("memory admin proxy routes", () => {
  beforeEach(() => {
    mocks.requireCloudflareAccess.mockResolvedValue(undefined);
    mocks.getAdminSimulationBearerToken.mockResolvedValue("sim-token");
    mocks.proxyJsonRequest.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  });

  it("proxies memory backfill to the public API with safe defaults", async () => {
    await postMemoryBackfill(new Request("https://admin.cookwithalchemy.com/api/admin/memory/search/backfill", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: 999, missing_only: false, user_id: "user-1" }),
    }));

    expect(mocks.proxyJsonRequest).toHaveBeenCalledWith({
      apiBase: expect.any(String),
      token: "sim-token",
      path: "/memory-search/backfill",
      method: "POST",
      body: {
        user_id: "user-1",
        limit: 200,
        missing_only: false,
      },
      errorMessage: "Memory retrieval backfill failed",
    });
  });

  it("proxies memory rebuild to the real rebuild endpoint", async () => {
    await postMemoryRebuild(new Request("https://admin.cookwithalchemy.com/api/admin/memories/rebuild", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id: "user-2" }),
    }));

    expect(mocks.proxyJsonRequest).toHaveBeenCalledWith({
      apiBase: expect.any(String),
      token: "sim-token",
      path: "/memory-search/rebuild",
      method: "POST",
      body: { user_id: "user-2" },
      errorMessage: "Memory rebuild failed",
    });
  });
});
