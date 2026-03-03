import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { requireAuth } from "../_shared/auth.ts";
import { ApiError, errorResponse, jsonResponse, requireJsonBody } from "../_shared/errors.ts";
import { createServiceClient, createUserClient } from "../_shared/db.ts";
import { llmGateway, type ModelOverrideMap } from "../_shared/llm-gateway.ts";
import type { AssistantReply, JsonValue, MemoryRecord, OnboardingState, RecipePayload } from "../_shared/types.ts";

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
  presentation_preferences: Record<string, JsonValue>;
};

type ContextPack = {
  preferences: PreferenceContext;
  memorySnapshot: Record<string, JsonValue>;
  selectedMemories: MemoryRecord[];
  selectedMemoryIds: string[];
};

type ChatMessageView = {
  id: string;
  role: string;
  content: string;
  metadata?: Record<string, JsonValue>;
  created_at: string;
};

type RecipeAttachmentView = {
  attachment_id: string;
  relation_type: string;
  position: number;
  recipe: RecipeView;
};

type RecipeView = {
  id: string;
  title: string;
  description?: string;
  summary: string;
  servings: number;
  ingredients: RecipePayload["ingredients"];
  steps: RecipePayload["steps"];
  notes?: string;
  pairings: string[];
  metadata?: JsonValue;
  emoji: string[];
  image_url: string | null;
  image_status: string;
  visibility: string;
  updated_at: string;
  version: {
    version_id: string;
    recipe_id: string;
    parent_version_id: string | null;
    diff_summary: string | null;
    created_at: string;
  };
  attachments: RecipeAttachmentView[];
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
  max_difficulty: 3,
  presentation_preferences: {}
};

const onboardingTopicKeys = ["skill", "equipment", "dietary", "presentation"] as const;

const extractOnboardingStateFromPreferences = (preferences: PreferenceContext): OnboardingState | null => {
  const candidate = preferences.presentation_preferences?.["onboarding_state"];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const data = candidate as Record<string, unknown>;
  const completed = Boolean(data.completed);
  const rawProgress = Number(data.progress);
  const progress = Number.isFinite(rawProgress) ? Math.max(0, Math.min(1, rawProgress)) : completed ? 1 : 0;
  const missingTopics = Array.isArray(data.missing_topics)
    ? data.missing_topics
        .filter((topic): topic is string => typeof topic === "string")
        .map((topic) => topic.trim())
        .filter((topic) => topic.length > 0)
    : [];
  const state =
    data.state && typeof data.state === "object" && !Array.isArray(data.state)
      ? (data.state as Record<string, JsonValue>)
      : {};

  return {
    completed,
    progress,
    missing_topics: missingTopics,
    state
  };
};

const deriveOnboardingStateFromPreferences = (preferences: PreferenceContext): OnboardingState => {
  const missingTopics: string[] = [];

  const hasSkill = preferences.skill_level.trim().length > 0;
  const hasEquipment = preferences.equipment.length > 0;
  const hasDietary = preferences.dietary_preferences.length > 0 || preferences.dietary_restrictions.length > 0;
  const presentationPreferenceCount = Object.keys(preferences.presentation_preferences ?? {}).filter(
    (key) => key !== "onboarding_state"
  ).length;
  const hasPresentation = presentationPreferenceCount > 0;

  if (!hasSkill) {
    missingTopics.push("skill");
  }
  if (!hasEquipment) {
    missingTopics.push("equipment");
  }
  if (!hasDietary) {
    missingTopics.push("dietary");
  }
  if (!hasPresentation) {
    missingTopics.push("presentation");
  }

  const progress = Math.max(0, Math.min(1, (onboardingTopicKeys.length - missingTopics.length) / onboardingTopicKeys.length));

  return {
    completed: missingTopics.length === 0,
    progress,
    missing_topics: missingTopics,
    state: {}
  };
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

const parseUuid = (value: string): string => {
  if (!value || !/^[0-9a-fA-F-]{36}$/.test(value)) {
    throw new ApiError(400, "invalid_uuid", "Expected UUID value");
  }

  return value;
};

const isSchemaMissingError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const message = (error as { message?: string }).message?.toLowerCase() ?? "";
  const code = (error as { code?: string }).code?.toLowerCase() ?? "";

  return (
    message.includes("could not find the table") ||
    message.includes("not found in the schema cache") ||
    message.includes("schema cache") ||
    message.includes("does not exist") ||
    message.includes("undefined column") ||
    code === "42p01" ||
    code === "42703"
  );
};

const isRlsError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const message = (error as { message?: string }).message?.toLowerCase() ?? "";
  const code = (error as { code?: string }).code?.toLowerCase() ?? "";
  return code === "42501" || message.includes("row-level security");
};

const ensureUserProfile = async (
  client: SupabaseClient,
  params: {
    userId: string;
    email?: string | null;
    fullName?: string | null;
    avatarUrl?: string | null;
  }
): Promise<void> => {
  const { error } = await client.from("users").upsert({
    id: params.userId,
    email: params.email ?? null,
    full_name: params.fullName ?? null,
    avatar_url: params.avatarUrl ?? null,
    updated_at: new Date().toISOString()
  });
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
    max_difficulty: data.max_difficulty,
    presentation_preferences:
      data.presentation_preferences && typeof data.presentation_preferences === "object" && !Array.isArray(data.presentation_preferences)
        ? (data.presentation_preferences as Record<string, JsonValue>)
        : {}
  };
};

const normalizePreferenceStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

const normalizePreferencePatch = (candidate: unknown): Partial<PreferenceContext> | null => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const patchObject = candidate as Record<string, unknown>;
  const patch: Partial<PreferenceContext> = {};

  if (typeof patchObject.free_form === "string") {
    patch.free_form = patchObject.free_form.trim();
  } else if (patchObject.free_form === null) {
    patch.free_form = null;
  }

  const dietaryPreferences = normalizePreferenceStringArray(patchObject.dietary_preferences);
  if (dietaryPreferences) {
    patch.dietary_preferences = dietaryPreferences;
  }

  const dietaryRestrictions = normalizePreferenceStringArray(patchObject.dietary_restrictions);
  if (dietaryRestrictions) {
    patch.dietary_restrictions = dietaryRestrictions;
  }

  if (typeof patchObject.skill_level === "string" && patchObject.skill_level.trim().length > 0) {
    patch.skill_level = patchObject.skill_level.trim();
  }

  const equipment = normalizePreferenceStringArray(patchObject.equipment);
  if (equipment) {
    patch.equipment = equipment;
  }

  const cuisines = normalizePreferenceStringArray(patchObject.cuisines);
  if (cuisines) {
    patch.cuisines = cuisines;
  }

  const aversions = normalizePreferenceStringArray(patchObject.aversions);
  if (aversions) {
    patch.aversions = aversions;
  }

  if (typeof patchObject.cooking_for === "string") {
    patch.cooking_for = patchObject.cooking_for.trim();
  } else if (patchObject.cooking_for === null) {
    patch.cooking_for = null;
  }

  const maxDifficulty = Number(patchObject.max_difficulty);
  if (Number.isInteger(maxDifficulty)) {
    patch.max_difficulty = Math.max(1, Math.min(5, maxDifficulty));
  }

  if (
    patchObject.presentation_preferences &&
    typeof patchObject.presentation_preferences === "object" &&
    !Array.isArray(patchObject.presentation_preferences)
  ) {
    patch.presentation_preferences = patchObject.presentation_preferences as Record<string, JsonValue>;
  }

  return Object.keys(patch).length > 0 ? patch : null;
};

const applyModelPreferenceUpdates = async (params: {
  client: SupabaseClient;
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  currentPreferences: PreferenceContext;
  preferenceUpdates: unknown;
}): Promise<PreferenceContext> => {
  const patch = normalizePreferencePatch(params.preferenceUpdates);
  if (!patch) {
    return params.currentPreferences;
  }

  const nextPreferences: PreferenceContext = {
    ...params.currentPreferences,
    ...patch
  };

  const { data, error } = await params.client
    .from("preferences")
    .upsert({
      user_id: params.userId,
      ...nextPreferences,
      updated_at: new Date().toISOString()
    })
    .select("*")
    .single();

  if (error) {
    console.error("preferences_auto_update_failed", error);
    return params.currentPreferences;
  }

  const persistedPreferences: PreferenceContext = {
    free_form: data.free_form,
    dietary_preferences: data.dietary_preferences ?? [],
    dietary_restrictions: data.dietary_restrictions ?? [],
    skill_level: data.skill_level,
    equipment: data.equipment ?? [],
    cuisines: data.cuisines ?? [],
    aversions: data.aversions ?? [],
    cooking_for: data.cooking_for,
    max_difficulty: data.max_difficulty,
    presentation_preferences:
      data.presentation_preferences && typeof data.presentation_preferences === "object" && !Array.isArray(data.presentation_preferences)
        ? (data.presentation_preferences as Record<string, JsonValue>)
        : {}
  };

  await logChangelog({
    serviceClient: params.serviceClient,
    actorUserId: params.userId,
    scope: "preferences",
    entityType: "preferences",
    entityId: params.userId,
    action: "assistant_updated",
    requestId: params.requestId,
    afterJson: persistedPreferences
  });

  return persistedPreferences;
};

const getMemorySnapshot = async (
  client: SupabaseClient,
  userId: string
): Promise<Record<string, JsonValue>> => {
  const { data, error } = await client
    .from("memory_snapshots")
    .select("summary")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (isSchemaMissingError(error)) {
      return {};
    }
    throw new ApiError(500, "memory_snapshot_fetch_failed", "Could not load memory snapshot", error.message);
  }

  if (!data || !data.summary || typeof data.summary !== "object" || Array.isArray(data.summary)) {
    return {};
  }

  return data.summary as Record<string, JsonValue>;
};

const getActiveMemories = async (
  client: SupabaseClient,
  userId: string,
  limit: number
): Promise<MemoryRecord[]> => {
  const preferred = await client
    .from("memories")
    .select("id,memory_type,memory_kind,memory_content,confidence,salience,status,source,created_at,updated_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("salience", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (preferred.error) {
    if (!isSchemaMissingError(preferred.error)) {
      throw new ApiError(500, "memory_fetch_failed", "Could not load user memories", preferred.error.message);
    }

    const legacy = await client
      .from("memories")
      .select("id,memory_type,memory_content,confidence,source,created_at,updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (legacy.error) {
      if (isSchemaMissingError(legacy.error)) {
        return [];
      }
      throw new ApiError(500, "memory_fetch_failed", "Could not load user memories", legacy.error.message);
    }

    return (legacy.data ?? []).map((row) => ({
      id: row.id,
      memory_type: row.memory_type,
      memory_kind: "legacy",
      memory_content: row.memory_content as JsonValue,
      confidence: Number(row.confidence ?? 0.5),
      salience: Number(row.confidence ?? 0.5),
      status: "active",
      source: row.source ?? "legacy",
      created_at: row.created_at,
      updated_at: row.updated_at
    })) as MemoryRecord[];
  }

  return (preferred.data ?? []) as MemoryRecord[];
};

