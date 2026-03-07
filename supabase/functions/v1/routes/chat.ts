import { createServiceClient } from "../../_shared/db.ts";
import {
  ApiError,
  requireJsonBody,
} from "../../_shared/errors.ts";
import { llmGateway } from "../../_shared/llm-gateway.ts";
import type {
  AssistantReply,
  JsonValue,
  RecipePayload,
} from "../../_shared/types.ts";
import type {
  CandidateRecipeRole,
  CandidateRecipeSet,
  ChatLoopResponse,
  ChatLoopState,
  ChatMessageView,
  ChatSessionContext,
  ContextPack,
  PreferenceContext,
  RouteContext,
} from "./shared.ts";

type AssistantChatResponse = Awaited<ReturnType<typeof llmGateway.converseChat>>;

type OrchestratedChatTurn = {
  assistantChatResponse: AssistantChatResponse;
  nextCandidateSet: CandidateRecipeSet | null;
  nextLoopState: ChatLoopState;
  nextContext: ChatSessionContext;
  effectivePreferences: PreferenceContext;
  responseContext: ChatLoopResponse["response_context"] | null;
  justGenerated: boolean;
};

type ChatDeps = {
  buildContextPack: (input: {
    userClient: RouteContext["client"];
    serviceClient: RouteContext["serviceClient"];
    userId: string;
    requestId: string;
    prompt: string;
    context: Record<string, JsonValue>;
    selectionMode?: "llm" | "fast";
  }) => Promise<ContextPack>;
  buildThreadForPrompt: (
    messages: ChatMessageView[],
  ) => Array<{ role: string; content: string }>;
  orchestrateChatTurn: (input: {
    client: RouteContext["client"];
    serviceClient: RouteContext["serviceClient"];
    userId: string;
    requestId: string;
    message: string;
    existingCandidate: CandidateRecipeSet | null;
    sessionContext: ChatSessionContext;
    contextPack: ContextPack;
    threadForPrompt: Array<{ role: string; content: string }>;
    modelOverrides?: RouteContext["modelOverrides"];
  }) => Promise<OrchestratedChatTurn>;
  updateChatSessionLoopContext: (input: {
    client: RouteContext["client"];
    chatId: string;
    context: ChatSessionContext;
  }) => Promise<void>;
  resolveAssistantMessageContent: (
    assistantReply: AssistantReply,
  ) => string;
  enqueueMemoryJob: (input: {
    serviceClient: RouteContext["serviceClient"];
    userId: string;
    chatId: string;
    messageId: string;
    interactionContext: Record<string, JsonValue>;
  }) => Promise<void>;
  logChangelog: (input: {
    serviceClient: RouteContext["serviceClient"];
    actorUserId: string;
    scope: string;
    entityType: string;
    entityId?: string;
    action: string;
    requestId: string;
    afterJson?: JsonValue;
  }) => Promise<void>;
  buildChatLoopResponse: (input: {
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
  }) => ChatLoopResponse;
  extractChatContext: (value: unknown) => ChatSessionContext;
  extractLatestAssistantReply: (
    messages: ChatMessageView[],
  ) => AssistantReply | null;
  normalizeCandidateRecipeSet: (
    candidate: unknown,
  ) => CandidateRecipeSet | null;
  hydrateCandidateRecipeSetImages: (input: {
    serviceClient: RouteContext["serviceClient"];
    chatId: string;
    candidateSet: CandidateRecipeSet;
  }) => Promise<CandidateRecipeSet>;
  enrollCandidateImageRequests: (input: {
    serviceClient: RouteContext["serviceClient"];
    userId: string;
    requestId: string;
    chatId: string;
    candidateSet: CandidateRecipeSet;
  }) => Promise<CandidateRecipeSet>;
  attachCommittedCandidateImages: (input: {
    serviceClient: RouteContext["serviceClient"];
    userId: string;
    requestId: string;
    chatId: string;
    candidateSet: CandidateRecipeSet;
    committedRecipes: Array<{
      component_id: string;
      recipe_id: string;
      recipe_version_id: string;
      recipe: RecipePayload;
      title: string;
    }>;
  }) => Promise<void>;
  deriveLoopState: (
    context: ChatSessionContext,
    candidate: CandidateRecipeSet | null,
  ) => ChatLoopState;
  buildCandidateOutlineForPrompt: (
    candidate: CandidateRecipeSet | null,
  ) => JsonValue;
  parseUuid: (value: string) => string;
  persistRecipe: (input: {
    client: RouteContext["client"];
    serviceClient: RouteContext["serviceClient"];
    userId: string;
    requestId: string;
    payload: RecipePayload;
    sourceChatId?: string;
    recipeId?: string;
    parentVersionId?: string;
    diffSummary?: string;
    heroImageUrl?: string;
    imageError?: string;
    selectedMemoryIds?: string[];
  }) => Promise<{ recipeId: string; versionId: string }>;
  scheduleImageQueueDrain: (input: {
    serviceClient: RouteContext["serviceClient"];
    actorUserId: string;
    requestId: string;
    limit?: number;
    modelOverrides?: RouteContext["modelOverrides"];
  }) => void;
  mapCandidateRoleToRelation: (role: CandidateRecipeRole) => string;
  resolveRelationTypeId: (
    client: RouteContext["client"] | RouteContext["serviceClient"],
    relationType: string,
  ) => Promise<string>;
  fetchChatMessages: (
    client: RouteContext["client"],
    chatId: string,
    limit?: number,
  ) => Promise<ChatMessageView[]>;
};

