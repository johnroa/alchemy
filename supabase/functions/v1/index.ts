import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { requireAuth } from "../_shared/auth.ts";
import { ApiError, errorResponse, jsonResponse, requireJsonBody } from "../_shared/errors.ts";
import { createServiceClient, createUserClient } from "../_shared/db.ts";
import { llmGateway } from "../_shared/llm-gateway.ts";
import type { JsonValue, RecipePayload } from "../_shared/types.ts";

type PreferenceContext = {
  free_form: string | null;
  dietary_preferences: string[];
  dietary_restrictions: string[];
  skill_level: string;
  equipment: string[];
  cuisines: string[];
  aversions: string[];
  cooking_for: string | null;
  max_difficulty: number;
};

const defaultPreferences: PreferenceContext = {
  free_form: null,
  dietary_preferences: [],
  dietary_restrictions: [],
  skill_level: "intermediate",
  equipment: [],
  cuisines: [],
  aversions: [],
  cooking_for: null,
  max_difficulty: 3
};

const normalizePath = (pathname: string): string[] => {
  const withoutFnPrefix = pathname.replace(/^\/functions\/v1/, "");
  const withoutApiPrefix = withoutFnPrefix.startsWith("/v1")
    ? withoutFnPrefix.slice(3)
    : withoutFnPrefix;

  return withoutApiPrefix.split("/").filter(Boolean);
};

const getLimit = (url: URL, fallback: number): number => {
  const raw = url.searchParams.get("limit");
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, 100);
};

const ensureUserProfile = async (client: SupabaseClient, userId: string): Promise<void> => {
  const { error } = await client.from("users").upsert({ id: userId, updated_at: new Date().toISOString() });
  if (error) {
    throw new ApiError(500, "user_profile_upsert_failed", "Could not ensure user profile", error.message);
  }
};

const getPreferences = async (client: SupabaseClient, userId: string): Promise<PreferenceContext> => {
  const { data, error } = await client.from("preferences").select("*").eq("user_id", userId).maybeSingle();
  if (error) {
    throw new ApiError(500, "preferences_fetch_failed", "Could not load preferences", error.message);
  }

  if (!data) {
    return defaultPreferences;
  }

  return {
    free_form: data.free_form,
    dietary_preferences: data.dietary_preferences ?? [],
    dietary_restrictions: data.dietary_restrictions ?? [],
    skill_level: data.skill_level,
    equipment: data.equipment ?? [],
    cuisines: data.cuisines ?? [],
    aversions: data.aversions ?? [],
    cooking_for: data.cooking_for,
    max_difficulty: data.max_difficulty
  };
};

const fetchRecipeView = async (client: SupabaseClient, recipeId: string) => {
  const { data: recipe, error: recipeError } = await client
    .from("recipes")
    .select("id,title,hero_image_url,visibility,updated_at,current_version_id")
    .eq("id", recipeId)
    .maybeSingle();

  if (recipeError) {
    throw new ApiError(500, "recipe_fetch_failed", "Could not fetch recipe", recipeError.message);
  }

  if (!recipe) {
    throw new ApiError(404, "recipe_not_found", "Recipe not found");
  }

  if (!recipe.current_version_id) {
    throw new ApiError(500, "recipe_version_missing", "Recipe does not have a current version");
  }

  const { data: version, error: versionError } = await client
    .from("recipe_versions")
    .select("id,payload,created_at,parent_version_id,diff_summary")
    .eq("id", recipe.current_version_id)
    .maybeSingle();

  if (versionError || !version) {
    throw new ApiError(500, "recipe_version_fetch_failed", "Could not fetch recipe version", versionError?.message);
  }

  const payload = version.payload as RecipePayload;

  return {
    id: recipe.id,
    title: payload.title ?? recipe.title,
    description: payload.description,
    summary: payload.description ?? payload.notes ?? "",
    servings: payload.servings,
    ingredients: payload.ingredients,
    steps: payload.steps,
    notes: payload.notes,
    pairings: payload.pairings ?? [],
    image_url: recipe.hero_image_url,
    visibility: recipe.visibility,
    updated_at: recipe.updated_at,
    version: {
      version_id: version.id,
      recipe_id: recipe.id,
      parent_version_id: version.parent_version_id,
      diff_summary: version.diff_summary,
      created_at: version.created_at
    }
  };
};

