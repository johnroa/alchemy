import { handleCommit } from "./routes/chat/commit.ts";
import type {
  CandidateRecipeSet,
  ChatCommitSummary,
  ChatSessionContext,
  ChatMessageView,
} from "./routes/shared.ts";
import type { AssistantReply, RecipePayload } from "../_shared/types.ts";

const recipePayload: RecipePayload = {
  title: "Cauliflower Pizza Crust",
  summary: "Crisp, sturdy, and low-carb.",
  description: "Crisp, sturdy, and low-carb.",
  servings: 2,
  ingredients: [
    { name: "Cauliflower", amount: 1, unit: "head" },
    { name: "Egg", amount: 1, unit: "whole" },
  ],
  steps: [
    { index: 1, instruction: "Steam and rice the cauliflower." },
    { index: 2, instruction: "Bake until golden." },
  ],
  metadata: {
    difficulty: "medium",
    time_minutes: 35,
    health_score: 81,
    quick_stats: {
      difficulty: "medium",
      time_minutes: 35,
      health_score: 81,
      items: 2,
    },
  },
};

const candidateSetFixture = (): CandidateRecipeSet => ({
  candidate_id: "candidate-1",
  revision: 2,
  active_component_id: "component-main",
  components: [
    {
      component_id: "component-main",
      role: "main",
      title: "Cauliflower Pizza Crust",
      image_url: null,
      image_status: "pending",
      recipe: recipePayload,
    },
  ],
});

const buildChatLoopResponse = (input: {
  chatId: string;
  messages: ChatMessageView[];
  context: ChatSessionContext;
  assistantReply?: AssistantReply | null;
  responseContext?: Record<string, unknown> | null;
  memoryContextIds: string[];
  createdAt?: string;
  updatedAt?: string;
}): Record<string, unknown> => ({
  id: input.chatId,
  messages: input.messages,
  loop_state: input.context.loop_state ?? "ideation",
  assistant_reply: input.assistantReply ?? null,
  candidate_recipe_set: input.context.candidate_recipe_set ?? null,
  response_context: input.responseContext ?? null,
  memory_context_ids: input.memoryContextIds,
  context_version: 2,
  created_at: input.createdAt ?? null,
  updated_at: input.updatedAt ?? null,
});

const parseJson = async (response: Response) =>
  await response.json() as Record<string, unknown>;

const clone = <T>(value: T): T => structuredClone(value);

type ChatSessionRow = {
  id: string;
  context: ChatSessionContext;
  created_at: string;
  updated_at: string;
  status: "open" | "archived";
};

const createCommitSummary = (candidateSet: CandidateRecipeSet): ChatCommitSummary => ({
  candidate_id: candidateSet.candidate_id,
  revision: candidateSet.revision,
  committed_count: 1,
  recipes: [{
    component_id: "component-main",
    role: "main",
    title: "Cauliflower Pizza Crust",
    cookbook_entry_id: "cookbook-entry-1",
    recipe_id: "recipe-1",
    recipe_version_id: "version-1",
    variant_id: null,
    variant_version_id: null,
    variant_status: "none",
    canonical_status: "ready",
  }],
  links: [],
  post_save_options: ["continue_chat", "restart_chat", "go_to_cookbook"],
});

