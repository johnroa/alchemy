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
  CookbookEntry,
  ChatMessageView,
  ContextPack,
  PreferenceContext,
  RecipePreview,
  RecipeViewOptions,
  RecipeView,
  RouteContext,
  VariantStatus,
} from "./shared.ts";
import type { SearchSafetyExclusions } from "../recipe-search.ts";

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
  ) => Promise<CookbookEntry[]>;
  buildCookbookInsightDeterministic: (items: CookbookEntry[]) => string | null;
  ensurePersistedRecipeImageRequest: (input: {
    serviceClient: RouteContext["serviceClient"];
    userId: string;
    requestId: string;
    recipeId: string;
    recipeVersionId: string;
  }) => Promise<void>;
  scheduleImageQueueDrain: (input: {
    serviceClient: RouteContext["serviceClient"];
    actorUserId: string;
    requestId: string;
    limit?: number;
  }) => void;
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
  computePreferenceFingerprint: (
    preferences: PreferenceContext,
  ) => Promise<string | null>;
  computeSafetyExclusions: (
    preferences: PreferenceContext,
  ) => SearchSafetyExclusions | undefined;
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
    modelOverrides,
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
    ensurePersistedRecipeImageRequest,
    scheduleImageQueueDrain,
    searchRecipes,
    toJsonValue,
    computePreferenceFingerprint,
    computeSafetyExclusions,
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

    // Load user preferences for safety exclusions — ensures recipes
    // containing the user's allergens/restrictions are never surfaced.
    const searchPrefs = await getPreferences(client, auth.userId);
    const safetyExclusions = computeSafetyExclusions(searchPrefs);

    const response = await searchRecipes({
      serviceClient,
      userId: auth.userId,
      requestId,
      surface: "explore",
      query: body.query ?? null,
      presetId: body.preset_id ?? null,
      cursor: body.cursor ?? null,
      limit: typeof body.limit === "number" ? body.limit : null,
      safetyExclusions,
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
      // Parse optional body for autopersonalize flag (defaults to true).
      let autopersonalize = true;
      try {
        const body = await requireJsonBody<{ autopersonalize?: boolean }>(request);
        if (typeof body.autopersonalize === "boolean") {
          autopersonalize = body.autopersonalize;
        }
      } catch {
        // Body is optional — empty request means default autopersonalize=true.
      }

      // cookbook_entries is the canonical save table (backfilled in migration 0047).
      // recipe_saves is deprecated — no longer written to.
      const { error: cookbookError } = await client
        .from("cookbook_entries")
        .upsert(
          {
            user_id: auth.userId,
            canonical_recipe_id: recipeId,
            autopersonalize,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,canonical_recipe_id" },
        );

      if (cookbookError) {
        throw new ApiError(
          500,
          "cookbook_entry_create_failed",
          "Could not create cookbook entry",
          cookbookError.message,
        );
      }

      await logChangelog({
        serviceClient,
        actorUserId: auth.userId,
        scope: "cookbook",
        entityType: "cookbook_entry",
        entityId: recipeId,
        action: "saved",
        requestId,
        afterJson: { autopersonalize } as unknown as JsonValue,
      });

      // Ensure image processing for the recipe.
      const { data: recipeImageCheck, error: recipeImageCheckError } = await client
        .from("recipes")
        .select("current_version_id")
        .eq("id", recipeId)
        .maybeSingle();

      if (recipeImageCheckError) {
        throw new ApiError(
          500,
          "recipe_image_state_lookup_failed",
          "Could not load recipe image state",
          recipeImageCheckError.message,
        );
      }

      if (recipeImageCheck?.current_version_id) {
        await ensurePersistedRecipeImageRequest({
          serviceClient,
          userId: auth.userId,
          requestId,
          recipeId,
          recipeVersionId: String(recipeImageCheck.current_version_id),
        });
        scheduleImageQueueDrain({
          serviceClient,
          actorUserId: auth.userId,
          requestId,
          limit: 5,
        });
      }

      // When autopersonalize is true, check if the user has constraint
      // preferences that would produce a meaningful variant. If so, schedule
      // background variant materialisation via the recipe_personalize scope.
      let variantStatus: VariantStatus = "none";
      if (autopersonalize) {
        const preferences = await getPreferences(client, auth.userId);
        const hasConstraints =
          (preferences.dietary_restrictions?.length ?? 0) > 0 ||
          (preferences.aversions?.length ?? 0) > 0 ||
          (preferences.equipment?.length ?? 0) > 0;

        if (hasConstraints && recipeImageCheck?.current_version_id) {
          // Mark as processing — background job will update to current/failed.
          variantStatus = "processing";

          // Fire-and-forget via EdgeRuntime.waitUntil (same pattern as
          // image queue draining). The variant/refresh endpoint contains
          // the full materialisation pipeline.
          const variantTask = (async () => {
            try {
              const { data: canonicalVersion } = await client
                .from("recipe_versions")
                .select("id, payload")
                .eq("id", recipeImageCheck.current_version_id)
                .single();

              if (!canonicalVersion) return;

              const canonicalPayload = canonicalVersion.payload as RecipePayload;
              const preferenceContext: Record<string, JsonValue> = {
                dietary_preferences: preferences.dietary_preferences as unknown as JsonValue,
                dietary_restrictions: preferences.dietary_restrictions as unknown as JsonValue,
                skill_level: preferences.skill_level as unknown as JsonValue,
                equipment: preferences.equipment as unknown as JsonValue,
                cuisines: preferences.cuisines as unknown as JsonValue,
                aversions: preferences.aversions as unknown as JsonValue,
                cooking_for: (preferences.cooking_for ?? null) as unknown as JsonValue,
                max_difficulty: preferences.max_difficulty as unknown as JsonValue,
                presentation_preferences: preferences.presentation_preferences as unknown as JsonValue,
              };

              const result = await llmGateway.personalizeRecipe({
                client,
                userId: auth.userId,
                requestId,
                canonicalPayload,
                preferences: preferenceContext,
                modelOverrides,
              });

              // Fingerprint at materialization time for stale detection.
              const bgFingerprint = await computePreferenceFingerprint(preferences);

              const provenance: Record<string, JsonValue> = {
                adaptation_summary: result.adaptationSummary,
                applied_adaptations: result.appliedAdaptations as JsonValue,
                tag_diff: result.tagDiff as unknown as JsonValue,
                preference_fingerprint: bgFingerprint,
              };

              // Insert variant version.
              const { data: newVersion } = await serviceClient
                .from("user_recipe_variant_versions")
                .insert({
                  source_canonical_version_id: canonicalVersion.id,
                  payload: result.recipe as unknown as JsonValue,
                  derivation_kind: "auto_personalized",
                  provenance,
                })
                .select("id")
                .single();

              if (!newVersion) return;

              // Create variant row with fingerprint.
              const { data: newVariant } = await serviceClient
                .from("user_recipe_variants")
                .insert({
                  user_id: auth.userId,
                  canonical_recipe_id: recipeId,
                  current_version_id: newVersion.id,
                  base_canonical_version_id: canonicalVersion.id,
                  preference_fingerprint: bgFingerprint,
                  stale_status: "current",
                  last_materialized_at: new Date().toISOString(),
                })
                .select("id")
                .single();

              if (!newVariant) return;

              // Link version to variant and cookbook entry.
              await serviceClient
                .from("user_recipe_variant_versions")
                .update({ variant_id: newVariant.id })
                .eq("id", newVersion.id);

              await serviceClient
                .from("cookbook_entries")
                .update({
                  active_variant_id: newVariant.id,
                  updated_at: new Date().toISOString(),
                })
                .eq("user_id", auth.userId)
                .eq("canonical_recipe_id", recipeId);
            } catch (err) {
              console.error("variant_auto_materialization_failed", {
                request_id: requestId,
                recipe_id: recipeId,
                user_id: auth.userId,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          })();

          // runInBackground is injected via deps to use EdgeRuntime.waitUntil.
          // Since we don't have it as a dep, fire-and-forget with void.
          void variantTask;
        }
      }

      return respond(200, {
        saved: true,
        canonical_recipe_id: recipeId,
        variant_status: variantStatus,
        active_variant_version_id: null,
      });
    }

    if (method === "DELETE") {
      // Delete from cookbook_entries (recipe_saves is deprecated).
      const { error: cookbookDeleteError } = await client
        .from("cookbook_entries")
        .delete()
        .eq("user_id", auth.userId)
        .eq("canonical_recipe_id", recipeId);

      if (cookbookDeleteError) {
        throw new ApiError(
          500,
          "cookbook_entry_delete_failed",
          "Could not remove cookbook entry",
          cookbookDeleteError.message,
        );
      }

      await logChangelog({
        serviceClient,
        actorUserId: auth.userId,
        scope: "cookbook",
        entityType: "cookbook_entry",
        entityId: recipeId,
        action: "unsaved",
        requestId,
      });

      return respond(200, { saved: false });
    }
  }

  // ── GET /recipes/{id}/variant ──
  // Returns the user's personalised variant for a canonical recipe.
  if (
    segments.length === 3 &&
    segments[0] === "recipes" &&
    segments[2] === "variant" &&
    method === "GET"
  ) {
    const recipeId = parseUuid(segments[1]);

    const { data: variant, error: variantError } = await client
      .from("user_recipe_variants")
      .select(
        "id, current_version_id, base_canonical_version_id, preference_fingerprint, stale_status, last_materialized_at",
      )
      .eq("user_id", auth.userId)
      .eq("canonical_recipe_id", recipeId)
      .maybeSingle();

    if (variantError) {
      throw new ApiError(
        500,
        "variant_fetch_failed",
        "Could not fetch variant",
        variantError.message,
      );
    }

    if (!variant || !variant.current_version_id) {
      throw new ApiError(
        404,
        "variant_not_found",
        "No variant exists for this user and recipe",
      );
    }

    const { data: variantVersion, error: versionError } = await client
      .from("user_recipe_variant_versions")
      .select(
        "id, payload, derivation_kind, provenance, source_canonical_version_id, created_at",
      )
      .eq("id", variant.current_version_id)
      .single();

    if (versionError || !variantVersion) {
      throw new ApiError(
        500,
        "variant_version_fetch_failed",
        "Could not fetch variant version",
        versionError?.message,
      );
    }

    const payload = variantVersion.payload as Record<string, JsonValue>;
    const provenance = variantVersion.provenance as Record<string, JsonValue>;

    // Apply rendering-only presentation options (units, groupBy, inline measurements).
    const preferences = await getPreferences(client, auth.userId);
    const viewOptions = resolvePresentationOptions({
      query: url.searchParams,
      presentationPreferences:
        preferences.presentation_preferences as Record<string, unknown>,
    });

    // Build a recipe view from the variant payload using the same projection
    // as canonical reads, but sourcing from the variant's payload.
    const canonicalRecipe = await fetchRecipeView(
      client,
      recipeId,
      true,
      viewOptions,
    );

    // Overlay variant payload fields onto the canonical recipe view.
    // The variant payload has the same structure as recipe_versions.payload.
    const variantRecipe = {
      ...canonicalRecipe,
      summary: (payload.summary as string) ?? canonicalRecipe.summary,
      ingredients: (payload.ingredients as JsonValue[]) ?? canonicalRecipe.ingredients,
      steps: (payload.steps as JsonValue[]) ?? canonicalRecipe.steps,
    };

    return respond(200, {
      variant_id: variant.id,
      variant_version_id: variantVersion.id,
      canonical_recipe_id: recipeId,
      recipe: variantRecipe,
      adaptation_summary:
        (provenance.adaptation_summary as string) ?? "",
      variant_status: variant.stale_status as VariantStatus,
      derivation_kind: variantVersion.derivation_kind,
      personalized_at:
        variant.last_materialized_at ?? variantVersion.created_at,
      tag_diff: (provenance.tag_diff as JsonValue) ?? { added: [], removed: [] },
      provenance,
    });
  }

  // ── POST /recipes/{id}/variant/refresh ──
  // Creates or refreshes the user's personalised variant by calling the
  // recipe_personalize LLM scope. Pipeline:
  //   1. Load canonical payload + user preferences
  //   2. LLM generates personalised recipe + adaptation metadata
  //   3. Insert new variant version (or create variant row if first time)
  //   4. Return the materialised variant state
  if (
    segments.length === 4 &&
    segments[0] === "recipes" &&
    segments[2] === "variant" &&
    segments[3] === "refresh" &&
    method === "POST"
  ) {
    const recipeId = parseUuid(segments[1]);

    // 1. Load canonical recipe + its current version payload.
    const { data: recipe, error: recipeError } = await client
      .from("recipes")
      .select("id, current_version_id")
      .eq("id", recipeId)
      .maybeSingle();

    if (recipeError || !recipe || !recipe.current_version_id) {
      throw new ApiError(
        404,
        "recipe_not_found",
        "Canonical recipe not found",
        recipeError?.message,
      );
    }

    const { data: canonicalVersion, error: cvError } = await client
      .from("recipe_versions")
      .select("id, payload")
      .eq("id", recipe.current_version_id)
      .single();

    if (cvError || !canonicalVersion) {
      throw new ApiError(
        500,
        "canonical_version_fetch_failed",
        "Could not load canonical recipe version",
        cvError?.message,
      );
    }

    const canonicalPayload = canonicalVersion.payload as RecipePayload;

    // 2. Load user preferences and build preference context for the LLM.
    const preferences = await getPreferences(client, auth.userId);
    const preferenceContext: Record<string, JsonValue> = {
      dietary_preferences: preferences.dietary_preferences as unknown as JsonValue,
      dietary_restrictions: preferences.dietary_restrictions as unknown as JsonValue,
      skill_level: preferences.skill_level as unknown as JsonValue,
      equipment: preferences.equipment as unknown as JsonValue,
      cuisines: preferences.cuisines as unknown as JsonValue,
      aversions: preferences.aversions as unknown as JsonValue,
      cooking_for: (preferences.cooking_for ?? null) as unknown as JsonValue,
      max_difficulty: preferences.max_difficulty as unknown as JsonValue,
      presentation_preferences: preferences.presentation_preferences as unknown as JsonValue,
    };

    // Parse optional manual edit instructions from request body.
    let manualEditInstructions: string | undefined;
    try {
      const body = await requireJsonBody<{ instructions?: string }>(request);
      if (body.instructions?.trim()) {
        manualEditInstructions = body.instructions.trim();
      }
    } catch {
      // Body is optional for refresh.
    }

    // Load any previously stored manual edits for replay during
    // re-personalization (e.g., constraint change triggered refresh).
    const storedEdits = Array.isArray(existingVariant?.accumulated_manual_edits)
      ? (existingVariant.accumulated_manual_edits as Array<{
          instruction: string;
          created_at: string;
        }>)
      : [];

    // 3. Call LLM to materialise the personalised variant.
    // Both new instructions and accumulated edits are sent so the LLM
    // can apply everything in one pass and detect conflicts.
    const result = await llmGateway.personalizeRecipe({
      client,
      userId: auth.userId,
      requestId,
      canonicalPayload,
      preferences: preferenceContext,
      manualEditInstructions,
      accumulatedManualEdits: storedEdits.length > 0 ? storedEdits : undefined,
      modelOverrides: modelOverrides,
    });

    // 4. Check for existing variant row (including accumulated manual edits).
    const { data: existingVariant } = await client
      .from("user_recipe_variants")
      .select("id, current_version_id, accumulated_manual_edits")
      .eq("user_id", auth.userId)
      .eq("canonical_recipe_id", recipeId)
      .maybeSingle();

    // 5. Compute preference fingerprint for stale detection.
    const fingerprint = await computePreferenceFingerprint(preferences);

    // 6. Persist: insert variant version, then upsert variant row.
    // Include manual edit instructions in provenance for audit trail.
    const provenance: Record<string, JsonValue> = {
      adaptation_summary: result.adaptationSummary,
      applied_adaptations: result.appliedAdaptations as JsonValue,
      tag_diff: result.tagDiff as unknown as JsonValue,
      preference_fingerprint: fingerprint,
    };
    if (manualEditInstructions) {
      provenance.manual_edit_instructions = manualEditInstructions;
    }
    if (storedEdits.length > 0) {
      provenance.replayed_manual_edits = storedEdits as unknown as JsonValue;
    }
    if (result.conflicts.length > 0) {
      provenance.conflicts = result.conflicts as JsonValue;
    }

    // Derivation kind: manual_edit (only instructions, no prior auto),
    // mixed (both), or auto_personalized (no manual involvement).
    const hasManualInput = Boolean(manualEditInstructions) || storedEdits.length > 0;
    const derivationKind = hasManualInput ? "mixed" : "auto_personalized";

    // Conflicts → needs_review instead of current. The user will be
    // prompted to resolve in Sous Chef.
    const resolvedStaleStatus: string = result.conflicts.length > 0
      ? "needs_review"
      : "current";

    // Build the updated accumulated manual edits list.
    // If new instructions were provided, append them.
    const updatedManualEdits = manualEditInstructions
      ? [
          ...storedEdits,
          {
            instruction: manualEditInstructions,
            created_at: new Date().toISOString(),
          },
        ]
      : storedEdits;

    // Insert the new variant version.
    const { data: newVersion, error: versionInsertError } = await serviceClient
      .from("user_recipe_variant_versions")
      .insert({
        variant_id: existingVariant?.id ?? undefined,
        parent_variant_version_id: existingVariant?.current_version_id ?? null,
        source_canonical_version_id: canonicalVersion.id,
        payload: result.recipe as unknown as JsonValue,
        derivation_kind: derivationKind,
        provenance,
      })
      .select("id")
      .single();

    if (versionInsertError || !newVersion) {
      throw new ApiError(
        500,
        "variant_version_insert_failed",
        "Could not save personalised variant version",
        versionInsertError?.message,
      );
    }

    let variantId: string;

    if (existingVariant) {
      // Update existing variant row with new version, fingerprint,
      // stale status, and accumulated manual edits.
      const { error: updateError } = await serviceClient
        .from("user_recipe_variants")
        .update({
          current_version_id: newVersion.id,
          base_canonical_version_id: canonicalVersion.id,
          preference_fingerprint: fingerprint,
          stale_status: resolvedStaleStatus,
          accumulated_manual_edits: updatedManualEdits,
          last_materialized_at: new Date().toISOString(),
        })
        .eq("id", existingVariant.id);

      if (updateError) {
        throw new ApiError(
          500,
          "variant_update_failed",
          "Could not update variant",
          updateError.message,
        );
      }
      variantId = existingVariant.id;
    } else {
      // Create new variant row with fingerprint and any manual edits.
      const { data: newVariant, error: variantInsertError } = await serviceClient
        .from("user_recipe_variants")
        .insert({
          user_id: auth.userId,
          canonical_recipe_id: recipeId,
          current_version_id: newVersion.id,
          base_canonical_version_id: canonicalVersion.id,
          preference_fingerprint: fingerprint,
          stale_status: resolvedStaleStatus,
          accumulated_manual_edits: updatedManualEdits,
          last_materialized_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (variantInsertError || !newVariant) {
        throw new ApiError(
          500,
          "variant_insert_failed",
          "Could not create variant",
          variantInsertError?.message,
        );
      }
      variantId = newVariant.id;

      // Back-link the version to the newly created variant row.
      await serviceClient
        .from("user_recipe_variant_versions")
        .update({ variant_id: variantId })
        .eq("id", newVersion.id);
    }

    // Update the cookbook entry to point to the active variant.
    await serviceClient
      .from("cookbook_entries")
      .update({
        active_variant_id: variantId,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", auth.userId)
      .eq("canonical_recipe_id", recipeId);

    await logChangelog({
      serviceClient,
      actorUserId: auth.userId,
      scope: "variants",
      entityType: "user_recipe_variant",
      entityId: variantId,
      action: existingVariant ? "refreshed" : "created",
      requestId,
      afterJson: {
        canonical_recipe_id: recipeId,
        derivation_kind: derivationKind,
        adaptations_count: result.appliedAdaptations.length,
      } as unknown as JsonValue,
    });

    return respond(200, {
      variant_id: variantId,
      variant_version_id: newVersion.id,
      variant_status: resolvedStaleStatus as VariantStatus,
      adaptation_summary: result.adaptationSummary,
      conflicts: result.conflicts.length > 0 ? result.conflicts : undefined,
    });
  }

  // ── POST /recipes/{id}/publish ──
  // Publishes a private variant as a new canonical recipe with derived_from edge.
  if (
    segments.length === 3 &&
    segments[0] === "recipes" &&
    segments[2] === "publish" &&
    method === "POST"
  ) {
    const sourceRecipeId = parseUuid(segments[1]);

    // Get the user's variant for this recipe.
    const { data: variant, error: variantError } = await client
      .from("user_recipe_variants")
      .select("id, current_version_id, canonical_recipe_id")
      .eq("user_id", auth.userId)
      .eq("canonical_recipe_id", sourceRecipeId)
      .maybeSingle();

    if (variantError || !variant || !variant.current_version_id) {
      throw new ApiError(
        404,
        "variant_not_found",
        "No variant to publish for this recipe",
        variantError?.message,
      );
    }

    // Get the variant version payload.
    const { data: variantVersion, error: vvError } = await client
      .from("user_recipe_variant_versions")
      .select("payload, source_canonical_version_id")
      .eq("id", variant.current_version_id)
      .single();

    if (vvError || !variantVersion) {
      throw new ApiError(
        500,
        "variant_version_fetch_failed",
        "Could not fetch variant payload for publishing",
        vvError?.message,
      );
    }

    // Parse optional title override.
    let newTitle: string | undefined;
    try {
      const body = await requireJsonBody<{ title?: string }>(request);
      if (body.title?.trim()) {
        newTitle = body.title.trim();
      }
    } catch {
      // Body is optional.
    }

    const payload = variantVersion.payload as RecipePayload;
    if (newTitle) {
      payload.title = newTitle;
    }

    // Persist as a new canonical recipe.
    const saved = await persistRecipe({
      client,
      serviceClient,
      userId: auth.userId,
      requestId,
      payload,
      diffSummary: `Published from variant of recipe ${sourceRecipeId}`,
    });

    // Create derived_from graph edge linking new canonical to source canonical.
    // Uses service client to bypass RLS on graph tables.
    const derivedFromTypeId = await resolveRelationTypeId(
      serviceClient,
      "derived_from",
    );

    // Create graph entities for both recipes if they don't exist,
    // then create the edge. Best-effort — don't fail the publish on graph errors.
    try {
      // Ensure recipe entities exist in graph.
      const sourceEntityResult = await serviceClient
        .from("graph_entities")
        .upsert(
          {
            entity_type: "recipe",
            label: payload.title ?? "Untitled",
            metadata: { recipe_id: saved.recipeId },
          },
          { onConflict: "entity_type,label" },
        )
        .select("id")
        .single();

      const targetEntityResult = await serviceClient
        .from("graph_entities")
        .select("id")
        .eq("entity_type", "recipe")
        .eq("metadata->>recipe_id", sourceRecipeId)
        .maybeSingle();

      if (sourceEntityResult.data && targetEntityResult.data) {
        await serviceClient.from("graph_edges").upsert(
          {
            from_entity_id: sourceEntityResult.data.id,
            to_entity_id: targetEntityResult.data.id,
            relation_type_id: derivedFromTypeId,
            source: "variant_publish",
            confidence: 1.0,
            metadata: {
              source_recipe_id: sourceRecipeId,
              published_recipe_id: saved.recipeId,
            },
          },
          {
            onConflict:
              "from_entity_id,to_entity_id,relation_type_id,source",
          },
        );
      }
    } catch {
      // Graph edge creation is best-effort. Log but don't fail the publish.
      console.warn(
        `[publish] Failed to create derived_from graph edge for recipe ${saved.recipeId}`,
      );
    }

    await logChangelog({
      serviceClient,
      actorUserId: auth.userId,
      scope: "cookbook",
      entityType: "recipe",
      entityId: saved.recipeId,
      action: "published_from_variant",
      requestId,
      afterJson: {
        source_recipe_id: sourceRecipeId,
        new_recipe_id: saved.recipeId,
        new_version_id: saved.versionId,
      } as unknown as JsonValue,
    });

    return respond(200, {
      recipe_id: saved.recipeId,
      recipe_version_id: saved.versionId,
      title: payload.title ?? "Untitled",
    });
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
