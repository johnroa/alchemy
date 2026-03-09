import {
  ApiError,
  requireJsonBody,
} from "../../../_shared/errors.ts";
import { llmGateway } from "../../../_shared/llm-gateway.ts";
import type {
  JsonValue,
  RecipePayload,
} from "../../../_shared/types.ts";
import type { ChatMessageView, RouteContext } from "../shared.ts";
import type { RecipesDeps } from "./types.ts";

export const handleDetailRoutes = async (
  context: RouteContext,
  deps: RecipesDeps,
): Promise<Response | null> => {
  const { request, url, segments, method, auth, client, serviceClient, requestId, respond } =
    context;
  const {
    parseUuid,
    getPreferences,
    resolvePresentationOptions,
    fetchRecipeView,
    fetchChatMessages,
    buildContextPack,
    deriveAttachmentPayload,
    canonicalizeRecipePayload,
    resolveAndPersistCanonicalRecipe,
    resolveRelationTypeId,
    logChangelog,
    toJsonValue,
  } = deps;

  // ── GET /recipes/:id ──
  if (segments.length === 2 && segments[0] === "recipes" && method === "GET") {
    const recipeId = parseUuid(segments[1]);
    const preferences = await getPreferences(client, auth.userId);
    const viewOptions = resolvePresentationOptions({
      query: url.searchParams,
      presentationPreferences:
        preferences.presentation_preferences as Record<string, unknown>,
    });
    const recipe = await fetchRecipeView(client, recipeId, true, viewOptions);

    // Fire-and-forget: log view event for popularity tracking.
    // Uses service client because recipe_view_events has service_role-only RLS.
    serviceClient
      .from("recipe_view_events")
      .insert({ recipe_id: recipeId, user_id: auth.userId })
      .then(({ error: viewErr }) => {
        if (viewErr) {
          console.warn(`[view-track] failed to log view: ${viewErr.message}`);
        }
      });

    return respond(200, recipe);
  }

  // ── GET /recipes/:id/history ──
  if (
    segments.length === 3 &&
    segments[0] === "recipes" &&
    segments[2] === "history" &&
    method === "GET"
  ) {
    const recipeId = parseUuid(segments[1]);

    const { data: recipe, error: recipeError } = await client
      .from("recipes")
      .select("id,source_chat_id")
      .eq("id", recipeId)
      .maybeSingle();

    if (recipeError || !recipe) {
      throw new ApiError(
        404,
        "recipe_not_found",
        "Recipe not found",
        recipeError?.message,
      );
    }

    const { data: versions, error: versionsError } = await client
      .from("recipe_versions")
      .select("id,parent_version_id,diff_summary,created_at,payload,created_by")
      .eq("recipe_id", recipeId)
      .order("created_at", { ascending: true });

    if (versionsError) {
      throw new ApiError(
        500,
        "recipe_history_fetch_failed",
        "Could not fetch recipe history",
        versionsError.message,
      );
    }

    const versionIds = (versions ?? []).map((version) => version.id);
    let events: Array<Record<string, JsonValue>> = [];
    if (versionIds.length > 0) {
      const versionEventsResult = await client
        .from("recipe_version_events")
        .select("id,recipe_version_id,event_type,request_id,metadata,created_at")
        .in("recipe_version_id", versionIds)
        .order("created_at", { ascending: true });

      if (versionEventsResult.error) {
        throw new ApiError(
          500,
          "recipe_version_events_fetch_failed",
          "Could not fetch recipe version events",
          versionEventsResult.error.message,
        );
      }

      events = (versionEventsResult.data ?? []) as unknown as Array<
        Record<string, JsonValue>
      >;
    }

    let chatMessages: ChatMessageView[] = [];
    if (recipe.source_chat_id) {
      chatMessages = await fetchChatMessages(client, recipe.source_chat_id, 160);
    }

    return respond(200, {
      recipe_id: recipeId,
      source_chat_id: recipe.source_chat_id,
      versions: versions ?? [],
      version_events: events,
      chat_messages: chatMessages,
    });
  }

  // ── POST /recipes/:id/attachments ──
  if (
    segments.length === 3 &&
    segments[0] === "recipes" &&
    segments[2] === "attachments" &&
    method === "POST"
  ) {
    const parentRecipeId = parseUuid(segments[1]);
    const body = await requireJsonBody<{
      relation_type: string;
      position?: number;
      prompt?: string;
      recipe?: Omit<RecipePayload, "attachments">;
    }>(request);

    const relationType = body.relation_type?.trim().toLowerCase();
    if (!relationType) {
      throw new ApiError(
        400,
        "invalid_relation_type",
        "relation_type is required",
      );
    }

    let attachmentRecipePayload: RecipePayload;

    const parentRecipe = await fetchRecipeView(client, parentRecipeId, false);
    const contextPack = await buildContextPack({
      userClient: client,
      serviceClient,
      userId: auth.userId,
      requestId,
      prompt: body.prompt?.trim() ?? `create ${relationType} attachment`,
      context: {
        parent_recipe: toJsonValue({
          id: parentRecipe.id,
          title: parentRecipe.title,
          ingredients: parentRecipe.ingredients,
          steps: parentRecipe.steps,
          metadata: parentRecipe.metadata,
        }),
      },
    });

    if (body.recipe) {
      attachmentRecipePayload = deriveAttachmentPayload(body.recipe);
    } else if (body.prompt?.trim()) {
      const attachmentGeneration = await llmGateway.generateRecipe({
        client: serviceClient,
        userId: auth.userId,
        requestId,
        prompt: body.prompt,
        context: {
          relation_type: relationType,
          parent_recipe: toJsonValue({
            id: parentRecipe.id,
            title: parentRecipe.title,
            ingredients: parentRecipe.ingredients,
            steps: parentRecipe.steps,
            metadata: parentRecipe.metadata,
          }),
          preferences: contextPack.preferences,
          preferences_natural_language: contextPack.preferencesNaturalLanguage,
          memory_snapshot: contextPack.memorySnapshot,
          selected_memories: contextPack.selectedMemories,
        },
      });
      attachmentRecipePayload = attachmentGeneration.recipe;
    } else {
      throw new ApiError(
        400,
        "invalid_attachment_payload",
        "Provide either prompt or recipe payload",
      );
    }

    const preferences = await getPreferences(client, auth.userId);
    const canonicalPayload = await canonicalizeRecipePayload({
      serviceClient,
      userId: auth.userId,
      requestId,
      payload: attachmentRecipePayload,
      preferences: preferences as unknown as Record<string, JsonValue>,
      modelOverrides: context.modelOverrides,
    });

    const saved = await resolveAndPersistCanonicalRecipe({
      client,
      serviceClient,
      userId: auth.userId,
      requestId,
      payload: canonicalPayload,
      diffSummary: `Attachment (${relationType})`,
      selectedMemoryIds: contextPack.selectedMemoryIds,
      modelOverrides: context.modelOverrides,
    });

    const relationTypeId = await resolveRelationTypeId(client, relationType);
    const { data: insertedLink, error: linkError } = await client
      .from("recipe_links")
      .insert({
        parent_recipe_id: parentRecipeId,
        child_recipe_id: saved.recipeId,
        relation_type_id: relationTypeId,
        position: Number.isFinite(Number(body.position))
          ? Number(body.position)
          : 0,
        source: "user",
      })
      .select("id")
      .single();

    if (linkError || !insertedLink) {
      throw new ApiError(
        500,
        "recipe_attachment_create_failed",
        "Could not create attachment link",
        linkError?.message,
      );
    }

    await logChangelog({
      serviceClient,
      actorUserId: auth.userId,
      scope: "attachments",
      entityType: "recipe_link",
      entityId: insertedLink.id,
      action: "created",
      requestId,
      afterJson: {
        parent_recipe_id: parentRecipeId,
        child_recipe_id: saved.recipeId,
        relation_type: relationType,
      },
    });

    const recipe = await fetchRecipeView(client, parentRecipeId);
    return respond(200, { recipe, attachment_id: insertedLink.id });
  }

  // ── PATCH /recipes/:id/attachments/:attachmentId ──
  if (
    segments.length === 4 &&
    segments[0] === "recipes" &&
    segments[2] === "attachments" &&
    method === "PATCH"
  ) {
    const parentRecipeId = parseUuid(segments[1]);
    const attachmentId = parseUuid(segments[3]);
    const body = await requireJsonBody<{ relation_type?: string; position?: number }>(
      request,
    );

    const updatePayload: Record<string, JsonValue> = {
      updated_at: new Date().toISOString(),
    };

    if (typeof body.position === "number" && Number.isInteger(body.position)) {
      updatePayload.position = body.position;
    }

    if (body.relation_type?.trim()) {
      updatePayload.relation_type_id = await resolveRelationTypeId(
        client,
        body.relation_type,
      );
    }

    const { error } = await client
      .from("recipe_links")
      .update(updatePayload)
      .eq("id", attachmentId)
      .eq("parent_recipe_id", parentRecipeId);

    if (error) {
      throw new ApiError(
        500,
        "recipe_attachment_update_failed",
        "Could not update attachment",
        error.message,
      );
    }

    await logChangelog({
      serviceClient,
      actorUserId: auth.userId,
      scope: "attachments",
      entityType: "recipe_link",
      entityId: attachmentId,
      action: "updated",
      requestId,
      afterJson: updatePayload as unknown as JsonValue,
    });

    const recipe = await fetchRecipeView(client, parentRecipeId);
    return respond(200, { recipe });
  }

  // ── DELETE /recipes/:id/attachments/:attachmentId ──
  if (
    segments.length === 4 &&
    segments[0] === "recipes" &&
    segments[2] === "attachments" &&
    method === "DELETE"
  ) {
    const parentRecipeId = parseUuid(segments[1]);
    const attachmentId = parseUuid(segments[3]);

    const { error } = await client
      .from("recipe_links")
      .delete()
      .eq("id", attachmentId)
      .eq("parent_recipe_id", parentRecipeId);

    if (error) {
      throw new ApiError(
        500,
        "recipe_attachment_delete_failed",
        "Could not delete attachment",
        error.message,
      );
    }

    await logChangelog({
      serviceClient,
      actorUserId: auth.userId,
      scope: "attachments",
      entityType: "recipe_link",
      entityId: attachmentId,
      action: "deleted",
      requestId,
    });

    const recipe = await fetchRecipeView(client, parentRecipeId);
    return respond(200, { recipe });
  }

  // ── POST /recipes/:id/categories/override ──
  if (
    segments.length === 4 &&
    segments[0] === "recipes" &&
    segments[2] === "categories" &&
    segments[3] === "override"
  ) {
    const recipeId = parseUuid(segments[1]);
    if (method === "POST") {
      const body = await requireJsonBody<{ category: string }>(request);
      const category = body.category?.trim();

      if (!category) {
        throw new ApiError(400, "invalid_category", "category is required");
      }

      const { error } = await client.from("recipe_user_categories").upsert({
        user_id: auth.userId,
        recipe_id: recipeId,
        category,
      });

      if (error) {
        throw new ApiError(
          500,
          "category_override_failed",
          "Could not set category override",
          error.message,
        );
      }

      await logChangelog({
        serviceClient,
        actorUserId: auth.userId,
        scope: "categories",
        entityType: "recipe_user_category",
        entityId: `${recipeId}:${category}`,
        action: "override_set",
        requestId,
      });

      return respond(200, { ok: true });
    }
  }

  // ── DELETE /recipes/:id/categories/override/:category ──
  if (
    segments.length === 5 &&
    segments[0] === "recipes" &&
    segments[2] === "categories" &&
    segments[3] === "override"
  ) {
    const recipeId = parseUuid(segments[1]);
    const category = decodeURIComponent(segments[4]);

    if (method === "DELETE") {
      const { error } = await client
        .from("recipe_user_categories")
        .delete()
        .eq("user_id", auth.userId)
        .eq("recipe_id", recipeId)
        .eq("category", category);

      if (error) {
        throw new ApiError(
          500,
          "category_override_remove_failed",
          "Could not remove category override",
          error.message,
        );
      }

      await logChangelog({
        serviceClient,
        actorUserId: auth.userId,
        scope: "categories",
        entityType: "recipe_user_category",
        entityId: `${recipeId}:${category}`,
        action: "override_removed",
        requestId,
      });

      return respond(200, { ok: true });
    }
  }

  return null;
};