const logChangelog = async (params: {
  serviceClient: SupabaseClient;
  actorUserId: string;
  scope: string;
  entityType: string;
  entityId?: string;
  action: string;
  requestId: string;
  beforeJson?: JsonValue;
  afterJson?: JsonValue;
  metadata?: Record<string, JsonValue>;
}): Promise<void> => {
  const { error } = await params.serviceClient.rpc("log_changelog_event", {
    p_actor_user_id: params.actorUserId,
    p_scope: params.scope,
    p_entity_type: params.entityType,
    p_entity_id: params.entityId ?? null,
    p_action: params.action,
    p_request_id: params.requestId,
    p_before_json: params.beforeJson ?? null,
    p_after_json: params.afterJson ?? null,
    p_metadata: params.metadata ?? {}
  });

  if (error) {
    console.error("changelog_log_failed", error);
  }
};

const enqueueImageJob = async (
  client: SupabaseClient,
  recipeId: string,
  errorMessage?: string
): Promise<void> => {
  const { error } = await client.from("recipe_image_jobs").upsert(
    {
      recipe_id: recipeId,
      status: "pending",
      next_attempt_at: new Date().toISOString(),
      last_error: errorMessage ?? null,
      updated_at: new Date().toISOString()
    },
    { onConflict: "recipe_id" }
  );

  if (error) {
    console.error("recipe_image_job_enqueue_failed", error);
  }
};

const resolveRelationTypeId = async (client: SupabaseClient, name: string): Promise<string> => {
  const normalizedName = name.trim().toLowerCase();

  const { data: existing, error: existingError } = await client
    .from("graph_relation_types")
    .select("id")
    .eq("name", normalizedName)
    .maybeSingle();

  if (existingError) {
    throw new ApiError(500, "relation_type_lookup_failed", "Could not lookup relation type", existingError.message);
  }

  if (existing?.id) {
    return existing.id;
  }

  const { data: inserted, error: insertError } = await client
    .from("graph_relation_types")
    .insert({ name: normalizedName, description: `Attached recipe relation: ${normalizedName}` })
    .select("id")
    .single();

  if (insertError || !inserted) {
    throw new ApiError(500, "relation_type_create_failed", "Could not create relation type", insertError?.message);
  }

  return inserted.id;
};

const fetchRecipeView = async (
  client: SupabaseClient,
  recipeId: string,
  includeAttachments = true
): Promise<RecipeView> => {
  const preferredRecipeQuery = await client
    .from("recipes")
    .select("id,title,hero_image_url,image_status,visibility,updated_at,current_version_id")
    .eq("id", recipeId)
    .maybeSingle();

  let recipe: {
    id: string;
    title: string;
    hero_image_url: string | null;
    image_status: string;
    visibility: string;
    updated_at: string;
    current_version_id: string | null;
  } | null = null;

  if (preferredRecipeQuery.error) {
    if (!isSchemaMissingError(preferredRecipeQuery.error)) {
      throw new ApiError(500, "recipe_fetch_failed", "Could not fetch recipe", preferredRecipeQuery.error.message);
    }

    const legacyRecipeQuery = await client
      .from("recipes")
      .select("id,title,hero_image_url,visibility,updated_at,current_version_id")
      .eq("id", recipeId)
      .maybeSingle();

    if (legacyRecipeQuery.error) {
      throw new ApiError(500, "recipe_fetch_failed", "Could not fetch recipe", legacyRecipeQuery.error.message);
    }

    if (legacyRecipeQuery.data) {
      recipe = {
        ...legacyRecipeQuery.data,
        image_status: legacyRecipeQuery.data.hero_image_url ? "ready" : "pending"
      };
    }
  } else {
    recipe = preferredRecipeQuery.data ?? null;
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

  let attachments: RecipeAttachmentView[] = [];
  if (includeAttachments) {
    const linksResult = await client
      .from("recipe_links")
      .select("id,child_recipe_id,relation_type_id,position")
      .eq("parent_recipe_id", recipe.id)
      .order("position", { ascending: true });

    const links = linksResult.data ?? [];
    if (linksResult.error) {
      if (isSchemaMissingError(linksResult.error)) {
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
          metadata: payload.metadata,
          emoji: payload.emoji ?? [],
          image_url: recipe.hero_image_url,
          image_status: recipe.image_status,
          visibility: recipe.visibility,
          updated_at: recipe.updated_at,
          version: {
            version_id: version.id,
            recipe_id: recipe.id,
            parent_version_id: version.parent_version_id,
            diff_summary: version.diff_summary,
            created_at: version.created_at
          },
          attachments: []
        };
      }
      throw new ApiError(
        500,
        "recipe_links_fetch_failed",
        "Could not fetch recipe attachments",
        linksResult.error.message
      );
    }

    const relationTypeIds = Array.from(new Set(links.map((link) => link.relation_type_id)));
    let relationById = new Map<string, string>();

    if (relationTypeIds.length > 0) {
      const { data: relationTypes, error: relationError } = await client
        .from("graph_relation_types")
        .select("id,name")
        .in("id", relationTypeIds);

      if (relationError) {
        throw new ApiError(500, "relation_types_fetch_failed", "Could not fetch relation type names", relationError.message);
      }

      relationById = new Map((relationTypes ?? []).map((item) => [item.id, item.name]));
    }

    const attachmentItems: RecipeAttachmentView[] = [];
    for (const link of links) {
      const childRecipe = await fetchRecipeView(client, link.child_recipe_id, false);
      attachmentItems.push({
        attachment_id: link.id,
        relation_type: relationById.get(link.relation_type_id) ?? "attached_to",
        position: link.position,
        recipe: childRecipe
      });
    }

    attachments = attachmentItems;
  }

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
    metadata: payload.metadata,
    emoji: payload.emoji ?? [],
    image_url: recipe.hero_image_url,
    image_status: recipe.image_status,
    visibility: recipe.visibility,
    updated_at: recipe.updated_at,
    version: {
      version_id: version.id,
      recipe_id: recipe.id,
      parent_version_id: version.parent_version_id,
      diff_summary: version.diff_summary,
      created_at: version.created_at
    },
    attachments
  };
};