export const handleChatRoutes = async (
  context: RouteContext,
  deps: ChatDeps,
): Promise<Response | null> => {
  const {
    request,
    segments,
    method,
    auth,
    client,
    serviceClient,
    requestId,
    respond,
    modelOverrides,
  } = context;
  const {
    buildContextPack,
    buildThreadForPrompt,
    orchestrateChatTurn,
    updateChatSessionLoopContext,
    resolveAssistantMessageContent,
    enqueueMemoryJob,
    logChangelog,
    buildChatLoopResponse,
    extractChatContext,
    extractLatestAssistantReply,
    normalizeCandidateRecipeSet,
    hydrateCandidateRecipeSetImages,
    enrollCandidateImageRequests,
    attachCommittedCandidateImages,
    deriveLoopState,
    buildCandidateOutlineForPrompt,
    parseUuid,
    persistRecipe,
    scheduleImageQueueDrain,
    mapCandidateRoleToRelation,
    resolveRelationTypeId,
    fetchChatMessages,
  } = deps;

  if (
    segments.length === 2 &&
    segments[0] === "chat" &&
    segments[1] === "greeting" &&
    method === "GET"
  ) {
    const userName = auth.fullName;
    // Prefer the client's timezone (via X-Timezone header) so the greeting
    // matches the user's local time, not UTC server time.
    const clientTz = request.headers.get("x-timezone") ?? "UTC";
    let hour: number;
    try {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: clientTz,
        hour: "numeric",
        hour12: false,
      });
      hour = parseInt(formatter.format(new Date()), 10);
    } catch {
      hour = new Date().getUTCHours();
    }
    const timeOfDay = hour < 12
      ? "morning"
      : hour < 17
      ? "afternoon"
      : "evening";

    const { data: recentRecipe } = await client
      .from("recipes")
      .select("title")
      .eq("user_id", auth.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastRecipeTitle = recentRecipe && typeof recentRecipe.title === "string"
      ? recentRecipe.title
      : null;

    const greeting = await llmGateway.generateGreeting({
      client: createServiceClient(),
      userId: auth.userId,
      requestId,
      userName,
      timeOfDay,
      lastRecipeTitle,
    });

    return respond(200, greeting);
  }

  if (segments.length === 1 && segments[0] === "chat" && method === "POST") {
    const body = await requireJsonBody<{ message: string }>(request);
    const message = body.message?.trim();
    if (!message) {
      throw new ApiError(400, "invalid_message", "message is required");
    }

    const contextPack = await buildContextPack({
      userClient: client,
      serviceClient,
      userId: auth.userId,
      requestId,
      prompt: message,
      context: {},
      selectionMode: "fast",
    });

    const { data: chatSession, error: chatError } = await client
      .from("chat_sessions")
      .insert({
        owner_user_id: auth.userId,
        context: {
          preferences: contextPack.preferences,
          memory_snapshot: contextPack.memorySnapshot,
          selected_memory_ids: contextPack.selectedMemoryIds,
          loop_state: "ideation",
          candidate_recipe_set: null,
          candidate_revision: 0,
          active_component_id: null,
          pending_preference_conflict: null,
          thread_preference_overrides: null,
        },
      })
      .select("id,created_at,updated_at")
      .single();

    if (chatError || !chatSession) {
      throw new ApiError(
        500,
        "chat_create_failed",
        "Could not create chat session",
        chatError?.message,
      );
    }

    const { data: userMessage, error: userMessageError } = await client
      .from("chat_messages")
      .insert({
        chat_id: chatSession.id,
        role: "user",
        content: message,
      })
      .select("id,created_at")
      .single();

    if (userMessageError || !userMessage) {
      throw new ApiError(
        500,
        "chat_message_create_failed",
        "Could not store chat message",
        userMessageError?.message ?? "chat_message_insert_missing",
      );
    }

    const threadMessages: ChatMessageView[] = [
      {
        id: userMessage.id,
        role: "user",
        content: message,
        created_at: userMessage.created_at,
      },
    ];
    const threadForPrompt = buildThreadForPrompt(threadMessages);
    const initialContext: ChatSessionContext = {
      preferences: contextPack.preferences,
      memory_snapshot: contextPack.memorySnapshot,
      selected_memory_ids: contextPack.selectedMemoryIds,
      loop_state: "ideation",
      candidate_recipe_set: null,
      candidate_revision: 0,
      active_component_id: null,
      pending_preference_conflict: null,
      thread_preference_overrides: null,
    };
    const orchestrated = await orchestrateChatTurn({
      client,
      serviceClient,
      userId: auth.userId,
      requestId,
      message,
      existingCandidate: null,
      sessionContext: initialContext,
      contextPack,
      threadForPrompt,
      modelOverrides,
    });

    let nextCandidateSet = orchestrated.nextCandidateSet;
    if (nextCandidateSet) {
      nextCandidateSet = await enrollCandidateImageRequests({
        serviceClient,
        userId: auth.userId,
        requestId,
        chatId: chatSession.id,
        candidateSet: nextCandidateSet,
      });
      orchestrated.nextContext = {
        ...orchestrated.nextContext,
        candidate_recipe_set: nextCandidateSet,
        candidate_revision: nextCandidateSet.revision,
        active_component_id: nextCandidateSet.active_component_id,
      };
      scheduleImageQueueDrain({
        serviceClient,
        actorUserId: auth.userId,
        requestId,
        limit: Math.max(5, nextCandidateSet.components.length),
        modelOverrides,
      });
    }

    await updateChatSessionLoopContext({
      client,
      chatId: chatSession.id,
      context: orchestrated.nextContext,
    });

    const assistantEnvelope = {
      assistant_reply: orchestrated.assistantChatResponse.assistant_reply,
      trigger_recipe: orchestrated.assistantChatResponse.trigger_recipe ??
        Boolean(nextCandidateSet),
      candidate_recipe_set: nextCandidateSet,
      recipe: orchestrated.assistantChatResponse.recipe,
      response_context: orchestrated.responseContext,
    };
    const assistantMessageContent = resolveAssistantMessageContent(
      orchestrated.assistantChatResponse.assistant_reply,
    );
    const assistantMetadata: Record<string, JsonValue> = {
      format: "assistant_chat_envelope_v2",
      loop_state: orchestrated.nextLoopState,
      intent: orchestrated.responseContext?.intent ?? null,
      envelope: assistantEnvelope as unknown as JsonValue,
    };

    const { data: assistantMessage, error: assistantMessageError } =
      await client.from("chat_messages").insert({
        chat_id: chatSession.id,
        role: "assistant",
        content: assistantMessageContent,
        metadata: assistantMetadata,
      }).select("id,created_at").single();

    if (assistantMessageError || !assistantMessage) {
      throw new ApiError(
        500,
        "chat_assistant_message_failed",
        "Could not store assistant chat message",
        assistantMessageError?.message ?? "assistant_message_insert_missing",
      );
    }

    const interactionContext: Record<string, JsonValue> = {
      prompt: message,
      chat_id: chatSession.id,
      assistant_reply: orchestrated.assistantChatResponse.assistant_reply,
      preferences: orchestrated.effectivePreferences,
      selected_memory_ids: contextPack.selectedMemoryIds,
      loop_state: orchestrated.nextLoopState,
      response_context: (orchestrated.responseContext ?? {}) as JsonValue,
      thread_size: threadMessages.length,
    };
    if (orchestrated.nextCandidateSet) {
      interactionContext.candidate_recipe_set = orchestrated
        .nextContext.candidate_recipe_set as unknown as JsonValue;
    } else if (orchestrated.assistantChatResponse.recipe) {
      interactionContext.assistant_recipe = orchestrated.assistantChatResponse
        .recipe as unknown as JsonValue;
    }

    await enqueueMemoryJob({
      serviceClient,
      userId: auth.userId,
      chatId: chatSession.id,
      messageId: userMessage.id,
      interactionContext,
    });

    const messages: ChatMessageView[] = [
      ...threadMessages,
      {
        id: assistantMessage.id,
        role: "assistant",
        content: assistantMessageContent,
        metadata: assistantMetadata,
        created_at: assistantMessage.created_at,
      },
    ];

    await logChangelog({
      serviceClient,
      actorUserId: auth.userId,
      scope: "chat",
      entityType: "chat_session",
      entityId: chatSession.id,
      action: "created",
      requestId,
      afterJson: {
        message_count: messages.length,
      },
    });

    return respond(
      200,
      buildChatLoopResponse({
        chatId: chatSession.id,
        messages,
        context: orchestrated.nextContext,
        assistantReply: orchestrated.assistantChatResponse.assistant_reply,
        responseContext: orchestrated.responseContext,
        memoryContextIds: contextPack.selectedMemoryIds,
        createdAt: chatSession.created_at,
        updatedAt: new Date().toISOString(),
        uiHints: nextCandidateSet
          ? {
            show_generation_animation: orchestrated.justGenerated,
            focus_component_id: nextCandidateSet.active_component_id,
          }
          : undefined,
      }),
    );
  }

  if (segments.length === 2 && segments[0] === "chat" && method === "GET") {
    const chatId = parseUuid(segments[1]);

    const { data: chatSession, error: chatError } = await client
      .from("chat_sessions")
      .select("id,created_at,updated_at,context")
      .eq("id", chatId)
      .maybeSingle();

    if (chatError || !chatSession) {
      throw new ApiError(
        404,
        "chat_not_found",
        "Chat session not found",
        chatError?.message,
      );
    }

    const messages = await fetchChatMessages(client, chatId, 120);
    const contextValue = extractChatContext(chatSession.context);
    const candidateSet = normalizeCandidateRecipeSet(
      contextValue.candidate_recipe_set ?? null,
    );
    const hydratedCandidateSet = candidateSet
      ? await hydrateCandidateRecipeSetImages({
        serviceClient,
        chatId,
        candidateSet,
      })
      : null;
    const memoryContextIds = Array.isArray(contextValue.selected_memory_ids)
      ? contextValue.selected_memory_ids.filter((item): item is string =>
        typeof item === "string"
      )
      : [];

    return respond(
      200,
      buildChatLoopResponse({
        chatId: chatSession.id,
        messages,
        context: {
          ...contextValue,
          candidate_recipe_set: hydratedCandidateSet,
          candidate_revision: hydratedCandidateSet?.revision ?? contextValue.candidate_revision,
          active_component_id: hydratedCandidateSet?.active_component_id ?? contextValue.active_component_id ?? null,
        },
        assistantReply: extractLatestAssistantReply(messages),
        memoryContextIds,
        createdAt: chatSession.created_at,
        updatedAt: chatSession.updated_at,
      }),
    );
  }

  if (
    segments.length === 3 &&
    segments[0] === "chat" &&
    segments[2] === "messages" &&
    method === "POST"
  ) {
    const chatId = parseUuid(segments[1]);
    const body = await requireJsonBody<{ message: string }>(request);
    const message = body.message?.trim();

    if (!message) {
      throw new ApiError(400, "invalid_message", "message is required");
    }

    const { data: chatSession, error: chatError } = await client
      .from("chat_sessions")
      .select("id,context,created_at,updated_at,status")
      .eq("id", chatId)
      .maybeSingle();

    if (chatError || !chatSession) {
      throw new ApiError(
        404,
        "chat_not_found",
        "Chat session not found",
        chatError?.message,
      );
    }
    if (chatSession.status === "archived") {
      throw new ApiError(
        409,
        "chat_not_open",
        "Archived chat sessions cannot receive new messages",
      );
    }

    const sessionContext = extractChatContext(chatSession.context);
    const existingCandidate = normalizeCandidateRecipeSet(
      sessionContext.candidate_recipe_set ?? null,
    );

    const contextPack = await buildContextPack({
      userClient: client,
      serviceClient,
      userId: auth.userId,
      requestId,
      prompt: message,
      context: {
        chat_context: (chatSession.context as Record<string, JsonValue>) ?? {},
        loop_state: deriveLoopState(sessionContext, existingCandidate),
        candidate_recipe_set_outline: buildCandidateOutlineForPrompt(
          existingCandidate,
        ),
      },
      selectionMode: "fast",
    });

    const { data: userMessage, error: userMessageError } = await client
      .from("chat_messages")
      .insert({
        chat_id: chatId,
        role: "user",
        content: message,
      })
      .select("id,created_at")
      .single();

    if (userMessageError || !userMessage) {
      throw new ApiError(
        500,
        "chat_message_create_failed",
        "Could not store chat message",
        userMessageError?.message ?? "chat_message_insert_missing",
      );
    }

    const threadMessages = await fetchChatMessages(client, chatId);
    const threadForPrompt = buildThreadForPrompt(threadMessages);
    const orchestrated = await orchestrateChatTurn({
      client,
      serviceClient,
      userId: auth.userId,
      requestId,
      message,
      existingCandidate,
      sessionContext,
      contextPack,
      threadForPrompt,
      modelOverrides,
    });

    let nextCandidateSet = orchestrated.nextCandidateSet;
    if (nextCandidateSet) {
      nextCandidateSet = await enrollCandidateImageRequests({
        serviceClient,
        userId: auth.userId,
        requestId,
        chatId,
        candidateSet: nextCandidateSet,
      });
      orchestrated.nextContext = {
        ...orchestrated.nextContext,
        candidate_recipe_set: nextCandidateSet,
        candidate_revision: nextCandidateSet.revision,
        active_component_id: nextCandidateSet.active_component_id,
      };
      scheduleImageQueueDrain({
        serviceClient,
        actorUserId: auth.userId,
        requestId,
        limit: Math.max(5, nextCandidateSet.components.length),
        modelOverrides,
      });
    }

    await updateChatSessionLoopContext({
      client,
      chatId,
      context: orchestrated.nextContext,
    });

    const assistantEnvelope = {
      assistant_reply: orchestrated.assistantChatResponse.assistant_reply,
      trigger_recipe: orchestrated.assistantChatResponse.trigger_recipe ??
        Boolean(nextCandidateSet),
      candidate_recipe_set: nextCandidateSet,
      recipe: orchestrated.assistantChatResponse.recipe,
      response_context: orchestrated.responseContext,
    };
    const assistantMessageContent = resolveAssistantMessageContent(
      orchestrated.assistantChatResponse.assistant_reply,
    );
    const assistantMetadata: Record<string, JsonValue> = {
      format: "assistant_chat_envelope_v2",
      loop_state: orchestrated.nextLoopState,
      intent: orchestrated.responseContext?.intent ?? null,
      envelope: assistantEnvelope as unknown as JsonValue,
    };
    const { data: assistantMessage, error: assistantMessageError } =
      await client.from("chat_messages").insert({
        chat_id: chatId,
        role: "assistant",
        content: assistantMessageContent,
        metadata: assistantMetadata,
      }).select("id,created_at").single();

    if (assistantMessageError || !assistantMessage) {
      throw new ApiError(
        500,
        "chat_assistant_message_failed",
        "Could not store assistant chat message",
        assistantMessageError?.message ?? "assistant_message_insert_missing",
      );
    }

    const interactionContext: Record<string, JsonValue> = {
      prompt: message,
      chat_id: chatId,
      assistant_reply: orchestrated.assistantChatResponse.assistant_reply,
      thread_size: threadMessages.length,
      preferences: orchestrated.effectivePreferences,
      selected_memory_ids: contextPack.selectedMemoryIds,
      loop_state: orchestrated.nextLoopState,
      response_context: (orchestrated.responseContext ?? {}) as JsonValue,
    };
    if (orchestrated.nextCandidateSet) {
      interactionContext.candidate_recipe_set = orchestrated
        .nextContext.candidate_recipe_set as unknown as JsonValue;
    } else if (orchestrated.assistantChatResponse.recipe) {
      interactionContext.assistant_recipe = orchestrated.assistantChatResponse
        .recipe as unknown as JsonValue;
    }

    await enqueueMemoryJob({
      serviceClient,
      userId: auth.userId,
      chatId,
      messageId: userMessage.id,
      interactionContext,
    });

    const messages: ChatMessageView[] = [
      ...threadMessages,
      {
        id: assistantMessage.id,
        role: "assistant",
        content: assistantMessageContent,
        metadata: assistantMetadata,
        created_at: assistantMessage.created_at,
      },
    ];

    return respond(
      200,
      buildChatLoopResponse({
        chatId,
        messages,
        context: orchestrated.nextContext,
        assistantReply: orchestrated.assistantChatResponse.assistant_reply,
        responseContext: orchestrated.responseContext,
        memoryContextIds: contextPack.selectedMemoryIds,
        createdAt: chatSession.created_at,
        updatedAt: new Date().toISOString(),
        uiHints: orchestrated.justGenerated
          ? {
            show_generation_animation: true,
            focus_component_id: nextCandidateSet?.active_component_id,
          }
          : nextCandidateSet
          ? {
            focus_component_id: nextCandidateSet.active_component_id,
          }
          : undefined,
      }),
    );
  }

  if (
    segments.length === 3 &&
    segments[0] === "chat" &&
    segments[2] === "candidate" &&
    method === "PATCH"
  ) {
    const chatId = parseUuid(segments[1]);
    const body = await requireJsonBody<{
      action?: "set_active_component" | "delete_component" | "clear_candidate";
      component_id?: string;
    }>(request);

    if (!body.action) {
      throw new ApiError(
        400,
        "invalid_candidate_action",
        "action is required",
      );
    }

    const { data: chatSession, error: chatError } = await client
      .from("chat_sessions")
      .select("id,context,created_at,updated_at")
      .eq("id", chatId)
      .maybeSingle();

    if (chatError || !chatSession) {
      throw new ApiError(
        404,
        "chat_not_found",
        "Chat session not found",
        chatError?.message,
      );
    }

    const contextValue = extractChatContext(chatSession.context);
    const candidateSet = normalizeCandidateRecipeSet(
      contextValue.candidate_recipe_set ?? null,
    );
    let nextCandidateSet = candidateSet;

    if (body.action === "clear_candidate") {
      nextCandidateSet = null;
    }

    if (body.action === "set_active_component") {
      if (!candidateSet) {
        throw new ApiError(
          409,
          "candidate_missing",
          "No candidate recipe set exists for this chat",
        );
      }
      if (!body.component_id) {
        throw new ApiError(
          400,
          "invalid_component_id",
          "component_id is required for set_active_component",
        );
      }
      if (
        !candidateSet.components.some((component) =>
          component.component_id === body.component_id
        )
      ) {
        throw new ApiError(
          404,
          "candidate_component_not_found",
          "Candidate component not found",
        );
      }
      nextCandidateSet = {
        ...candidateSet,
        revision: Math.max(1, candidateSet.revision + 1),
        active_component_id: body.component_id,
      };
    }

    if (body.action === "delete_component") {
      if (!candidateSet) {
        throw new ApiError(
          409,
          "candidate_missing",
          "No candidate recipe set exists for this chat",
        );
      }
      if (!body.component_id) {
        throw new ApiError(
          400,
          "invalid_component_id",
          "component_id is required for delete_component",
        );
      }
      const remaining = candidateSet.components.filter((component) =>
        component.component_id !== body.component_id
      );
      if (remaining.length === candidateSet.components.length) {
        throw new ApiError(
          404,
          "candidate_component_not_found",
          "Candidate component not found",
        );
      }
      if (remaining.length === 0) {
        throw new ApiError(
          409,
          "candidate_last_component",
          "Cannot delete the final remaining component",
        );
      }

      const nextActiveId =
        candidateSet.active_component_id === body.component_id
          ? remaining[0].component_id
          : candidateSet.active_component_id;

      nextCandidateSet = {
        ...candidateSet,
        revision: Math.max(1, candidateSet.revision + 1),
        active_component_id: nextActiveId,
        components: remaining,
      };
    }

    let hydratedNextCandidateSet = nextCandidateSet;
    if (hydratedNextCandidateSet) {
      hydratedNextCandidateSet = await enrollCandidateImageRequests({
        serviceClient,
        userId: auth.userId,
        requestId,
        chatId,
        candidateSet: hydratedNextCandidateSet,
      });
      scheduleImageQueueDrain({
        serviceClient,
        actorUserId: auth.userId,
        requestId,
        limit: Math.max(5, hydratedNextCandidateSet.components.length),
        modelOverrides,
      });
    }

    const nextLoopState: ChatLoopState = hydratedNextCandidateSet
      ? "candidate_presented"
      : "ideation";
    const memoryContextIds = Array.isArray(contextValue.selected_memory_ids)
      ? contextValue.selected_memory_ids.filter((item): item is string =>
        typeof item === "string"
      )
      : [];
    const nextContext: ChatSessionContext = {
      ...contextValue,
      loop_state: nextLoopState,
      candidate_recipe_set: hydratedNextCandidateSet,
      candidate_revision: hydratedNextCandidateSet?.revision ?? 0,
      active_component_id: hydratedNextCandidateSet?.active_component_id ?? null,
    };

    await updateChatSessionLoopContext({
      client,
      chatId,
      context: nextContext,
    });

    await logChangelog({
      serviceClient,
      actorUserId: auth.userId,
      scope: "chat",
      entityType: "chat_session",
      entityId: chatId,
      action: `candidate_${body.action}`,
      requestId,
      afterJson: {
        candidate_id: nextCandidateSet?.candidate_id ?? null,
        revision: hydratedNextCandidateSet?.revision ?? null,
        active_component_id: hydratedNextCandidateSet?.active_component_id ?? null,
      },
    });

    const messages = await fetchChatMessages(client, chatId, 120);
    return respond(
      200,
      buildChatLoopResponse({
        chatId,
        messages,
        context: nextContext,
        memoryContextIds,
        createdAt: chatSession.created_at,
        updatedAt: new Date().toISOString(),
        uiHints: hydratedNextCandidateSet
          ? {
            focus_component_id: hydratedNextCandidateSet.active_component_id,
          }
          : undefined,
      }),
    );
  }

  if (
    segments.length === 3 &&
    segments[0] === "chat" &&
    segments[2] === "commit" &&
    method === "POST"
  ) {
    const chatId = parseUuid(segments[1]);

    const { data: chatSession, error: chatError } = await client
      .from("chat_sessions")
      .select("id,context,created_at,updated_at,status")
      .eq("id", chatId)
      .maybeSingle();

    if (chatError || !chatSession) {
      throw new ApiError(
        404,
        "chat_not_found",
        "Chat session not found",
        chatError?.message,
      );
    }
    if (chatSession.status === "archived") {
      throw new ApiError(
        409,
        "chat_not_open",
        "Archived chat sessions cannot be committed",
      );
    }

    const contextValue = extractChatContext(chatSession.context);
    const candidateSet = normalizeCandidateRecipeSet(
      contextValue.candidate_recipe_set ?? null,
    );
    if (!candidateSet || candidateSet.components.length === 0) {
      throw new ApiError(
        409,
        "candidate_missing",
        "No candidate recipe set is available to commit",
      );
    }

    const selectedMemoryIds = Array.isArray(contextValue.selected_memory_ids)
      ? contextValue.selected_memory_ids.filter((item): item is string =>
        typeof item === "string"
      )
      : [];

    const committedComponentsForImages = await Promise.all(
      candidateSet.components.map(async (component) => {
        const saved = await persistRecipe({
          client,
          serviceClient,
          userId: auth.userId,
          requestId,
          payload: component.recipe,
          sourceChatId: chatId,
          diffSummary: `Committed from chat candidate (${component.role})`,
          selectedMemoryIds,
        });

        // Dual-write: legacy recipe_saves + new cookbook_entries.
        // recipe_saves will be removed once backfill migration is complete.
        const { error: saveError } = await client
          .from("recipe_saves")
          .upsert(
            {
              user_id: auth.userId,
              recipe_id: saved.recipeId,
            },
            { onConflict: "user_id,recipe_id" },
          );
        if (saveError) {
          throw new ApiError(
            500,
            "recipe_save_failed",
            "Could not save committed recipe to cookbook",
            saveError.message,
          );
        }

        // Write cookbook_entries row. autopersonalize defaults to true.
        const { error: cookbookError } = await client
          .from("cookbook_entries")
          .upsert(
            {
              user_id: auth.userId,
              canonical_recipe_id: saved.recipeId,
              autopersonalize: true,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id,canonical_recipe_id" },
          );
        if (cookbookError) {
          // Non-fatal — log but don't fail the commit if cookbook_entries write fails.
          // The legacy recipe_saves path still works.
          console.warn(
            `[commit] cookbook_entries upsert failed for recipe ${saved.recipeId}: ${cookbookError.message}`,
          );
        }

        // TODO: Phase 2 — call recipe_canonicalize then recipe_personalize here
        // to implement the two-phase commit. For now, the personalized candidate
        // is persisted directly as the canonical recipe (existing behavior).
        // The variant_id/variant_version_id/variant_status fields will be
        // populated once the LLM gateway wrappers are wired.

        return {
          component_id: component.component_id,
          role: component.role,
          title: component.title,
          recipe_id: saved.recipeId,
          recipe_version_id: saved.versionId,
          variant_id: null as string | null,
          variant_version_id: null as string | null,
          variant_status: "none" as const,
          recipe: component.recipe,
        };
      }),
    );

    const committedComponents = committedComponentsForImages.map((component) => ({
      component_id: component.component_id,
      role: component.role,
      title: component.title,
      recipe_id: component.recipe_id,
      recipe_version_id: component.recipe_version_id,
      variant_id: component.variant_id,
      variant_version_id: component.variant_version_id,
      variant_status: component.variant_status,
    }));

    await attachCommittedCandidateImages({
      serviceClient,
      userId: auth.userId,
      requestId,
      chatId,
      candidateSet,
      committedRecipes: committedComponentsForImages,
    });
    scheduleImageQueueDrain({
      serviceClient,
      actorUserId: auth.userId,
      requestId,
      limit: Math.max(5, committedComponents.length),
      modelOverrides,
    });

    const primary = committedComponents[0];
    const links: Array<{
      id: string;
      parent_recipe_id: string;
      child_recipe_id: string;
      relation_type: string;
      position: number;
    }> = [];

    if (primary) {
      for (let index = 1; index < committedComponents.length; index += 1) {
        const component = committedComponents[index];
        const relationType = mapCandidateRoleToRelation(component.role);
        const relationTypeId = await resolveRelationTypeId(
          serviceClient,
          relationType,
        );
        const { data: link, error: linkError } = await serviceClient
          .from("recipe_links")
          .insert({
            parent_recipe_id: primary.recipe_id,
            child_recipe_id: component.recipe_id,
            relation_type_id: relationTypeId,
            position: index,
            source: "chat_commit",
          })
          .select("id,parent_recipe_id,child_recipe_id,position")
          .single();

        if (linkError || !link) {
          throw new ApiError(
            500,
            "recipe_link_insert_failed",
            "Could not link committed recipe components",
            linkError?.message,
          );
        }

        links.push({
          id: String(link.id),
          parent_recipe_id: String(link.parent_recipe_id),
          child_recipe_id: String(link.child_recipe_id),
          relation_type: relationType,
          position: Number(link.position ?? index),
        });
      }
    }

    const nextContext: ChatSessionContext = {
      ...contextValue,
      loop_state: "ideation",
      candidate_recipe_set: null,
      candidate_revision: candidateSet.revision,
      active_component_id: null,
      pending_preference_conflict: null,
    };

    await updateChatSessionLoopContext({
      client,
      chatId,
      context: nextContext,
    });

    await logChangelog({
      serviceClient,
      actorUserId: auth.userId,
      scope: "chat",
      entityType: "chat_session",
      entityId: chatId,
      action: "committed_candidate_set",
      requestId,
      afterJson: {
        candidate_id: candidateSet.candidate_id,
        revision: candidateSet.revision,
        committed_components: committedComponents,
        links,
      },
    });

    const messages = await fetchChatMessages(client, chatId, 120);
    const memoryContextIds = Array.isArray(nextContext.selected_memory_ids)
      ? nextContext.selected_memory_ids.filter((item): item is string =>
        typeof item === "string"
      )
      : [];
    const loopResponse = buildChatLoopResponse({
      chatId,
      messages,
      context: nextContext,
      memoryContextIds,
      createdAt: chatSession.created_at,
      updatedAt: new Date().toISOString(),
    });

    return respond(200, {
      ...loopResponse,
      commit: {
        candidate_id: candidateSet.candidate_id,
        revision: candidateSet.revision,
        committed_count: committedComponents.length,
        recipes: committedComponents,
        links,
        post_save_options: [
          "continue_chat",
          "restart_chat",
          "go_to_cookbook",
        ],
      },
    });
  }

  return null;
};
