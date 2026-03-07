import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../../../_shared/errors.ts";
import { logBehaviorEvents } from "../../lib/behavior-events.ts";
import type {
  CandidateRecipeSet,
  ChatCommitClaim,
  ChatCommitLink,
  ChatCommitRecipe,
  ChatCommitSummary,
  ChatSessionContext,
  RouteContext,
} from "../shared.ts";
import type { ChatDeps } from "./types.ts";

const COMMIT_RECOVERY_WINDOW_MS = 30_000;
const COMMIT_POLL_ATTEMPTS = 12;
const COMMIT_POLL_DELAY_MS = 250;

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const extractMemoryContextIds = (context: ChatSessionContext): string[] =>
  Array.isArray(context.selected_memory_ids)
    ? context.selected_memory_ids.filter((item): item is string =>
      typeof item === "string"
    )
    : [];

const isRecentIsoTimestamp = (value: string | null | undefined): boolean => {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return false;
  }

  return Date.now() - parsed <= COMMIT_RECOVERY_WINDOW_MS;
};

const buildCommitSummary = (
  candidateSet: CandidateRecipeSet,
  committedComponents: ChatCommitRecipe[],
  links: ChatCommitLink[],
): ChatCommitSummary => ({
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
});

const loadChatSession = async (
  client: SupabaseClient,
  chatId: string,
): Promise<{
  id: string;
  context: unknown;
  created_at: string;
  updated_at: string;
  status: string;
} | null> => {
  const { data, error } = await client
    .from("chat_sessions")
    .select("id,context,created_at,updated_at,status")
    .eq("id", chatId)
    .maybeSingle();

  if (error) {
    throw new ApiError(
      500,
      "chat_fetch_failed",
      "Could not load chat session",
      error.message,
    );
  }

  return data;
};

const buildCommitResponse = async (params: {
  chatId: string;
  chatSession: {
    created_at: string;
    updated_at: string;
  };
  context: ChatSessionContext;
  commitSummary: ChatCommitSummary;
  client: RouteContext["client"];
  respond: RouteContext["respond"];
  buildChatLoopResponse: ChatDeps["buildChatLoopResponse"];
  fetchChatMessages: ChatDeps["fetchChatMessages"];
}): Promise<Response> => {
  const messages = await params.fetchChatMessages(params.client, params.chatId, 120);
  const loopResponse = params.buildChatLoopResponse({
    chatId: params.chatId,
    messages,
    context: params.context,
    memoryContextIds: extractMemoryContextIds(params.context),
    createdAt: params.chatSession.created_at,
    updatedAt: params.chatSession.updated_at,
  });

  return params.respond(200, {
    ...loopResponse,
    commit: params.commitSummary,
  });
};

const tryRecoverCommittedCandidate = async (params: {
  client: RouteContext["client"];
  chatId: string;
  candidateId: string;
  revision: number;
  extractChatContext: ChatDeps["extractChatContext"];
  respond: RouteContext["respond"];
  buildChatLoopResponse: ChatDeps["buildChatLoopResponse"];
  fetchChatMessages: ChatDeps["fetchChatMessages"];
}): Promise<Response | null> => {
  const latestSession = await loadChatSession(params.client, params.chatId);
  if (!latestSession) {
    return null;
  }

  const latestContext = params.extractChatContext(latestSession.context);
  const committed = latestContext.last_committed_candidate;

  if (
    !committed ||
    committed.candidate_id !== params.candidateId ||
    committed.revision !== params.revision ||
    !isRecentIsoTimestamp(committed.committed_at)
  ) {
    return null;
  }

  return await buildCommitResponse({
    chatId: params.chatId,
    chatSession: latestSession,
    context: latestContext,
    commitSummary: committed.commit,
    client: params.client,
    respond: params.respond,
    buildChatLoopResponse: params.buildChatLoopResponse,
    fetchChatMessages: params.fetchChatMessages,
  });
};

const waitForCommittedCandidate = async (params: {
  client: RouteContext["client"];
  chatId: string;
  candidateId: string;
  revision: number;
  extractChatContext: ChatDeps["extractChatContext"];
  respond: RouteContext["respond"];
  buildChatLoopResponse: ChatDeps["buildChatLoopResponse"];
  fetchChatMessages: ChatDeps["fetchChatMessages"];
}): Promise<Response | null> => {
  for (let attempt = 0; attempt < COMMIT_POLL_ATTEMPTS; attempt += 1) {
    const recovered = await tryRecoverCommittedCandidate(params);
    if (recovered) {
      return recovered;
    }

    const latestSession = await loadChatSession(params.client, params.chatId);
    if (!latestSession) {
      return null;
    }

    const latestContext = params.extractChatContext(latestSession.context);
    const activeCommit = latestContext.active_commit;
    if (
      !activeCommit ||
      activeCommit.candidate_id !== params.candidateId ||
      activeCommit.revision !== params.revision ||
      !isRecentIsoTimestamp(activeCommit.claimed_at)
    ) {
      return null;
    }

    await sleep(COMMIT_POLL_DELAY_MS);
  }

  return null;
};

const releaseCommitClaim = async (params: {
  client: RouteContext["client"];
  chatId: string;
  claimedAt: string;
  context: ChatSessionContext;
}): Promise<void> => {
  const { error } = await params.client
    .from("chat_sessions")
    .update({
      context: params.context,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.chatId)
    .eq("updated_at", params.claimedAt)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("chat_commit_claim_release_failed", error);
  }
};

/**
 * POST /chat/:id/commit
 *
 * Commits the current candidate recipe set — persists each component as a
 * canonical recipe, saves cookbook entries, creates recipe links between
 * primary and companion components, attaches pending candidate images to
 * the committed recipes, and returns the ChatLoopResponse enriched with
 * a `commit` summary block.
 */