const persistRecipe = async (params: {
  client: SupabaseClient;
  serviceClient: SupabaseClient;
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
}): Promise<{
  recipeId: string;
  versionId: string;
}> => {
  const now = new Date().toISOString();

  let recipeId = params.recipeId;
  if (!recipeId) {
    const preferredInsert = await params.client
      .from("recipes")
      .insert({
        owner_user_id: params.userId,
        title: params.payload.title,
        hero_image_url: params.heroImageUrl,
        image_status: params.heroImageUrl ? "ready" : "pending",
        image_updated_at: now,
        image_last_error: params.imageError ?? null,
        image_generation_attempts: params.heroImageUrl ? 1 : 0,
        visibility: "public",
        source_chat_id: params.sourceChatId,
        updated_at: now
      })
      .select("id")
      .single();

    let recipe = preferredInsert.data;
    if (preferredInsert.error || !recipe) {
      if (!isSchemaMissingError(preferredInsert.error)) {
        throw new ApiError(500, "recipe_insert_failed", "Could not create recipe", preferredInsert.error?.message);
      }

      const legacyInsert = await params.client
        .from("recipes")
        .insert({
          owner_user_id: params.userId,
          title: params.payload.title,
          hero_image_url: params.heroImageUrl,
          visibility: "public",
          source_chat_id: params.sourceChatId,
          updated_at: now
        })
        .select("id")
        .single();

      if (legacyInsert.error || !legacyInsert.data) {
        throw new ApiError(500, "recipe_insert_failed", "Could not create recipe", legacyInsert.error?.message);
      }

      recipe = legacyInsert.data;
    }

    recipeId = recipe.id;
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
    .select("id")
    .single();

  if (versionError || !version) {
    throw new ApiError(500, "recipe_version_insert_failed", "Could not create recipe version", versionError?.message);
  }

  const updatePayload: Record<string, JsonValue> = {
    title: params.payload.title,
    current_version_id: version.id,
    updated_at: now,
    image_updated_at: now,
    image_generation_attempts: params.heroImageUrl ? 1 : 0
  };

  if (typeof params.heroImageUrl === "string" && params.heroImageUrl.length > 0) {
    updatePayload.hero_image_url = params.heroImageUrl;
    updatePayload.image_status = "ready";
    updatePayload.image_last_error = null;
  } else {
    updatePayload.image_status = "pending";
    updatePayload.image_last_error = params.imageError ?? null;
  }

  const { error: updateError } = await params.client.from("recipes").update(updatePayload).eq("id", recipeId);
  if (updateError) {
    if (!isSchemaMissingError(updateError)) {
      throw new ApiError(500, "recipe_update_failed", "Could not update recipe", updateError.message);
    }

    const legacyPayload: Record<string, JsonValue> = {
      title: params.payload.title,
      current_version_id: version.id,
      updated_at: now
    };
    if (typeof params.heroImageUrl === "string" && params.heroImageUrl.length > 0) {
      legacyPayload.hero_image_url = params.heroImageUrl;
    }

    const { error: legacyUpdateError } = await params.client
      .from("recipes")
      .update(legacyPayload)
      .eq("id", recipeId);

    if (legacyUpdateError) {
      throw new ApiError(500, "recipe_update_failed", "Could not update recipe", legacyUpdateError.message);
    }
  }

  // Image jobs are only enqueued when a recipe is explicitly saved to cookbook.
  // Do NOT enqueue here — avoids triggering slow image generation on every chatSession/tweak.

  const { error: versionEventError } = await params.client.from("recipe_version_events").insert({
    recipe_version_id: version.id,
    event_type: params.parentVersionId ? "recipe_tweak" : "recipe_create",
    request_id: params.requestId,
    metadata: {
      source_chat_id: params.sourceChatId ?? null,
      diff_summary: params.diffSummary ?? null,
      selected_memory_ids: params.selectedMemoryIds ?? []
    }
  });

  if (versionEventError) {
    console.error("recipe_version_event_failed", versionEventError);
  }

  if ((params.selectedMemoryIds ?? []).length > 0) {
    const records = (params.selectedMemoryIds ?? []).map((memoryId) => ({
      memory_id: memoryId,
      recipe_id: recipeId,
      recipe_version_id: version.id,
      source_event_id: null
    }));

    const { error: memoryLinkError } = await params.client
      .from("memory_recipe_links")
      .upsert(records, { onConflict: "memory_id,recipe_version_id" });

    if (memoryLinkError) {
      console.error("memory_recipe_link_failed", memoryLinkError);
    }
  }

  await logChangelog({
    serviceClient: params.serviceClient,
    actorUserId: params.userId,
    scope: "recipe",
    entityType: "recipe",
    entityId: recipeId,
    action: params.parentVersionId ? "version_created" : "created",
    requestId: params.requestId,
    afterJson: {
      recipe_id: recipeId,
      version_id: version.id,
      diff_summary: params.diffSummary ?? null
    }
  });

  return {
    recipeId,
    versionId: version.id
  };
};

const applyAutoCategories = async (params: {
  client: SupabaseClient;
  recipeId: string;
  categories: Array<{ category: string; confidence: number }>;
}): Promise<void> => {
  const records = params.categories.map((item) => ({
    recipe_id: params.recipeId,
    category: item.category,
    confidence: item.confidence,
    source: "llm"
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
  const rawLabels: unknown[] = [
    params.recipe.title,
    ...(params.recipe.pairings ?? []),
    ...params.recipe.ingredients.map((i) => i.name)
  ];
  const uniqueLabels = Array.from(
    new Set(
      rawLabels
        .filter((label): label is string => typeof label === "string")
        .map((label) => label.trim())
        .filter((label) => label.length > 0)
    )
  );

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
    if (isRlsError(entityError) || isSchemaMissingError(entityError)) {
      return;
    }
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
    if (isRlsError(linkError) || isSchemaMissingError(linkError)) {
      return;
    }
    throw new ApiError(500, "graph_link_failed", "Could not link recipe version to graph entities", linkError.message);
  }
};

const buildContextPack = async (params: {
  userClient: SupabaseClient;
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  prompt: string;
  context: Record<string, JsonValue>;
  selectionMode?: "llm" | "fast";
}): Promise<ContextPack> => {
  const preferences = await getPreferences(params.userClient, params.userId);
  const memorySnapshot = await getMemorySnapshot(params.userClient, params.userId);
  const memories = await getActiveMemories(params.userClient, params.userId, 120);

  if (memories.length === 0) {
    return {
      preferences,
      memorySnapshot,
      selectedMemories: [],
      selectedMemoryIds: []
    };
  }

  if (params.selectionMode === "fast") {
    const selectedMemories = memories.slice(0, 12);
    return {
      preferences,
      memorySnapshot,
      selectedMemories,
      selectedMemoryIds: selectedMemories.map((memory) => memory.id)
    };
  }

  let selectedIds: string[] = [];
  try {
    const selection = await llmGateway.selectMemories({
      client: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      prompt: params.prompt,
      context: {
        preferences,
        memory_snapshot: memorySnapshot,
        ...params.context
      },
      memories
    });
    selectedIds = selection.selected_memory_ids;
  } catch (error) {
    console.error("memory_select_failed", error);
    selectedIds = memories.map((memory) => memory.id).slice(0, 12);
  }

  const selectedSet = new Set(selectedIds);
  const selectedMemories = memories.filter((memory) => selectedSet.has(memory.id));

  return {
    preferences,
    memorySnapshot,
    selectedMemories,
    selectedMemoryIds: selectedMemories.map((memory) => memory.id)
  };
};

const updateMemoryFromInteraction = async (params: {
  userClient: SupabaseClient;
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  interactionContext: Record<string, JsonValue>;
  mode?: "full" | "light";
}): Promise<void> => {
  if (params.mode === "light") {
    await logChangelog({
      serviceClient: params.serviceClient,
      actorUserId: params.userId,
      scope: "memory",
      entityType: "memory_snapshot",
      entityId: params.userId,
      action: "interaction_observed",
      requestId: params.requestId,
      afterJson: {
        mode: "light",
        reason: "deferred_memory_processing"
      }
    });
    return;
  }

  const existingMemories = await getActiveMemories(params.userClient, params.userId, 200);

  let candidates: Array<{
    memory_type: string;
    memory_kind?: string;
    memory_content: JsonValue;
    confidence?: number;
    salience?: number;
    source?: string;
  }> = [];

  try {
    candidates = await llmGateway.extractMemories({
      client: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      context: params.interactionContext
    });
  } catch (error) {
    console.error("memory_extract_failed", error);
  }

  if (candidates.length > 0) {
    const preferredInsert = await params.userClient.from("memories").insert(
      candidates.map((candidate) => ({
        user_id: params.userId,
        memory_type: candidate.memory_type,
        memory_kind: candidate.memory_kind ?? "preference",
        memory_content: candidate.memory_content,
        confidence: Number.isFinite(Number(candidate.confidence)) ? Number(candidate.confidence) : 0.5,
        salience: Number.isFinite(Number(candidate.salience)) ? Number(candidate.salience) : 0.5,
        source: candidate.source ?? "llm_extract",
        status: "active"
      }))
    );

    if (preferredInsert.error) {
      if (!isSchemaMissingError(preferredInsert.error)) {
        console.error("memory_insert_failed", preferredInsert.error);
      } else {
        const legacyInsert = await params.userClient.from("memories").insert(
          candidates.map((candidate) => ({
            user_id: params.userId,
            memory_type: candidate.memory_type,
            memory_content: candidate.memory_content,
            confidence: Number.isFinite(Number(candidate.confidence)) ? Number(candidate.confidence) : 0.5,
            source: candidate.source ?? "llm_extract"
          }))
        );

        if (legacyInsert.error) {
          console.error("memory_insert_failed", legacyInsert.error);
        }
      }
    }
  }

  try {
    const conflict = await llmGateway.resolveMemoryConflicts({
      client: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      existingMemories,
      candidates
    });

    for (const action of conflict.actions) {
      if (!action.memory_id) {
        continue;
      }

      if (action.action === "delete") {
        const deleteUpdate = await params.userClient
          .from("memories")
          .update({ status: "deleted", updated_at: new Date().toISOString() })
          .eq("id", action.memory_id);

        if (deleteUpdate.error && isSchemaMissingError(deleteUpdate.error)) {
          await params.userClient.from("memories").delete().eq("id", action.memory_id);
        }
      }

      if (action.action === "supersede") {
        const supersedeUpdate = await params.userClient
          .from("memories")
          .update({ status: "superseded", supersedes_memory_id: action.supersedes_memory_id ?? null, updated_at: new Date().toISOString() })
          .eq("id", action.memory_id);

        if (supersedeUpdate.error && isSchemaMissingError(supersedeUpdate.error)) {
          // Legacy schema does not support supersession fields.
          continue;
        }
      }

      if (action.action === "merge" && action.merged_content) {
        await params.userClient
          .from("memories")
          .update({ memory_content: action.merged_content, updated_at: new Date().toISOString() })
          .eq("id", action.memory_id);
      }
    }
  } catch (error) {
    console.error("memory_conflict_resolution_failed", error);
  }

  const activeMemories = await getActiveMemories(params.userClient, params.userId, 200);
  try {
    const summary = await llmGateway.summarizeMemories({
      client: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      memories: activeMemories,
      context: params.interactionContext
    });

    const { error: snapshotError } = await params.userClient.from("memory_snapshots").upsert({
      user_id: params.userId,
      summary: summary.summary,
      token_estimate: summary.token_estimate ?? 0,
      updated_at: new Date().toISOString()
    });

    if (snapshotError && !isSchemaMissingError(snapshotError)) {
      console.error("memory_snapshot_upsert_failed", snapshotError);
    }
  } catch (error) {
    console.error("memory_summary_failed", error);
  }

  await logChangelog({
    serviceClient: params.serviceClient,
    actorUserId: params.userId,
    scope: "memory",
    entityType: "memory_snapshot",
    entityId: params.userId,
    action: "updated",
    requestId: params.requestId,
    afterJson: {
      active_memory_count: activeMemories.length
    }
  });
};

const deriveAttachmentPayload = (recipe: Omit<RecipePayload, "attachments">): RecipePayload => {
  return {
    ...recipe,
    attachments: []
  };
};

const syncRecipeAttachments = async (params: {
  userClient: SupabaseClient;
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  parentRecipeId: string;
  payload: RecipePayload;
  contextPack: ContextPack;
}): Promise<void> => {
  const attachments = params.payload.attachments ?? [];

  const { error: clearError } = await params.userClient
    .from("recipe_links")
    .delete()
    .eq("parent_recipe_id", params.parentRecipeId);

  if (clearError) {
    if (isSchemaMissingError(clearError)) {
      return;
    }
    throw new ApiError(500, "recipe_links_clear_failed", "Could not clear existing attachments", clearError.message);
  }

  if (attachments.length === 0) {
    return;
  }

  for (let index = 0; index < attachments.length; index += 1) {
    const attachment = attachments[index];
    const relationType = attachment.relation_type?.trim();

    if (!relationType) {
      continue;
    }

    const childPayload = deriveAttachmentPayload(attachment.recipe);

    const childSaved = await persistRecipe({
      client: params.userClient,
      serviceClient: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      payload: childPayload,
      diffSummary: `Attached to ${params.parentRecipeId}`,
      selectedMemoryIds: params.contextPack.selectedMemoryIds
    });

    const relationTypeId = await resolveRelationTypeId(params.userClient, relationType);

    const { error: linkError } = await params.userClient.from("recipe_links").insert({
      parent_recipe_id: params.parentRecipeId,
      child_recipe_id: childSaved.recipeId,
      relation_type_id: relationTypeId,
      position: index,
      source: "llm"
    });

    if (linkError) {
      throw new ApiError(500, "recipe_link_insert_failed", "Could not create recipe attachment link", linkError.message);
    }

    await logChangelog({
      serviceClient: params.serviceClient,
      actorUserId: params.userId,
      scope: "attachments",
      entityType: "recipe_link",
      entityId: childSaved.recipeId,
      action: "attached",
      requestId: params.requestId,
      afterJson: {
        parent_recipe_id: params.parentRecipeId,
        child_recipe_id: childSaved.recipeId,
        relation_type: relationType,
        position: index
      }
    });
  }
};

const fetchChatMessages = async (client: SupabaseClient, chatId: string): Promise<ChatMessageView[]> => {
  const { data: messages, error } = await client
    .from("chat_messages")
    .select("id,role,content,metadata,created_at")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new ApiError(500, "chat_messages_fetch_failed", "Could not fetch chat messages", error.message);
  }

  return (messages ?? []) as ChatMessageView[];
};

const parseAssistantChatPayload = (
  message: Pick<ChatMessageView, "content">
): { recipe: RecipePayload | null; assistantReply: AssistantReply | null } | null => {
  try {
    const parsed = JSON.parse(message.content) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const candidate = parsed as Record<string, unknown>;
    const envelopeRecipe = candidate.recipe as RecipePayload | undefined;

    const recipe =
      envelopeRecipe && envelopeRecipe.title && Array.isArray(envelopeRecipe.ingredients) && Array.isArray(envelopeRecipe.steps)
        ? envelopeRecipe
        : (() => {
            const directRecipe = parsed as RecipePayload;
            if (directRecipe && directRecipe.title && Array.isArray(directRecipe.ingredients) && Array.isArray(directRecipe.steps)) {
              return directRecipe;
            }
            return null;
          })();

    const replyCandidate =
      candidate.assistant_reply ??
      ((candidate.data as Record<string, unknown> | undefined)?.assistant_reply as unknown) ??
      ((candidate.result as Record<string, unknown> | undefined)?.assistant_reply as unknown);
    const assistantReply = (() => {
      if (typeof replyCandidate === "string" && replyCandidate.trim().length > 0) {
        return { text: replyCandidate.trim() } as AssistantReply;
      }

      if (
        replyCandidate &&
        typeof replyCandidate === "object" &&
        !Array.isArray(replyCandidate) &&
        typeof (replyCandidate as { text?: unknown }).text === "string"
      ) {
        return (replyCandidate as AssistantReply) ?? null;
      }

      return null;
    })();

    if (!recipe && !assistantReply) {
      return null;
    }

    return {
      recipe,
      assistantReply
    };
  } catch {
    return null;
  }

  return null;
};

const extractLatestAssistantRecipe = (messages: ChatMessageView[]): RecipePayload | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") {
      continue;
    }

    const parsed = parseAssistantChatPayload(message);
    if (parsed?.recipe) {
      return parsed.recipe;
    }
  }

  return null;
};

