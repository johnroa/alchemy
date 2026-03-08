import {
  ApiError,
  requireJsonBody,
} from "../../../_shared/errors.ts";
import type { JsonValue } from "../../../_shared/types.ts";
import { getInstallIdFromHeaders, logBehaviorEvents } from "../../lib/behavior-events.ts";
import type {
  ChatLoopState,
  ChatSessionContext,
  RouteContext,
} from "../shared.ts";
import type { ChatDeps } from "./types.ts";

/**
 * PATCH /chat/:id/candidate
 *
 * Mutates the candidate recipe set for an existing chat session.
 * Supports three actions:
 *   - set_active_component: switch the active component within the set
 *   - delete_component: remove a component (cannot delete the last one)
 *   - clear_candidate: discard the entire candidate set
 */
export const handleCandidatePatch = async (
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
    extractChatContext,
    normalizeCandidateRecipeSet,
    enrollCandidateImageRequests,
    scheduleImageQueueDrain,
    updateChatSessionLoopContext,
    logChangelog,
    buildChatLoopResponse,
    fetchChatMessages,
    enqueueDemandExtractionJob,
    scheduleDemandQueueDrain,
  } = deps;

  const chatId = parseUuid(segments[1]);
  const installId = getInstallIdFromHeaders(request);
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
  let affectedComponents: Array<Record<string, unknown>> = [];

  if (body.action === "clear_candidate") {
    affectedComponents = candidateSet?.components.map((component) => ({
      component_id: component.component_id,
      title: component.title,
      role: component.role,
    })) ?? [];
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
    affectedComponents = candidateSet.components
      .filter((component) => component.component_id === body.component_id)
      .map((component) => ({
        component_id: component.component_id,
        title: component.title,
        role: component.role,
      }));
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
    affectedComponents = candidateSet.components
      .filter((component) => component.component_id === body.component_id)
      .map((component) => ({
        component_id: component.component_id,
        title: component.title,
        role: component.role,
      }));
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

  if (body.action === "set_active_component" && hydratedNextCandidateSet) {
    await logBehaviorEvents({
      serviceClient,
      events: [{
        eventId: crypto.randomUUID(),
        userId: auth.userId,
        installId,
        eventType: "chat_candidate_selected",
        sessionId: chatId,
        entityType: "candidate_set",
        entityId: hydratedNextCandidateSet.candidate_id,
        payload: {
          candidate_id: hydratedNextCandidateSet.candidate_id,
          revision: hydratedNextCandidateSet.revision,
          active_component_id: hydratedNextCandidateSet.active_component_id,
        },
      }],
    });
  } else if (body.action === "delete_component" || body.action === "clear_candidate") {
    await logBehaviorEvents({
      serviceClient,
      events: [{
        eventId: crypto.randomUUID(),
        userId: auth.userId,
        installId,
        eventType: body.action === "clear_candidate"
          ? "chat_candidate_cleared"
          : "chat_candidate_rejected",
        sessionId: chatId,
        entityType: "candidate_set",
        entityId: candidateSet?.candidate_id ?? chatId,
        payload: {
          candidate_id: candidateSet?.candidate_id ?? null,
          revision: candidateSet?.revision ?? null,
          components: affectedComponents as never,
        },
      }],
    });
  }

  if (enqueueDemandExtractionJob) {
    await enqueueDemandExtractionJob({
      serviceClient,
      sourceKind: "chat_candidate_action",
      sourceId: [
        chatId,
        candidateSet?.candidate_id ?? "candidate",
        body.action,
        body.component_id ?? "all",
      ].join(":"),
      userId: auth.userId,
      stage: "selection",
      extractorScope: "demand_summarize_outcome_reason",
      observedAt: new Date().toISOString(),
      payload: {
        chat_id: chatId as JsonValue,
        action: body.action as JsonValue,
        candidate_id: (candidateSet?.candidate_id ?? null) as JsonValue,
        component_id: (body.component_id ?? null) as JsonValue,
        component_title: (affectedComponents[0]?.["title"] ?? null) as JsonValue,
        component_role: (affectedComponents[0]?.["role"] ?? null) as JsonValue,
        components: affectedComponents as unknown as JsonValue,
      },
    });
    scheduleDemandQueueDrain?.({
      serviceClient,
      actorUserId: auth.userId,
      requestId,
      limit: 1,
    });
  }

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
};
