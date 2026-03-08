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
import type {
  ChatMessageView,
  RouteContext,
} from "../shared.ts";
import type { ChatDeps } from "./types.ts";

/**
 * POST /chat/:id/messages
 *
 * Sends a new user message to an existing chat session, runs an LLM turn,
 * persists the assistant reply, enrolls candidate images, enqueues memory
 * extraction, and returns the updated ChatLoopResponse.
 */
export const handleSendMessage = async (
  context: RouteContext,
  deps: ChatDeps,
): Promise<Response> => {
  const {
    request,
    segments,
    auth,
    client,
    serviceClient,
    requestId,
    respond,
    modelOverrides,
  } = context;
  const {
    parseUuid,
    buildContextPack,
    buildThreadForPrompt,
    orchestrateChatTurn,
    updateChatSessionLoopContext,
    resolveAssistantMessageContent,
    enqueueMemoryJob,
    buildChatLoopResponse,
    enrollCandidateImageRequests,
    scheduleImageQueueDrain,
    scheduleMemoryQueueDrain,
    enqueueDemandExtractionJob,
    scheduleDemandQueueDrain,
    fetchChatMessages,
    extractChatContext,
    normalizeCandidateRecipeSet,
    deriveLoopState,
    buildCandidateOutlineForPrompt,
  } = deps;

  const chatId = parseUuid(segments[1]);
  const body = await requireJsonBody<{ message: string }>(request);
  const message = body.message?.trim();
  const installId = getInstallIdFromHeaders(request);

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

  if (existingCandidate) {
    await logBehaviorEvents({
      serviceClient,
      events: [{
        eventId: crypto.randomUUID(),
        userId: auth.userId,
        installId,
        eventType: "chat_iteration_requested",
        sessionId: chatId,
        entityType: "chat_session",
        entityId: chatId,
        payload: {
          candidate_id: existingCandidate.candidate_id,
          previous_revision: existingCandidate.revision,
          active_component_id: existingCandidate.active_component_id,
        },
      }],
    });
  }

  const threadMessages = await fetchChatMessages(client, chatId);
  await logBehaviorEvents({
    serviceClient,
    events: [{
      eventId: crypto.randomUUID(),
      userId: auth.userId,
      installId,
      eventType: "chat_turn_submitted",
      sessionId: chatId,
      entityType: "chat_session",
      entityId: chatId,
      payload: {
        prompt_char_count: message.length,
        thread_size: threadMessages.length,
      },
    }],
  });
  const threadForPrompt = buildThreadForPrompt(threadMessages);
  // Defer the heavy generation LLM call when no recipe exists yet.
  // The ideation call (~1-3s) classifies intent and returns a chat
  // reply. If it determines recipe generation is needed, we return
  // immediately with generation_pending so the client can show the
  // cooking animation while calling POST /chat/:id/generate.
  // When a recipe already exists (iteration), we run inline since
  // there's no separate classification step.
  const shouldDeferGeneration = !existingCandidate;
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
    deferGeneration: shouldDeferGeneration,
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

  const resolvedEventId = crypto.randomUUID();
  const generatedCount = nextCandidateSet?.components.length ?? 0;
  await logBehaviorEvents({
    serviceClient,
    events: [{
      eventId: resolvedEventId,
      userId: auth.userId,
      installId,
      eventType: "chat_turn_resolved",
      sessionId: chatId,
      entityType: "chat_session",
      entityId: chatId,
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
      chatId,
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
      stage: existingCandidate ? "iteration" : "intent",
      extractorScope: existingCandidate
        ? "demand_extract_iteration_delta"
        : "demand_extract_observation",
      observedAt: userMessage.created_at,
      payload: {
        chat_id: chatId,
        assistant_message_id: assistantMessage.id,
        response_context: (orchestrated.responseContext ?? {}) as JsonValue,
        candidate_id: (nextCandidateSet?.candidate_id ?? null) as JsonValue,
        active_component_id: (nextCandidateSet?.active_component_id ?? null) as JsonValue,
        workflow: (sessionContext.workflow ?? null) as JsonValue,
        entry_surface: (sessionContext.entry_surface ?? null) as JsonValue,
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
      uiHints: orchestrated.generationDeferred
        ? {
          generation_pending: true,
          show_generation_animation: true,
        }
        : orchestrated.justGenerated
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
};