const extractLatestAssistantReply = (messages: ChatMessageView[]): AssistantReply | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") {
      continue;
    }

    const parsed = parseAssistantChatPayload(message);
    if (parsed?.assistantReply) {
      return parsed.assistantReply;
    }
  }

  return null;
};

const renderChatMessageForPrompt = (message: ChatMessageView): string => {
  if (message.role !== "assistant") {
    return message.content;
  }

  const parsed = parseAssistantChatPayload(message);
  if (parsed?.assistantReply?.text) {
    return parsed.assistantReply.text;
  }

  if (parsed?.recipe) {
    const summaryParts = [parsed.recipe.title, parsed.recipe.description, parsed.recipe.notes].filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0
    );
    return summaryParts.join(" — ");
  }

  return message.content;
};

const buildCookbookItems = async (client: SupabaseClient, userId: string): Promise<Array<Record<string, JsonValue>>> => {
  const { data: saves, error: savesError } = await client
    .from("recipe_saves")
    .select("recipe_id")
    .eq("user_id", userId);

  if (savesError) {
    throw new ApiError(500, "cookbook_saves_fetch_failed", "Could not fetch saved recipes", savesError.message);
  }

  const recipeIds = (saves ?? []).map((row) => row.recipe_id);
  if (recipeIds.length === 0) {
    return [];
  }

  const preferredRecipesQuery = await client
    .from("recipes")
    .select("id,title,hero_image_url,image_status,visibility,updated_at,current_version_id")
    .in("id", recipeIds)
    .order("updated_at", { ascending: false });

  let recipes: Array<{
    id: string;
    title: string;
    hero_image_url: string | null;
    image_status: string;
    visibility: string;
    updated_at: string;
    current_version_id: string | null;
  }> = [];

  if (preferredRecipesQuery.error) {
    if (!isSchemaMissingError(preferredRecipesQuery.error)) {
      throw new ApiError(500, "cookbook_fetch_failed", "Could not load cookbook recipes", preferredRecipesQuery.error.message);
    }

    const legacyRecipesQuery = await client
      .from("recipes")
      .select("id,title,hero_image_url,visibility,updated_at,current_version_id")
      .in("id", recipeIds)
      .order("updated_at", { ascending: false });

    if (legacyRecipesQuery.error) {
      throw new ApiError(500, "cookbook_fetch_failed", "Could not load cookbook recipes", legacyRecipesQuery.error.message);
    }

    recipes = (legacyRecipesQuery.data ?? []).map((row) => ({
      ...row,
      image_status: row.hero_image_url ? "ready" : "pending"
    }));
  } else {
    recipes = (preferredRecipesQuery.data ?? []) as Array<{
      id: string;
      title: string;
      hero_image_url: string | null;
      image_status: string;
      visibility: string;
      updated_at: string;
      current_version_id: string | null;
    }>;
  }

  const versionIds = recipes
    .map((recipe) => recipe.current_version_id)
    .filter((id): id is string => Boolean(id));

  let versionById = new Map<string, RecipePayload>();
  if (versionIds.length > 0) {
    const { data: versions, error: versionsError } = await client
      .from("recipe_versions")
      .select("id,payload")
      .in("id", versionIds);

    if (versionsError) {
      throw new ApiError(500, "cookbook_version_fetch_failed", "Could not load cookbook versions", versionsError.message);
    }

    versionById = new Map((versions ?? []).map((version) => [version.id, version.payload as RecipePayload]));
  }

  const [{ data: userCategories }, { data: autoCategories }] = await Promise.all([
    client
      .from("recipe_user_categories")
      .select("recipe_id,category")
      .eq("user_id", userId),
    client
      .from("recipe_auto_categories")
      .select("recipe_id,category,confidence")
  ]);

  const userCategoryByRecipe = new Map<string, string>();
  for (const entry of userCategories ?? []) {
    userCategoryByRecipe.set(entry.recipe_id, entry.category);
  }

  const autoCategoryByRecipe = new Map<string, string>();
  for (const entry of autoCategories ?? []) {
    if (!autoCategoryByRecipe.has(entry.recipe_id)) {
      autoCategoryByRecipe.set(entry.recipe_id, entry.category);
    }
  }

  return recipes.map((recipe) => {
    const payload = recipe.current_version_id ? versionById.get(recipe.current_version_id) : undefined;
    const userCategory = userCategoryByRecipe.get(recipe.id);
    const autoCategory = autoCategoryByRecipe.get(recipe.id);

    return {
      id: recipe.id,
      title: payload?.title ?? recipe.title,
      summary: payload?.description ?? payload?.notes ?? "",
      image_url: recipe.hero_image_url,
      image_status: recipe.image_status,
      category: userCategory ?? autoCategory ?? "Auto Organized",
      visibility: recipe.visibility,
      updated_at: recipe.updated_at
    };
  });
};

