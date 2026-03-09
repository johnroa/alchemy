import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  normalizeApiBase: vi.fn(),
  getAdminSimulationBearerToken: vi.fn(),
  getBearerTokenForEmail: vi.fn(),
  getAdminClient: vi.fn(),
  requireCloudflareAccess: vi.fn(),
}));

vi.mock("@/lib/admin-api-base", () => ({
  normalizeApiBase: mocks.normalizeApiBase,
}));

vi.mock("@/lib/admin-simulation-token", () => ({
  getAdminSimulationBearerToken: mocks.getAdminSimulationBearerToken,
  getBearerTokenForEmail: mocks.getBearerTokenForEmail,
}));

vi.mock("@/lib/supabase-admin", () => ({
  getAdminClient: mocks.getAdminClient,
  requireCloudflareAccess: mocks.requireCloudflareAccess,
}));

const buildCanonicalPayload = (instruction: string) => ({
  id: "recipe-1",
  title: "Branzino",
  summary: "Bright and fast.",
  description: "Simple grilled fish.",
  servings: 2,
  ingredients: [
    {
      name: "olive oil",
      amount: 2,
      unit: "tbsp",
      display_amount: "2",
      preparation: null,
      category: "pantry",
      component: "main",
    },
  ],
  ingredient_groups: [
    {
      key: "main",
      label: "Main",
      ingredients: [
        {
          name: "olive oil",
          amount: 2,
          unit: "tbsp",
          display_amount: "2",
          preparation: null,
          category: "pantry",
          component: "main",
        },
      ],
    },
  ],
  steps: [{ index: 1, instruction, title: null, notes: null }],
  notes: null,
  pairings: [],
  image_url: null,
  image_status: "ready",
});

const buildVariantEnvelope = (instruction: string) => ({
  variant_id: "variant-1",
  variant_status: "current",
  derivation_kind: "personalized",
  adaptation_summary: "Swapped dairy for olive oil.",
  personalized_at: "2026-03-09T04:00:00.000Z",
  recipe: buildCanonicalPayload(instruction),
});

const createAdminClient = () => ({
  from(table: string) {
    if (table === "user_recipe_variants") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: {
                  id: "variant-1",
                  user_id: "user-1",
                  canonical_recipe_id: "recipe-1",
                  stale_status: "current",
                  current_version_id: "variant-version-1",
                },
                error: null,
              })),
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

    if (table === "user_recipe_variant_versions") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: { id: "variant-version-1", derivation_kind: "personalized" },
              error: null,
            })),
          })),
        })),
      };
    }

    throw new Error(`unexpected table ${table}`);
  },
});

describe("admin recipe render route", () => {
  beforeEach(() => {
    mocks.getAdminSimulationBearerToken.mockReset();
    mocks.getBearerTokenForEmail.mockReset();
    mocks.getAdminClient.mockReset();
    mocks.requireCloudflareAccess.mockReset();
    mocks.normalizeApiBase.mockReset();
    mocks.requireCloudflareAccess.mockResolvedValue({
      email: "admin@cookwithalchemy.com",
    });
    mocks.normalizeApiBase.mockReturnValue("https://api.cookwithalchemy.com/v1");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("fans out three canonical render requests with the admin simulation token", async () => {
    mocks.getAdminSimulationBearerToken.mockResolvedValue("canon-token");
    mocks.getAdminClient.mockReturnValue(createAdminClient());

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      const verbosity = new URL(url).searchParams.get("verbosity") ?? "balanced";
      return new Response(
        JSON.stringify(buildCanonicalPayload(`Instruction ${verbosity}`)),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const response = await GET(
      new Request("https://admin.cookwithalchemy.com/api/admin/recipes/recipe-1/render?units=metric&group_by=category&inline_measurements=false&temperature_unit=celsius"),
      { params: Promise.resolve({ id: "recipe-1" }) },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.source.kind).toBe("canonical");
    expect(payload.options).toEqual({
      units: "metric",
      group_by: "category",
      inline_measurements: false,
      temperature_unit: "celsius",
    });
    expect(payload.previews.concise.steps[0].instruction).toBe("Instruction concise");
    expect(payload.previews.balanced.steps[0].instruction).toBe("Instruction balanced");
    expect(payload.previews.detailed.steps[0].instruction).toBe("Instruction detailed");
    expect(mocks.getAdminSimulationBearerToken).toHaveBeenCalledTimes(1);
    expect(mocks.getBearerTokenForEmail).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/recipes/recipe-1?");
    expect(fetchMock.mock.calls[0]?.[0]).toContain("verbosity=concise");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("verbosity=balanced");
    expect(fetchMock.mock.calls[2]?.[0]).toContain("verbosity=detailed");
  });

  it("uses the variant owner's bearer token for variant previews", async () => {
    mocks.getAdminClient.mockReturnValue(createAdminClient());
    mocks.getBearerTokenForEmail.mockResolvedValue("variant-token");

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      const verbosity = new URL(url).searchParams.get("verbosity") ?? "balanced";
      return new Response(
        JSON.stringify(buildVariantEnvelope(`Variant ${verbosity}`)),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const response = await GET(
      new Request("https://admin.cookwithalchemy.com/api/admin/recipes/recipe-1/render?variant_id=variant-1"),
      { params: Promise.resolve({ id: "recipe-1" }) },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.source.kind).toBe("variant");
    expect(payload.source.user_email).toBe("cook@example.com");
    expect(payload.source.adaptation_summary).toBe("Swapped dairy for olive oil.");
    expect(payload.previews.balanced.steps[0].instruction).toBe("Variant balanced");
    expect(mocks.getBearerTokenForEmail).toHaveBeenCalledWith("cook@example.com");
    expect(mocks.getAdminSimulationBearerToken).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/recipes/recipe-1/variant?");
  });
});