const createUserClient = (params: {
  session: ChatSessionRow;
  loseFirstClaim?: boolean;
  recoveredCommit?: ChatCommitSummary;
}) => {
  const state = {
    session: clone(params.session),
    cookbookWrites: [] as Array<Record<string, unknown>>,
    claimAttempts: 0,
  };

  const client = {
    from(table: string) {
      if (table === "chat_sessions") {
        return {
          select(_columns: string) {
            return {
              eq(_column: string, value: string) {
                return {
                  async maybeSingle() {
                    if (value !== state.session.id) {
                      return { data: null, error: null };
                    }
                    return { data: clone(state.session), error: null };
                  },
                };
              },
            };
          },
          update(payload: { context: ChatSessionContext; updated_at: string }) {
            const filters: Record<string, string> = {};
            return {
              eq(column: string, value: string) {
                filters[column] = value;
                return this;
              },
              select(_columns: string) {
                return {
                  maybeSingle: async () => {
                    if (filters["id"] !== state.session.id) {
                      return { data: null, error: null };
                    }
                    if (
                      typeof filters["updated_at"] === "string" &&
                      filters["updated_at"] !== state.session.updated_at
                    ) {
                      return { data: null, error: null };
                    }

                    const nextContext = payload.context;
                    const isClaimAttempt = !!nextContext.active_commit &&
                      nextContext.candidate_recipe_set?.candidate_id ===
                        state.session.context.candidate_recipe_set?.candidate_id;

                    if (
                      params.loseFirstClaim &&
                      isClaimAttempt &&
                      state.claimAttempts === 0 &&
                      params.recoveredCommit
                    ) {
                      state.claimAttempts += 1;
                      state.session = {
                        ...state.session,
                        context: {
                          ...state.session.context,
                          loop_state: "ideation",
                          candidate_recipe_set: null,
                          active_component_id: null,
                          active_commit: null,
                          last_committed_candidate: {
                            candidate_id: params.recoveredCommit.candidate_id,
                            revision: params.recoveredCommit.revision,
                            committed_at: new Date().toISOString(),
                            commit: params.recoveredCommit,
                          },
                        },
                        updated_at: new Date().toISOString(),
                      };
                      return { data: null, error: null };
                    }

                    state.claimAttempts += isClaimAttempt ? 1 : 0;
                    state.session = {
                      ...state.session,
                      context: clone(payload.context),
                      updated_at: payload.updated_at,
                    };
                    return { data: clone(state.session), error: null };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "cookbook_entries") {
        return {
          async upsert(payload: Record<string, unknown>) {
            state.cookbookWrites.push(payload);
            return { error: null };
          },
        };
      }

      throw new Error(`unexpected user table: ${table}`);
    },
  };

  return {
    client,
    state,
  };
};

const createServiceClient = () => ({
  from(table: string) {
    if (table === "recipe_links") {
      return {
        insert(payload: Record<string, unknown>) {
          return {
            select(_columns: string) {
              return {
                async single() {
                  return {
                    data: {
                      id: "link-1",
                      parent_recipe_id: payload["parent_recipe_id"],
                      child_recipe_id: payload["child_recipe_id"],
                      position: payload["position"] ?? 1,
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

    if (table === "behavior_events") {
      return {
        async upsert() {
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
        async insert() {
          return { error: null };
        },
        update(_payload: Record<string, unknown>) {
          return {
            async eq(_column: string, _value: string) {
              return { error: null };
            },
          };
        },
      };
    }

    if (table === "behavior_semantic_facts") {
      return {
        async insert() {
          return { error: null };
        },
      };
    }

    throw new Error(`unexpected service table: ${table}`);
  },
});

const createRouteContext = (input: {
  client: unknown;
  serviceClient: unknown;
}) => ({
  request: new Request("https://api.cookwithalchemy.com/v1/chat/chat-1/commit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  }),
  url: new URL("https://api.cookwithalchemy.com/v1/chat/chat-1/commit"),
  segments: ["chat", "chat-1", "commit"],
  method: "POST",
  requestId: "request-1",
  auth: {
    userId: "user-1",
    authHeader: "Bearer test-token",
    email: null,
    fullName: null,
    avatarUrl: null,
  },
  client: input.client,
  serviceClient: input.serviceClient,
  respond: (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
});

Deno.test("POST /chat/{id}/commit clears the candidate and records the commit summary", async () => {
  const candidateSet = candidateSetFixture();
  const { client, state } = createUserClient({
    session: {
      id: "chat-1",
      context: {
        loop_state: "candidate_presented",
        candidate_recipe_set: candidateSet,
        candidate_revision: candidateSet.revision,
        active_component_id: candidateSet.active_component_id,
        selected_memory_ids: ["memory-1"],
      },
      created_at: "2026-03-07T00:15:04.480Z",
      updated_at: "2026-03-07T00:18:19.000Z",
      status: "open",
    },
  });

  const response = await handleCommit(
    createRouteContext({
      client: client as never,
      serviceClient: createServiceClient() as never,
    }) as never,
    {
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
      canonicalizeRecipePayload: async (input: {
        payload: RecipePayload;
      }) => input.payload,
      extractChatContext: (value: unknown) => (value ?? {}) as ChatSessionContext,
      normalizeCandidateRecipeSet: (value: unknown) =>
        value ? value as CandidateRecipeSet : null,
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
      createPrivateCookbookEntry: async () => {
        state.cookbookWrites.push({
          cookbook_entry_id: "cookbook-entry-1",
          canonical_status: "pending",
        });
        return {
          cookbookEntryId: "cookbook-entry-1",
          variantId: "variant-1",
          variantVersionId: "variant-version-1",
          canonicalStatus: "pending" as const,
          variantStatus: "current" as const,
        };
      },
      deriveCanonicalForCookbookEntry: async () => ({
        cookbookEntryId: "cookbook-entry-1",
        canonicalRecipeId: "recipe-1",
        canonicalStatus: "ready" as const,
      }),
      computePreferenceFingerprint: async () => null,
      computeVariantTags: () => ({}),
      ensurePersistedRecipeImageRequest: async () => undefined,
      scheduleImageQueueDrain: () => undefined,
      mapCandidateRoleToRelation: () => "pairs_with",
      resolveRelationTypeId: async () => "relation-1",
      updateChatSessionLoopContext: async () => undefined,
      logChangelog: async () => undefined,
      buildChatLoopResponse,
      fetchChatMessages: async () => [],
    } as never,
  );

  if (response.status !== 200) {
    throw new Error(`expected 200, received ${response.status}`);
  }

  const body = await parseJson(response);
  const commit = body["commit"] as ChatCommitSummary | undefined;
  if (!commit || commit.committed_count !== 1) {
    throw new Error("expected commit summary in response");
  }
  if (state.session.context.candidate_recipe_set !== null) {
    throw new Error("expected candidate set to be cleared after commit");
  }
  if (state.session.context.active_commit !== null) {
    throw new Error("expected active commit claim to be cleared");
  }
  if (state.session.context.last_committed_candidate?.commit.candidate_id !== candidateSet.candidate_id) {
    throw new Error("expected last committed candidate record");
  }
  if (state.cookbookWrites.length !== 1) {
    throw new Error("expected cookbook save to be upserted once");
  }
});

Deno.test("POST /chat/{id}/commit returns the first successful commit when claim is lost", async () => {
  const candidateSet = candidateSetFixture();
  const recoveredCommit = createCommitSummary(candidateSet);
  const { client } = createUserClient({
    loseFirstClaim: true,
    recoveredCommit,
    session: {
      id: "chat-1",
      context: {
        loop_state: "candidate_presented",
        candidate_recipe_set: candidateSet,
        candidate_revision: candidateSet.revision,
        active_component_id: candidateSet.active_component_id,
      },
      created_at: "2026-03-07T00:15:04.480Z",
      updated_at: "2026-03-07T00:18:19.000Z",
      status: "open",
    },
  });

  let persistCalls = 0;
  const response = await handleCommit(
    createRouteContext({
      client: client as never,
      serviceClient: createServiceClient() as never,
    }) as never,
    {
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
      canonicalizeRecipePayload: async (input: {
        payload: RecipePayload;
      }) => input.payload,
      extractChatContext: (value: unknown) => (value ?? {}) as ChatSessionContext,
      normalizeCandidateRecipeSet: (value: unknown) =>
        value ? value as CandidateRecipeSet : null,
      resolveAndPersistCanonicalRecipe: async () => {
        persistCalls += 1;
        return {
          action: "create_new_canon" as const,
          reason: "new_canon",
          recipeId: "recipe-should-not-be-created",
          versionId: "version-should-not-be-created",
          matchedRecipeId: null,
          matchedRecipeVersionId: null,
          judgeInvoked: false,
          judgeCandidateCount: 0,
          judgeConfidence: null,
        };
      },
      createPrivateCookbookEntry: async () => ({
        cookbookEntryId: "cookbook-entry-1",
        variantId: "variant-1",
        variantVersionId: "variant-version-1",
        canonicalStatus: "pending" as const,
        variantStatus: "current" as const,
      }),
      deriveCanonicalForCookbookEntry: async () => ({
        cookbookEntryId: "cookbook-entry-1",
        canonicalRecipeId: "recipe-1",
        canonicalStatus: "ready" as const,
      }),
      computePreferenceFingerprint: async () => null,
      computeVariantTags: () => ({}),
      ensurePersistedRecipeImageRequest: async () => undefined,
      scheduleImageQueueDrain: () => undefined,
      mapCandidateRoleToRelation: () => "pairs_with",
      resolveRelationTypeId: async () => "relation-1",
      updateChatSessionLoopContext: async () => undefined,
      logChangelog: async () => undefined,
      buildChatLoopResponse,
      fetchChatMessages: async () => [],
    } as never,
  );

  if (response.status !== 200) {
    throw new Error(`expected 200, received ${response.status}`);
  }

  const body = await parseJson(response);
  const commit = body["commit"] as ChatCommitSummary | undefined;
  if (!commit || commit.candidate_id !== candidateSet.candidate_id) {
    throw new Error("expected recovered commit summary");
  }
  if (persistCalls !== 0) {
    throw new Error("expected lost claim path to reuse the existing commit");
  }
});