const persistRecipe = async (params: {
  client: SupabaseClient;
  userId: string;
  payload: RecipePayload;
  sourceDraftId?: string;
  recipeId?: string;
  parentVersionId?: string;
  diffSummary?: string;
  heroImageUrl?: string;
}) => {
  const now = new Date().toISOString();

  let recipeId = params.recipeId;
  if (!recipeId) {
    const { data: recipe, error: recipeError } = await params.client
      .from("recipes")
      .insert({
        owner_user_id: params.userId,
        title: params.payload.title,
        hero_image_url: params.heroImageUrl,
        visibility: "public",
        source_draft_id: params.sourceDraftId,
        updated_at: now
      })
      .select("id")
      .single();

    if (recipeError || !recipe) {
      throw new ApiError(500, "recipe_insert_failed", "Could not create recipe", recipeError?.message);
    }

    recipeId = recipe.id;

    const { error: publicationError } = await params.client
      .from("explore_publications")
      .upsert({ recipe_id: recipeId, status: "active", updated_at: now });

    if (publicationError) {
      throw new ApiError(500, "explore_publication_failed", "Could not publish recipe", publicationError.message);
    }
  }

  const { data: version, error: versionError } = await params.client
    .from("recipe_versions")
    .insert({
      recipe_id: recipeId,
      parent_version_id: params.parentVersionId,
      payload: params.payload,
      diff_summary: params.diffSummary,
      created_by: params.userId
    })
    .select("id,created_at,parent_version_id,diff_summary")
    .single();

  if (versionError || !version) {
    throw new ApiError(500, "recipe_version_insert_failed", "Could not create recipe version", versionError?.message);
  }

  const recipeUpdatePayload: Record<string, unknown> = {
    title: params.payload.title,
    current_version_id: version.id,
    updated_at: now
  };

  if (typeof params.heroImageUrl === "string" && params.heroImageUrl.length > 0) {
    recipeUpdatePayload.hero_image_url = params.heroImageUrl;
  }

  const { error: recipeUpdateError } = await params.client
    .from("recipes")
    .update(recipeUpdatePayload)
    .eq("id", recipeId);

  if (recipeUpdateError) {
    throw new ApiError(500, "recipe_update_failed", "Could not update recipe pointer", recipeUpdateError.message);
  }

  return {
    recipeId,
    versionId: version.id,
    version
  };
};

const applyAutoCategories = async (params: {
  client: SupabaseClient;
  recipeId: string;
  categories: Array<{ category: string; confidence: number }>;
  source: string;
}): Promise<void> => {
  const records = params.categories.map((item) => ({
    recipe_id: params.recipeId,
    category: item.category,
    confidence: item.confidence,
    source: params.source
  }));

  if (records.length === 0) {
    return;
  }

  const { error } = await params.client.from("recipe_auto_categories").upsert(records, {
    onConflict: "recipe_id,category"
  });

  if (error) {
    throw new ApiError(500, "auto_categories_failed", "Could not apply recipe auto categories", error.message);
  }
};

