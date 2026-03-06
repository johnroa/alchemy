import {
  ApiError,
  requireJsonBody,
} from "../../_shared/errors.ts";
import { llmGateway } from "../../_shared/llm-gateway.ts";
import type {
  JsonValue,
  RecipePayload,
} from "../../_shared/types.ts";
import type {
  CookbookItem,
  ChatMessageView,
  ContextPack,
  PreferenceContext,
  RecipePreview,
  RecipeViewOptions,
  RecipeView,
  RouteContext,
} from "./shared.ts";

type RecipesDeps = {
  parseUuid: (value: string) => string;
  getPreferences: (
    client: RouteContext["client"],
    userId: string,
  ) => Promise<PreferenceContext>;
  resolvePresentationOptions: (input: {
    query: URLSearchParams;
    presentationPreferences: Record<string, unknown>;
  }) => RecipeViewOptions;
  fetchRecipeView: (
    client: RouteContext["client"],
    recipeId: string,
    enforceVisibility?: boolean,
    viewOptions?: RecipeViewOptions,
  ) => Promise<RecipeView>;
  fetchChatMessages: (
    client: RouteContext["client"],
    chatId: string,
    limit?: number,
  ) => Promise<ChatMessageView[]>;
  buildContextPack: (input: {
    userClient: RouteContext["client"];
    serviceClient: RouteContext["serviceClient"];
    userId: string;
    requestId: string;
    prompt: string;
    context: Record<string, JsonValue>;
    selectionMode?: "llm" | "fast";
  }) => Promise<ContextPack>;
  deriveAttachmentPayload: (
    payload: Omit<RecipePayload, "attachments">,
  ) => RecipePayload;
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
  resolveRelationTypeId: (
    client: RouteContext["client"] | RouteContext["serviceClient"],
    relationType: string,
  ) => Promise<string>;
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
  buildCookbookItems: (
    client: RouteContext["client"],
    userId: string,
  ) => Promise<CookbookItem[]>;
  buildCookbookInsightDeterministic: (items: CookbookItem[]) => string | null;
  enqueueImageJob: (
    client: RouteContext["client"],
    recipeId: string,
  ) => Promise<void>;
  searchRecipes: (input: {
    serviceClient: RouteContext["serviceClient"];
    userId: string;
    requestId: string;
    surface: "explore" | "chat";
    query?: string | null;
    presetId?: string | null;
    cursor?: string | null;
    limit?: number | null;
  }) => Promise<{
    search_id: string;
    applied_context: "all" | "preset" | "query";
    items: RecipePreview[];
    next_cursor: string | null;
    no_match: {
      code: string;
      message: string;
      suggested_action: string;
    } | null;
  }>;
  toJsonValue: (value: unknown) => JsonValue;
};

