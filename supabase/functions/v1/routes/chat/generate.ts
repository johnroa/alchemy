/**
 * POST /chat/:id/generate
 *
 * Runs the deferred recipe generation LLM call. Called by the client
 * after receiving a response with ui_hints.generation_pending = true.
 *
 * Flow:
 *   1. Validate session has generation_pending = true
 *   2. Rebuild context pack + thread (same as message handler)
 *   3. Call chat_generation scope LLM
 *   4. Process result: candidate set, preference updates, images
 *   5. Save assistant message with recipe envelope
 *   6. Clear generation_pending, persist updated context
 *   7. Return full ChatLoopResponse with candidate_recipe_set
 *
 * The client shows the generation animation (Lottie + cooking phrases)
 * for the entire duration of this request (~8-12s).
 */
import {
  ApiError,
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

export const handleGenerateRecipe = async (
  context: RouteContext,
  deps: ChatDeps,
): Promise<Response> => {
  const {
    segments,
    auth,
    client,
    serviceClient,
    requestId,
    respond,
    modelOverrides,
    request,
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
    fetchChatMessages,
    extractChatContext,
    normalizeCandidateRecipeSet,
    deriveLoopState,
    buildCandidateOutlineForPrompt,
  } = deps;

  const chatId = parseUuid(segments[1]);
  const installId = getInstallIdFromHeaders(request);

  // ── Load session and validate generation_pending ──

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
      "Archived chat sessions cannot generate recipes",
    );
  }

  const sessionContext = extractChatContext(chatSession.context);

  if (!sessionContext.generation_pending) {
    throw new ApiError(
      409,
      "generation_not_pending",
      "No deferred generation pending for this session. Send a message first.",
    );
  }

  const existingCandidate = normalizeCandidateRecipeSet(
    sessionContext.candidate_recipe_set ?? null,
  );

  // ── Build context (same as message handler) ──

  const threadMessages = await fetchChatMessages(client, chatId);

  // The user's last message is the generation prompt.
  const lastUserMessage = [...threadMessages]
    .reverse()
    .find((m) => m.role === "user");

  if (!lastUserMessage) {
    throw new ApiError(
      409,
      "no_user_message",
      "Cannot generate without a preceding user message",
    );
  }

  const contextPack = await buildContextPack({
    userClient: client,
    serviceClient,
    userId: auth.userId,
    requestId,
    prompt: lastUserMessage.content,
    context: {
      chat_context: (chatSession.context as Record<string, JsonValue>) ?? {},
      loop_state: deriveLoopState(sessionContext, existingCandidate),
      candidate_recipe_set_outline: buildCandidateOutlineForPrompt(
        existingCandidate,
      ),
    },
    selectionMode: "fast",
  });

  const threadForPrompt = buildThreadForPrompt(threadMessages);

  // ── Run the generation LLM (the heavy call) ──
  // Force chat_generation scope to skip re-running ideation (already
  // done in the message handler). Clear generation_pending so we
  // don't double-generate.
  const generationSessionContext = {
    ...sessionContext,
    generation_pending: undefined,
  };

  const orchestrated = await orchestrateChatTurn({
    client,
    serviceClient,
    userId: auth.userId,
    requestId,
    message: lastUserMessage.content,
    existingCandidate,
    sessionContext: generationSessionContext,
    contextPack,
    threadForPrompt,
    modelOverrides,
    scopeOverride: "chat_generation",
  });

  // ── Post-processing: images, persistence, memory ──

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
      generation_pending: undefined,
    };
    scheduleImageQueueDrain({
      serviceClient,
      actorUserId: auth.userId,
      requestId,
      limit: Math.max(5, nextCandidateSet.components.length),
      modelOverrides,
    });
  } else {
    // Generation didn't produce a recipe — clear pending flag anyway.
    orchestrated.nextContext = {
      ...orchestrated.nextContext,
      generation_pending: undefined,
    };
  }

  await updateChatSessionLoopContext({
    client,
    chatId,
    context: orchestrated.nextContext,
  });

  // Save the generation result as a new assistant message.
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
    source: "deferred_generation",
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
      "Could not store generation result",
      assistantMessageError?.message ?? "assistant_message_insert_missing",
    );
  }

  // Telemetry
  const generatedCount = nextCandidateSet?.components.length ?? 0;
  const resolvedEventId = crypto.randomUUID();
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
        source: "deferred_generation",
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

  // Enqueue memory extraction for the generation turn.
  const interactionContext: Record<string, JsonValue> = {
    prompt: lastUserMessage.content,
    chat_id: chatId,
    assistant_reply: orchestrated.assistantChatResponse.assistant_reply,
    thread_size: threadMessages.length,
    preferences: orchestrated.effectivePreferences,
    selected_memory_ids: contextPack.selectedMemoryIds,
    loop_state: orchestrated.nextLoopState,
    response_context: (orchestrated.responseContext ?? {}) as JsonValue,
    source: "deferred_generation",
  };
  if (nextCandidateSet) {
    interactionContext.candidate_recipe_set = orchestrated
      .nextContext.candidate_recipe_set as unknown as JsonValue;
  }

  await enqueueMemoryJob({
    serviceClient,
    userId: auth.userId,
    chatId,
    messageId: assistantMessage.id,
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

  // ── Response ──

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
      uiHints: nextCandidateSet
        ? {
          show_generation_animation: true,
          focus_component_id: nextCandidateSet.active_component_id,
        }
        : undefined,
    }),
  );
};
