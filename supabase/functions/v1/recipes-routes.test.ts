import { ApiError } from "../_shared/errors.ts";
import { llmGateway } from "../_shared/llm-gateway.ts";
import { searchRecipes } from "./recipe-search.ts";
import { resolvePresentationOptions as resolveRecipePresentationOptions } from "./recipe-standardization.ts";
import { handleRecipeRoutes } from "./routes/recipes.ts";
import type { RecipePreview } from "./recipe-preview.ts";
import type { RecipePayload } from "../_shared/types.ts";
import openapiSpec from "../../../packages/contracts/openapi.json" with {
  type: "json",
};

type StoredSearchSession = {
  id: string;
  owner_user_id: string;
  surface: "explore" | "chat";
  applied_context: "all" | "preset" | "query" | "for_you";
  normalized_input: string | null;
  preset_id: string | null;
  interpreted_intent: unknown;
  query_embedding: string | null;
  snapshot_cutoff_indexed_at: string;
  page1_promoted_recipe_ids: string[];
  hybrid_items: unknown[];
  algorithm_version?: string | null;
  profile_state?: string | null;
  rationale_tags_by_recipe?: unknown;
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

type ResolvedViewOptions = {
  units: string;
  groupBy: string;
  inlineMeasurements: boolean;
  verbosity: string;
  temperatureUnit: string;
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
  getMemorySnapshot: async () => ({}),
  getActiveMemories: async () => [],
  resolvePresentationOptions: unused,
  fetchRecipeView: unused,
  fetchChatMessages: unused,
  buildContextPack: unused,
  deriveAttachmentPayload: unused,
  canonicalizeRecipePayload: async (input: { payload: RecipePayload }) => input.payload,
  persistRecipe: unused,
  resolveAndPersistCanonicalRecipe: async () => ({
    action: "create_new_canon" as const,
    reason: "new_canon",
    recipeId: "recipe-1",
    versionId: "version-1",
    matchedRecipeId: null,
    matchedRecipeVersionId: null,
    judgeInvoked: false,
    judgeCandidateCount: 0,
    judgeConfidence: null,
  }),
  resolveRelationTypeId: unused,
  logChangelog: unused,
  buildCookbookItems: async () => [] as RecipePreview[],
  buildCookbookFeed: async () => ({ items: [], suggestedChips: [] }),
  buildCookbookInsightDeterministic: () => null,
  ensurePersistedRecipeImageRequest: unused,
  scheduleImageQueueDrain: unused,
  searchRecipes,
  getExploreForYouFeed: unused,
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
    segments: url.pathname.split("/").filter(Boolean).slice(1),
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

const createRecipeDetailFetchView = () => ({
  id: "recipe-123",
  title: "Late-Summer Pasta",
  description:
    "This pasta has the swagger of a restaurant special and the ease of something you can still pull together on a Tuesday, with corn, lemon, and basil doing all the right flirting.",
  summary: "Corn, lemon, and basil pasta.",
  servings: 4,
  ingredients: [
    {
      name: "Rigatoni",
      amount: 12,
      unit: "oz",
      category: "Pantry",
      component: "Pasta",
      ingredient_id: "ingredient-rigatoni",
      normalized_status: "normalized",
    },
  ],
  ingredient_groups: [
    {
      key: "pasta",
      label: "Pasta",
      ingredients: [
        {
          name: "Rigatoni",
          amount: 12,
          unit: "oz",
          category: "Pantry",
          component: "Pasta",
          ingredient_id: "ingredient-rigatoni",
          normalized_status: "normalized",
        },
      ],
    },
  ],
  steps: [],
  notes: undefined,
  pairings: [],
  metadata: undefined,
  emoji: [],
  image_url: null,
  image_status: "pending",
  visibility: "public",
  updated_at: "2026-03-07T12:00:00.000Z",
  version: {
    version_id: "version-123",
    recipe_id: "recipe-123",
    parent_version_id: null,
    diff_summary: null,
    created_at: "2026-03-07T12:00:00.000Z",
  },
  attachments: [],
});

const createVariantRouteClient = () => ({
  from(table: string) {
    if (table === "user_recipe_variants") {
      return {
        select(_columns: string) {
          return {
            eq(_column: string, _value: string) {
              return {
                eq(_columnTwo: string, _valueTwo: string) {
                  return {
                    async maybeSingle() {
                      return {
                        data: {
                          id: "variant-123",
                          current_version_id: "variant-version-123",
                          base_canonical_version_id: "canonical-version-123",
                          preference_fingerprint: "fp",
                          stale_status: "current",
                          last_materialized_at: "2026-03-07T13:00:00.000Z",
                        },
                        error: null,
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    }

    if (table === "user_recipe_variant_versions") {
      return {
        select(_columns: string) {
          return {
            eq(_column: string, _value: string) {
              return {
                async single() {
                  return {
                    data: {
                      id: "variant-version-123",
                      payload: {
                        summary: "Corn, lemon, and basil pasta.",
                        description:
                          "The personalized version keeps the same breezy spirit but leans even brighter, the sort of bowl you want to eat by an open window with a glass of cold white wine.",
                        ingredients: [
                          {
                            name: "Rigatoni",
                            amount: 12,
                            unit: "oz",
                            category: "Pantry",
                            component: "Pasta",
                          },
                          {
                            name: "Sweet Corn",
                            amount: 2,
                            unit: "unit",
                            category: "Produce",
                            component: "Pasta",
                          },
                          {
                            name: "Basil Butter",
                            amount: 3,
                            unit: "tbsp",
                            category: "Dairy",
                            component: "Sauce",
                          },
                        ],
                        steps: [{ index: 1, instruction: "Toss everything together." }],
                        notes: "Finish with lemon zest.",
                        pairings: ["Cold white wine"],
                        emoji: ["🍝"],
                        metadata: {
                          difficulty: "easy",
                          health_score: 82,
                          time_minutes: 25,
                          items: 3,
                        },
                      },
                      derivation_kind: "automatic",
                      provenance: {
                        adaptation_summary: "Adjusted to the user's preferences.",
                        tag_diff: { added: [], removed: [] },
                      },
                      source_canonical_version_id: "canonical-version-123",
                      created_at: "2026-03-07T13:00:00.000Z",
                    },
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    }

    if (table === "recipe_ingredients") {
      return {
        select(_columns: string) {
          return {
            eq(_column: string, _value: string) {
              return {
                async order(_orderColumn: string, _params: { ascending: boolean }) {
                  return {
                    data: [
                      {
                        id: "row-rigatoni",
                        position: 0,
                        ingredient_id: "ingredient-rigatoni",
                        source_name: "Rigatoni",
                        source_amount: 12,
                        source_unit: "oz",
                        normalized_amount_si: 340,
                        normalized_unit: "g",
                        unit_kind: "mass",
                        normalized_status: "normalized",
                        category: "Pantry",
                        component: "Pasta",
                        metadata: {},
                      },
                      {
                        id: "row-corn",
                        position: 1,
                        ingredient_id: "ingredient-corn",
                        source_name: "Sweet Corn",
                        source_amount: 2,
                        source_unit: "unit",
                        normalized_amount_si: 2,
                        normalized_unit: "unit",
                        unit_kind: "count",
                        normalized_status: "normalized",
                        category: "Produce",
                        component: "Pasta",
                        metadata: {},
                      },
                    ],
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
});

Deno.test("GET /recipes/cookbook returns the preview shape plus cookbook_insight", async () => {
  const item = {
    canonical_recipe_id: "11111111-1111-1111-1111-111111111111",
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
    variant_status: "none",
    active_variant_version_id: null,
    personalized_at: null,
    autopersonalize: true,
    saved_at: "2026-03-06T12:00:00.000Z",
    variant_tags: {},
    matched_chip_ids: ["occasion:weeknight"],
  };

  const response = await handleRecipeRoutes(
    createRouteContext({
      path: "/recipes/cookbook",
      method: "GET",
    }) as never,
    createDeps({
      buildCookbookFeed: async () => ({
        items: [item],
        suggestedChips: [{ id: "occasion:weeknight", label: "Weeknight", matched_count: 1 }],
      }),
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
  if (!Array.isArray(body.suggested_chips) || body.suggested_chips.length !== 1) {
    throw new Error("expected cookbook suggested chips");
  }
  if (body.cookbook_insight !== "You save quick pasta dinners most often.") {
    throw new Error("expected cookbook_insight");
  }

  const preview = body.items[0] as Record<string, unknown>;
  for (
    const key of [
      "canonical_recipe_id",
      "title",
      "summary",
      "image_url",
      "image_status",
      "category",
      "visibility",
      "updated_at",
      "quick_stats",
      "matched_chip_ids",
    ]
  ) {
    if (!(key in preview)) {
      throw new Error(`expected cookbook preview field: ${key}`);
    }
  }
});

Deno.test("GET /recipes/{id} preserves distinct summary and long description fields", async () => {
  const response = await handleRecipeRoutes(
    createRouteContext({
      path: "/recipes/recipe-123",
      method: "GET",
      serviceClient: {
        from(table: string) {
          if (table === "recipe_view_events") {
            return {
              async insert(_payload: unknown) {
                return { error: null };
              },
            };
          }

          throw new Error(`unexpected table: ${table}`);
        },
      },
    }) as never,
    createDeps({
      resolvePresentationOptions: () => ({
        units: "source",
        groupBy: "component",
        inlineMeasurements: false,
        verbosity: "balanced",
        temperatureUnit: "fahrenheit",
      }),
      fetchRecipeView: async () => createRecipeDetailFetchView(),
    }) as never,
  );

  if (!response || response.status !== 200) {
    throw new Error("expected recipe detail response");
  }

  const body = await parseJson(response);
  if (body.summary !== "Corn, lemon, and basil pasta.") {
    throw new Error("expected short summary on detail response");
  }
  if (
    body.description !==
      "This pasta has the swagger of a restaurant special and the ease of something you can still pull together on a Tuesday, with corn, lemon, and basil doing all the right flirting."
  ) {
    throw new Error("expected long description on detail response");
  }
});

Deno.test("GET /recipes/{id} uses component grouping when no query or saved preference exists", async () => {
  let receivedOptions: ResolvedViewOptions | null = null;

  const response = await handleRecipeRoutes(
    createRouteContext({
      path: "/recipes/recipe-123",
      method: "GET",
      serviceClient: {
        from(table: string) {
          if (table === "recipe_view_events") {
            return {
              async insert(_payload: unknown) {
                return { error: null };
              },
            };
          }

          throw new Error(`unexpected table: ${table}`);
        },
      },
    }) as never,
    createDeps({
      resolvePresentationOptions: resolveRecipePresentationOptions,
      fetchRecipeView: async (_client: unknown, _recipeId: string, _enforceVisibility: boolean, viewOptions: unknown) => {
        receivedOptions = viewOptions as ResolvedViewOptions;
        return createRecipeDetailFetchView();
      },
    }) as never,
  );

  if (!response || response.status !== 200) {
    throw new Error("expected recipe detail response");
  }

  const receivedGroupBy = (
    receivedOptions as unknown as { groupBy?: string } | null
  )?.groupBy;
  if (receivedGroupBy !== "component") {
    throw new Error("expected default recipe detail grouping to be component");
  }
});

Deno.test("GET /recipes/{id} forwards live render overrides for detail reads", async () => {
  let receivedOptions: ResolvedViewOptions | null = null;

  const response = await handleRecipeRoutes(
    createRouteContext({
      path:
        "/recipes/recipe-123?units=metric&group_by=category&inline_measurements=true&verbosity=detailed&temperature_unit=celsius",
      method: "GET",
      serviceClient: {
        from(table: string) {
          if (table === "recipe_view_events") {
            return {
              async insert(_payload: unknown) {
                return { error: null };
              },
            };
          }

          throw new Error(`unexpected table: ${table}`);
        },
      },
    }) as never,
    createDeps({
      resolvePresentationOptions: resolveRecipePresentationOptions,
      fetchRecipeView: async (
        _client: unknown,
        _recipeId: string,
        _enforceVisibility: boolean,
        viewOptions: unknown,
      ) => {
        receivedOptions = viewOptions as ResolvedViewOptions;
        return createRecipeDetailFetchView();
      },
    }) as never,
  );

  if (!response || response.status !== 200) {
    throw new Error("expected recipe detail response");
  }

  if (!receivedOptions) {
    throw new Error("expected resolved view options");
  }

  const detailOptions = receivedOptions as unknown as ResolvedViewOptions;
  if (
    detailOptions.units !== "metric" ||
    detailOptions.groupBy !== "category" ||
    detailOptions.inlineMeasurements !== true ||
    detailOptions.verbosity !== "detailed" ||
    detailOptions.temperatureUnit !== "celsius"
  ) {
    throw new Error("expected detail route to honor query render overrides");
  }
});

Deno.test("GET /recipes/{id}/variant overlays personalized summary, description, and rebuilt ingredient groups", async () => {
  const response = await handleRecipeRoutes(
    createRouteContext({
      path: "/recipes/recipe-123/variant",
      method: "GET",
      client: createVariantRouteClient(),
    }) as never,
    createDeps({
      resolvePresentationOptions: () => ({
        units: "source",
        groupBy: "component",
        inlineMeasurements: false,
        verbosity: "balanced",
        temperatureUnit: "fahrenheit",
      }),
      fetchRecipeView: async () => createRecipeDetailFetchView(),
    }) as never,
  );

  if (!response || response.status !== 200) {
    throw new Error("expected variant response");
  }

  const body = await parseJson(response);
  const recipe = body.recipe as Record<string, unknown>;

  if (recipe.summary !== "Corn, lemon, and basil pasta.") {
    throw new Error("expected personalized summary on variant response");
  }
  if (
    recipe.description !==
      "The personalized version keeps the same breezy spirit but leans even brighter, the sort of bowl you want to eat by an open window with a glass of cold white wine."
  ) {
    throw new Error("expected personalized long description on variant response");
  }

  const ingredientGroups = recipe.ingredient_groups as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(ingredientGroups) || ingredientGroups.length !== 2) {
    throw new Error("expected rebuilt ingredient groups on variant response");
  }
  if (ingredientGroups[0]?.label !== "Pasta" || ingredientGroups[1]?.label !== "Sauce") {
    throw new Error("expected personalized component groups");
  }
  const ingredients = recipe.ingredients as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(ingredients) || ingredients[2]?.component !== "Sauce") {
    throw new Error("expected personalized ingredient components");
  }
});

Deno.test("GET /recipes/{id}/variant forwards live render overrides for variant reads", async () => {
  let receivedOptions: ResolvedViewOptions | null = null;

  const response = await handleRecipeRoutes(
    createRouteContext({
      path:
        "/recipes/recipe-123/variant?units=metric&group_by=category&inline_measurements=true&verbosity=concise&temperature_unit=celsius",
      method: "GET",
      client: createVariantRouteClient(),
    }) as never,
    createDeps({
      resolvePresentationOptions: resolveRecipePresentationOptions,
      fetchRecipeView: async (
        _client: unknown,
        _recipeId: string,
        _enforceVisibility: boolean,
        viewOptions: unknown,
      ) => {
        receivedOptions = viewOptions as ResolvedViewOptions;
        return createRecipeDetailFetchView();
      },
    }) as never,
  );

  if (!response || response.status !== 200) {
    throw new Error("expected variant response");
  }

  if (!receivedOptions) {
    throw new Error("expected variant view options");
  }

  const variantOptions = receivedOptions as unknown as ResolvedViewOptions;
  if (
    variantOptions.units !== "metric" ||
    variantOptions.groupBy !== "category" ||
    variantOptions.inlineMeasurements !== true ||
    variantOptions.verbosity !== "concise" ||
    variantOptions.temperatureUnit !== "celsius"
  ) {
    throw new Error("expected variant route to honor query render overrides");
  }
});

Deno.test("POST /recipes/{id}/variant/refresh uses serviceClient for personalization", async () => {
  const canonicalPayload = {
    title: "Spicy Salmon Rice Bowl",
    summary: "Salmon bowl with glossy heat.",
    description: "A long-form salmon bowl description.",
    servings: 2,
    ingredients: [],
    steps: [],
  };

  const userClient = {
    from(table: string) {
      if (table === "recipes") {
        return {
          select(_columns: string) {
            return {
              eq(_column: string, _value: string) {
                return {
                  async maybeSingle() {
                    return {
                      data: { id: "recipe-123", current_version_id: "canonical-version-1" },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "recipe_versions") {
        return {
          select(_columns: string) {
            return {
              eq(_column: string, _value: string) {
                return {
                  async single() {
                    return {
                      data: { id: "canonical-version-1", payload: canonicalPayload },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "user_recipe_variants") {
        const query = {
          eq(_column: string, _value: string) {
            return query;
          },
          async maybeSingle() {
            return { data: null, error: null };
          },
        };

        return {
          select(_columns: string) {
            return query;
          },
        };
      }

      throw new Error(`unexpected user table: ${table}`);
    },
  };

  const serviceClient = {
    insertedVariantId: null as string | null,
    insertedVersionVariantId: null as string | null,
    from(table: string) {
      if (table === "user_recipe_variant_versions") {
        return {
          insert(payload: { variant_id?: string }) {
            serviceClient.insertedVersionVariantId = payload.variant_id ?? null;
            return {
              select(_columns: string) {
                return {
                  async single() {
                    return { data: { id: "variant-version-1" }, error: null };
                  },
                };
              },
            };
          },
          update(_payload: unknown) {
            return {
              eq(_column: string, _value: string) {
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }

      if (table === "user_recipe_variants") {
        return {
          async insert(payload: { id?: string }) {
            serviceClient.insertedVariantId = payload.id ?? null;
            return { error: null };
          },
          update(_payload: unknown) {
            return {
              eq(_column: string, _value: string) {
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }

      if (table === "cookbook_entries") {
        return {
          update(_payload: unknown) {
            let eqCount = 0;
            const query = {
              eq(_column: string, _value: string) {
                eqCount += 1;
                return eqCount >= 2 ? Promise.resolve({ error: null }) : query;
              },
            };
            return query;
          },
        };
      }

      if (table === "behavior_events") {
        return {
          async upsert(_payload: unknown, _options?: unknown) {
            return { error: null };
          },
        };
      }

      if (table === "user_acquisition_profiles") {
        return {
          select(_columns: string) {
            return {
              eq(_column: string, _value: string) {
                return {
                  async maybeSingle() {
                    return { data: null, error: null };
                  },
                };
              },
            };
          },
          async insert(_payload: unknown) {
            return { error: null };
          },
        };
      }

      throw new Error(`unexpected service table: ${table}`);
    },
  };

  const originalPersonalizeRecipe = llmGateway.personalizeRecipe;
  let receivedClient: unknown = null;

  llmGateway.personalizeRecipe = async (params) => {
    receivedClient = params.client;
    return {
      recipe: canonicalPayload,
      adaptationSummary: "No changes needed for this user.",
      appliedAdaptations: [],
      tagDiff: { added: [], removed: [] },
      substitutionDiffs: [],
      conflicts: [],
    };
  };

  try {
    const response = await handleRecipeRoutes(
      createRouteContext({
        path: "/recipes/recipe-123/variant/refresh",
        method: "POST",
        body: {},
        client: userClient,
        serviceClient,
      }) as never,
      createDeps({
        computePreferenceFingerprint: async () => "fingerprint-1",
        computeVariantTags: () => ({}),
        fetchGraphSubstitutions: async () => [],
        logChangelog: async () => undefined,
      }) as never,
    );

    if (!response || response.status !== 200) {
      throw new Error("expected variant refresh response");
    }

    if (receivedClient !== serviceClient) {
      throw new Error("expected personalization to receive serviceClient");
    }

    const body = await parseJson(response);
    if (body.variant_id !== serviceClient.insertedVariantId) {
      throw new Error("expected variant id from inserted row");
    }
    if (body.variant_status !== "current") {
      throw new Error("expected current variant status");
    }
    if (!serviceClient.insertedVariantId) {
      throw new Error("expected variant row insert to provide an id");
    }
    if (serviceClient.insertedVersionVariantId !== serviceClient.insertedVariantId) {
      throw new Error("expected version insert to reference the created variant id");
    }
  } finally {
    llmGateway.personalizeRecipe = originalPersonalizeRecipe;
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

Deno.test("POST /recipes/explore/for-you returns the personalized feed and logs feed-served telemetry", async () => {
  const behaviorEvents: unknown[] = [];

  const response = await handleRecipeRoutes(
    createRouteContext({
      path: "/recipes/explore/for-you",
      method: "POST",
      body: { preset_id: "Healthy", limit: 10 },
      serviceClient: {
        from(table: string) {
          if (table === "behavior_events") {
            return {
              async upsert(payload: unknown) {
                behaviorEvents.push(payload);
                return { error: null };
              },
            };
          }

          if (table === "user_acquisition_profiles") {
            return {
              select(_columns: string) {
                return {
                  eq(_column: string, _value: string) {
                    return {
                      async maybeSingle() {
                        return { data: null, error: null };
                      },
                    };
                  },
                };
              },
              async insert(_payload: unknown) {
                return { error: null };
              },
            };
          }

          throw new Error(`unexpected table: ${table}`);
        },
      },
    }) as never,
    createDeps({
      getExploreForYouFeed: async () => ({
        feed_id: "feed-1",
        applied_context: "preset",
        profile_state: "warm",
        algorithm_version: "for_you_v1",
        items: [{
          id: "recipe-1",
          title: "Lemon Tahini Bowls",
          summary: "Fast grain bowls with a bright tahini finish.",
          image_url: null,
          image_status: "pending",
          category: "Dinner",
          visibility: "public",
          updated_at: "2026-03-07T00:00:00.000Z",
          quick_stats: null,
          why_tags: ["Quick cleanup", "Leans healthy"],
        }],
        suggested_chips: [{
          id: "health:leans-healthy",
          label: "Leans Healthy",
          matched_count: 1,
        }],
        next_cursor: null,
        no_match: null,
        internal: {
          rerank_used: true,
          candidate_count: 24,
          fallback_path: null,
          rationale_tags_by_recipe: { "recipe-1": ["Quick cleanup", "Leans healthy"] },
        },
      }),
    }) as never,
  );

  if (!response || response.status !== 200) {
    throw new Error("expected For You response");
  }

  const body = await parseJson(response);
  if (body.feed_id !== "feed-1" || body.algorithm_version !== "for_you_v1") {
    throw new Error("expected feed metadata in response");
  }
  if (!Array.isArray(body.suggested_chips) || body.suggested_chips.length !== 1) {
    throw new Error("expected suggested chips in response");
  }
  if (!Array.isArray(body.items) || body.items.length !== 1) {
    throw new Error("expected personalized feed items");
  }

  const loggedPayload = behaviorEvents[0];
  if (!Array.isArray(loggedPayload) || loggedPayload.length !== 1) {
    throw new Error("expected explore_feed_served behavior event");
  }
  const loggedEvent = loggedPayload[0] as Record<string, unknown>;
  if (loggedEvent["event_type"] !== "explore_feed_served") {
    throw new Error("expected explore_feed_served event type");
  }
  if (loggedEvent["algorithm_version"] !== "for_you_v1") {
    throw new Error("expected algorithm version on feed-served telemetry");
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

          if (table === "user_acquisition_profiles") {
            return {
              select(_columns: string) {
                return {
                  eq(_column: string, _value: string) {
                    return {
                      async maybeSingle() {
                        return { data: null, error: null };
                      },
                    };
                  },
                };
              },
              async insert(_payload: unknown) {
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