export const handleCommit = async (
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
  } = context;
  const {
    parseUuid,
    extractChatContext,
    normalizeCandidateRecipeSet,
    persistRecipe,
    attachCommittedCandidateImages,
    scheduleImageQueueDrain,
    mapCandidateRoleToRelation,
    resolveRelationTypeId,
    logChangelog,
    buildChatLoopResponse,
    fetchChatMessages,
  } = deps;

  const chatId = parseUuid(segments[1]);
  const chatSession = await loadChatSession(client, chatId);

  if (!chatSession) {
    throw new ApiError(404, "chat_not_found", "Chat session not found");
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
    const recentCommit = contextValue.last_committed_candidate;
    if (
      recentCommit &&
      isRecentIsoTimestamp(recentCommit.committed_at)
    ) {
      return await buildCommitResponse({
        chatId,
        chatSession,
        context: contextValue,
        commitSummary: recentCommit.commit,
        client,
        respond,
        buildChatLoopResponse,
        fetchChatMessages,
      });
    }

    throw new ApiError(
      409,
      "candidate_missing",
      "No candidate recipe set is available to commit",
    );
  }

  const activeCommit = contextValue.active_commit;
  if (
    activeCommit &&
    activeCommit.request_id !== requestId &&
    activeCommit.candidate_id === candidateSet.candidate_id &&
    activeCommit.revision === candidateSet.revision &&
    isRecentIsoTimestamp(activeCommit.claimed_at)
  ) {
    const recovered = await waitForCommittedCandidate({
      client,
      chatId,
      candidateId: candidateSet.candidate_id,
      revision: candidateSet.revision,
      extractChatContext,
      respond,
      buildChatLoopResponse,
      fetchChatMessages,
    });

    if (recovered) {
      return recovered;
    }

    throw new ApiError(
      409,
      "candidate_commit_in_progress",
      "Candidate is already being committed",
    );
  }

  const claim: ChatCommitClaim = {
    candidate_id: candidateSet.candidate_id,
    revision: candidateSet.revision,
    request_id: requestId,
    claimed_at: new Date().toISOString(),
  };

  const claimContext: ChatSessionContext = {
    ...contextValue,
    active_commit: claim,
  };

  const { data: claimedSession, error: claimError } = await client
    .from("chat_sessions")
    .update({
      context: claimContext,
      updated_at: claim.claimed_at,
    })
    .eq("id", chatId)
    .eq("updated_at", chatSession.updated_at)
    .select("id,context,created_at,updated_at,status")
    .maybeSingle();

  if (claimError) {
    throw new ApiError(
      500,
      "chat_commit_claim_failed",
      "Could not claim candidate commit",
      claimError.message,
    );
  }

  if (!claimedSession) {
    const recovered = await waitForCommittedCandidate({
      client,
      chatId,
      candidateId: candidateSet.candidate_id,
      revision: candidateSet.revision,
      extractChatContext,
      respond,
      buildChatLoopResponse,
      fetchChatMessages,
    });

    if (recovered) {
      return recovered;
    }

    throw new ApiError(
      409,
      "candidate_commit_in_progress",
      "Candidate is already being committed",
    );
  }

  const selectedMemoryIds = extractMemoryContextIds(contextValue);

  try {
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

        // Save to cookbook_entries (recipe_saves is deprecated after backfill 0047).
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
          throw new ApiError(
            500,
            "cookbook_entry_create_failed",
            "Could not save committed recipe to cookbook",
            cookbookError.message,
          );
        }

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

    const committedComponents: ChatCommitRecipe[] = committedComponentsForImages
      .map((component) => ({
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
    const links: ChatCommitLink[] = [];

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

    const committedAt = new Date().toISOString();
    const commitSummary = buildCommitSummary(
      candidateSet,
      committedComponents,
      links,
    );
    const nextContext: ChatSessionContext = {
      ...contextValue,
      loop_state: "ideation",
      candidate_recipe_set: null,
      candidate_revision: candidateSet.revision,
      active_component_id: null,
      active_commit: null,
      last_committed_candidate: {
        candidate_id: candidateSet.candidate_id,
        revision: candidateSet.revision,
        committed_at: committedAt,
        commit: commitSummary,
      },
      pending_preference_conflict: null,
    };

    const { data: finalizedSession, error: finalizeError } = await client
      .from("chat_sessions")
      .update({
        context: nextContext,
        updated_at: committedAt,
      })
      .eq("id", chatId)
      .eq("updated_at", claim.claimed_at)
      .select("id,context,created_at,updated_at,status")
      .maybeSingle();

    if (finalizeError || !finalizedSession) {
      throw new ApiError(
        500,
        "chat_context_update_failed",
        "Could not update chat context",
        finalizeError?.message,
      );
    }

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

    await logBehaviorEvents({
      serviceClient,
      events: [{
        eventId: crypto.randomUUID(),
        userId: auth.userId,
        eventType: "chat_commit_completed",
        sessionId: chatId,
        entityType: "candidate_set",
        entityId: candidateSet.candidate_id,
        payload: {
          candidate_id: candidateSet.candidate_id,
          revision: candidateSet.revision,
          committed_count: committedComponents.length,
        },
      }],
    });

    return await buildCommitResponse({
      chatId,
      chatSession: finalizedSession,
      context: nextContext,
      commitSummary,
      client,
      respond,
      buildChatLoopResponse,
      fetchChatMessages,
    });
  } catch (error) {
    await releaseCommitClaim({
      client,
      chatId,
      claimedAt: claim.claimed_at,
      context: {
        ...contextValue,
        active_commit: null,
      },
    });

    throw error;
  }
};
