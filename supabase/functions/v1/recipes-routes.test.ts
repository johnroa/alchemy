import { ApiError } from "../_shared/errors.ts";
import { searchRecipes } from "./recipe-search.ts";
import { handleRecipeRoutes } from "./routes/recipes.ts";
import type { RecipePreview } from "./recipe-preview.ts";
import openapiSpec from "../../../packages/contracts/openapi.json" with {
  type: "json",
};

type StoredSearchSession = {
  id: string;
  owner_user_id: string;
  surface: "explore" | "chat";
  applied_context: "all" | "preset" | "query";
  normalized_input: string | null;
  preset_id: string | null;
  interpreted_intent: unknown;
  query_embedding: string | null;
  snapshot_cutoff_indexed_at: string;
  page1_promoted_recipe_ids: string[];
  hybrid_items: unknown[];
  expires_at: string;
};

type SearchFeedRow = {
  recipe_id: string;
  recipe_version_id: string;
  title: string;
  summary: string | null;
  image_url: string | null;
  image_status: string;
  category: string | null;
  visibility: string;
  updated_at: string;
  quick_stats: Record<string, unknown> | null;
  indexed_at: string;
  explore_eligible: boolean;
};

const unused = () => {
  throw new Error("unexpected dependency call");
};

const createMockServiceClient = (rows: SearchFeedRow[]) => {
  const sessions = new Map<string, StoredSearchSession>();
  const eventPayloads: unknown[] = [];
  let sessionCounter = 0;

  const orderedRows = [...rows].sort((left, right) => {
    if (left.indexed_at === right.indexed_at) {
      return right.recipe_id.localeCompare(left.recipe_id);
    }
    return right.indexed_at.localeCompare(left.indexed_at);
  });

  return {
    eventPayloads,
    client: {
      from(table: string) {
        if (table === "recipe_search_sessions") {
          return {
            insert(payload: Omit<StoredSearchSession, "id">) {
              return {
                select(_columns: string) {
                  return {
                    async single() {
                      sessionCounter += 1;
                      const id = `session-${sessionCounter}`;
                      sessions.set(id, { id, ...payload });
                      return { data: { id }, error: null };
                    },
                  };
                },
              };
            },
            select(_columns: string) {
              const filters = new Map<string, unknown>();
              const query = {
                eq(column: string, value: unknown) {
                  filters.set(column, value);
                  return query;
                },
                async maybeSingle() {
                  const match = [...sessions.values()].find((session) =>
                    [...filters.entries()].every(([column, value]) =>
                      session[column as keyof StoredSearchSession] === value
                    )
                  );
                  return { data: match ?? null, error: null };
                },
              };
              return query;
            },
          };
        }

        if (table === "events") {
          return {
            async insert(payload: unknown) {
              eventPayloads.push(payload);
              return { error: null };
            },
          };
        }

        throw new Error(`unexpected table: ${table}`);
      },
      async rpc(functionName: string, params: Record<string, unknown>) {
        if (functionName !== "list_recipe_search_documents") {
          throw new Error(`unexpected rpc: ${functionName}`);
        }

        const cursorIndexedAt = typeof params.p_cursor_indexed_at === "string"
          ? params.p_cursor_indexed_at
          : null;
        const cursorRecipeId = typeof params.p_cursor_recipe_id === "string"
          ? params.p_cursor_recipe_id
          : null;
        const snapshotCutoff = String(params.p_snapshot_cutoff_indexed_at ?? "");
        const exploreOnly = params.p_explore_only === true;
        const limit = Number(params.p_limit ?? 20);

        const data = orderedRows.filter((row) => {
          if (row.visibility !== "public") {
            return false;
          }
          if (exploreOnly && !row.explore_eligible) {
            return false;
          }
          if (row.indexed_at > snapshotCutoff) {
            return false;
          }
          if (!cursorIndexedAt) {
            return true;
          }
          return row.indexed_at < cursorIndexedAt ||
            (row.indexed_at === cursorIndexedAt &&
              cursorRecipeId !== null &&
              row.recipe_id < cursorRecipeId);
        }).slice(0, limit);

        return { data, error: null };
      },
    },
  };
};