const processImageJobs = async (params: {
  userClient: SupabaseClient;
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  limit: number;
}): Promise<{
  processed: number;
  ready: number;
  failed: number;
  pending: number;
}> => {
  const { data: jobs, error: jobsError } = await params.userClient
    .from("recipe_image_jobs")
    .select("id,recipe_id,attempt,max_attempts,status")
    .in("status", ["pending", "failed"])
    .order("updated_at", { ascending: true })
    .limit(params.limit);

  if (jobsError) {
    if (isSchemaMissingError(jobsError)) {
      return { processed: 0, ready: 0, failed: 0, pending: 0 };
    }
    throw new ApiError(500, "image_jobs_fetch_failed", "Could not fetch image jobs", jobsError.message);
  }

  if (!jobs || jobs.length === 0) {
    return { processed: 0, ready: 0, failed: 0, pending: 0 };
  }

  const preferences = await getPreferences(params.userClient, params.userId);
  const snapshot = await getMemorySnapshot(params.userClient, params.userId);

  let ready = 0;
  let failed = 0;
  let pending = 0;

  for (const job of jobs) {
    const nextAttempt = Number(job.attempt) + 1;
    await params.userClient
      .from("recipe_image_jobs")
      .update({
        status: "processing",
        attempt: nextAttempt,
        updated_at: new Date().toISOString(),
        locked_at: new Date().toISOString(),
        locked_by: "v1_image_jobs_process"
      })
      .eq("id", job.id);

    const { data: recipe, error: recipeError } = await params.userClient
      .from("recipes")
      .select("id,current_version_id")
      .eq("id", job.recipe_id)
      .maybeSingle();

    if (recipeError || !recipe?.current_version_id) {
      await params.userClient
        .from("recipe_image_jobs")
        .update({
          status: "failed",
          last_error: "recipe_or_current_version_missing",
          updated_at: new Date().toISOString(),
          locked_at: null,
          locked_by: null
        })
        .eq("id", job.id);
      await logChangelog({
        serviceClient: params.serviceClient,
        actorUserId: params.userId,
        scope: "image",
        entityType: "recipe",
        entityId: job.recipe_id,
        action: "image_failed",
        requestId: params.requestId,
        afterJson: {
          reason: "recipe_or_current_version_missing"
        }
      });
      failed += 1;
      continue;
    }

    const { data: version, error: versionError } = await params.userClient
      .from("recipe_versions")
      .select("payload")
      .eq("id", recipe.current_version_id)
      .maybeSingle();

    if (versionError || !version?.payload) {
      await params.userClient
        .from("recipe_image_jobs")
        .update({
          status: "failed",
          last_error: "recipe_payload_missing",
          updated_at: new Date().toISOString(),
          locked_at: null,
          locked_by: null
        })
        .eq("id", job.id);
      await logChangelog({
        serviceClient: params.serviceClient,
        actorUserId: params.userId,
        scope: "image",
        entityType: "recipe",
        entityId: job.recipe_id,
        action: "image_failed",
        requestId: params.requestId,
        afterJson: {
          reason: "recipe_payload_missing"
        }
      });
      failed += 1;
      continue;
    }

    const recipePayload = version.payload as RecipePayload;

    try {
      const imageUrl = await llmGateway.generateRecipeImage({
        client: params.serviceClient,
        userId: params.userId,
        requestId: params.requestId,
        recipe: recipePayload,
        context: {
          preferences,
          memory_snapshot: snapshot
        }
      });

      await params.userClient
        .from("recipes")
        .update({
          hero_image_url: imageUrl,
          image_status: "ready",
          image_last_error: null,
          image_updated_at: new Date().toISOString(),
          image_generation_attempts: nextAttempt,
          updated_at: new Date().toISOString()
        })
        .eq("id", job.recipe_id);

      await params.userClient
        .from("recipe_image_jobs")
        .update({
          status: "ready",
          last_error: null,
          updated_at: new Date().toISOString(),
          locked_at: null,
          locked_by: null
        })
        .eq("id", job.id);

      await logChangelog({
        serviceClient: params.serviceClient,
        actorUserId: params.userId,
        scope: "image",
        entityType: "recipe",
        entityId: job.recipe_id,
        action: "image_ready",
        requestId: params.requestId
      });
      ready += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "image_generation_failed";
      const terminalFailure = nextAttempt >= Number(job.max_attempts);
      await params.userClient
        .from("recipes")
        .update({
          image_status: terminalFailure ? "failed" : "pending",
          image_last_error: message,
          image_updated_at: new Date().toISOString(),
          image_generation_attempts: nextAttempt,
          updated_at: new Date().toISOString()
        })
        .eq("id", job.recipe_id);

      await params.userClient
        .from("recipe_image_jobs")
        .update({
          status: terminalFailure ? "failed" : "pending",
          last_error: message,
          next_attempt_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          locked_at: null,
          locked_by: null
        })
        .eq("id", job.id);

      await logChangelog({
        serviceClient: params.serviceClient,
        actorUserId: params.userId,
        scope: "image",
        entityType: "recipe",
        entityId: job.recipe_id,
        action: terminalFailure ? "image_failed" : "image_retry_scheduled",
        requestId: params.requestId,
        afterJson: {
          reason: message,
          attempt: nextAttempt,
          terminal_failure: terminalFailure
        }
      });

      if (terminalFailure) {
        failed += 1;
      } else {
        pending += 1;
      }
    }
  }

  return {
    processed: jobs.length,
    ready,
    failed,
    pending
  };
};

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();

  try {
    const url = new URL(request.url);
    const rawSegments = normalizePath(url.pathname);
    const segments = [...rawSegments];
    const method = request.method.toUpperCase();

    if (segments.length === 1 && segments[0] === "healthz" && method === "GET") {
      return jsonResponse(200, {
        status: "ok",
        service: "alchemy-api",
        timestamp: new Date().toISOString(),
        request_id: requestId
      });
    }

    const auth = await requireAuth(request);
    const client = createUserClient(auth.authHeader);
    const serviceClient = createServiceClient();

    let modelOverrides: ModelOverrideMap | undefined;
    const simOverridesHeader = request.headers.get("x-sim-model-overrides");
    if (simOverridesHeader) {
      try {
        modelOverrides = JSON.parse(simOverridesHeader) as ModelOverrideMap;
      } catch {
        // ignore malformed override header
      }
    }
    await ensureUserProfile(client, {
      userId: auth.userId,
      email: auth.email,
      fullName: auth.fullName,
      avatarUrl: auth.avatarUrl
    });

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

        await logChangelog({
          serviceClient,
          actorUserId: auth.userId,
          scope: "preferences",
          entityType: "preferences",
          entityId: auth.userId,
          action: "updated",
          requestId,
          afterJson: data as unknown as JsonValue
        });

        return jsonResponse(200, data);
      }
    }

    if (segments.length === 2 && segments[0] === "onboarding" && segments[1] === "state" && method === "GET") {
      const preferences = await getPreferences(client, auth.userId);
      const storedState = extractOnboardingStateFromPreferences(preferences);
      const derivedState = deriveOnboardingStateFromPreferences(preferences);

      const onboardingState =
        storedState && storedState.completed
          ? storedState
          : {
              ...derivedState,
              state: storedState?.state ?? {}
            };

      return jsonResponse(200, onboardingState);
    }

    if (segments.length === 2 && segments[0] === "onboarding" && segments[1] === "chat" && method === "POST") {
      const body = await requireJsonBody<{
        message?: string;
        transcript?: Array<{ role?: string; content?: string; created_at?: string }>;
        state?: Record<string, JsonValue>;
      }>(request);

      const normalizedMessage = typeof body.message === "string" ? body.message.trim() : "";
      const transcript = Array.isArray(body.transcript)
        ? body.transcript
            .filter((entry) => entry && typeof entry.content === "string" && typeof entry.role === "string")
            .map((entry) => ({
              role: entry.role === "assistant" ? "assistant" : "user",
              content: entry.content?.trim() ?? "",
              created_at: entry.created_at
            }))
            .filter((entry) => entry.content.length > 0)
        : [];
      const state =
        body.state && typeof body.state === "object" && !Array.isArray(body.state)
          ? body.state
          : {};

      const contextPack = await buildContextPack({
        userClient: client,
        serviceClient,
        userId: auth.userId,
        requestId,
        prompt: normalizedMessage || "start onboarding",
        context: {
          workflow: "onboarding",
          transcript,
          state
        },
        selectionMode: "fast"
      });

      const interview = await llmGateway.runOnboardingInterview({
        client: serviceClient,
        userId: auth.userId,
        requestId,
        prompt: normalizedMessage || "start onboarding",
        context: {
          preferences: contextPack.preferences,
          memory_snapshot: contextPack.memorySnapshot,
          selected_memories: contextPack.selectedMemories,
          transcript,
          state
        }
      });

      const effectivePreferences = await applyModelPreferenceUpdates({
        client,
        serviceClient,
        userId: auth.userId,
        requestId,
        currentPreferences: contextPack.preferences,
        preferenceUpdates: interview.preference_updates
      });

      const inferredState = deriveOnboardingStateFromPreferences(effectivePreferences);
      const userSkipRequested =
        normalizedMessage.length > 0 &&
        /\b(skip|later|not now|start using|use the app|done for now|skip onboarding)\b/i.test(normalizedMessage);

      const onboardingState: OnboardingState = userSkipRequested
        ? {
            completed: true,
            progress: 1,
            missing_topics: [],
            state: {
              ...interview.onboarding_state.state,
              skip_requested: true
            }
          }
        : interview.onboarding_state.completed || inferredState.completed
          ? {
              completed: true,
              progress: 1,
              missing_topics: [],
              state: {
                ...interview.onboarding_state.state,
                readiness_inferred: inferredState.completed
              }
            }
          : {
              completed: false,
              progress: Math.max(interview.onboarding_state.progress, inferredState.progress),
              missing_topics: Array.from(new Set([...interview.onboarding_state.missing_topics, ...inferredState.missing_topics])),
              state: interview.onboarding_state.state
            };

      const mergedPresentationPreferences = {
        ...(effectivePreferences.presentation_preferences ?? {}),
        onboarding_state: onboardingState
      } as Record<string, JsonValue>;

      const { data: persistedPreferences, error: persistedPreferencesError } = await client
        .from("preferences")
        .upsert({
          user_id: auth.userId,
          ...effectivePreferences,
          presentation_preferences: mergedPresentationPreferences,
          updated_at: new Date().toISOString()
        })
        .select("*")
        .single();

      if (persistedPreferencesError) {
        throw new ApiError(
          500,
          "onboarding_preferences_persist_failed",
          "Could not persist onboarding preferences",
          persistedPreferencesError.message
        );
      }

      // Fire-and-forget: memory pipeline + changelog run in background so the
      // response returns immediately (~10s saved per round-trip).
      void (async () => {
        try {
          await updateMemoryFromInteraction({
            userClient: client,
            serviceClient,
            userId: auth.userId,
            requestId,
            interactionContext: {
              workflow: "onboarding",
              user_message: normalizedMessage,
              transcript,
              assistant_reply: interview.assistant_reply,
              onboarding_state: onboardingState,
              preference_updates: interview.preference_updates ?? {},
              effective_preferences: persistedPreferences as unknown as Record<string, JsonValue>
            }
          });
          await logChangelog({
            serviceClient,
            actorUserId: auth.userId,
            scope: "onboarding",
            entityType: "preferences",
            entityId: auth.userId,
            action: onboardingState.completed ? "completed" : "step",
            requestId,
            afterJson: {
              onboarding_state: onboardingState,
              preference_updates: interview.preference_updates ?? {}
            }
          });
        } catch (bgError) {
          console.error("onboarding_background_task_failed", bgError);
        }
      })();

      return jsonResponse(200, {
        assistant_reply: interview.assistant_reply,
        onboarding_state: onboardingState,
        preference_updates: interview.preference_updates ?? {}
      });
    }

    if (segments.length === 1 && segments[0] === "memories") {
      if (method === "GET") {
        const memories = await getActiveMemories(client, auth.userId, getLimit(url, 100));
        const snapshot = await getMemorySnapshot(client, auth.userId);
        return jsonResponse(200, { items: memories, snapshot });
      }
    }

    if (segments.length === 2 && segments[0] === "memories" && segments[1] === "reset" && method === "POST") {
      const resetResult = await client
        .from("memories")
        .update({ status: "deleted", updated_at: new Date().toISOString() })
        .eq("user_id", auth.userId)
        .eq("status", "active");

      if (resetResult.error) {
        if (!isSchemaMissingError(resetResult.error)) {
          throw new ApiError(500, "memory_reset_failed", "Could not reset memories", resetResult.error.message);
        }

        const legacyDelete = await client.from("memories").delete().eq("user_id", auth.userId);
        if (legacyDelete.error) {
          throw new ApiError(500, "memory_reset_failed", "Could not reset memories", legacyDelete.error.message);
        }
      }

      const snapshotResult = await client.from("memory_snapshots").upsert({
        user_id: auth.userId,
        summary: {},
        token_estimate: 0,
        updated_at: new Date().toISOString()
      });
      if (snapshotResult.error && !isSchemaMissingError(snapshotResult.error)) {
        throw new ApiError(500, "memory_reset_failed", "Could not reset memory snapshot", snapshotResult.error.message);
      }

      await logChangelog({
        serviceClient,
        actorUserId: auth.userId,
        scope: "memory",
        entityType: "memory",
        entityId: auth.userId,
        action: "reset",
        requestId
      });

      return jsonResponse(200, { ok: true });
    }

    if (segments.length === 2 && segments[0] === "memories" && segments[1] === "forget" && method === "POST") {
      const body = await requireJsonBody<{ memory_id: string }>(request);
      const memoryId = parseUuid(body.memory_id);

      const forgetResult = await client
        .from("memories")
        .update({ status: "deleted", updated_at: new Date().toISOString() })
        .eq("id", memoryId)
        .eq("user_id", auth.userId);

      if (forgetResult.error) {
        if (!isSchemaMissingError(forgetResult.error)) {
          throw new ApiError(500, "memory_forget_failed", "Could not forget memory", forgetResult.error.message);
        }

        const legacyDelete = await client.from("memories").delete().eq("id", memoryId).eq("user_id", auth.userId);
        if (legacyDelete.error) {
          throw new ApiError(500, "memory_forget_failed", "Could not forget memory", legacyDelete.error.message);
        }
      }

      await logChangelog({
        serviceClient,
        actorUserId: auth.userId,
        scope: "memory",
        entityType: "memory",
        entityId: memoryId,
        action: "forgotten",
        requestId
      });

      return jsonResponse(200, { ok: true });
    }

    if (segments.length === 1 && segments[0] === "changelog" && method === "GET") {
      const limit = getLimit(url, 100);
      const changelogResult = await client
        .from("changelog_events")
        .select("id,scope,entity_type,entity_id,action,request_id,before_json,after_json,metadata,created_at")
        .eq("actor_user_id", auth.userId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (changelogResult.error) {
        if (!isSchemaMissingError(changelogResult.error)) {
          throw new ApiError(500, "changelog_fetch_failed", "Could not load changelog", changelogResult.error.message);
        }

        const legacyEvents = await client
          .from("events")
          .select("id,event_type,request_id,event_payload,created_at")
          .eq("user_id", auth.userId)
          .order("created_at", { ascending: false })
          .limit(limit);

        if (legacyEvents.error) {
          throw new ApiError(500, "changelog_fetch_failed", "Could not load changelog", legacyEvents.error.message);
        }

        const items = (legacyEvents.data ?? []).map((event) => ({
          id: event.id,
          scope: "event",
          entity_type: "event",
          entity_id: null,
          action: event.event_type,
          request_id: event.request_id,
          before_json: null,
          after_json: event.event_payload,
          metadata: {},
          created_at: event.created_at
        }));
        return jsonResponse(200, { items });
      }

      return jsonResponse(200, { items: changelogResult.data ?? [] });
    }

    if (segments.length === 2 && segments[0] === "image-jobs" && segments[1] === "process" && method === "POST") {
      const body = await requireJsonBody<{ limit?: number }>(request).catch(() => ({ limit: 5 }));
      const limit = Number.isFinite(Number(body.limit)) ? Math.max(1, Math.min(20, Number(body.limit))) : 5;

      const result = await processImageJobs({
        userClient: client,
        serviceClient,
        userId: auth.userId,
        requestId,
        limit
      });

      await logChangelog({
        serviceClient,
        actorUserId: auth.userId,
        scope: "image",
        entityType: "image_job",
        action: "process_batch",
        requestId,
        afterJson: {
          processed: result.processed,
          ready: result.ready,
          failed: result.failed,
          pending: result.pending
        }
      });

      return jsonResponse(200, result);
    }

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

        await logChangelog({
          serviceClient,
          actorUserId: auth.userId,
          scope: "collections",
          entityType: "collection",
          entityId: data.id,
          action: "created",
          requestId,
          afterJson: data as unknown as JsonValue
        });

        return jsonResponse(200, data);
      }
    }

    if (segments.length === 3 && segments[0] === "collections" && segments[2] === "items" && method === "POST") {
      const collectionId = parseUuid(segments[1]);
      const body = await requireJsonBody<{ recipe_id: string }>(request);
      const recipeId = parseUuid(body.recipe_id);

      const { error } = await client.from("collection_items").upsert({
        collection_id: collectionId,
        recipe_id: recipeId
      });

      if (error) {
        throw new ApiError(500, "collection_item_create_failed", "Could not add recipe to collection", error.message);
      }

      await logChangelog({
        serviceClient,
        actorUserId: auth.userId,
        scope: "collections",
        entityType: "collection_item",
        entityId: `${collectionId}:${recipeId}`,
        action: "added",
        requestId
      });

      return jsonResponse(200, { ok: true });
    }

    if (segments.length === 2 && segments[0] === "recipes" && segments[1] === "generate" && method === "POST") {
      const body = await requireJsonBody<{ prompt: string; vibe?: string }>(request);
      if (!body.prompt?.trim()) {
        throw new ApiError(400, "invalid_prompt", "prompt is required");
      }

      const contextPack = await buildContextPack({
        userClient: client,
        serviceClient,
        userId: auth.userId,
        requestId,
        prompt: body.prompt,
        context: { vibe: body.vibe ?? null },
        selectionMode: "fast"
      });

      const generation = await llmGateway.generateRecipe({
        client: serviceClient,
        userId: auth.userId,
        requestId,
        prompt: body.prompt,
        context: {
          vibe: body.vibe ?? null,
          preferences: contextPack.preferences,
          memory_snapshot: contextPack.memorySnapshot,
          selected_memories: contextPack.selectedMemories
        }
      });
      const recipePayload = generation.recipe;
      const effectivePreferences = await applyModelPreferenceUpdates({
        client,
        serviceClient,
        userId: auth.userId,
        requestId,
        currentPreferences: contextPack.preferences,
        preferenceUpdates: generation.response_context?.preference_updates
      });
      const effectiveContextPack: ContextPack = {
        ...contextPack,
        preferences: effectivePreferences
      };

      const categories = await llmGateway.inferCategories({
        client: serviceClient,
        userId: auth.userId,
        requestId,
        recipe: recipePayload,
        context: {
          preferences: effectivePreferences,
          memory_snapshot: contextPack.memorySnapshot
        }
      });

      const saved = await persistRecipe({
        client,
        serviceClient,
        userId: auth.userId,
        requestId,
        payload: recipePayload,
        diffSummary: "Initial generation",
        selectedMemoryIds: contextPack.selectedMemoryIds
      });

      await applyAutoCategories({
        client,
        recipeId: saved.recipeId,
        categories
      });

      await recordGraphData({
        client,
        recipeVersionId: saved.versionId,
        recipe: recipePayload
      });

      await syncRecipeAttachments({
        userClient: client,
        serviceClient,
        userId: auth.userId,
        requestId,
        parentRecipeId: saved.recipeId,
        payload: recipePayload,
        contextPack: effectiveContextPack
      });

      await updateMemoryFromInteraction({
        userClient: client,
        serviceClient,
        userId: auth.userId,
        requestId,
        interactionContext: {
          prompt: body.prompt,
          recipe: recipePayload,
          preferences: effectivePreferences,
          selected_memory_ids: contextPack.selectedMemoryIds
        },
        mode: "light"
      });

      const recipe = await fetchRecipeView(client, saved.recipeId);
      return jsonResponse(200, { recipe, version: recipe.version, assistant_reply: generation.assistant_reply });
    }

    if (segments.length === 2 && segments[0] === "recipes" && segments[1] === "cookbook" && method === "GET") {
      const items = await buildCookbookItems(client, auth.userId);
      return jsonResponse(200, { items });
    }

    if (segments.length === 2 && segments[0] === "recipes" && method === "GET") {
      const recipeId = parseUuid(segments[1]);
      const recipe = await fetchRecipeView(client, recipeId);
      return jsonResponse(200, recipe);
    }

    if (segments.length === 3 && segments[0] === "recipes" && segments[2] === "history" && method === "GET") {
      const recipeId = parseUuid(segments[1]);

      const { data: recipe, error: recipeError } = await client
        .from("recipes")
        .select("id,source_chat_id")
        .eq("id", recipeId)
        .maybeSingle();

      if (recipeError || !recipe) {
        throw new ApiError(404, "recipe_not_found", "Recipe not found", recipeError?.message);
      }

      const { data: versions, error: versionsError } = await client
        .from("recipe_versions")
        .select("id,parent_version_id,diff_summary,created_at,payload,created_by")
        .eq("recipe_id", recipeId)
        .order("created_at", { ascending: true });

      if (versionsError) {
        throw new ApiError(500, "recipe_history_fetch_failed", "Could not fetch recipe history", versionsError.message);
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
          if (!isSchemaMissingError(versionEventsResult.error)) {
            throw new ApiError(
              500,
              "recipe_version_events_fetch_failed",
              "Could not fetch recipe version events",
              versionEventsResult.error.message
            );
          }
        } else {
          events = (versionEventsResult.data ?? []) as unknown as Array<Record<string, JsonValue>>;
        }
      }

      let chatMessages: ChatMessageView[] = [];
      if (recipe.source_chat_id) {
        chatMessages = await fetchChatMessages(client, recipe.source_chat_id);
      }

      return jsonResponse(200, {
        recipe_id: recipeId,
        source_chat_id: recipe.source_chat_id,
        versions: versions ?? [],
        version_events: events,
        chat_messages: chatMessages
      });
    }

    if (segments.length === 3 && segments[0] === "recipes" && segments[2] === "tweak" && method === "POST") {
      const recipeId = parseUuid(segments[1]);
      const body = await requireJsonBody<{ message: string }>(request);
      if (!body.message?.trim()) {
        throw new ApiError(400, "invalid_message", "message is required");
      }

      const current = await fetchRecipeView(client, recipeId, false);
      const contextPack = await buildContextPack({
        userClient: client,
        serviceClient,
        userId: auth.userId,
        requestId,
        prompt: body.message,
        context: {
          recipe_id: recipeId,
          current_recipe: {
            title: current.title,
            servings: current.servings,
            ingredients: current.ingredients,
            steps: current.steps,
            notes: current.notes,
            pairings: current.pairings,
            metadata: current.metadata
          }
        },
        selectionMode: "fast"
      });

      const tweak = await llmGateway.tweakRecipe({
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
            pairings: current.pairings,
            metadata: current.metadata
          },
          preferences: contextPack.preferences,
          memory_snapshot: contextPack.memorySnapshot,
          selected_memories: contextPack.selectedMemories
        }
      });
      const tweakedPayload = tweak.recipe;
      const effectivePreferences = await applyModelPreferenceUpdates({
        client,
        serviceClient,
        userId: auth.userId,
        requestId,
        currentPreferences: contextPack.preferences,
        preferenceUpdates: tweak.response_context?.preference_updates
      });
      const effectiveContextPack: ContextPack = {
        ...contextPack,
        preferences: effectivePreferences
      };

      const categories = await llmGateway.inferCategories({
        client: serviceClient,
        userId: auth.userId,
        requestId,
        recipe: tweakedPayload,
        context: {
          preferences: effectivePreferences,
          memory_snapshot: contextPack.memorySnapshot
        }
      });

      const saved = await persistRecipe({
        client,
        serviceClient,
        userId: auth.userId,
        requestId,
        recipeId,
        payload: tweakedPayload,
        parentVersionId: current.version.version_id,
        diffSummary: body.message,
        selectedMemoryIds: contextPack.selectedMemoryIds
      });

      await applyAutoCategories({
        client,
        recipeId,
        categories
      });

      await recordGraphData({
        client,
        recipeVersionId: saved.versionId,
        recipe: tweakedPayload
      });

      await syncRecipeAttachments({
        userClient: client,
        serviceClient,
        userId: auth.userId,
        requestId,
        parentRecipeId: recipeId,
        payload: tweakedPayload,
        contextPack: effectiveContextPack
      });

      await updateMemoryFromInteraction({
        userClient: client,
        serviceClient,
        userId: auth.userId,
        requestId,
        interactionContext: {
          prompt: body.message,
          recipe_id: recipeId,
          updated_recipe: tweakedPayload,
          selected_memory_ids: contextPack.selectedMemoryIds
        },
        mode: "light"
      });

      const recipe = await fetchRecipeView(client, recipeId);
      return jsonResponse(200, { recipe, version: recipe.version, assistant_reply: tweak.assistant_reply });
    }

    if (segments.length === 3 && segments[0] === "recipes" && segments[2] === "attachments" && method === "POST") {
      const parentRecipeId = parseUuid(segments[1]);
      const body = await requireJsonBody<{
        relation_type: string;
        position?: number;
        prompt?: string;
        recipe?: Omit<RecipePayload, "attachments">;
      }>(request);

      const relationType = body.relation_type?.trim().toLowerCase();
      if (!relationType) {
        throw new ApiError(400, "invalid_relation_type", "relation_type is required");
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
          parent_recipe: {
            id: parentRecipe.id,
            title: parentRecipe.title,
            ingredients: parentRecipe.ingredients,
            steps: parentRecipe.steps,
            metadata: parentRecipe.metadata
          }
        }
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
            parent_recipe: {
              id: parentRecipe.id,
              title: parentRecipe.title,
              ingredients: parentRecipe.ingredients,
              steps: parentRecipe.steps,
              metadata: parentRecipe.metadata
            },
            preferences: contextPack.preferences,
            memory_snapshot: contextPack.memorySnapshot,
            selected_memories: contextPack.selectedMemories
          }
        });
        attachmentRecipePayload = attachmentGeneration.recipe;
      } else {
        throw new ApiError(400, "invalid_attachment_payload", "Provide either prompt or recipe payload");
      }

      const saved = await persistRecipe({
        client,
        serviceClient,
        userId: auth.userId,
        requestId,
        payload: attachmentRecipePayload,
        diffSummary: `Attachment (${relationType})`,
        selectedMemoryIds: contextPack.selectedMemoryIds
      });

      const relationTypeId = await resolveRelationTypeId(client, relationType);
      const { data: insertedLink, error: linkError } = await client
        .from("recipe_links")
        .insert({
          parent_recipe_id: parentRecipeId,
          child_recipe_id: saved.recipeId,
          relation_type_id: relationTypeId,
          position: Number.isFinite(Number(body.position)) ? Number(body.position) : 0,
          source: "user"
        })
        .select("id")
        .single();

      if (linkError || !insertedLink) {
        throw new ApiError(500, "recipe_attachment_create_failed", "Could not create attachment link", linkError?.message);
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
          relation_type: relationType
        }
      });

      const recipe = await fetchRecipeView(client, parentRecipeId);
      return jsonResponse(200, { recipe, attachment_id: insertedLink.id });
    }

    if (segments.length === 4 && segments[0] === "recipes" && segments[2] === "attachments" && method === "PATCH") {
      const parentRecipeId = parseUuid(segments[1]);
      const attachmentId = parseUuid(segments[3]);
      const body = await requireJsonBody<{ relation_type?: string; position?: number }>(request);

      const updatePayload: Record<string, JsonValue> = {
        updated_at: new Date().toISOString()
      };

      if (typeof body.position === "number" && Number.isInteger(body.position)) {
        updatePayload.position = body.position;
      }

      if (body.relation_type?.trim()) {
        updatePayload.relation_type_id = await resolveRelationTypeId(client, body.relation_type);
      }

      const { error } = await client
        .from("recipe_links")
        .update(updatePayload)
        .eq("id", attachmentId)
        .eq("parent_recipe_id", parentRecipeId);

      if (error) {
        throw new ApiError(500, "recipe_attachment_update_failed", "Could not update attachment", error.message);
      }

      await logChangelog({
        serviceClient,
        actorUserId: auth.userId,
        scope: "attachments",
        entityType: "recipe_link",
        entityId: attachmentId,
        action: "updated",
        requestId,
        afterJson: updatePayload as unknown as JsonValue
      });

      const recipe = await fetchRecipeView(client, parentRecipeId);
      return jsonResponse(200, { recipe });
    }

    if (segments.length === 4 && segments[0] === "recipes" && segments[2] === "attachments" && method === "DELETE") {
      const parentRecipeId = parseUuid(segments[1]);
      const attachmentId = parseUuid(segments[3]);

      const { error } = await client
        .from("recipe_links")
        .delete()
        .eq("id", attachmentId)
        .eq("parent_recipe_id", parentRecipeId);

      if (error) {
        throw new ApiError(500, "recipe_attachment_delete_failed", "Could not delete attachment", error.message);
      }

      await logChangelog({
        serviceClient,
        actorUserId: auth.userId,
        scope: "attachments",
        entityType: "recipe_link",
        entityId: attachmentId,
        action: "deleted",
        requestId
      });

      const recipe = await fetchRecipeView(client, parentRecipeId);
      return jsonResponse(200, { recipe });
    }

    if (segments.length === 3 && segments[0] === "recipes" && segments[2] === "save") {
      const recipeId = parseUuid(segments[1]);
      if (method === "POST") {
        const { error } = await client
          .from("recipe_saves")
          .upsert({ user_id: auth.userId, recipe_id: recipeId }, { onConflict: "user_id,recipe_id" });

        if (error) {
          throw new ApiError(500, "recipe_save_failed", "Could not save recipe", error.message);
        }

        await logChangelog({
          serviceClient,
          actorUserId: auth.userId,
          scope: "cookbook",
          entityType: "recipe_save",
          entityId: recipeId,
          action: "saved",
          requestId
        });

        // Enqueue image generation now that the recipe is saved to cookbook
        const { data: recipeImageCheck } = await client
          .from("recipes")
          .select("hero_image_url")
          .eq("id", recipeId)
          .maybeSingle();

        if (!recipeImageCheck?.hero_image_url) {
          await enqueueImageJob(client, recipeId);
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

        await logChangelog({
          serviceClient,
          actorUserId: auth.userId,
          scope: "cookbook",
          entityType: "recipe_save",
          entityId: recipeId,
          action: "unsaved",
          requestId
        });

        return jsonResponse(200, { saved: false });
      }
    }

    if (segments.length === 4 && segments[0] === "recipes" && segments[2] === "categories" && segments[3] === "override") {
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
          category
        });

        if (error) {
          throw new ApiError(500, "category_override_failed", "Could not set category override", error.message);
        }

        await logChangelog({
          serviceClient,
          actorUserId: auth.userId,
          scope: "categories",
          entityType: "recipe_user_category",
          entityId: `${recipeId}:${category}`,
          action: "override_set",
          requestId
        });

        return jsonResponse(200, { ok: true });
      }
    }

    if (segments.length === 5 && segments[0] === "recipes" && segments[2] === "categories" && segments[3] === "override") {
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
          throw new ApiError(500, "category_override_remove_failed", "Could not remove category override", error.message);
        }

        await logChangelog({
          serviceClient,
          actorUserId: auth.userId,
          scope: "categories",
          entityType: "recipe_user_category",
          entityId: `${recipeId}:${category}`,
          action: "override_removed",
          requestId
        });

        return jsonResponse(200, { ok: true });
      }
    }

    if (segments.length === 3 && segments[0] === "recipes" && segments[2] === "graph" && method === "GET") {
      const recipeId = parseUuid(segments[1]);

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

    if (segments.length === 1 && segments[0] === "chat" && method === "POST") {
      const body = await requireJsonBody<{ message: string }>(request);
      const message = body.message?.trim();
      if (!message) {
        throw new ApiError(400, "invalid_message", "message is required");
      }

      const contextPack = await buildContextPack({
        userClient: client,
        serviceClient,
        userId: auth.userId,
        requestId,
        prompt: message,
        context: {},
        selectionMode: "fast"
      });

      const { data: chatSession, error: chatError } = await client
        .from("chat_sessions")
        .insert({
          owner_user_id: auth.userId,
          context: {
            preferences: contextPack.preferences,
            memory_snapshot: contextPack.memorySnapshot,
            selected_memory_ids: contextPack.selectedMemoryIds
          }
        })
        .select("id,created_at,updated_at")
        .single();

      if (chatError || !chatSession) {
        throw new ApiError(500, "chat_create_failed", "Could not create chat session", chatError?.message);
      }

      const { error: userMessageError } = await client.from("chat_messages").insert({
        chat_id: chatSession.id,
        role: "user",
        content: message
      });

      if (userMessageError) {
        throw new ApiError(500, "chat_message_create_failed", "Could not store chat message", userMessageError.message);
      }

      const assistantChatResponse = await llmGateway.converseChat({
        client: serviceClient,
        userId: auth.userId,
        requestId,
        prompt: message,
        context: {
          preferences: contextPack.preferences,
          memory_snapshot: contextPack.memorySnapshot,
          selected_memories: contextPack.selectedMemories
        },
        modelOverrides
      });
      const effectivePreferences = await applyModelPreferenceUpdates({
        client,
        serviceClient,
        userId: auth.userId,
        requestId,
        currentPreferences: contextPack.preferences,
        preferenceUpdates: assistantChatResponse.response_context?.preference_updates
      });

      const { error: assistantMessageError } = await client.from("chat_messages").insert({
        chat_id: chatSession.id,
        role: "assistant",
        content: JSON.stringify(assistantChatResponse),
        metadata: { format: "assistant_chat_envelope" }
      });

      if (assistantMessageError) {
        throw new ApiError(500, "chat_assistant_message_failed", "Could not store assistant chat message", assistantMessageError.message);
      }

      const interactionContext: Record<string, JsonValue> = {
        prompt: message,
        chat_id: chatSession.id,
        assistant_reply: assistantChatResponse.assistant_reply,
        preferences: effectivePreferences,
        selected_memory_ids: contextPack.selectedMemoryIds
      };
      if (assistantChatResponse.recipe) {
        interactionContext.assistant_recipe = assistantChatResponse.recipe;
      }

      await updateMemoryFromInteraction({
        userClient: client,
        serviceClient,
        userId: auth.userId,
        requestId,
        interactionContext,
        mode: "light"
      });

      const messages = await fetchChatMessages(client, chatSession.id);

      await logChangelog({
        serviceClient,
        actorUserId: auth.userId,
        scope: "chat",
        entityType: "chat_session",
        entityId: chatSession.id,
        action: "created",
        requestId,
        afterJson: {
          message_count: messages.length
        }
      });

      return jsonResponse(200, {
        id: chatSession.id,
        messages,
        active_recipe: assistantChatResponse.recipe ?? null,
        assistant_reply: assistantChatResponse.assistant_reply,
        context_version: 1,
        memory_context_ids: contextPack.selectedMemoryIds,
        created_at: chatSession.created_at,
        updated_at: chatSession.updated_at
      });
    }

    if (segments.length === 2 && segments[0] === "chat" && method === "GET") {
      const chatId = parseUuid(segments[1]);

      const { data: chatSession, error: chatError } = await client
        .from("chat_sessions")
        .select("id,created_at,updated_at,context")
        .eq("id", chatId)
        .maybeSingle();

      if (chatError || !chatSession) {
        throw new ApiError(404, "chat_not_found", "Chat session not found", chatError?.message);
      }

      const messages = await fetchChatMessages(client, chatId);
      const latestAssistantRecipe = extractLatestAssistantRecipe(messages);
      const latestAssistantReply = extractLatestAssistantReply(messages);

      return jsonResponse(200, {
        id: chatSession.id,
        messages,
        active_recipe: latestAssistantRecipe,
        assistant_reply: latestAssistantReply,
        context: chatSession.context,
        created_at: chatSession.created_at,
        updated_at: chatSession.updated_at
      });
    }

    if (segments.length === 3 && segments[0] === "chat" && segments[2] === "messages" && method === "POST") {
      const chatId = parseUuid(segments[1]);
      const body = await requireJsonBody<{ message: string }>(request);
      const message = body.message?.trim();

      if (!message) {
        throw new ApiError(400, "invalid_message", "message is required");
      }

      const { data: chatSession, error: chatError } = await client
        .from("chat_sessions")
        .select("id,context")
        .eq("id", chatId)
        .maybeSingle();

      if (chatError || !chatSession) {
        throw new ApiError(404, "chat_not_found", "Chat session not found", chatError?.message);
      }

      const contextPack = await buildContextPack({
        userClient: client,
        serviceClient,
        userId: auth.userId,
        requestId,
        prompt: message,
        context: {
          chat_context: (chatSession.context as Record<string, JsonValue>) ?? {}
        },
        selectionMode: "fast"
      });

      const { error: userMessageError } = await client.from("chat_messages").insert({
        chat_id: chatId,
        role: "user",
        content: message
      });

      if (userMessageError) {
        throw new ApiError(500, "chat_message_create_failed", "Could not store chat message", userMessageError.message);
      }

      const threadMessages = await fetchChatMessages(client, chatId);
      const latestAssistantRecipe = extractLatestAssistantRecipe(threadMessages);

      const assistantChatResponse = await llmGateway.converseChat({
        client: serviceClient,
        userId: auth.userId,
        requestId,
        prompt: message,
        context: {
          chat_context: (chatSession.context as Record<string, JsonValue>) ?? {},
          thread: threadMessages,
          active_recipe: latestAssistantRecipe ?? undefined,
          preferences: contextPack.preferences,
          memory_snapshot: contextPack.memorySnapshot,
          selected_memories: contextPack.selectedMemories
        },
        modelOverrides
      });
      const effectivePreferences = await applyModelPreferenceUpdates({
        client,
        serviceClient,
        userId: auth.userId,
        requestId,
        currentPreferences: contextPack.preferences,
        preferenceUpdates: assistantChatResponse.response_context?.preference_updates
      });

      const { error: assistantMessageError } = await client.from("chat_messages").insert({
        chat_id: chatId,
        role: "assistant",
        content: JSON.stringify(assistantChatResponse),
        metadata: { format: "assistant_chat_envelope" }
      });

      if (assistantMessageError) {
        throw new ApiError(500, "chat_assistant_message_failed", "Could not store assistant chat message", assistantMessageError.message);
      }

      const interactionContext: Record<string, JsonValue> = {
        prompt: message,
        chat_id: chatId,
        assistant_reply: assistantChatResponse.assistant_reply,
        thread_size: threadMessages.length,
        preferences: effectivePreferences,
        selected_memory_ids: contextPack.selectedMemoryIds
      };
      if (assistantChatResponse.recipe) {
        interactionContext.assistant_recipe = assistantChatResponse.recipe;
      }

      await updateMemoryFromInteraction({
        userClient: client,
        serviceClient,
        userId: auth.userId,
        requestId,
        interactionContext,
        mode: "light"
      });

      const messages = await fetchChatMessages(client, chatId);
      const responseActiveRecipe = assistantChatResponse.recipe ?? extractLatestAssistantRecipe(messages);

      return jsonResponse(200, {
        id: chatId,
        messages,
        active_recipe: responseActiveRecipe ?? null,
        assistant_reply: assistantChatResponse.assistant_reply,
        context_version: 1,
        memory_context_ids: contextPack.selectedMemoryIds
      });
    }

    if (segments.length === 3 && segments[0] === "chat" && segments[2] === "generate" && method === "POST") {
      const chatId = parseUuid(segments[1]);

      const { data: chatSession, error: chatError } = await client
        .from("chat_sessions")
        .select("id,context,status")
        .eq("id", chatId)
        .maybeSingle();

      if (chatError || !chatSession) {
        throw new ApiError(404, "chat_not_found", "Chat session not found", chatError?.message);
      }

      if (chatSession.status !== "open") {
        throw new ApiError(409, "chat_not_open", "Only open chat sessions can generate a recipe");
      }

      const messages = await fetchChatMessages(client, chatId);
      if (messages.length === 0) {
        throw new ApiError(400, "chat_empty", "Chat session does not contain any messages");
      }

      const consolidatedPrompt = messages
        .map((message) => `[${message.role}] ${renderChatMessageForPrompt(message)}`)
        .join("\n");

      const contextPack = await buildContextPack({
        userClient: client,
        serviceClient,
        userId: auth.userId,
        requestId,
        prompt: consolidatedPrompt,
        context: {
          chat_context: (chatSession.context as Record<string, JsonValue>) ?? {},
          thread_size: messages.length
        }
      });

      const finalizedGeneration = await llmGateway.generateRecipe({
        client: serviceClient,
        userId: auth.userId,
        requestId,
        prompt: consolidatedPrompt,
        context: {
          chat_context: (chatSession.context as Record<string, JsonValue>) ?? {},
          thread: messages,
          preferences: contextPack.preferences,
          memory_snapshot: contextPack.memorySnapshot,
          selected_memories: contextPack.selectedMemories
        },
        modelOverrides
      });
      const recipePayload = finalizedGeneration.recipe;
      const effectivePreferences = await applyModelPreferenceUpdates({
        client,
        serviceClient,
        userId: auth.userId,
        requestId,
        currentPreferences: contextPack.preferences,
        preferenceUpdates: finalizedGeneration.response_context?.preference_updates
      });
      const effectiveContextPack: ContextPack = {
        ...contextPack,
        preferences: effectivePreferences
      };

      const categories = await llmGateway.inferCategories({
        client: serviceClient,
        userId: auth.userId,
        requestId,
        recipe: recipePayload,
        context: {
          chat_context: (chatSession.context as Record<string, JsonValue>) ?? {},
          preferences: effectivePreferences,
          memory_snapshot: contextPack.memorySnapshot
        }
      });

      const saved = await persistRecipe({
        client,
        serviceClient,
        userId: auth.userId,
        requestId,
        payload: recipePayload,
        sourceChatId: chatId,
        diffSummary: "Generated from chat session",
        selectedMemoryIds: contextPack.selectedMemoryIds
      });

      await applyAutoCategories({
        client,
        recipeId: saved.recipeId,
        categories
      });

      await recordGraphData({
        client,
        recipeVersionId: saved.versionId,
        recipe: recipePayload
      });

      await syncRecipeAttachments({
        userClient: client,
        serviceClient,
        userId: auth.userId,
        requestId,
        parentRecipeId: saved.recipeId,
        payload: recipePayload,
        contextPack: effectiveContextPack
      });

      const { error: chatStatusError } = await client
        .from("chat_sessions")
        .update({ status: "finalized", updated_at: new Date().toISOString() })
        .eq("id", chatId);

      if (chatStatusError) {
        throw new ApiError(500, "chat_generate_update_failed", "Could not update chat session status", chatStatusError.message);
      }

      await updateMemoryFromInteraction({
        userClient: client,
        serviceClient,
        userId: auth.userId,
        requestId,
        interactionContext: {
          chat_id: chatId,
          consolidated_prompt: consolidatedPrompt,
          finalized_recipe: recipePayload,
          preferences: effectivePreferences,
          selected_memory_ids: contextPack.selectedMemoryIds
        }
      });

      await logChangelog({
        serviceClient,
        actorUserId: auth.userId,
        scope: "chat",
        entityType: "chat_session",
        entityId: chatId,
        action: "generated_recipe",
        requestId,
        afterJson: {
          recipe_id: saved.recipeId
        }
      });

      const recipe = await fetchRecipeView(client, saved.recipeId);
      return jsonResponse(200, {
        recipe,
        version: recipe.version,
        assistant_reply: finalizedGeneration.assistant_reply
      });
    }

    throw new ApiError(404, "route_not_found", "Requested route does not exist");
  } catch (error) {
    return errorResponse(requestId, error);
  }
});
