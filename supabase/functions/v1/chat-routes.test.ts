import { handleChatRoutes } from "./routes/chat.ts";
import type {
  CandidateRecipeSet,
  ChatLoopResponse,
  ChatMessageView,
  ChatSessionContext,
} from "./routes/shared.ts";
import type { AssistantReply, JsonValue, RecipePayload } from "../_shared/types.ts";

const unused = () => {
  throw new Error("unexpected dependency call");
};

const recipePayload: RecipePayload = {
  title: "Lemon Chicken",
  summary: "Bright and quick chicken dinner.",
  description: "Bright and quick chicken dinner.",
  servings: 2,
  ingredients: [
    { name: "Chicken thighs", amount: 1, unit: "lb" },
    { name: "Lemon", amount: 1, unit: "whole" },
  ],
  steps: [
    { index: 1, instruction: "Sear the chicken." },
    { index: 2, instruction: "Finish with lemon juice." },
  ],
  metadata: {
    difficulty: "easy",
    health_score: 82,
    time_minutes: 25,
    quick_stats: {
      time_minutes: 25,
      difficulty: "easy",
      health_score: 82,
      items: 2,
    },
  },
};

const candidateSetFixture = (): CandidateRecipeSet => ({
  candidate_id: "candidate-1",
  revision: 1,
  active_component_id: "component-main",
  components: [
    {
      component_id: "component-main",
      role: "main",
      title: "Lemon Chicken",
      image_url: null,
      image_status: "pending",
      recipe: recipePayload,
    },
    {
      component_id: "component-side",
      role: "side",
      title: "Herby Rice",
      image_url: null,
      image_status: "pending",
      recipe: {
        ...recipePayload,
        title: "Herby Rice",
        ingredients: [{ name: "Rice", amount: 1, unit: "cup" }],
        steps: [{ index: 1, instruction: "Cook the rice." }],
      },
    },
  ],
});

const withImageStates = (
  candidateSet: CandidateRecipeSet,
  statuses: Array<{ image_url: string | null; image_status: "pending" | "processing" | "ready" | "failed" }>,
): CandidateRecipeSet => ({
  ...candidateSet,
  components: candidateSet.components.map((component, index) => ({
    ...component,
    image_url: statuses[index]?.image_url ?? null,
    image_status: statuses[index]?.image_status ?? "pending",
  })),
});

const buildChatLoopResponse = (input: {
  chatId: string;
  messages: ChatMessageView[];
  context: ChatSessionContext;
  assistantReply?: AssistantReply | null;
  responseContext?: ChatLoopResponse["response_context"] | null;
  memoryContextIds: string[];
  createdAt?: string;
  updatedAt?: string;
  uiHints?: {
    show_generation_animation?: boolean;
    focus_component_id?: string;
  };
}): Record<string, unknown> => ({
  id: input.chatId,
  messages: input.messages,
  loop_state: input.context.loop_state ?? "ideation",
  assistant_reply: input.assistantReply ?? null,
  candidate_recipe_set: input.context.candidate_recipe_set ?? null,
  response_context: input.responseContext ?? null,
  memory_context_ids: input.memoryContextIds,
  context_version: 2,
  ui_hints: input.uiHints ?? null,
  created_at: input.createdAt ?? null,
  updated_at: input.updatedAt ?? null,
});

const createDeps = (overrides: Record<string, unknown> = {}) => ({
  buildContextPack: async () => ({
    preferences: {
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
    },
    preferencesNaturalLanguage: {},
    memorySnapshot: {},
    selectedMemories: [],
    selectedMemoryIds: ["memory-1"],
  }),
  buildThreadForPrompt: (messages: ChatMessageView[]) =>
    messages.map((message) => ({ role: message.role, content: message.content })),
  orchestrateChatTurn: async () => ({
    assistantChatResponse: {
      assistant_reply: {
        text: "Here are a couple of options.",
      },
      trigger_recipe: true,
      response_context: { mode: "generation" },
    },
    nextCandidateSet: candidateSetFixture(),
    nextLoopState: "candidate_presented",
    nextContext: {
      loop_state: "candidate_presented",
      candidate_recipe_set: candidateSetFixture(),
      candidate_revision: 1,
      active_component_id: "component-main",
      selected_memory_ids: ["memory-1"],
    },
    effectivePreferences: {
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
    },
    responseContext: { mode: "generation" },
    justGenerated: true,
  }),
  updateChatSessionLoopContext: async () => undefined,
  resolveAssistantMessageContent: (assistantReply: AssistantReply) => assistantReply.text,
  enqueueMemoryJob: async () => undefined,
  logChangelog: async () => undefined,
  buildChatLoopResponse,
  extractChatContext: (value: unknown) => (value ?? {}) as ChatSessionContext,
  extractLatestAssistantReply: () => null,
  normalizeCandidateRecipeSet: (candidate: unknown) =>
    candidate ? candidate as CandidateRecipeSet : null,
  hydrateCandidateRecipeSetImages: async (input: { candidateSet: CandidateRecipeSet }) => input.candidateSet,
  enrollCandidateImageRequests: async (input: { candidateSet: CandidateRecipeSet }) => input.candidateSet,
  attachCommittedCandidateImages: async () => undefined,
  deriveLoopState: (context: ChatSessionContext) =>
    context.loop_state ?? "ideation",
  buildCandidateOutlineForPrompt: () => null,
  parseUuid: (value: string) => value,
  persistRecipe: unused,
  scheduleImageQueueDrain: () => undefined,
  mapCandidateRoleToRelation: unused,
  resolveRelationTypeId: unused,
  fetchChatMessages: async () => [] as ChatMessageView[],
  ...overrides,
});

