import {
  ApiError,
  requireJsonBody,
} from "../../../_shared/errors.ts";
import type { JsonValue } from "../../../_shared/types.ts";
import {
  buildChatBehaviorFacts,
  getInstallIdFromHeaders,
  logBehaviorEvents,
  logBehaviorFacts,
} from "../../lib/behavior-events.ts";
import { normalizeChatLaunchContext } from "../../lib/chat-types.ts";
import type {
  ChatMessageView,
  ChatSessionContext,
  RouteContext,
} from "../shared.ts";
import type { ChatDeps } from "./types.ts";

/**
 * POST /chat
 *
 * Creates a new chat session, stores the first user message, runs the
 * initial LLM turn via orchestrateChatTurn, persists the assistant reply,
 * enqueues memory extraction, enrolls candidate images, and returns the
 * full ChatLoopResponse.
 */
export const handleCreateSession = async (
  context: RouteContext,
  deps: ChatDeps,
): Promise<Response> => {
  const {
    request,
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
    enrollCandidateImageRequests,
    scheduleImageQueueDrain,
    scheduleMemoryQueueDrain,
    enqueueDemandExtractionJob,
    scheduleDemandQueueDrain,
  } = deps;

  const body = await requireJsonBody<{
    message: string;
    launch_context?: unknown;
  }>(request);
  const message = body.message?.trim();
  const launchContext = normalizeChatLaunchContext(body.launch_context);
  const installId = getInstallIdFromHeaders(request);
  if (!message) {
    throw new ApiError(400, "invalid_message", "message is required");
  }

  const contextPack = await buildContextPack({
    userClient: client,
    serviceClient,
    userId: auth.userId,
    requestId,
    prompt: message,
    context: launchContext
      ? { launch_context: launchContext as unknown as JsonValue }
      : {},
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
        workflow: launchContext?.workflow ?? null,
        entry_surface: launchContext?.entry_surface ?? null,
        preference_editing_intent: launchContext?.preference_editing_intent ??
          null,
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

  await logBehaviorEvents({
    serviceClient,
    events: [{
      eventId: crypto.randomUUID(),
      userId: auth.userId,
      installId,
      eventType: "chat_session_started",
      sessionId: chatSession.id,
      entityType: "chat_session",
      entityId: chatSession.id,
      payload: {
        prompt_char_count: message.length,
        loop_state: "ideation",
      },
    }, {
      eventId: crypto.randomUUID(),
      userId: auth.userId,
      installId,
      eventType: "chat_turn_submitted",
      sessionId: chatSession.id,
      entityType: "chat_session",
      entityId: chatSession.id,
      payload: {
        turn_index: 1,
        prompt_char_count: message.length,
        thread_size: 1,
      },
    }],
  });

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
    workflow: launchContext?.workflow ?? null,
    entry_surface: launchContext?.entry_surface ?? null,
    preference_editing_intent: launchContext?.preference_editing_intent ?? null,
  };
  // Defer generation on session creation too — the very first
  // message could be a direct recipe request like "make me pad thai".
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
    deferGeneration: true,
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

  const resolvedEventId = crypto.randomUUID();
  const generatedCount = nextCandidateSet?.components.length ?? 0;
  await logBehaviorEvents({
    serviceClient,
    events: [{
      eventId: resolvedEventId,
      userId: auth.userId,
      installId,
      eventType: "chat_turn_resolved",
      sessionId: chatSession.id,
      entityType: "chat_session",
      entityId: chatSession.id,
      payload: {
        loop_state: orchestrated.nextLoopState,
        intent: (orchestrated.responseContext?.intent ?? null) as JsonValue,
        mode: (orchestrated.responseContext?.mode ?? null) as JsonValue,
        candidate_id: (nextCandidateSet?.candidate_id ?? null) as JsonValue,
        candidate_component_count: generatedCount,
        triggered_recipe: Boolean(nextCandidateSet),
      },
    }],
  });
  await logBehaviorFacts({
    serviceClient,
    facts: buildChatBehaviorFacts({
      eventId: resolvedEventId,
      userId: auth.userId,
      chatId: chatSession.id,
      responseContext: (orchestrated.responseContext ?? null) as Record<string, JsonValue> | null,
      candidateId: nextCandidateSet?.candidate_id ?? null,
      generatedCount,
    }),
  });

  if (enqueueDemandExtractionJob) {
    await enqueueDemandExtractionJob({
      serviceClient,
      sourceKind: "chat_message",
      sourceId: userMessage.id,
      userId: auth.userId,
      stage: "intent",
      extractorScope: "demand_extract_observation",
      observedAt: userMessage.created_at,
      payload: {
        chat_id: chatSession.id,
        assistant_message_id: assistantMessage.id,
        response_context: (orchestrated.responseContext ?? {}) as JsonValue,
        candidate_id: (nextCandidateSet?.candidate_id ?? null) as JsonValue,
        active_component_id: (nextCandidateSet?.active_component_id ?? null) as JsonValue,
        workflow: (launchContext?.workflow ?? null) as JsonValue,
        entry_surface: (launchContext?.entry_surface ?? null) as JsonValue,
      },
    });
    scheduleDemandQueueDrain?.({
      serviceClient,
      actorUserId: auth.userId,
      requestId,
      limit: 1,
    });
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
  try {
    scheduleMemoryQueueDrain({
      serviceClient,
      actorUserId: auth.userId,
      requestId,
      limit: 1,
    });
  } catch (error) {
    console.error("memory_queue_schedule_failed", {
      request_id: requestId,
      actor_user_id: auth.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

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
      uiHints: orchestrated.generationDeferred
        ? {
          generation_pending: true,
          show_generation_animation: true,
        }
        : nextCandidateSet
        ? {
          show_generation_animation: orchestrated.justGenerated,
          focus_component_id: nextCandidateSet.active_component_id,
        }
        : undefined,
    }),
  );
};

/**
 * GET /chat/:id
 *
 * Fetches an existing chat session by ID, hydrates candidate images,
 * and returns the full ChatLoopResponse with message history.
 */
export const handleGetSession = async (
  context: RouteContext,
  deps: ChatDeps,
): Promise<Response> => {
  const { segments, client, serviceClient, respond } = context;
  const {
    parseUuid,
    fetchChatMessages,
    extractChatContext,
    normalizeCandidateRecipeSet,
    hydrateCandidateRecipeSetImages,
    extractLatestAssistantReply,
    buildChatLoopResponse,
  } = deps;

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
};
