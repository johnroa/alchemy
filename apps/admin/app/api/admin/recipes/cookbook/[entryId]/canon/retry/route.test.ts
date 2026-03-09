import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  normalizeApiBase: vi.fn((value: string | undefined) => value ?? "https://api.test/v1"),
  proxyJsonRequest: vi.fn(),
  getBearerTokenForEmail: vi.fn(),
  getAdminClient: vi.fn(),
  requireCloudflareAccess: vi.fn(),
}));

vi.mock("@/lib/admin-api-base", () => ({
  normalizeApiBase: mocks.normalizeApiBase,
}));

vi.mock("@/lib/admin-http", () => ({
  proxyJsonRequest: mocks.proxyJsonRequest,
}));

vi.mock("@/lib/admin-simulation-token", () => ({
  getBearerTokenForEmail: mocks.getBearerTokenForEmail,
}));

vi.mock("@/lib/supabase-admin", () => ({
  getAdminClient: mocks.getAdminClient,
  requireCloudflareAccess: mocks.requireCloudflareAccess,
}));

const createAdminClient = () => ({
  from(table: string) {
    if (table === "cookbook_entries") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: {
                id: "cookbook-entry-1",
                user_id: "user-1",
              },
              error: null,
            })),
          })),
        })),
      };
    }

    if (table === "users") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: { email: "cook@example.com" },
              error: null,
            })),
          })),
        })),
      };
    }

    throw new Error(`unexpected table ${table}`);
  },
});

describe("admin cookbook canon retry route", () => {
  beforeEach(() => {
    mocks.requireCloudflareAccess.mockResolvedValue(undefined);
    mocks.getBearerTokenForEmail.mockResolvedValue("user-token");
    mocks.getAdminClient.mockReturnValue(createAdminClient());
    mocks.proxyJsonRequest.mockResolvedValue(
      new Response(
        JSON.stringify({
          cookbook_entry_id: "cookbook-entry-1",
          canonical_recipe_id: "recipe-1",
          canonical_status: "processing",
        }),
        { status: 200 },
      ),
    );
  });

  it("proxies canon retry through the cookbook owner's auth context", async () => {
    const response = await POST(
      new Request("https://admin.cookwithalchemy.com/api/admin/recipes/cookbook/cookbook-entry-1/canon/retry", {
        method: "POST",
      }),
      { params: Promise.resolve({ entryId: "cookbook-entry-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.getBearerTokenForEmail).toHaveBeenCalledWith("cook@example.com");
    expect(mocks.proxyJsonRequest).toHaveBeenCalledWith({
      apiBase: expect.any(String),
      token: "user-token",
      path: "/recipes/cookbook/cookbook-entry-1/canon/retry",
      method: "POST",
      errorMessage: "Cookbook canon retry failed",
    });
  });
});