const recordGraphData = async (params: {
  client: SupabaseClient;
  recipeVersionId: string;
  recipe: RecipePayload;
}): Promise<void> => {
  const labels = [params.recipe.title, ...(params.recipe.pairings ?? []), ...params.recipe.ingredients.map((i) => i.name)];
  const uniqueLabels = Array.from(new Set(labels.filter((label) => label.trim().length > 0)));

  if (uniqueLabels.length === 0) {
    return;
  }

  const entitiesPayload = uniqueLabels.map((label) => ({
    entity_type: "food_item",
    label,
    metadata: {}
  }));

  const { data: entities, error: entityError } = await params.client
    .from("graph_entities")
    .upsert(entitiesPayload, { onConflict: "entity_type,label" })
    .select("id,label");

  if (entityError || !entities) {
    throw new ApiError(500, "graph_entity_upsert_failed", "Could not upsert graph entities", entityError?.message);
  }

  const entityByLabel = new Map<string, string>();
  for (const entity of entities) {
    entityByLabel.set(entity.label, entity.id);
  }

  const links = uniqueLabels
    .map((label) => entityByLabel.get(label))
    .filter((id): id is string => Boolean(id))
    .map((entityId) => ({ recipe_version_id: params.recipeVersionId, entity_id: entityId }));

  const { error: linkError } = await params.client.from("recipe_graph_links").upsert(links, {
    onConflict: "recipe_version_id,entity_id"
  });

  if (linkError) {
    throw new ApiError(500, "graph_link_failed", "Could not link recipe version to graph entities", linkError.message);
  }
};

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();

  try {
    const auth = await requireAuth(request);
    const client = createUserClient(auth.authHeader);
    const serviceClient = createServiceClient();
    await ensureUserProfile(client, auth.userId);

    const url = new URL(request.url);
    const segments = normalizePath(url.pathname);
    const method = request.method.toUpperCase();

    // /v1/preferences
    if (segments.length === 1 && segments[0] === "preferences") {
      if (method === "GET") {
        const preferences = await getPreferences(client, auth.userId);
        return jsonResponse(200, preferences);
      }

      if (method === "PATCH") {
        const body = await requireJsonBody<PreferenceContext>(request);
        const payload = { ...body, user_id: auth.userId, updated_at: new Date().toISOString() };
        const { data, error } = await client.from("preferences").upsert(payload).select("*").single();
        if (error) {
          throw new ApiError(500, "preferences_update_failed", "Could not update preferences", error.message);
        }

        return jsonResponse(200, data);
      }
    }

    // /v1/collections
    if (segments.length === 1 && segments[0] === "collections") {
      if (method === "GET") {
        const { data, error } = await client
          .from("collections")
          .select("id,name,created_at")
          .order("created_at", { ascending: false });
        if (error) {
          throw new ApiError(500, "collections_fetch_failed", "Could not fetch collections", error.message);
        }

        return jsonResponse(200, { items: data ?? [] });
      }

      if (method === "POST") {
        const body = await requireJsonBody<{ name: string }>(request);
        const name = body.name?.trim();
        if (!name) {
          throw new ApiError(400, "invalid_collection_name", "Collection name is required");
        }

        const { data, error } = await client
          .from("collections")
          .insert({ name, owner_user_id: auth.userId })
          .select("id,name,created_at")
          .single();

        if (error || !data) {
          throw new ApiError(500, "collection_create_failed", "Could not create collection", error?.message);
        }

        return jsonResponse(200, data);
      }
    }

    // /v1/collections/{id}/items
    if (segments.length === 3 && segments[0] === "collections" && segments[2] === "items" && method === "POST") {
      const collectionId = segments[1];
      const body = await requireJsonBody<{ recipe_id: string }>(request);
      const recipeId = body.recipe_id;

      if (!recipeId) {
        throw new ApiError(400, "invalid_recipe_id", "recipe_id is required");
      }

      const { error } = await client.from("collection_items").upsert({
        collection_id: collectionId,
        recipe_id: recipeId
      });

      if (error) {
        throw new ApiError(500, "collection_item_create_failed", "Could not add recipe to collection", error.message);
      }

      return jsonResponse(200, { ok: true });
    }

    // /v1/recipes/generate
    if (segments.length === 2 && segments[0] === "recipes" && segments[1] === "generate" && method === "POST") {
      const body = await requireJsonBody<{ prompt: string; vibe?: string }>(request);
      if (!body.prompt?.trim()) {
        throw new ApiError(400, "invalid_prompt", "prompt is required");
      }

      const preferenceContext = await getPreferences(client, auth.userId);
      const recipePayload = await llmGateway.generateRecipe({
        client: serviceClient,
        userId: auth.userId,
        requestId,
        prompt: body.prompt,
        context: {
          vibe: body.vibe ?? null,
          preferences: preferenceContext
        }
      });

      const categories = await llmGateway.inferCategories({
        client: serviceClient,
        userId: auth.userId,
        requestId,
        recipe: recipePayload,
        context: { preferences: preferenceContext }
      });

      let heroImageUrl: string | undefined;
      try {
        heroImageUrl = await llmGateway.generateRecipeImage({
          client: serviceClient,
          userId: auth.userId,
          requestId,
          recipe: recipePayload,
          context: { preferences: preferenceContext }
        });
      } catch (imageError) {
        console.error("recipe_image_generation_failed", imageError);
      }

      const saved = await persistRecipe({
        client,
        userId: auth.userId,
        payload: recipePayload,
        heroImageUrl,
        diffSummary: "Initial generation"
      });

      await applyAutoCategories({
        client,
        recipeId: saved.recipeId,
        categories,
        source: "llm_generate"
      });

      await recordGraphData({
        client,
        recipeVersionId: saved.versionId,
        recipe: recipePayload
      });

      const recipe = await fetchRecipeView(client, saved.recipeId);
      return jsonResponse(200, { recipe, version: recipe.version });
    }

    // /v1/recipes/feed
    if (segments.length === 2 && segments[0] === "recipes" && segments[1] === "feed" && method === "GET") {
      const limit = getLimit(url, 25);
      const { data: recipes, error: recipesError } = await client
        .from("recipes")
        .select("id,title,hero_image_url,visibility,updated_at,current_version_id")
        .eq("visibility", "public")
        .order("updated_at", { ascending: false })
        .limit(limit);

      if (recipesError) {
        throw new ApiError(500, "feed_fetch_failed", "Could not fetch recipe feed", recipesError.message);
      }

      const versionIds = (recipes ?? [])
        .map((recipe) => recipe.current_version_id)
        .filter((id): id is string => Boolean(id));

      let versionById = new Map<string, RecipePayload>();
      if (versionIds.length > 0) {
        const { data: versions, error: versionsError } = await client
          .from("recipe_versions")
          .select("id,payload")
          .in("id", versionIds);

        if (versionsError) {
          throw new ApiError(500, "feed_version_fetch_failed", "Could not fetch recipe versions for feed", versionsError.message);
        }

        versionById = new Map((versions ?? []).map((version) => [version.id, version.payload as RecipePayload]));
      }

      const items = (recipes ?? []).map((recipe) => {
        const payload = recipe.current_version_id ? versionById.get(recipe.current_version_id) : undefined;
        return {
          id: recipe.id,
          title: payload?.title ?? recipe.title,
          summary: payload?.description ?? payload?.notes ?? "",
          description: payload?.description,
          image_url: recipe.hero_image_url,
          servings: payload?.servings ?? 0,
          ingredients: payload?.ingredients ?? [],
          steps: payload?.steps ?? [],
          notes: payload?.notes,
          pairings: payload?.pairings ?? [],
          visibility: recipe.visibility,
          updated_at: recipe.updated_at
        };
      });

      return jsonResponse(200, { items });
    }

    // /v1/recipes/{id}
    if (segments.length === 2 && segments[0] === "recipes" && method === "GET") {
      const recipeId = segments[1];
      const recipe = await fetchRecipeView(client, recipeId);
      return jsonResponse(200, recipe);
    }

    // /v1/recipes/{id}/tweak
    if (segments.length === 3 && segments[0] === "recipes" && segments[2] === "tweak" && method === "POST") {
      const recipeId = segments[1];
      const body = await requireJsonBody<{ message: string }>(request);
      if (!body.message?.trim()) {
        throw new ApiError(400, "invalid_message", "message is required");
      }

      const current = await fetchRecipeView(client, recipeId);
      const preferenceContext = await getPreferences(client, auth.userId);
      const tweakedPayload = await llmGateway.tweakRecipe({
        client: serviceClient,
        userId: auth.userId,
        requestId,
        prompt: body.message,
        context: {
          current_recipe: {
            title: current.title,
            servings: current.servings,
            ingredients: current.ingredients,
            steps: current.steps,
            notes: current.notes,
            pairings: current.pairings
          },
          preferences: preferenceContext
        }
      });

      const categories = await llmGateway.inferCategories({
        client: serviceClient,
        userId: auth.userId,
        requestId,
        recipe: tweakedPayload,
        context: { preferences: preferenceContext }
      });

      let heroImageUrl: string | undefined;
      try {
        heroImageUrl = await llmGateway.generateRecipeImage({
          client: serviceClient,
          userId: auth.userId,
          requestId,
          recipe: tweakedPayload,
          context: { preferences: preferenceContext }
        });
      } catch (imageError) {
        console.error("recipe_image_generation_failed", imageError);
      }

      const saved = await persistRecipe({
        client,
        userId: auth.userId,
        recipeId,
        payload: tweakedPayload,
        heroImageUrl,
        parentVersionId: current.version.version_id,
        diffSummary: body.message
      });

      await applyAutoCategories({
        client,
        recipeId,
        categories,
        source: "llm_tweak"
      });

      await recordGraphData({
        client,
        recipeVersionId: saved.versionId,
        recipe: tweakedPayload
      });

      const recipe = await fetchRecipeView(client, recipeId);
      return jsonResponse(200, { recipe, version: recipe.version });
    }

    // /v1/recipes/{id}/save
    if (segments.length === 3 && segments[0] === "recipes" && segments[2] === "save") {
      const recipeId = segments[1];
      if (method === "POST") {
        const { error } = await client
          .from("recipe_saves")
          .upsert({ user_id: auth.userId, recipe_id: recipeId }, { onConflict: "user_id,recipe_id" });

        if (error) {
          throw new ApiError(500, "recipe_save_failed", "Could not save recipe", error.message);
        }

        return jsonResponse(200, { saved: true });
      }

      if (method === "DELETE") {
        const { error } = await client
          .from("recipe_saves")
          .delete()
          .eq("user_id", auth.userId)
          .eq("recipe_id", recipeId);

        if (error) {
          throw new ApiError(500, "recipe_unsave_failed", "Could not unsave recipe", error.message);
        }

        return jsonResponse(200, { saved: false });
      }
    }

    // /v1/recipes/{id}/categories/override
    if (segments.length === 4 && segments[0] === "recipes" && segments[2] === "categories" && segments[3] === "override") {
      const recipeId = segments[1];
      if (method === "POST") {
        const body = await requireJsonBody<{ category: string }>(request);
        const category = body.category?.trim();

        if (!category) {
          throw new ApiError(400, "invalid_category", "category is required");
        }

        const { error } = await client.from("recipe_user_categories").upsert({
          user_id: auth.userId,
          recipe_id: recipeId,
          category
        });

        if (error) {
          throw new ApiError(500, "category_override_failed", "Could not set category override", error.message);
        }

        return jsonResponse(200, { ok: true });
      }
    }

    // /v1/recipes/{id}/categories/override/{category}
    if (segments.length === 5 && segments[0] === "recipes" && segments[2] === "categories" && segments[3] === "override") {
      const recipeId = segments[1];
      const category = decodeURIComponent(segments[4]);

      if (method === "DELETE") {
        const { error } = await client
          .from("recipe_user_categories")
          .delete()
          .eq("user_id", auth.userId)
          .eq("recipe_id", recipeId)
          .eq("category", category);

        if (error) {
          throw new ApiError(500, "category_override_remove_failed", "Could not remove category override", error.message);
        }

        return jsonResponse(200, { ok: true });
      }
    }

    // /v1/recipes/{id}/graph
    if (segments.length === 3 && segments[0] === "recipes" && segments[2] === "graph" && method === "GET") {
      const recipeId = segments[1];

      const { data: recipe, error: recipeError } = await client
        .from("recipes")
        .select("current_version_id")
        .eq("id", recipeId)
        .maybeSingle();

      if (recipeError || !recipe?.current_version_id) {
        throw new ApiError(404, "recipe_or_version_not_found", "Recipe graph source was not found", recipeError?.message);
      }

      const { data: links, error: linksError } = await client
        .from("recipe_graph_links")
        .select("entity_id")
        .eq("recipe_version_id", recipe.current_version_id);

      if (linksError) {
        throw new ApiError(500, "graph_links_fetch_failed", "Could not fetch graph links", linksError.message);
      }

      const entityIds = (links ?? []).map((item) => item.entity_id);
      if (entityIds.length === 0) {
        return jsonResponse(200, { entities: [], edges: [] });
      }

      const { data: entities, error: entitiesError } = await client
        .from("graph_entities")
        .select("id,entity_type,label,metadata")
        .in("id", entityIds);

      if (entitiesError) {
        throw new ApiError(500, "graph_entities_fetch_failed", "Could not fetch graph entities", entitiesError.message);
      }

      const [{ data: edgesFrom, error: edgesFromError }, { data: edgesTo, error: edgesToError }] = await Promise.all([
        client
          .from("graph_edges")
          .select("id,from_entity_id,to_entity_id,confidence,source,relation_type_id")
          .in("from_entity_id", entityIds),
        client
          .from("graph_edges")
          .select("id,from_entity_id,to_entity_id,confidence,source,relation_type_id")
          .in("to_entity_id", entityIds)
      ]);

      if (edgesFromError || edgesToError) {
        throw new ApiError(
          500,
          "graph_edges_fetch_failed",
          "Could not fetch graph edges",
          edgesFromError?.message ?? edgesToError?.message
        );
      }

      type EdgeRow = NonNullable<typeof edgesFrom>[number];
      const edgeById = new Map<string, EdgeRow>();
      for (const edge of edgesFrom ?? []) {
        edgeById.set(edge.id, edge);
      }
      for (const edge of edgesTo ?? []) {
        edgeById.set(edge.id, edge);
      }
      const edges = Array.from(edgeById.values());

      const relationTypeIds = Array.from(new Set((edges ?? []).map((edge) => edge.relation_type_id)));
      let relationById = new Map<string, string>();
      if (relationTypeIds.length > 0) {
        const { data: relationTypes, error: relationTypesError } = await client
          .from("graph_relation_types")
          .select("id,name")
          .in("id", relationTypeIds);

        if (relationTypesError) {
          throw new ApiError(500, "graph_relation_types_fetch_failed", "Could not fetch graph relation types", relationTypesError.message);
        }

        relationById = new Map((relationTypes ?? []).map((relationType) => [relationType.id, relationType.name]));
      }

      const responseEdges = (edges ?? []).map((edge) => ({
        id: edge.id,
        from_entity_id: edge.from_entity_id,
        to_entity_id: edge.to_entity_id,
        relation_type: relationById.get(edge.relation_type_id) ?? "unknown",
        confidence: edge.confidence,
        source: edge.source
      }));

      return jsonResponse(200, { entities: entities ?? [], edges: responseEdges });
    }

    // /v1/recipe-drafts
    if (segments.length === 1 && segments[0] === "recipe-drafts" && method === "POST") {
      const body = await requireJsonBody<{ message: string }>(request);
      const message = body.message?.trim();
      if (!message) {
        throw new ApiError(400, "invalid_message", "message is required");
      }

      const preferenceContext = await getPreferences(client, auth.userId);
      const { data: draft, error: draftError } = await client
        .from("recipe_drafts")
        .insert({ owner_user_id: auth.userId, context: { preferences: preferenceContext } })
        .select("id,created_at,updated_at")
        .single();

      if (draftError || !draft) {
        throw new ApiError(500, "draft_create_failed", "Could not create recipe draft", draftError?.message);
      }

      const { error: userMessageError } = await client.from("recipe_draft_messages").insert({
        draft_id: draft.id,
        role: "user",
        content: message
      });

      if (userMessageError) {
        throw new ApiError(500, "draft_message_create_failed", "Could not store draft message", userMessageError.message);
      }

      const assistantRecipe = await llmGateway.generateRecipe({
        client: serviceClient,
        userId: auth.userId,
        requestId,
        prompt: message,
        context: { preferences: preferenceContext }
      });

      const assistantMessage = JSON.stringify({
        title: assistantRecipe.title,
        servings: assistantRecipe.servings,
        notes: assistantRecipe.notes,
        pairings: assistantRecipe.pairings,
        ingredients: assistantRecipe.ingredients,
        steps: assistantRecipe.steps
      });

      const { error: assistantMessageError } = await client.from("recipe_draft_messages").insert({
        draft_id: draft.id,
        role: "assistant",
        content: assistantMessage,
        metadata: { format: "recipe_payload" }
      });

      if (assistantMessageError) {
        throw new ApiError(500, "draft_assistant_message_failed", "Could not store assistant draft message", assistantMessageError.message);
      }

      const { data: messages, error: messagesError } = await client
        .from("recipe_draft_messages")
        .select("id,role,content,created_at")
        .eq("draft_id", draft.id)
        .order("created_at", { ascending: true });

      if (messagesError) {
        throw new ApiError(500, "draft_messages_fetch_failed", "Could not fetch draft messages", messagesError.message);
      }

      return jsonResponse(200, {
        id: draft.id,
        messages: messages ?? [],
        created_at: draft.created_at,
        updated_at: draft.updated_at
      });
    }

    // /v1/recipe-drafts/{id}
    if (segments.length === 2 && segments[0] === "recipe-drafts" && method === "GET") {
      const draftId = segments[1];

      const { data: draft, error: draftError } = await client
        .from("recipe_drafts")
        .select("id,created_at,updated_at")
        .eq("id", draftId)
        .maybeSingle();

      if (draftError || !draft) {
        throw new ApiError(404, "draft_not_found", "Recipe draft not found", draftError?.message);
      }

      const { data: messages, error: messagesError } = await client
        .from("recipe_draft_messages")
        .select("id,role,content,created_at")
        .eq("draft_id", draftId)
        .order("created_at", { ascending: true });

      if (messagesError) {
        throw new ApiError(500, "draft_messages_fetch_failed", "Could not fetch draft messages", messagesError.message);
      }

      return jsonResponse(200, {
        id: draft.id,
        messages: messages ?? [],
        created_at: draft.created_at,
        updated_at: draft.updated_at
      });
    }

    // /v1/recipe-drafts/{id}/messages
    if (segments.length === 3 && segments[0] === "recipe-drafts" && segments[2] === "messages" && method === "POST") {
      const draftId = segments[1];
      const body = await requireJsonBody<{ message: string }>(request);
      const message = body.message?.trim();

      if (!message) {
        throw new ApiError(400, "invalid_message", "message is required");
      }

      const { data: draft, error: draftError } = await client
        .from("recipe_drafts")
        .select("id,context")
        .eq("id", draftId)
        .maybeSingle();

      if (draftError || !draft) {
        throw new ApiError(404, "draft_not_found", "Recipe draft not found", draftError?.message);
      }

      const { error: userMessageError } = await client.from("recipe_draft_messages").insert({
        draft_id: draftId,
        role: "user",
        content: message
      });

      if (userMessageError) {
        throw new ApiError(500, "draft_message_create_failed", "Could not store draft message", userMessageError.message);
      }

      const { data: threadMessages, error: threadError } = await client
        .from("recipe_draft_messages")
        .select("role,content,created_at")
        .eq("draft_id", draftId)
        .order("created_at", { ascending: true });

      if (threadError) {
        throw new ApiError(500, "draft_thread_fetch_failed", "Could not fetch draft thread", threadError.message);
      }

      const assistantRecipe = await llmGateway.tweakRecipe({
        client: serviceClient,
        userId: auth.userId,
        requestId,
        prompt: message,
        context: {
          draft_context: draft.context as Record<string, JsonValue>,
          thread: threadMessages ?? []
        }
      });

      const { error: assistantMessageError } = await client.from("recipe_draft_messages").insert({
        draft_id: draftId,
        role: "assistant",
        content: JSON.stringify(assistantRecipe),
        metadata: { format: "recipe_payload" }
      });

      if (assistantMessageError) {
        throw new ApiError(500, "draft_assistant_message_failed", "Could not store assistant draft message", assistantMessageError.message);
      }

      const { data: messages, error: messagesError } = await client
        .from("recipe_draft_messages")
        .select("id,role,content,created_at")
        .eq("draft_id", draftId)
        .order("created_at", { ascending: true });

      if (messagesError) {
        throw new ApiError(500, "draft_messages_fetch_failed", "Could not fetch draft messages", messagesError.message);
      }

      return jsonResponse(200, {
        id: draftId,
        messages: messages ?? []
      });
    }

    // /v1/recipe-drafts/{id}/finalize
    if (segments.length === 3 && segments[0] === "recipe-drafts" && segments[2] === "finalize" && method === "POST") {
      const draftId = segments[1];

      const { data: draft, error: draftError } = await client
        .from("recipe_drafts")
        .select("id,context,status")
        .eq("id", draftId)
        .maybeSingle();

      if (draftError || !draft) {
        throw new ApiError(404, "draft_not_found", "Recipe draft not found", draftError?.message);
      }

      if (draft.status !== "open") {
        throw new ApiError(409, "draft_not_open", "Only open drafts can be finalized");
      }

      const { data: messages, error: messagesError } = await client
        .from("recipe_draft_messages")
        .select("role,content,created_at")
        .eq("draft_id", draftId)
        .order("created_at", { ascending: true });

      if (messagesError || !messages || messages.length === 0) {
        throw new ApiError(400, "draft_empty", "Draft does not contain any messages", messagesError?.message);
      }

      const consolidatedPrompt = messages
        .map((message) => `[${message.role}] ${message.content}`)
        .join("\n");

      const recipePayload = await llmGateway.generateRecipe({
        client: serviceClient,
        userId: auth.userId,
        requestId,
        prompt: consolidatedPrompt,
        context: {
          draft_context: draft.context as Record<string, JsonValue>,
          thread: messages
        }
      });

      const categories = await llmGateway.inferCategories({
        client: serviceClient,
        userId: auth.userId,
        requestId,
        recipe: recipePayload,
        context: {
          draft_context: draft.context as Record<string, JsonValue>
        }
      });

      let heroImageUrl: string | undefined;
      try {
        heroImageUrl = await llmGateway.generateRecipeImage({
          client: serviceClient,
          userId: auth.userId,
          requestId,
          recipe: recipePayload,
          context: {
            draft_context: draft.context as Record<string, JsonValue>
          }
        });
      } catch (imageError) {
        console.error("recipe_image_generation_failed", imageError);
      }

      const saved = await persistRecipe({
        client,
        userId: auth.userId,
        payload: recipePayload,
        heroImageUrl,
        sourceDraftId: draftId,
        diffSummary: "Finalized from draft chat"
      });

      await applyAutoCategories({
        client,
        recipeId: saved.recipeId,
        categories,
        source: "llm_finalize"
      });

      await recordGraphData({
        client,
        recipeVersionId: saved.versionId,
        recipe: recipePayload
      });

      const { error: draftFinalizeError } = await client
        .from("recipe_drafts")
        .update({ status: "finalized", updated_at: new Date().toISOString() })
        .eq("id", draftId);

      if (draftFinalizeError) {
        throw new ApiError(500, "draft_finalize_update_failed", "Could not finalize draft status", draftFinalizeError.message);
      }

      const recipe = await fetchRecipeView(client, saved.recipeId);
      return jsonResponse(200, { recipe, version: recipe.version });
    }

    throw new ApiError(404, "route_not_found", "Requested route does not exist");
  } catch (error) {
    return errorResponse(requestId, error);
  }
});