const createRouteContext = (input: {
  path: string;
  method: string;
  body?: unknown;
  client?: unknown;
  serviceClient?: unknown;
}) => {
  const defaultServiceClient = {
    from(table: string) {
      if (table === "behavior_events") {
        return {
          async upsert(_payload: unknown, _options?: unknown) {
            return { error: null };
          },
        };
      }

      if (table === "behavior_semantic_facts") {
        return {
          async insert(_payload: unknown) {
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
          update(_payload: unknown) {
            return {
              async eq(_column: string, _value: string) {
                return { error: null };
              },
            };
          },
        };
      }

      throw new Error(`unexpected service table: ${table}`);
    },
  };

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
    serviceClient: input.serviceClient ?? defaultServiceClient,
    respond: (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  };
};

const parseJson = async (response: Response) =>
  await response.json() as Record<string, unknown>;

const createChatClient = (params: {
  chatId?: string;
  context?: ChatSessionContext;
  status?: "open" | "archived";
}) => {
  let sessionContext = params.context ?? {
    loop_state: "ideation",
    candidate_recipe_set: null,
    candidate_revision: 0,
    active_component_id: null,
  };
  let messageCounter = 0;
  const chatId = params.chatId ?? "chat-1";
  const createdAt = "2026-03-06T12:00:00.000Z";

  return {
    get context(): ChatSessionContext {
      return sessionContext;
    },
    client: {
      from(table: string) {
        if (table === "chat_sessions") {
          return {
            insert(payload: { context: ChatSessionContext }) {
              sessionContext = payload.context;
              return {
                select(_columns: string) {
                  return {
                    async single() {
                      return {
                        data: {
                          id: chatId,
                          created_at: createdAt,
                          updated_at: createdAt,
                        },
                        error: null,
                      };
                    },
                  };
                },
              };
            },
            select(_columns: string) {
              return {
                eq(_column: string, _value: string) {
                  return {
                    async maybeSingle() {
                      return {
                        data: {
                          id: chatId,
                          context: sessionContext,
                          created_at: createdAt,
                          updated_at: "2026-03-06T12:05:00.000Z",
                          status: params.status ?? "open",
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

        if (table === "chat_messages") {
          return {
            insert(_payload: { chat_id: string; role: string; content: string }) {
              return {
                select(_columns: string) {
                  return {
                    async single() {
                      messageCounter += 1;
                      return {
                        data: {
                          id: `message-${messageCounter}`,
                          created_at: `2026-03-06T12:00:0${messageCounter}.000Z`,
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

        throw new Error(`unexpected table: ${table}`);
      },
    },
  };
};

Deno.test("POST /chat returns enrolled candidate image fields and schedules drain", async () => {
  const chatClient = createChatClient({});
  const scheduled: Array<{ limit?: number }> = [];
  let persistedContext: ChatSessionContext | null = null;
  const enrolled = withImageStates(candidateSetFixture(), [
    {
      image_url: "https://cdn.cookwithalchemy.com/images/lemon-chicken.jpg",
      image_status: "ready",
    },
    {
      image_url: null,
      image_status: "processing",
    },
  ]);

  const response = await handleChatRoutes(
    createRouteContext({
      path: "/chat",
      method: "POST",
      body: { message: "Make dinner with a side." },
      client: chatClient.client,
    }) as never,
    createDeps({
      enrollCandidateImageRequests: async () => enrolled,
      updateChatSessionLoopContext: async (input: { context: ChatSessionContext }) => {
        persistedContext = input.context;
      },
      scheduleImageQueueDrain: (input: { limit?: number }) => {
        scheduled.push({ limit: input.limit });
      },
    }) as never,
  );

  if (!response || response.status !== 200) {
    throw new Error("expected POST /chat response");
  }

  const body = await parseJson(response);
  const candidateSet = body.candidate_recipe_set as CandidateRecipeSet | null;
  if (!candidateSet || candidateSet.components.length !== 2) {
    throw new Error("expected candidate recipe set in response");
  }
  if (candidateSet.components[0].image_status !== "ready") {
    throw new Error("expected enrolled ready image state");
  }
  if (candidateSet.components[1].image_status !== "processing") {
    throw new Error("expected enrolled processing image state");
  }
  const persistedCandidateSet = (persistedContext as ChatSessionContext | null)
    ?.candidate_recipe_set;
  if (!persistedCandidateSet) {
    throw new Error("expected persisted chat context to include candidate images");
  }
  if (scheduled.length !== 1 || scheduled[0].limit !== 5) {
    throw new Error("expected image drain scheduling for candidate enrollment");
  }
});

Deno.test("GET /chat/{id} returns hydrated candidate image state for polling", async () => {
  const initialCandidate = candidateSetFixture();
  const hydratedCandidate = withImageStates(initialCandidate, [
    {
      image_url: "https://cdn.cookwithalchemy.com/images/lemon-chicken.jpg",
      image_status: "ready",
    },
    {
      image_url: null,
      image_status: "failed",
    },
  ]);
  const chatClient = createChatClient({
    context: {
      loop_state: "candidate_presented",
      candidate_recipe_set: initialCandidate,
      candidate_revision: initialCandidate.revision,
      active_component_id: initialCandidate.active_component_id,
      selected_memory_ids: ["memory-1"],
    },
  });

  const response = await handleChatRoutes(
    createRouteContext({
      path: "/chat/chat-1",
      method: "GET",
      client: chatClient.client,
    }) as never,
    createDeps({
      hydrateCandidateRecipeSetImages: async () => hydratedCandidate,
      fetchChatMessages: async () => [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Hydrated",
          created_at: "2026-03-06T12:01:00.000Z",
          metadata: {},
        },
      ],
    }) as never,
  );

  if (!response || response.status !== 200) {
    throw new Error("expected GET /chat/{id} response");
  }

  const body = await parseJson(response);
  const candidateSet = body.candidate_recipe_set as CandidateRecipeSet | null;
  if (!candidateSet) {
    throw new Error("expected hydrated candidate recipe set");
  }
  if (candidateSet.components[0].image_url !== "https://cdn.cookwithalchemy.com/images/lemon-chicken.jpg") {
    throw new Error("expected hydrated image URL");
  }
  if (candidateSet.components[1].image_status !== "failed") {
    throw new Error("expected hydrated failed image status");
  }
});

Deno.test("POST /chat/{id}/messages returns iterated candidate image fields and schedules drain", async () => {
  const existingCandidate = candidateSetFixture();
  const iteratedCandidate = withImageStates(
    {
      ...existingCandidate,
      revision: 2,
    },
    [
      {
        image_url: null,
        image_status: "processing",
      },
      {
        image_url: "https://cdn.cookwithalchemy.com/images/herby-rice.jpg",
        image_status: "ready",
      },
    ],
  );
  const chatClient = createChatClient({
    context: {
      loop_state: "candidate_presented",
      candidate_recipe_set: existingCandidate,
      candidate_revision: 1,
      active_component_id: existingCandidate.active_component_id,
      selected_memory_ids: ["memory-1"],
    },
  });
  const scheduled: Array<{ limit?: number }> = [];

  const response = await handleChatRoutes(
    createRouteContext({
      path: "/chat/chat-1/messages",
      method: "POST",
      body: { message: "Make it a little lighter." },
      client: chatClient.client,
    }) as never,
    createDeps({
      orchestrateChatTurn: async () => ({
        assistantChatResponse: {
          assistant_reply: {
            text: "Adjusted the dish and side.",
          },
          trigger_recipe: true,
          response_context: { mode: "iteration" },
        },
        nextCandidateSet: {
          ...existingCandidate,
          revision: 2,
        },
        nextLoopState: "candidate_presented",
        nextContext: {
          loop_state: "candidate_presented",
          candidate_recipe_set: {
            ...existingCandidate,
            revision: 2,
          },
          candidate_revision: 2,
          active_component_id: existingCandidate.active_component_id,
          selected_memory_ids: ["memory-1"],
        },
        effectivePreferences: {
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
        },
        responseContext: { mode: "iteration" },
        justGenerated: true,
      }),
      enrollCandidateImageRequests: async () => iteratedCandidate,
      fetchChatMessages: async () => [
        {
          id: "message-previous",
          role: "user",
          content: "Make dinner with a side.",
          created_at: "2026-03-06T12:00:00.000Z",
        },
      ],
      scheduleImageQueueDrain: (input: { limit?: number }) => {
        scheduled.push({ limit: input.limit });
      },
    }) as never,
  );

  if (!response || response.status !== 200) {
    throw new Error("expected POST /chat/{id}/messages response");
  }

  const body = await parseJson(response);
  const candidateSet = body.candidate_recipe_set as CandidateRecipeSet | null;
  if (!candidateSet || candidateSet.revision !== 2) {
    throw new Error("expected iterated candidate recipe set");
  }
  if (candidateSet.components[0].image_status !== "processing") {
    throw new Error("expected iterated processing image state");
  }
  if (candidateSet.components[1].image_status !== "ready") {
    throw new Error("expected iterated ready image state");
  }
  if (scheduled.length !== 1 || scheduled[0].limit !== 5) {
    throw new Error("expected image drain scheduling for iteration");
  }
});