const createDeps = (overrides: Record<string, unknown> = {}) => ({
  parseUuid: (value: string) => value,
  getPreferences: async () => ({
    free_form: null,
    dietary_preferences: [],
    dietary_restrictions: [],
    skill_level: "easy",
    equipment: [],
    cuisines: [],
    aversions: [],
    cooking_for: null,
    max_difficulty: 1,
    presentation_preferences: {},
  }),
  resolvePresentationOptions: unused,
  fetchRecipeView: unused,
  fetchChatMessages: unused,
  buildContextPack: unused,
  deriveAttachmentPayload: unused,
  persistRecipe: unused,
  resolveRelationTypeId: unused,
  logChangelog: unused,
  buildCookbookItems: async () => [] as RecipePreview[],
  buildCookbookInsightDeterministic: () => null,
  ensurePersistedRecipeImageRequest: unused,
  scheduleImageQueueDrain: unused,
  searchRecipes,
  toJsonValue: (value: unknown) => value,
  computeSafetyExclusions: () => undefined,
  ...overrides,
});

const createRouteContext = (input: {
  path: string;
  method: string;
  body?: unknown;
  serviceClient?: unknown;
  client?: unknown;
}) => {
  const url = new URL(`https://api.cookwithalchemy.com/v1${input.path}`);
  const request = new Request(url, {
    method: input.method,
    headers: { "content-type": "application/json" },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });

  return {
    request,
    url,
    segments: input.path.split("/").filter(Boolean),
    method: input.method,
    requestId: "request-1",
    auth: {
      userId: "user-1",
      authHeader: "Bearer test-token",
      email: null,
      fullName: null,
      avatarUrl: null,
    },
    client: input.client ?? {},
    serviceClient: input.serviceClient ?? {},
    respond: (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  };
};

const parseJson = async (response: Response) => {
  return await response.json() as Record<string, unknown>;
};

const createRecipeSaveClient = (currentVersionId: string | null) => {
  const savedEntries: Array<{ user_id: string; canonical_recipe_id: string; autopersonalize: boolean }> = [];

  return {
    savedEntries,
    client: {
      from(table: string) {
        if (table === "cookbook_entries") {
          return {
            async upsert(payload: { user_id: string; canonical_recipe_id: string; autopersonalize: boolean }) {
              savedEntries.push(payload);
              return { error: null };
            },
          };
        }

        if (table === "recipes") {
          return {
            select(_columns: string) {
              return {
                eq(_column: string, _value: string) {
                  return {
                    async maybeSingle() {
                      return {
                        data: currentVersionId ? { current_version_id: currentVersionId } : null,
                        error: null,
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

Deno.test("GET /recipes/cookbook returns the preview shape plus cookbook_insight", async () => {
  const item: RecipePreview = {
    id: "11111111-1111-1111-1111-111111111111",
    title: "Weeknight Rigatoni",
    summary: "Fast tomato rigatoni with basil.",
    image_url: "https://cdn.cookwithalchemy.com/rigatoni.jpg",
    image_status: "ready",
    category: "Favorites",
    visibility: "private",
    updated_at: "2026-03-06T12:00:00.000Z",
    quick_stats: {
      time_minutes: 25,
      difficulty: "easy",
      health_score: 78,
      items: 7,
    },
  };

  const response = await handleRecipeRoutes(
    createRouteContext({
      path: "/recipes/cookbook",
      method: "GET",
    }) as never,
    createDeps({
      buildCookbookItems: async () => [item],
      buildCookbookInsightDeterministic: () => "You save quick pasta dinners most often.",
    }) as never,
  );

  if (!response || response.status !== 200) {
    throw new Error("expected cookbook route response");
  }

  const body = await parseJson(response);
  if (!Array.isArray(body.items) || body.items.length !== 1) {
    throw new Error("expected cookbook items");
  }
  if (body.cookbook_insight !== "You save quick pasta dinners most often.") {
    throw new Error("expected cookbook_insight");
  }

  const preview = body.items[0] as Record<string, unknown>;
  for (
    const key of [
      "id",
      "title",
      "summary",
      "image_url",
      "image_status",
      "category",
      "visibility",
      "updated_at",
      "quick_stats",
    ]
  ) {
    if (!(key in preview)) {
      throw new Error(`expected cookbook preview field: ${key}`);
    }
  }
});

Deno.test("POST /recipes/search with no query returns the explore feed and paginates to completion", async () => {
  const mock = createMockServiceClient([
    {
      recipe_id: "33333333-3333-3333-3333-333333333333",
      recipe_version_id: "a1111111-1111-1111-1111-111111111111",
      title: "Charred Broccolini",
      summary: "Lemon, chile, and crunchy breadcrumbs.",
      image_url: "https://cdn.cookwithalchemy.com/broccolini.jpg",
      image_status: "ready",
      category: "Sides",
      visibility: "public",
      updated_at: "2026-03-05T12:00:00.000Z",
      quick_stats: {
        time_minutes: 18,
        difficulty: "easy",
        health_score: 84,
        items: 6,
      },
      indexed_at: "2026-03-01T12:00:03.000Z",
      explore_eligible: true,
    },
    {
      recipe_id: "22222222-2222-2222-2222-222222222222",
      recipe_version_id: "b1111111-1111-1111-1111-111111111111",
      title: "Citrus Salmon Bowl",
      summary: "Bright salmon with herbed rice.",
      image_url: "https://cdn.cookwithalchemy.com/salmon.jpg",
      image_status: "ready",
      category: "Dinner",
      visibility: "public",
      updated_at: "2026-03-04T12:00:00.000Z",
      quick_stats: {
        time_minutes: 30,
        difficulty: "medium",
        health_score: 88,
        items: 9,
      },
      indexed_at: "2026-03-01T12:00:02.000Z",
      explore_eligible: true,
    },
    {
      recipe_id: "11111111-1111-1111-1111-111111111111",
      recipe_version_id: "c1111111-1111-1111-1111-111111111111",
      title: "Roasted Carrot Toast",
      summary: "Whipped ricotta, dill, and honey.",
      image_url: "https://cdn.cookwithalchemy.com/carrots.jpg",
      image_status: "ready",
      category: "Lunch",
      visibility: "public",
      updated_at: "2026-03-03T12:00:00.000Z",
      quick_stats: {
        time_minutes: 20,
        difficulty: "easy",
        health_score: 80,
        items: 5,
      },
      indexed_at: "2026-03-01T12:00:01.000Z",
      explore_eligible: true,
    },
  ]);

  const firstResponse = await handleRecipeRoutes(
    createRouteContext({
      path: "/recipes/search",
      method: "POST",
      body: { limit: 2 },
      serviceClient: mock.client,
    }) as never,
    createDeps() as never,
  );

  if (!firstResponse || firstResponse.status !== 200) {
    throw new Error("expected initial search response");
  }

  const firstBody = await parseJson(firstResponse);
  if (firstBody.applied_context !== "all") {
    throw new Error("expected explore feed applied_context=all");
  }
  if (!Array.isArray(firstBody.items) || firstBody.items.length !== 2) {
    throw new Error("expected first page of explore results");
  }
  if (typeof firstBody.next_cursor !== "string") {
    throw new Error("expected next_cursor for continued explore feed");
  }

  const firstPreview = firstBody.items[0] as Record<string, unknown>;
  if (firstPreview.category !== "Sides" || firstPreview.visibility !== "public") {
    throw new Error("expected preview category and visibility");
  }
  if (
    !firstPreview.quick_stats ||
    typeof (firstPreview.quick_stats as Record<string, unknown>).items !== "number"
  ) {
    throw new Error("expected quick_stats object");
  }

  const secondResponse = await handleRecipeRoutes(
    createRouteContext({
      path: "/recipes/search",
      method: "POST",
      body: {
        limit: 2,
        cursor: firstBody.next_cursor,
      },
      serviceClient: mock.client,
    }) as never,
    createDeps() as never,
  );

  if (!secondResponse || secondResponse.status !== 200) {
    throw new Error("expected continued search response");
  }

  const secondBody = await parseJson(secondResponse);
  if (!Array.isArray(secondBody.items) || secondBody.items.length !== 1) {
    throw new Error("expected final explore item on continuation");
  }
  if (secondBody.next_cursor !== null) {
    throw new Error("expected end-of-feed to clear next_cursor");
  }
  if (mock.eventPayloads.length !== 2) {
    throw new Error("expected search events for both feed requests");
  }
});

Deno.test("POST /recipes/search rejects invalid cursors", async () => {
  let error: unknown = null;

  try {
    await handleRecipeRoutes(
      createRouteContext({
        path: "/recipes/search",
        method: "POST",
        body: {
          cursor: "not-a-valid-cursor",
        },
      }) as never,
      createDeps() as never,
    );
  } catch (candidate) {
    error = candidate;
  }

  if (!(error instanceof ApiError)) {
    throw new Error("expected ApiError for invalid cursor");
  }
  if (error.status !== 400 || error.code !== "recipe_search_cursor_invalid") {
    throw new Error("expected recipe_search_cursor_invalid");
  }
});

Deno.test("OpenAPI uses RecipePreview for cookbook and search responses", () => {
  const cookbookItemsRef = openapiSpec.paths["/recipes/cookbook"].get.responses["200"]
    .content["application/json"].schema.properties.items.items.$ref;
  const recipeSearchResponse = openapiSpec.components.schemas.RecipeSearchResponse;
  const searchItemsRef = recipeSearchResponse.properties.items.items.$ref;
  const recipePreview = openapiSpec.components.schemas.RecipePreview;
  const cookbookEntry = openapiSpec.components.schemas.CookbookEntry;
  const required = Array.isArray(recipePreview.required)
    ? recipePreview.required
    : [];
  const cookbookRequired = Array.isArray(cookbookEntry.required)
    ? cookbookEntry.required
    : [];

  if (cookbookItemsRef !== "#/components/schemas/CookbookEntry") {
    throw new Error("expected cookbook to reference CookbookEntry");
  }
  if (searchItemsRef !== "#/components/schemas/RecipePreview") {
    throw new Error("expected search to reference RecipePreview");
  }

  for (
    const key of [
      "id",
      "title",
      "summary",
      "image_url",
      "image_status",
      "category",
      "visibility",
      "updated_at",
      "quick_stats",
    ]
  ) {
    if (!required.includes(key)) {
      throw new Error(`expected RecipePreview.required to include ${key}`);
    }
  }

  for (const key of ["canonical_recipe_id", "variant_status", "autopersonalize", "saved_at"]) {
    if (!cookbookRequired.includes(key)) {
      throw new Error(`expected CookbookEntry.required to include ${key}`);
    }
  }
});

Deno.test("POST /recipes/{id}/save attaches the persisted version to the image pipeline", async () => {
  const recipeClient = createRecipeSaveClient("version-123");
  const ensureCalls: Array<{ recipeId: string; recipeVersionId: string }> = [];
  const scheduleCalls: Array<{ limit?: number }> = [];
  const behaviorEvents: unknown[] = [];

  const response = await handleRecipeRoutes(
    createRouteContext({
      path: "/recipes/recipe-123/save",
      method: "POST",
      body: { autopersonalize: false, source_surface: "cookbook" },
      client: recipeClient.client,
      serviceClient: {
        from(table: string) {
          if (table === "behavior_events") {
            return {
              async upsert(payload: unknown, _options?: unknown) {
                behaviorEvents.push(payload);
                return { error: null };
              },
            };
          }

          throw new Error(`unexpected table: ${table}`);
        },
      },
    }) as never,
    createDeps({
      logChangelog: async () => undefined,
      ensurePersistedRecipeImageRequest: async (
        input: { recipeId: string; recipeVersionId: string },
      ) => {
        ensureCalls.push(input);
      },
      scheduleImageQueueDrain: (input: { limit?: number }) => {
        scheduleCalls.push({ limit: input.limit });
      },
    }) as never,
  );

  if (!response || response.status !== 200) {
    throw new Error("expected save route response");
  }

  const body = await parseJson(response);
  if (body.saved !== true) {
    throw new Error("expected saved=true response");
  }
  if (recipeClient.savedEntries.length !== 1) {
    throw new Error("expected cookbook entry upsert");
  }
  if (recipeClient.savedEntries[0]?.canonical_recipe_id !== "recipe-123") {
    throw new Error("expected canonical recipe id in cookbook entry");
  }
  if (ensureCalls.length !== 1) {
    throw new Error("expected persisted recipe image request attachment");
  }
  if (ensureCalls[0].recipeId !== "recipe-123" || ensureCalls[0].recipeVersionId !== "version-123") {
    throw new Error("expected save route to attach the current recipe version");
  }
  if (scheduleCalls.length !== 1 || scheduleCalls[0].limit !== 5) {
    throw new Error("expected image queue drain scheduling after save");
  }
  if (behaviorEvents.length !== 1) {
    throw new Error("expected recipe_saved behavior event");
  }
});
