import { ApiError } from "../../../_shared/errors.ts";
import type { ChatSessionContext, RouteContext } from "../shared.ts";
import type { ChatDeps } from "./types.ts";

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
    updateChatSessionLoopContext,
    logChangelog,
    buildChatLoopResponse,
    fetchChatMessages,
  } = deps;

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
};