export const handleRecipeRoutes = async (
  context: RouteContext,
  deps: RecipesDeps,
): Promise<Response | null> => {
  const {
    request,
    url,
    segments,
    method,
    auth,
    client,
    serviceClient,
    requestId,
    respond,
  } = context;
  const {
    parseUuid,
    getPreferences,
    resolvePresentationOptions,
    fetchRecipeView,
    fetchChatMessages,
    buildContextPack,
    deriveAttachmentPayload,
    persistRecipe,
    resolveRelationTypeId,
    logChangelog,
    buildCookbookItems,
    buildCookbookInsightDeterministic,
    enqueueImageJob,
    searchRecipes,
    toJsonValue,
  } = deps;

  if (segments.length === 1 && segments[0] === "collections") {
    if (method === "GET") {
      const { data, error } = await client
        .from("collections")
        .select("id,name,created_at")
        .order("created_at", { ascending: false });
      if (error) {
        throw new ApiError(
          500,
          "collections_fetch_failed",
          "Could not fetch collections",
          error.message,
        );
      }

      return respond(200, { items: data ?? [] });
    }

    if (method === "POST") {
      const body = await requireJsonBody<{ name: string }>(request);
      const name = body.name?.trim();
      if (!name) {
        throw new ApiError(
          400,
          "invalid_collection_name",
          "Collection name is required",
        );
      }

      const { data, error } = await client
        .from("collections")
        .insert({ name, owner_user_id: auth.userId })
        .select("id,name,created_at")
        .single();

      if (error || !data) {
        throw new ApiError(
          500,
          "collection_create_failed",
          "Could not create collection",
          error?.message,
        );
      }

      await logChangelog({
        serviceClient,
        actorUserId: auth.userId,
        scope: "collections",
        entityType: "collection",
        entityId: data.id,
        action: "created",
        requestId,
        afterJson: data as unknown as JsonValue,
      });

      return respond(200, data);
    }
  }

  if (
    segments.length === 3 &&
    segments[0] === "collections" &&
    segments[2] === "items" &&
    method === "POST"
  ) {
    const collectionId = parseUuid(segments[1]);
    const body = await requireJsonBody<{ recipe_id: string }>(request);
    const recipeId = parseUuid(body.recipe_id);

    const { error } = await client.from("collection_items").upsert({
      collection_id: collectionId,
      recipe_id: recipeId,
    });

    if (error) {
      throw new ApiError(
        500,
        "collection_item_create_failed",
        "Could not add recipe to collection",
        error.message,
      );
    }

    await logChangelog({
      serviceClient,
      actorUserId: auth.userId,
      scope: "collections",
      entityType: "collection_item",
      entityId: `${collectionId}:${recipeId}`,
      action: "added",
      requestId,
    });

    return respond(200, { ok: true });
  }

  if (
    segments.length === 2 &&
    segments[0] === "recipes" &&
    segments[1] === "search" &&
    method === "POST"
  ) {
    const body = await requireJsonBody<{
      query?: string;
      preset_id?: string;
      cursor?: string;
      limit?: number;
    }>(request);

    const response = await searchRecipes({
      serviceClient,
      userId: auth.userId,
      requestId,
      surface: "explore",
      query: body.query ?? null,
      presetId: body.preset_id ?? null,
      cursor: body.cursor ?? null,
      limit: typeof body.limit === "number" ? body.limit : null,
    });

    return respond(200, response);
  }

  if (
    segments.length === 2 &&
    segments[0] === "recipes" &&
    segments[1] === "cookbook" &&
    method === "GET"
  ) {
    const items = await buildCookbookItems(client, auth.userId);
    const cookbookInsight = buildCookbookInsightDeterministic(items);
    return respond(200, { items, cookbook_insight: cookbookInsight });
  }

  if (segments.length === 2 && segments[0] === "recipes" && method === "GET") {
    const recipeId = parseUuid(segments[1]);
    const preferences = await getPreferences(client, auth.userId);
    const viewOptions = resolvePresentationOptions({
      query: url.searchParams,
      presentationPreferences:
        preferences.presentation_preferences as Record<string, unknown>,
    });
    const recipe = await fetchRecipeView(client, recipeId, true, viewOptions);
    return respond(200, recipe);
  }

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

    const saved = await persistRecipe({
      client,
      serviceClient,
      userId: auth.userId,
      requestId,
      payload: attachmentRecipePayload,
      diffSummary: `Attachment (${relationType})`,
      selectedMemoryIds: contextPack.selectedMemoryIds,
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

  if (
    segments.length === 3 &&
    segments[0] === "recipes" &&
    segments[2] === "save"
  ) {
    const recipeId = parseUuid(segments[1]);
    if (method === "POST") {
      const { error } = await client
        .from("recipe_saves")
        .upsert({ user_id: auth.userId, recipe_id: recipeId }, {
          onConflict: "user_id,recipe_id",
        });

      if (error) {
        throw new ApiError(
          500,
          "recipe_save_failed",
          "Could not save recipe",
          error.message,
        );
      }

      await logChangelog({
        serviceClient,
        actorUserId: auth.userId,
        scope: "cookbook",
        entityType: "recipe_save",
        entityId: recipeId,
        action: "saved",
        requestId,
      });

      const { data: recipeImageCheck } = await client
        .from("recipes")
        .select("hero_image_url")
        .eq("id", recipeId)
        .maybeSingle();

      if (!recipeImageCheck?.hero_image_url) {
        await enqueueImageJob(client, recipeId);
      }

      return respond(200, { saved: true });
    }

    if (method === "DELETE") {
      const { error } = await client
        .from("recipe_saves")
        .delete()
        .eq("user_id", auth.userId)
        .eq("recipe_id", recipeId);

      if (error) {
        throw new ApiError(
          500,
          "recipe_unsave_failed",
          "Could not unsave recipe",
          error.message,
        );
      }

      await logChangelog({
        serviceClient,
        actorUserId: auth.userId,
        scope: "cookbook",
        entityType: "recipe_save",
        entityId: recipeId,
        action: "unsaved",
        requestId,
      });

      return respond(200, { saved: false });
    }
  }

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
