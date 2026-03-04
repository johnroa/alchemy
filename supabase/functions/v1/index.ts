import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { requireAuth } from "../_shared/auth.ts";
import {
  ApiError,
  errorResponse,
  jsonResponse,
  requireJsonBody,
} from "../_shared/errors.ts";
import { createServiceClient, createUserClient } from "../_shared/db.ts";
import { llmGateway, type ModelOverrideMap } from "../_shared/llm-gateway.ts";
import type {
  AssistantReply,
  JsonValue,
  MemoryRecord,
  OnboardingState,
  RecipePayload,
} from "../_shared/types.ts";
import {
  buildIngredientGroups,
  type CanonicalIngredientView,
  canonicalizeIngredients,
  deriveCanonicalIngredientIdentity,
  type GroupByPreference,
  type IngredientGroup,
  type NormalizedStatus,
  projectIngredientsForOutput,
  projectInlineMeasurements,
  resolvePresentationOptions,
  type UnitKind,
  type UnitPreference,
} from "./recipe-standardization.ts";
import { sanitizeModelPreferencePatch } from "./preference-auto-update.ts";

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
  preferencesNaturalLanguage: Record<string, JsonValue>;
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
  ingredients: CanonicalIngredientView[];
  steps: RecipePayload["steps"];
  ingredient_groups?: IngredientGroup[];
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

type ChatLoopState = "ideation" | "candidate_presented" | "iterating";
type CandidateRecipeRole = "main" | "side" | "appetizer" | "dessert" | "drink";
type ChatIntent = "in_scope_ideation" | "in_scope_generate" | "out_of_scope";

type CandidateRecipeComponent = {
  component_id: string;
  role: CandidateRecipeRole;
  title: string;
  recipe: RecipePayload;
};

type CandidateRecipeSet = {
  candidate_id: string;
  revision: number;
  active_component_id: string;
  components: CandidateRecipeComponent[];
};

type ChatSessionContext = {
  preferences?: PreferenceContext;
  memory_snapshot?: Record<string, JsonValue>;
  selected_memory_ids?: string[];
  loop_state?: ChatLoopState;
  candidate_recipe_set?: CandidateRecipeSet | null;
  candidate_revision?: number;
  active_component_id?: string | null;
};

type ChatUiHints = {
  show_generation_animation?: boolean;
  focus_component_id?: string;
};

type ChatLoopResponse = {
  id: string;
  messages: ChatMessageView[];
  loop_state: ChatLoopState;
  assistant_reply: AssistantReply | null;
  candidate_recipe_set: CandidateRecipeSet | null;
  response_context?: {
    mode?: string;
    intent?: ChatIntent;
    changed_sections?: string[];
    personalization_notes?: string[];
    preference_updates?: Record<string, JsonValue>;
  };
  memory_context_ids: string[];
  context_version: number;
  ui_hints?: ChatUiHints;
  context?: Record<string, JsonValue>;
  created_at?: string;
  updated_at?: string;
};

const candidateRoles: CandidateRecipeRole[] = [
  "main",
  "side",
  "appetizer",
  "dessert",
  "drink",
];

const normalizeCandidateRole = (value: unknown): CandidateRecipeRole => {
  if (
    typeof value === "string" &&
    candidateRoles.includes(value as CandidateRecipeRole)
  ) {
    return value as CandidateRecipeRole;
  }
  return "main";
};

const normalizeCandidateRecipeSet = (
  candidate: unknown,
): CandidateRecipeSet | null => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const raw = candidate as Record<string, unknown>;
  const rawComponents = Array.isArray(raw.components) ? raw.components : [];

  const components: CandidateRecipeComponent[] = rawComponents
    .map((component, index) => {
      if (
        !component || typeof component !== "object" || Array.isArray(component)
      ) {
        return null;
      }
      const value = component as Record<string, unknown>;
      const recipe = value.recipe;
      if (!recipe || typeof recipe !== "object" || Array.isArray(recipe)) {
        return null;
      }
      const normalizedRecipe = recipe as RecipePayload;
      if (
        typeof normalizedRecipe.title !== "string" ||
        !Array.isArray(normalizedRecipe.ingredients) ||
        !Array.isArray(normalizedRecipe.steps)
      ) {
        return null;
      }

      const componentId = typeof value.component_id === "string" &&
          value.component_id.trim().length > 0
        ? value.component_id
        : crypto.randomUUID();
      const title =
        typeof value.title === "string" && value.title.trim().length > 0
          ? value.title.trim()
          : normalizedRecipe.title;

      return {
        component_id: componentId,
        role: normalizeCandidateRole(value.role),
        title,
        recipe: normalizedRecipe,
      };
    })
    .filter((component): component is CandidateRecipeComponent =>
      component !== null
    )
    .slice(0, 3);

  if (components.length === 0) {
    return null;
  }

  const activeComponentId = typeof raw.active_component_id === "string" &&
      components.some((component) =>
        component.component_id === raw.active_component_id
      )
    ? raw.active_component_id
    : components[0].component_id;

  const revision = Number(raw.revision);
  const candidateId =
    typeof raw.candidate_id === "string" && raw.candidate_id.trim().length > 0
      ? raw.candidate_id
      : crypto.randomUUID();

  return {
    candidate_id: candidateId,
    revision: Number.isFinite(revision) && revision >= 1
      ? Math.trunc(revision)
      : 1,
    active_component_id: activeComponentId,
    components,
  };
};

const wrapRecipeInCandidateSet = (
  recipe: RecipePayload,
  existing?: CandidateRecipeSet | null,
): CandidateRecipeSet => {
  const revision = Math.max(1, Number(existing?.revision ?? 0) + 1);
  const componentId = existing?.components?.[0]?.component_id ??
    crypto.randomUUID();

  return {
    candidate_id: existing?.candidate_id ?? crypto.randomUUID(),
    revision,
    active_component_id: componentId,
    components: [
      {
        component_id: componentId,
        role: "main",
        title: recipe.title,
        recipe,
      },
    ],
  };
};

const extractChatContext = (value: unknown): ChatSessionContext => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as ChatSessionContext;
};

const deriveLoopState = (
  context: ChatSessionContext,
  candidateSet: CandidateRecipeSet | null,
): ChatLoopState => {
  const raw = context.loop_state;
  if (
    raw === "ideation" || raw === "candidate_presented" || raw === "iterating"
  ) {
    if (!candidateSet && raw !== "ideation") {
      return "ideation";
    }
    return raw;
  }
  return candidateSet ? "candidate_presented" : "ideation";
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
  presentation_preferences: {},
};

const rawPreferenceTextKeys = {
  dietary_preferences: "raw_dietary_preferences",
  dietary_restrictions: "raw_dietary_restrictions",
  equipment: "raw_special_equipment",
  cuisines: "raw_cuisines",
  aversions: "raw_disliked_ingredients",
} as const;

const normalizedRawPreferenceText = (
  preferences: PreferenceContext,
  field: keyof typeof rawPreferenceTextKeys,
): string | null => {
  const raw = preferences.presentation_preferences
    ?.[rawPreferenceTextKeys[field]];
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const joinCanonicalPreferenceList = (values: string[]): string =>
  values.join(", ");

const buildNaturalLanguagePreferenceContext = (
  preferences: PreferenceContext,
): Record<string, JsonValue> => ({
  chef_profile: preferences.free_form ?? "",
  cooking_for: preferences.cooking_for ?? "",
  skill_level: preferences.skill_level,
  max_difficulty: preferences.max_difficulty,
  dietary_preferences:
    normalizedRawPreferenceText(preferences, "dietary_preferences") ??
      joinCanonicalPreferenceList(preferences.dietary_preferences),
  dietary_restrictions:
    normalizedRawPreferenceText(preferences, "dietary_restrictions") ??
      joinCanonicalPreferenceList(preferences.dietary_restrictions),
  special_equipment: normalizedRawPreferenceText(preferences, "equipment") ??
    joinCanonicalPreferenceList(preferences.equipment),
  cuisines: normalizedRawPreferenceText(preferences, "cuisines") ??
    joinCanonicalPreferenceList(preferences.cuisines),
  disliked_ingredients: normalizedRawPreferenceText(preferences, "aversions") ??
    joinCanonicalPreferenceList(preferences.aversions),
});

const onboardingTopicKeys = [
  "skill",
  "equipment",
  "dietary",
  "presentation",
] as const;

const extractOnboardingStateFromPreferences = (
  preferences: PreferenceContext,
): OnboardingState | null => {
  const candidate = preferences.presentation_preferences?.["onboarding_state"];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const data = candidate as Record<string, unknown>;
  const completed = Boolean(data.completed);
  const rawProgress = Number(data.progress);
  const progress = Number.isFinite(rawProgress)
    ? Math.max(0, Math.min(1, rawProgress))
    : completed
    ? 1
    : 0;
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
    state,
  };
};

const deriveOnboardingStateFromPreferences = (
  preferences: PreferenceContext,
): OnboardingState => {
  const missingTopics: string[] = [];

  const hasSkill = preferences.skill_level.trim().length > 0;
  const hasEquipment = preferences.equipment.length > 0;
  const hasDietary = preferences.dietary_preferences.length > 0 ||
    preferences.dietary_restrictions.length > 0;
  const presentationPreferenceCount =
    Object.keys(preferences.presentation_preferences ?? {}).filter(
      (key) => key !== "onboarding_state",
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

  const progress = Math.max(
    0,
    Math.min(
      1,
      (onboardingTopicKeys.length - missingTopics.length) /
        onboardingTopicKeys.length,
    ),
  );

  return {
    completed: missingTopics.length === 0,
    progress,
    missing_topics: missingTopics,
    state: {},
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
  },
): Promise<void> => {
  const { error } = await client.from("users").upsert({
    id: params.userId,
    email: params.email ?? null,
    full_name: params.fullName ?? null,
    avatar_url: params.avatarUrl ?? null,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    throw new ApiError(
      500,
      "user_profile_upsert_failed",
      "Could not ensure user profile",
      error.message,
    );
  }
};

const getPreferences = async (
  client: SupabaseClient,
  userId: string,
): Promise<PreferenceContext> => {
  const { data, error } = await client.from("preferences").select("*").eq(
    "user_id",
    userId,
  ).maybeSingle();
  if (error) {
    throw new ApiError(
      500,
      "preferences_fetch_failed",
      "Could not load preferences",
      error.message,
    );
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
    presentation_preferences: data.presentation_preferences &&
        typeof data.presentation_preferences === "object" &&
        !Array.isArray(data.presentation_preferences)
      ? (data.presentation_preferences as Record<string, JsonValue>)
      : {},
  };
};

const normalizePreferenceStringArray = (
  value: unknown,
): string[] | undefined => {
  if (typeof value !== "string" && !Array.isArray(value) && value !== null) {
    return undefined;
  }

  const rawValues: string[] = value === null
    ? []
    : typeof value === "string"
    ? [value]
    : value.filter((item): item is string => typeof item === "string");

  const entries = rawValues
    .map((raw) => raw.trim())
    .filter((raw) => raw.length > 0);
  const seen = new Set<string>();
  const uniqueEntries: string[] = [];
  for (const entry of entries) {
    const key = entry.toLocaleLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueEntries.push(entry);
  }

  return uniqueEntries.slice(0, 32);
};

const normalizePreferencePatch = (
  candidate: unknown,
): Partial<PreferenceContext> | null => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const patchObject = candidate as Record<string, unknown>;
  const patch: Partial<PreferenceContext> = {};

  if (typeof patchObject.free_form === "string") {
    const freeForm = patchObject.free_form.trim();
    patch.free_form = freeForm.length > 0 ? freeForm : null;
  } else if (patchObject.free_form === null) {
    patch.free_form = null;
  }

  const dietaryPreferences = normalizePreferenceStringArray(
    patchObject.dietary_preferences,
  );
  if (dietaryPreferences) {
    patch.dietary_preferences = dietaryPreferences;
  }

  const dietaryRestrictions = normalizePreferenceStringArray(
    patchObject.dietary_restrictions,
  );
  if (dietaryRestrictions) {
    patch.dietary_restrictions = dietaryRestrictions;
  }

  if (
    typeof patchObject.skill_level === "string" &&
    patchObject.skill_level.trim().length > 0
  ) {
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
    const cookingFor = patchObject.cooking_for.trim();
    patch.cooking_for = cookingFor.length > 0 ? cookingFor : null;
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
    patch.presentation_preferences = patchObject
      .presentation_preferences as Record<string, JsonValue>;
  }

  return Object.keys(patch).length > 0 ? patch : null;
};

const preferenceListFieldLabels: Record<
  | "dietary_preferences"
  | "dietary_restrictions"
  | "equipment"
  | "cuisines"
  | "aversions",
  string
> = {
  dietary_preferences: "dietary preferences",
  dietary_restrictions: "dietary restrictions",
  equipment: "special equipment",
  cuisines: "cuisines",
  aversions: "ingredients to avoid",
};

const normalizePreferencePatchWithLlm = async (params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  patch: Partial<PreferenceContext>;
}): Promise<Partial<PreferenceContext>> => {
  const nextPatch: Partial<PreferenceContext> = { ...params.patch };

  const listFields = Object.keys(preferenceListFieldLabels) as Array<
    keyof typeof preferenceListFieldLabels
  >;
  await Promise.all(
    listFields.map(async (field) => {
      const candidate = params.patch[field];
      if (!Array.isArray(candidate)) {
        return;
      }

      const normalized = await llmGateway.normalizePreferenceList({
        client: params.client,
        userId: params.userId,
        requestId: params.requestId,
        field: preferenceListFieldLabels[field],
        entries: candidate,
      });
      nextPatch[field] = normalized;
    }),
  );

  return nextPatch;
};

const applyModelPreferenceUpdates = async (params: {
  client: SupabaseClient;
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  currentPreferences: PreferenceContext;
  preferenceUpdates: unknown;
  latestUserMessage: string;
  userMessages?: string[];
}): Promise<PreferenceContext> => {
  const patch = normalizePreferencePatch(params.preferenceUpdates);
  if (!patch) {
    return params.currentPreferences;
  }

  const safePatch = normalizePreferencePatchDeterministic(
    sanitizeModelPreferencePatch(patch),
  );

  if (Object.keys(safePatch).length === 0) {
    return params.currentPreferences;
  }

  const nextPreferences: PreferenceContext = {
    ...params.currentPreferences,
    ...safePatch,
  };

  const { data, error } = await params.client
    .from("preferences")
    .upsert({
      user_id: params.userId,
      ...nextPreferences,
      updated_at: new Date().toISOString(),
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
    presentation_preferences: data.presentation_preferences &&
        typeof data.presentation_preferences === "object" &&
        !Array.isArray(data.presentation_preferences)
      ? (data.presentation_preferences as Record<string, JsonValue>)
      : {},
  };

  await logChangelog({
    serviceClient: params.serviceClient,
    actorUserId: params.userId,
    scope: "preferences",
    entityType: "preferences",
    entityId: params.userId,
    action: "assistant_updated",
    requestId: params.requestId,
    afterJson: persistedPreferences,
  });

  return persistedPreferences;
};

const getMemorySnapshot = async (
  client: SupabaseClient,
  userId: string,
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
    throw new ApiError(
      500,
      "memory_snapshot_fetch_failed",
      "Could not load memory snapshot",
      error.message,
    );
  }

  if (
    !data || !data.summary || typeof data.summary !== "object" ||
    Array.isArray(data.summary)
  ) {
    return {};
  }

  return data.summary as Record<string, JsonValue>;
};

const getActiveMemories = async (
  client: SupabaseClient,
  userId: string,
  limit: number,
): Promise<MemoryRecord[]> => {
  const preferred = await client
    .from("memories")
    .select(
      "id,memory_type,memory_kind,memory_content,confidence,salience,status,source,created_at,updated_at",
    )
    .eq("user_id", userId)
    .eq("status", "active")
    .order("salience", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (preferred.error) {
    if (!isSchemaMissingError(preferred.error)) {
      throw new ApiError(
        500,
        "memory_fetch_failed",
        "Could not load user memories",
        preferred.error.message,
      );
    }

    const legacy = await client
      .from("memories")
      .select(
        "id,memory_type,memory_content,confidence,source,created_at,updated_at",
      )
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (legacy.error) {
      if (isSchemaMissingError(legacy.error)) {
        return [];
      }
      throw new ApiError(
        500,
        "memory_fetch_failed",
        "Could not load user memories",
        legacy.error.message,
      );
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
      updated_at: row.updated_at,
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
    p_metadata: params.metadata ?? {},
  });

  if (error) {
    console.error("changelog_log_failed", error);
  }
};

const enqueueImageJob = async (
  client: SupabaseClient,
  recipeId: string,
  errorMessage?: string,
): Promise<void> => {
  const { error } = await client.from("recipe_image_jobs").upsert(
    {
      recipe_id: recipeId,
      status: "pending",
      next_attempt_at: new Date().toISOString(),
      last_error: errorMessage ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "recipe_id" },
  );

  if (error) {
    console.error("recipe_image_job_enqueue_failed", error);
  }
};

const resolveRelationTypeId = async (
  client: SupabaseClient,
  name: string,
): Promise<string> => {
  const normalizedName = name.trim().toLowerCase();

  const { data: existing, error: existingError } = await client
    .from("graph_relation_types")
    .select("id")
    .eq("name", normalizedName)
    .maybeSingle();

  if (existingError) {
    throw new ApiError(
      500,
      "relation_type_lookup_failed",
      "Could not lookup relation type",
      existingError.message,
    );
  }

  if (existing?.id) {
    return existing.id;
  }

  const { data: inserted, error: insertError } = await client
    .from("graph_relation_types")
    .insert({
      name: normalizedName,
      description: `Attached recipe relation: ${normalizedName}`,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    throw new ApiError(
      500,
      "relation_type_create_failed",
      "Could not create relation type",
      insertError?.message,
    );
  }

  return inserted.id;
};

type RecipeViewOptions = {
  units: UnitPreference;
  groupBy: GroupByPreference;
  inlineMeasurements: boolean;
};

type CanonicalRecipeIngredientRow = {
  id: string;
  position: number;
  ingredient_id: string | null;
  source_name: string;
  source_amount: number | null;
  source_unit: string | null;
  normalized_amount_si: number | null;
  normalized_unit: string | null;
  unit_kind: UnitKind;
  normalized_status: NormalizedStatus;
  category: string | null;
  component: string | null;
  metadata: Record<string, JsonValue>;
};

const defaultRecipeViewOptions: RecipeViewOptions = {
  units: "source",
  groupBy: "flat",
  inlineMeasurements: false,
};

const toFiniteNumberOrNull = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const listifyText = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

const ENRICHMENT_PERSIST_CONFIDENCE = 0.85;
const ENRICHMENT_TRACK_CONFIDENCE = 0.65;

const clampConfidence = (value: unknown, fallback = 0.5): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, numeric));
};

const shouldPersistEnrichment = (confidence: unknown): boolean =>
  clampConfidence(confidence, 0) >= ENRICHMENT_PERSIST_CONFIDENCE;

const listifyMaybeText = (value: unknown): string[] => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }
  return listifyText(value);
};

const normalizeTermKey = (value: string): string =>
  value
    .trim()
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s:_-]/g, " ")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "");

const fetchCanonicalIngredientRows = async (
  client: SupabaseClient,
  recipeVersionId: string,
): Promise<CanonicalRecipeIngredientRow[]> => {
  const rowsResult = await client
    .from("recipe_ingredients")
    .select(
      "id,position,ingredient_id,source_name,source_amount,source_unit,normalized_amount_si,normalized_unit,unit_kind,normalized_status,category,component,metadata",
    )
    .eq("recipe_version_id", recipeVersionId)
    .order("position", { ascending: true });

  if (rowsResult.error) {
    if (
      isSchemaMissingError(rowsResult.error) || isRlsError(rowsResult.error)
    ) {
      return [];
    }

    throw new ApiError(
      500,
      "recipe_ingredients_fetch_failed",
      "Could not fetch canonical recipe ingredients",
      rowsResult.error.message,
    );
  }

  return (rowsResult.data ?? []).map((row) => ({
    id: String(row.id ?? ""),
    position: Number(row.position ?? 0),
    ingredient_id: row.ingredient_id ?? null,
    source_name: String(row.source_name ?? ""),
    source_amount: toFiniteNumberOrNull(row.source_amount),
    source_unit: row.source_unit ? String(row.source_unit) : null,
    normalized_amount_si: toFiniteNumberOrNull(row.normalized_amount_si),
    normalized_unit: row.normalized_unit ? String(row.normalized_unit) : null,
    unit_kind: row.unit_kind === "mass" || row.unit_kind === "volume" ||
        row.unit_kind === "count" || row.unit_kind === "unknown"
      ? row.unit_kind
      : "unknown",
    normalized_status: row.normalized_status === "normalized"
      ? "normalized"
      : "needs_retry",
    category: row.category ? String(row.category) : null,
    component: row.component ? String(row.component) : null,
    metadata: row.metadata && typeof row.metadata === "object" &&
        !Array.isArray(row.metadata)
      ? row.metadata as Record<string, JsonValue>
      : {},
  }));
};

const loadIngredientNameById = async (
  client: SupabaseClient,
  ingredientIds: string[],
): Promise<Map<string, string>> => {
  if (ingredientIds.length === 0) {
    return new Map();
  }

  const { data, error } = await client.from("ingredients").select(
    "id,canonical_name",
  ).in("id", ingredientIds);
  if (error) {
    if (isSchemaMissingError(error) || isRlsError(error)) {
      return new Map();
    }
    throw new ApiError(
      500,
      "ingredients_fetch_failed",
      "Could not fetch canonical ingredients",
      error.message,
    );
  }

  return new Map((data ?? []).map((row) => [row.id, row.canonical_name]));
};

const loadIngredientIdsByAliasKey = async (
  client: SupabaseClient,
  aliasKeys: string[],
): Promise<Map<string, string>> => {
  if (aliasKeys.length === 0) {
    return new Map();
  }

  const { data, error } = await client.from("ingredient_aliases").select(
    "alias_key,ingredient_id",
  ).in("alias_key", aliasKeys);
  if (error) {
    if (isSchemaMissingError(error) || isRlsError(error)) {
      return new Map();
    }
    throw new ApiError(
      500,
      "ingredient_aliases_fetch_failed",
      "Could not fetch ingredient aliases",
      error.message,
    );
  }

  return new Map(
    (data ?? [])
      .filter((row): row is { alias_key: string; ingredient_id: string } =>
        typeof row.alias_key === "string" &&
        typeof row.ingredient_id === "string" &&
        row.alias_key.length > 0 &&
        row.ingredient_id.length > 0
      )
      .map((row) => [row.alias_key, row.ingredient_id]),
  );
};

const loadIngredientsByNormalizedKey = async (
  client: SupabaseClient,
  normalizedKeys: string[],
): Promise<Map<string, { id: string; canonical_name: string }>> => {
  if (normalizedKeys.length === 0) {
    return new Map();
  }

  const { data, error } = await client.from("ingredients").select(
    "id,normalized_key,canonical_name",
  ).in("normalized_key", normalizedKeys);
  if (error) {
    throw new ApiError(
      500,
      "ingredients_fetch_by_key_failed",
      "Could not fetch canonical ingredients by key",
      error.message,
    );
  }

  return new Map(
    (data ?? [])
      .filter((row): row is {
        id: string;
        normalized_key: string;
        canonical_name: string;
      } =>
        typeof row.id === "string" &&
        typeof row.normalized_key === "string" &&
        typeof row.canonical_name === "string" &&
        row.id.length > 0 &&
        row.normalized_key.length > 0
      )
      .map((row) => [
        row.normalized_key,
        { id: row.id, canonical_name: row.canonical_name },
      ]),
  );
};

const resolveAliasCanonicalIdentity = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  unresolvedAliases: Array<{
    alias_key: string;
    source_name: string;
    fallback_canonical_name: string;
  }>;
}): Promise<Map<string, {
  canonical_key: string;
  canonical_name: string;
  confidence: number;
}>> => {
  if (params.unresolvedAliases.length === 0) {
    return new Map();
  }

  const suggested = await llmGateway.normalizeIngredientAliases({
    client: params.serviceClient,
    userId: params.userId,
    requestId: params.requestId,
    aliases: params.unresolvedAliases.map((alias) => ({
      alias_key: alias.alias_key,
      source_name: alias.source_name,
      fallback_canonical_name: alias.fallback_canonical_name,
    })),
  });
  const suggestedByAlias = new Map(
    suggested.map((entry) => [entry.alias_key, entry]),
  );

  const resolved = new Map<string, {
    canonical_key: string;
    canonical_name: string;
    confidence: number;
  }>();
  for (const alias of params.unresolvedAliases) {
    const suggestion = suggestedByAlias.get(alias.alias_key);
    const identity = deriveCanonicalIngredientIdentity(
      suggestion?.canonical_name ?? alias.fallback_canonical_name,
      alias.source_name,
    );
    if (!identity.canonicalKey) {
      continue;
    }

    resolved.set(alias.alias_key, {
      canonical_key: identity.canonicalKey,
      canonical_name: identity.canonicalName,
      confidence: Number.isFinite(Number(suggestion?.confidence))
        ? Math.max(0, Math.min(1, Number(suggestion?.confidence)))
        : 0.8,
    });
  }

  return resolved;
};

const persistCanonicalRecipeIngredients = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  recipeVersionId: string;
  recipe: RecipePayload;
}): Promise<void> => {
  const canonicalRows = canonicalizeIngredients(params.recipe.ingredients);
  if (canonicalRows.length === 0) {
    return;
  }

  const keySet = Array.from(
    new Set(
      canonicalRows.map((row) => row.normalized_key).filter((key) =>
        key.length > 0
      ),
    ),
  );

  if (keySet.length === 0) {
    return;
  }

  const ingredientIdByAliasKey = await loadIngredientIdsByAliasKey(
    params.serviceClient,
    keySet,
  );

  const { error: clearError } = await params.serviceClient
    .from("recipe_ingredients")
    .delete()
    .eq("recipe_version_id", params.recipeVersionId);
  if (clearError) {
    throw new ApiError(
      500,
      "recipe_ingredients_clear_failed",
      "Could not clear recipe ingredients",
      clearError.message,
    );
  }

  const rowsToInsert = canonicalRows.map((row) => ({
    recipe_version_id: params.recipeVersionId,
    ingredient_id: ingredientIdByAliasKey.get(row.normalized_key) ?? null,
    source_name: row.source_name,
    source_amount: row.source_amount,
    source_unit: row.source_unit,
    normalized_amount_si: row.normalized_amount_si,
    normalized_unit: row.normalized_unit,
    unit_kind: row.unit_kind,
    normalized_status:
      row.normalized_status === "normalized" &&
        ingredientIdByAliasKey.has(row.normalized_key)
        ? "normalized"
        : "needs_retry",
    category: row.category,
    component: row.component,
    position: row.position,
    metadata: {
      preparation: row.preparation ?? null,
      alias_key: row.normalized_key,
      needs_ingredient_resolution: !ingredientIdByAliasKey.has(row.normalized_key),
    },
  }));

  const { error: insertError } = await params.serviceClient.from(
    "recipe_ingredients",
  ).insert(rowsToInsert);
  if (insertError) {
    throw new ApiError(
      500,
      "recipe_ingredients_insert_failed",
      "Could not persist recipe ingredients",
      insertError.message,
    );
  }
};

const enqueueRecipeMetadataJob = async (params: {
  serviceClient: SupabaseClient;
  recipeId: string;
  recipeVersionId: string;
}): Promise<void> => {
  const { error } = await params.serviceClient.from("recipe_metadata_jobs")
    .upsert(
      {
        recipe_id: params.recipeId,
        recipe_version_id: params.recipeVersionId,
        status: "pending",
        attempts: 0,
        max_attempts: 5,
        next_attempt_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
        last_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "recipe_version_id" },
    );

  if (error) {
    throw new ApiError(
      500,
      "recipe_metadata_enqueue_failed",
      "Could not enqueue metadata job",
      error.message,
    );
  }
};

const ensureGraphRelationTypes = async (
  client: SupabaseClient,
  relationNames: string[],
): Promise<Map<string, string>> => {
  const normalizedNames = relationNames.map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 0);
  if (normalizedNames.length === 0) {
    return new Map();
  }

  const uniqueNames = Array.from(new Set(normalizedNames));
  const insertPayload = uniqueNames.map((name) => ({
    name,
    description: `Graph relation: ${name}`,
  }));

  const { error: upsertError } = await client.from("graph_relation_types")
    .upsert(insertPayload, { onConflict: "name" });
  if (upsertError) {
    throw new ApiError(
      500,
      "metadata_relation_type_upsert_failed",
      "Could not upsert graph relation types",
      upsertError.message,
    );
  }

  const { data, error } = await client.from("graph_relation_types").select(
    "id,name",
  ).in("name", uniqueNames);
  if (error) {
    throw new ApiError(
      500,
      "metadata_relation_type_fetch_failed",
      "Could not fetch graph relation types",
      error.message,
    );
  }

  return new Map((data ?? []).map((row) => [row.name, row.id]));
};

const upsertMetadataGraph = async (params: {
  serviceClient: SupabaseClient;
  recipeId: string;
  recipeVersionId: string;
  payload: RecipePayload;
  canonicalRows: CanonicalRecipeIngredientRow[];
  canonicalIngredientNameById: Map<string, string>;
}): Promise<void> => {
  const recipeLabel = params.payload.title.trim();
  if (!recipeLabel) {
    return;
  }

  const ingredientNames = params.canonicalRows
    .map((row) => {
      if (row.ingredient_id) {
        return params.canonicalIngredientNameById.get(row.ingredient_id) ??
          row.source_name;
      }
      return row.source_name;
    })
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

  const categoryNames = Array.from(
    new Set(
      [
        ...params.canonicalRows.map((row) => row.category).filter((
          value,
        ): value is string => Boolean(value)),
        ...listifyText(params.payload.metadata?.cuisine_tags),
        ...listifyText(params.payload.metadata?.occasion_tags),
      ]
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );

  const keywordNames = Array.from(
    new Set(
      [
        ...listifyText(params.payload.metadata?.flavor_profile),
        ...listifyText(params.payload.pairings),
        ...listifyText(params.payload.metadata?.pairing_rationale),
      ]
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );

  const entityPayload: Array<
    { entity_type: string; label: string; metadata: Record<string, JsonValue> }
  > = [
    {
      entity_type: "recipe",
      label: recipeLabel,
      metadata: {
        recipe_id: params.recipeId,
      },
    },
    ...ingredientNames.map((label) => ({
      entity_type: "ingredient",
      label,
      metadata: {},
    })),
    ...categoryNames.map((label) => ({
      entity_type: "category",
      label,
      metadata: {},
    })),
    ...keywordNames.map((label) => ({
      entity_type: "keyword",
      label,
      metadata: {},
    })),
  ];

  const uniqueEntityPayload = Array.from(
    new Map(
      entityPayload.map((
        entity,
      ) => [`${entity.entity_type}:${entity.label.toLowerCase()}`, entity]),
    ).values(),
  );

  const { data: entities, error: entityError } = await params.serviceClient
    .from("graph_entities")
    .upsert(uniqueEntityPayload, { onConflict: "entity_type,label" })
    .select("id,entity_type,label");

  if (entityError || !entities) {
    throw new ApiError(
      500,
      "metadata_entity_upsert_failed",
      "Could not upsert graph entities",
      entityError?.message,
    );
  }

  const entityByKey = new Map(
    entities.map((
      entity,
    ) => [`${entity.entity_type}:${entity.label.toLowerCase()}`, entity.id]),
  );
  const recipeEntityId = entityByKey.get(`recipe:${recipeLabel.toLowerCase()}`);
  if (!recipeEntityId) {
    return;
  }

  const linkPayload = entities.map((entity) => ({
    recipe_version_id: params.recipeVersionId,
    entity_id: entity.id,
  }));
  const { error: linkError } = await params.serviceClient.from(
    "recipe_graph_links",
  ).upsert(linkPayload, {
    onConflict: "recipe_version_id,entity_id",
  });
  if (linkError) {
    throw new ApiError(
      500,
      "metadata_graph_link_failed",
      "Could not upsert recipe graph links",
      linkError.message,
    );
  }

  const relationTypeByName = await ensureGraphRelationTypes(
    params.serviceClient,
    [
      "contains_ingredient",
      "has_category",
      "has_keyword",
    ],
  );

  const containsIngredientRelation = relationTypeByName.get(
    "contains_ingredient",
  );
  const hasCategoryRelation = relationTypeByName.get("has_category");
  const hasKeywordRelation = relationTypeByName.get("has_keyword");

  const edgePayload: Array<{
    from_entity_id: string;
    to_entity_id: string;
    relation_type_id: string;
    source: string;
    confidence: number;
    metadata: Record<string, JsonValue>;
  }> = [];

  if (containsIngredientRelation) {
    for (const ingredientName of ingredientNames) {
      const entityId = entityByKey.get(
        `ingredient:${ingredientName.toLowerCase()}`,
      );
      if (!entityId) {
        continue;
      }

      edgePayload.push({
        from_entity_id: recipeEntityId,
        to_entity_id: entityId,
        relation_type_id: containsIngredientRelation,
        source: "metadata_job",
        confidence: 1,
        metadata: {},
      });
    }
  }

  if (hasCategoryRelation) {
    for (const categoryName of categoryNames) {
      const entityId = entityByKey.get(
        `category:${categoryName.toLowerCase()}`,
      );
      if (!entityId) {
        continue;
      }
      edgePayload.push({
        from_entity_id: recipeEntityId,
        to_entity_id: entityId,
        relation_type_id: hasCategoryRelation,
        source: "metadata_job",
        confidence: 0.85,
        metadata: {},
      });
    }
  }

  if (hasKeywordRelation) {
    for (const keywordName of keywordNames) {
      const entityId = entityByKey.get(`keyword:${keywordName.toLowerCase()}`);
      if (!entityId) {
        continue;
      }
      edgePayload.push({
        from_entity_id: recipeEntityId,
        to_entity_id: entityId,
        relation_type_id: hasKeywordRelation,
        source: "metadata_job",
        confidence: 0.8,
        metadata: {},
      });
    }
  }

  if (edgePayload.length === 0) {
    return;
  }

  const { error: edgeError } = await params.serviceClient.from("graph_edges")
    .upsert(edgePayload, {
      onConflict: "from_entity_id,to_entity_id,relation_type_id,source",
    });

  if (edgeError) {
    throw new ApiError(
      500,
      "metadata_graph_edge_upsert_failed",
      "Could not upsert graph edges",
      edgeError.message,
    );
  }
};

const processMetadataJobs = async (params: {
  serviceClient: SupabaseClient;
  actorUserId: string;
  requestId: string;
  limit: number;
}): Promise<{
  reaped: number;
  claimed: number;
  processed: number;
  ready: number;
  failed: number;
  pending: number;
  queue: {
    pending: number;
    processing: number;
    ready: number;
    failed: number;
  };
}> => {
  const now = new Date();
  const staleThreshold = new Date(now.getTime() - 10 * 60 * 1000).toISOString();

  const { data: staleJobs, error: staleJobsError } = await params.serviceClient
    .from("recipe_metadata_jobs")
    .select("id")
    .eq("status", "processing")
    .lt("locked_at", staleThreshold);

  if (staleJobsError && !isSchemaMissingError(staleJobsError)) {
    throw new ApiError(
      500,
      "metadata_jobs_stale_fetch_failed",
      "Could not fetch stale metadata jobs",
      staleJobsError.message,
    );
  }

  const staleIds = (staleJobs ?? []).map((job) => job.id);
  let reaped = 0;
  if (staleIds.length > 0) {
    const { error: reapError } = await params.serviceClient
      .from("recipe_metadata_jobs")
      .update({
        status: "pending",
        locked_at: null,
        locked_by: null,
        next_attempt_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .in("id", staleIds);

    if (reapError) {
      throw new ApiError(
        500,
        "metadata_jobs_reap_failed",
        "Could not reap stale metadata locks",
        reapError.message,
      );
    }
    reaped = staleIds.length;
  }

  if (params.limit <= 0) {
    const { data: queueRows } = await params.serviceClient.from(
      "recipe_metadata_jobs",
    ).select("status");
    const queue = {
      pending: (queueRows ?? []).filter((row) =>
        row.status === "pending"
      ).length,
      processing: (queueRows ?? []).filter((row) =>
        row.status === "processing"
      ).length,
      ready: (queueRows ?? []).filter((row) => row.status === "ready").length,
      failed: (queueRows ?? []).filter((row) => row.status === "failed").length,
    };
    return {
      reaped,
      claimed: 0,
      processed: 0,
      ready: 0,
      failed: 0,
      pending: 0,
      queue,
    };
  }

  const { data: dueJobs, error: dueJobsError } = await params.serviceClient
    .from("recipe_metadata_jobs")
    .select(
      "id,recipe_id,recipe_version_id,status,attempts,max_attempts,next_attempt_at",
    )
    .in("status", ["pending", "failed"])
    .lte("next_attempt_at", now.toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(params.limit);

  if (dueJobsError) {
    if (isSchemaMissingError(dueJobsError)) {
      return {
        reaped,
        claimed: 0,
        processed: 0,
        ready: 0,
        failed: 0,
        pending: 0,
        queue: { pending: 0, processing: 0, ready: 0, failed: 0 },
      };
    }
    throw new ApiError(
      500,
      "metadata_jobs_due_fetch_failed",
      "Could not fetch due metadata jobs",
      dueJobsError.message,
    );
  }

  const jobs = dueJobs ?? [];
  let claimed = 0;
  let processed = 0;
  let ready = 0;
  let failed = 0;
  let pending = 0;

  for (const job of jobs) {
    const nextAttempt = Number(job.attempts ?? 0) + 1;
    const lockResult = await params.serviceClient
      .from("recipe_metadata_jobs")
      .update({
        status: "processing",
        attempts: nextAttempt,
        locked_at: now.toISOString(),
        locked_by: "v1_metadata_jobs_process",
        updated_at: now.toISOString(),
      })
      .eq("id", job.id)
      .eq("status", job.status)
      .select("id")
      .maybeSingle();

    if (lockResult.error) {
      throw new ApiError(
        500,
        "metadata_job_lock_failed",
        "Could not claim metadata job",
        lockResult.error.message,
      );
    }
    if (!lockResult.data) {
      continue;
    }
    claimed += 1;

    try {
      const { data: version, error: versionError } = await params.serviceClient
        .from("recipe_versions")
        .select("id,payload")
        .eq("id", job.recipe_version_id)
        .maybeSingle();

      if (versionError || !version?.payload) {
        throw new Error("recipe_version_payload_missing");
      }

      const payload = version.payload as RecipePayload;
      const canonicalRows = await fetchCanonicalIngredientRows(
        params.serviceClient,
        job.recipe_version_id,
      );
      const ingredientIds = Array.from(
        new Set(
          canonicalRows.map((row) => row.ingredient_id).filter((
            id,
          ): id is string => Boolean(id)),
        ),
      );
      const canonicalIngredientNameById = await loadIngredientNameById(
        params.serviceClient,
        ingredientIds,
      );
      const categories = Array.from(
        new Set(
          [
            ...canonicalRows.map((row) => row.category).filter((
              value,
            ): value is string => Boolean(value)),
            ...listifyText(payload.metadata?.cuisine_tags),
            ...listifyText(payload.metadata?.occasion_tags),
          ]
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
        ),
      );
      const keywords = Array.from(
        new Set(
          [
            ...listifyText(payload.metadata?.flavor_profile),
            ...listifyText(payload.pairings),
            ...listifyText(payload.metadata?.pairing_rationale),
          ]
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
        ),
      );

      await upsertMetadataGraph({
        serviceClient: params.serviceClient,
        recipeId: job.recipe_id,
        recipeVersionId: job.recipe_version_id,
        payload,
        canonicalRows,
        canonicalIngredientNameById,
      });

      const { error: readyError } = await params.serviceClient
        .from("recipe_metadata_jobs")
        .update({
          status: "ready",
          locked_at: null,
          locked_by: null,
          last_error: null,
          metadata: {
            categories,
            keywords,
            nutrition: payload.metadata?.nutrition ?? null,
            processed_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      if (readyError) {
        throw new Error(readyError.message);
      }

      await logChangelog({
        serviceClient: params.serviceClient,
        actorUserId: params.actorUserId,
        scope: "metadata",
        entityType: "metadata_job",
        entityId: job.id,
        action: "ready",
        requestId: params.requestId,
        afterJson: {
          recipe_id: job.recipe_id,
          recipe_version_id: job.recipe_version_id,
        },
      });

      processed += 1;
      ready += 1;
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "metadata_job_failed";
      const maxAttempts = Number(job.max_attempts ?? 5);
      const terminal = nextAttempt >= maxAttempts;
      const baseDelayMs = Math.min(
        60 * 60 * 1000,
        1000 * (2 ** Math.max(0, nextAttempt - 1)),
      );
      const jitterMs = Math.floor(Math.random() * 2000);
      const nextAttemptAt = new Date(Date.now() + baseDelayMs + jitterMs)
        .toISOString();

      const { error: failureUpdateError } = await params.serviceClient
        .from("recipe_metadata_jobs")
        .update({
          status: terminal ? "failed" : "pending",
          next_attempt_at: terminal ? now.toISOString() : nextAttemptAt,
          locked_at: null,
          locked_by: null,
          last_error: message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      if (failureUpdateError) {
        throw new ApiError(
          500,
          "metadata_job_failure_update_failed",
          "Could not update metadata job failure",
          failureUpdateError.message,
        );
      }

      await logChangelog({
        serviceClient: params.serviceClient,
        actorUserId: params.actorUserId,
        scope: "metadata",
        entityType: "metadata_job",
        entityId: job.id,
        action: terminal ? "failed" : "retry_scheduled",
        requestId: params.requestId,
        afterJson: {
          attempt: nextAttempt,
          max_attempts: maxAttempts,
          terminal,
          error: message,
        },
      });

      processed += 1;
      if (terminal) {
        failed += 1;
      } else {
        pending += 1;
      }
    }
  }

  const { data: queueRows } = await params.serviceClient.from(
    "recipe_metadata_jobs",
  ).select("status");
  const queue = {
    pending: (queueRows ?? []).filter((row) => row.status === "pending").length,
    processing:
      (queueRows ?? []).filter((row) => row.status === "processing").length,
    ready: (queueRows ?? []).filter((row) => row.status === "ready").length,
    failed: (queueRows ?? []).filter((row) => row.status === "failed").length,
  };

  return { reaped, claimed, processed, ready, failed, pending, queue };
};

const fetchRecipeView = async (
  client: SupabaseClient,
  recipeId: string,
  includeAttachments = true,
  options: RecipeViewOptions = defaultRecipeViewOptions,
): Promise<RecipeView> => {
  const { data: recipe, error: recipeError } = await client
    .from("recipes")
    .select(
      "id,title,hero_image_url,image_status,visibility,updated_at,current_version_id",
    )
    .eq("id", recipeId)
    .maybeSingle();

  if (recipeError) {
    throw new ApiError(
      500,
      "recipe_fetch_failed",
      "Could not fetch recipe",
      recipeError.message,
    );
  }

  if (!recipe) {
    throw new ApiError(404, "recipe_not_found", "Recipe not found");
  }

  if (!recipe.current_version_id) {
    throw new ApiError(
      500,
      "recipe_version_missing",
      "Recipe does not have a current version",
    );
  }

  const { data: version, error: versionError } = await client
    .from("recipe_versions")
    .select("id,payload,created_at,parent_version_id,diff_summary")
    .eq("id", recipe.current_version_id)
    .maybeSingle();

  if (versionError || !version) {
    throw new ApiError(
      500,
      "recipe_version_fetch_failed",
      "Could not fetch recipe version",
      versionError?.message,
    );
  }

  const payload = version.payload as RecipePayload;
  const canonicalRows = await fetchCanonicalIngredientRows(client, version.id);
  const projectedIngredients = projectIngredientsForOutput({
    sourceIngredients: payload.ingredients,
    canonicalRows,
    units: options.units,
  });
  const ingredientGroups = buildIngredientGroups({
    ingredients: projectedIngredients,
    groupBy: options.groupBy,
  });

  const projectedSteps = projectInlineMeasurements({
    steps: payload.steps,
    units: options.units,
    includeInlineMeasurements: options.inlineMeasurements,
  });

  let attachments: RecipeAttachmentView[] = [];
  if (includeAttachments) {
    const linksResult = await client
      .from("recipe_links")
      .select("id,child_recipe_id,relation_type_id,position")
      .eq("parent_recipe_id", recipe.id)
      .order("position", { ascending: true });

    const links = linksResult.data ?? [];
    if (linksResult.error) {
      throw new ApiError(
        500,
        "recipe_links_fetch_failed",
        "Could not fetch recipe attachments",
        linksResult.error.message,
      );
    }

    const relationTypeIds = Array.from(
      new Set(links.map((link) => link.relation_type_id)),
    );
    let relationById = new Map<string, string>();

    if (relationTypeIds.length > 0) {
      const { data: relationTypes, error: relationError } = await client
        .from("graph_relation_types")
        .select("id,name")
        .in("id", relationTypeIds);

      if (relationError) {
        throw new ApiError(
          500,
          "relation_types_fetch_failed",
          "Could not fetch relation type names",
          relationError.message,
        );
      }

      relationById = new Map(
        (relationTypes ?? []).map((item) => [item.id, item.name]),
      );
    }

    const attachmentItems: RecipeAttachmentView[] = [];
    for (const link of links) {
      const childRecipe = await fetchRecipeView(
        client,
        link.child_recipe_id,
        false,
        options,
      );
      attachmentItems.push({
        attachment_id: link.id,
        relation_type: relationById.get(link.relation_type_id) ?? "attached_to",
        position: link.position,
        recipe: childRecipe,
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
    ingredients: projectedIngredients,
    steps: projectedSteps,
    ingredient_groups: ingredientGroups,
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
      created_at: version.created_at,
    },
    attachments,
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
        updated_at: now,
      })
      .select("id")
      .single();

    let recipe = preferredInsert.data;
    if (preferredInsert.error || !recipe) {
      if (!isSchemaMissingError(preferredInsert.error)) {
        throw new ApiError(
          500,
          "recipe_insert_failed",
          "Could not create recipe",
          preferredInsert.error?.message,
        );
      }

      const legacyInsert = await params.client
        .from("recipes")
        .insert({
          owner_user_id: params.userId,
          title: params.payload.title,
          hero_image_url: params.heroImageUrl,
          visibility: "public",
          source_chat_id: params.sourceChatId,
          updated_at: now,
        })
        .select("id")
        .single();

      if (legacyInsert.error || !legacyInsert.data) {
        throw new ApiError(
          500,
          "recipe_insert_failed",
          "Could not create recipe",
          legacyInsert.error?.message,
        );
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
      created_by: params.userId,
    })
    .select("id")
    .single();

  if (versionError || !version) {
    throw new ApiError(
      500,
      "recipe_version_insert_failed",
      "Could not create recipe version",
      versionError?.message,
    );
  }

  const updatePayload: Record<string, JsonValue> = {
    title: params.payload.title,
    current_version_id: version.id,
    updated_at: now,
    image_updated_at: now,
    image_generation_attempts: params.heroImageUrl ? 1 : 0,
  };

  if (
    typeof params.heroImageUrl === "string" && params.heroImageUrl.length > 0
  ) {
    updatePayload.hero_image_url = params.heroImageUrl;
    updatePayload.image_status = "ready";
    updatePayload.image_last_error = null;
  } else {
    updatePayload.image_status = "pending";
    updatePayload.image_last_error = params.imageError ?? null;
  }

  const { error: updateError } = await params.client.from("recipes").update(
    updatePayload,
  ).eq("id", recipeId);
  if (updateError) {
    if (!isSchemaMissingError(updateError)) {
      throw new ApiError(
        500,
        "recipe_update_failed",
        "Could not update recipe",
        updateError.message,
      );
    }

    const legacyPayload: Record<string, JsonValue> = {
      title: params.payload.title,
      current_version_id: version.id,
      updated_at: now,
    };
    if (
      typeof params.heroImageUrl === "string" && params.heroImageUrl.length > 0
    ) {
      legacyPayload.hero_image_url = params.heroImageUrl;
    }

    const { error: legacyUpdateError } = await params.client
      .from("recipes")
      .update(legacyPayload)
      .eq("id", recipeId);

    if (legacyUpdateError) {
      throw new ApiError(
        500,
        "recipe_update_failed",
        "Could not update recipe",
        legacyUpdateError.message,
      );
    }
  }

  await persistCanonicalRecipeIngredients({
    serviceClient: params.serviceClient,
    userId: params.userId,
    requestId: params.requestId,
    recipeVersionId: version.id,
    recipe: params.payload,
  });

  await enqueueRecipeMetadataJob({
    serviceClient: params.serviceClient,
    recipeId,
    recipeVersionId: version.id,
  });

  // Image jobs are only enqueued when a recipe is explicitly saved to cookbook.
  // Do NOT enqueue here — avoids triggering slow image generation on every chatSession/tweak.

  const { error: versionEventError } = await params.client.from(
    "recipe_version_events",
  ).insert({
    recipe_version_id: version.id,
    event_type: params.parentVersionId ? "recipe_tweak" : "recipe_create",
    request_id: params.requestId,
    metadata: {
      source_chat_id: params.sourceChatId ?? null,
      diff_summary: params.diffSummary ?? null,
      selected_memory_ids: params.selectedMemoryIds ?? [],
    },
  });

  if (versionEventError) {
    console.error("recipe_version_event_failed", versionEventError);
  }

  if ((params.selectedMemoryIds ?? []).length > 0) {
    const records = (params.selectedMemoryIds ?? []).map((memoryId) => ({
      memory_id: memoryId,
      recipe_id: recipeId,
      recipe_version_id: version.id,
      source_event_id: null,
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
      diff_summary: params.diffSummary ?? null,
    },
  });

  return {
    recipeId,
    versionId: version.id,
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
    source: "llm",
  }));

  if (records.length === 0) {
    return;
  }

  const { error } = await params.client.from("recipe_auto_categories").upsert(
    records,
    {
      onConflict: "recipe_id,category",
    },
  );

  if (error) {
    throw new ApiError(
      500,
      "auto_categories_failed",
      "Could not apply recipe auto categories",
      error.message,
    );
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
  const preferencesNaturalLanguage = buildNaturalLanguagePreferenceContext(
    preferences,
  );
  const memorySnapshot = await getMemorySnapshot(
    params.userClient,
    params.userId,
  );
  const memories = await getActiveMemories(
    params.userClient,
    params.userId,
    120,
  );

  if (memories.length === 0) {
    return {
      preferences,
      preferencesNaturalLanguage,
      memorySnapshot,
      selectedMemories: [],
      selectedMemoryIds: [],
    };
  }

  if (params.selectionMode === "fast") {
    const selectedMemories = memories.slice(0, 12);
    return {
      preferences,
      preferencesNaturalLanguage,
      memorySnapshot,
      selectedMemories,
      selectedMemoryIds: selectedMemories.map((memory) => memory.id),
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
        preferences_natural_language: preferencesNaturalLanguage,
        memory_snapshot: memorySnapshot,
        ...params.context,
      },
      memories,
    });
    selectedIds = selection.selected_memory_ids;
  } catch (error) {
    console.error("memory_select_failed", error);
    selectedIds = memories.map((memory) => memory.id).slice(0, 12);
  }

  const selectedSet = new Set(selectedIds);
  const selectedMemories = memories.filter((memory) =>
    selectedSet.has(memory.id)
  );

  return {
    preferences,
    preferencesNaturalLanguage,
    memorySnapshot,
    selectedMemories,
    selectedMemoryIds: selectedMemories.map((memory) => memory.id),
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
        reason: "deferred_memory_processing",
      },
    });
    return;
  }

  const existingMemories = await getActiveMemories(
    params.userClient,
    params.userId,
    200,
  );

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
      context: params.interactionContext,
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
        confidence: Number.isFinite(Number(candidate.confidence))
          ? Number(candidate.confidence)
          : 0.5,
        salience: Number.isFinite(Number(candidate.salience))
          ? Number(candidate.salience)
          : 0.5,
        source: candidate.source ?? "llm_extract",
        status: "active",
      })),
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
            confidence: Number.isFinite(Number(candidate.confidence))
              ? Number(candidate.confidence)
              : 0.5,
            source: candidate.source ?? "llm_extract",
          })),
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
      candidates,
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
          await params.userClient.from("memories").delete().eq(
            "id",
            action.memory_id,
          );
        }
      }

      if (action.action === "supersede") {
        const supersedeUpdate = await params.userClient
          .from("memories")
          .update({
            status: "superseded",
            supersedes_memory_id: action.supersedes_memory_id ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", action.memory_id);

        if (
          supersedeUpdate.error && isSchemaMissingError(supersedeUpdate.error)
        ) {
          // Legacy schema does not support supersession fields.
          continue;
        }
      }

      if (action.action === "merge" && action.merged_content) {
        await params.userClient
          .from("memories")
          .update({
            memory_content: action.merged_content,
            updated_at: new Date().toISOString(),
          })
          .eq("id", action.memory_id);
      }
    }
  } catch (error) {
    console.error("memory_conflict_resolution_failed", error);
  }

  const activeMemories = await getActiveMemories(
    params.userClient,
    params.userId,
    200,
  );
  try {
    const summary = await llmGateway.summarizeMemories({
      client: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      memories: activeMemories,
      context: params.interactionContext,
    });

    const { error: snapshotError } = await params.userClient.from(
      "memory_snapshots",
    ).upsert({
      user_id: params.userId,
      summary: summary.summary,
      token_estimate: summary.token_estimate ?? 0,
      updated_at: new Date().toISOString(),
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
      active_memory_count: activeMemories.length,
    },
  });
};

const enqueueMemoryJob = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  chatId: string;
  messageId: string;
  interactionContext: Record<string, JsonValue>;
}): Promise<void> => {
  const { error } = await params.serviceClient.from("memory_jobs").upsert(
    {
      user_id: params.userId,
      chat_id: params.chatId,
      message_id: params.messageId,
      status: "pending",
      attempts: 0,
      max_attempts: 5,
      next_attempt_at: new Date().toISOString(),
      interaction_context: params.interactionContext,
      locked_at: null,
      locked_by: null,
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "chat_id,message_id" },
  );

  if (error) {
    if (isSchemaMissingError(error)) {
      return;
    }
    throw new ApiError(
      500,
      "memory_job_enqueue_failed",
      "Could not enqueue memory job",
      error.message,
    );
  }
};

const processMemoryJobs = async (params: {
  userClient: SupabaseClient;
  serviceClient: SupabaseClient;
  actorUserId: string;
  requestId: string;
  limit: number;
}): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  queue: { pending: number; processing: number; ready: number; failed: number };
}> => {
  const nowIso = new Date().toISOString();
  const staleCutoffIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const lockOwner = `memory-worker:${crypto.randomUUID()}`;

  const staleResult = await params.serviceClient
    .from("memory_jobs")
    .select("id")
    .eq("status", "processing")
    .lt("locked_at", staleCutoffIso)
    .limit(200);

  if (staleResult.error && !isSchemaMissingError(staleResult.error)) {
    throw new ApiError(
      500,
      "memory_jobs_stale_fetch_failed",
      "Could not fetch stale memory jobs",
      staleResult.error.message,
    );
  }

  if ((staleResult.data ?? []).length > 0) {
    const staleIds = (staleResult.data ?? []).map((row) => row.id);
    const staleUpdate = await params.serviceClient
      .from("memory_jobs")
      .update({
        status: "pending",
        locked_at: null,
        locked_by: null,
        next_attempt_at: nowIso,
        updated_at: nowIso,
      })
      .in("id", staleIds);

    if (staleUpdate.error && !isSchemaMissingError(staleUpdate.error)) {
      throw new ApiError(
        500,
        "memory_jobs_stale_requeue_failed",
        "Could not requeue stale memory jobs",
        staleUpdate.error.message,
      );
    }
  }

  const dueResult = await params.serviceClient
    .from("memory_jobs")
    .select(
      "id,user_id,chat_id,message_id,attempts,max_attempts,interaction_context",
    )
    .in("status", ["pending", "failed"])
    .lte("next_attempt_at", nowIso)
    .order("next_attempt_at", { ascending: true })
    .limit(Math.min(Math.max(params.limit, 1), 100));

  if (dueResult.error) {
    if (isSchemaMissingError(dueResult.error)) {
      return {
        processed: 0,
        succeeded: 0,
        failed: 0,
        queue: { pending: 0, processing: 0, ready: 0, failed: 0 },
      };
    }
    throw new ApiError(
      500,
      "memory_jobs_due_fetch_failed",
      "Could not fetch due memory jobs",
      dueResult.error.message,
    );
  }

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const row of dueResult.data ?? []) {
    const claim = await params.serviceClient
      .from("memory_jobs")
      .update({
        status: "processing",
        locked_at: nowIso,
        locked_by: lockOwner,
        updated_at: nowIso,
      })
      .eq("id", row.id)
      .in("status", ["pending", "failed"])
      .select("id,user_id,interaction_context,attempts,max_attempts")
      .maybeSingle();

    if (claim.error || !claim.data) {
      continue;
    }

    processed += 1;
    try {
      await updateMemoryFromInteraction({
        userClient: params.userClient,
        serviceClient: params.serviceClient,
        userId: claim.data.user_id,
        requestId: params.requestId,
        interactionContext:
          (claim.data.interaction_context as Record<string, JsonValue>) ?? {},
        mode: "full",
      });

      const readyUpdate = await params.serviceClient
        .from("memory_jobs")
        .update({
          status: "ready",
          locked_at: null,
          locked_by: null,
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", claim.data.id);

      if (readyUpdate.error) {
        throw new ApiError(
          500,
          "memory_job_ready_update_failed",
          "Could not update memory job status",
          readyUpdate.error.message,
        );
      }

      succeeded += 1;
    } catch (error) {
      const attempts = Number(claim.data.attempts ?? 0) + 1;
      const maxAttempts = Number(claim.data.max_attempts ?? 5);
      const terminal = attempts >= maxAttempts;
      const baseDelay = Math.min(60, 2 ** Math.min(attempts, 6)) * 1000;
      const jitter = Math.floor(Math.random() * 1000);
      const nextAttemptAt = new Date(Date.now() + baseDelay + jitter)
        .toISOString();

      const failedUpdate = await params.serviceClient
        .from("memory_jobs")
        .update({
          status: terminal ? "failed" : "pending",
          attempts,
          next_attempt_at: terminal ? new Date().toISOString() : nextAttemptAt,
          locked_at: null,
          locked_by: null,
          last_error: error instanceof Error
            ? error.message.slice(0, 2000)
            : String(error).slice(0, 2000),
          updated_at: new Date().toISOString(),
        })
        .eq("id", claim.data.id);

      if (failedUpdate.error) {
        throw new ApiError(
          500,
          "memory_job_failure_update_failed",
          "Could not update memory job failure",
          failedUpdate.error.message,
        );
      }

      failed += 1;
    }
  }

  const queueRows = await params.serviceClient.from("memory_jobs").select(
    "status",
  );
  if (queueRows.error && !isSchemaMissingError(queueRows.error)) {
    throw new ApiError(
      500,
      "memory_jobs_queue_fetch_failed",
      "Could not fetch memory queue summary",
      queueRows.error.message,
    );
  }

  const queue = { pending: 0, processing: 0, ready: 0, failed: 0 };
  for (const row of queueRows.data ?? []) {
    if (row.status === "pending") queue.pending += 1;
    if (row.status === "processing") queue.processing += 1;
    if (row.status === "ready") queue.ready += 1;
    if (row.status === "failed") queue.failed += 1;
  }

  return { processed, succeeded, failed, queue };
};

const deriveAttachmentPayload = (
  recipe: Omit<RecipePayload, "attachments">,
): RecipePayload => {
  return {
    ...recipe,
    attachments: [],
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
    throw new ApiError(
      500,
      "recipe_links_clear_failed",
      "Could not clear existing attachments",
      clearError.message,
    );
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
      selectedMemoryIds: params.contextPack.selectedMemoryIds,
    });

    const relationTypeId = await resolveRelationTypeId(
      params.userClient,
      relationType,
    );

    const { error: linkError } = await params.userClient.from("recipe_links")
      .insert({
        parent_recipe_id: params.parentRecipeId,
        child_recipe_id: childSaved.recipeId,
        relation_type_id: relationTypeId,
        position: index,
        source: "llm",
      });

    if (linkError) {
      throw new ApiError(
        500,
        "recipe_link_insert_failed",
        "Could not create recipe attachment link",
        linkError.message,
      );
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
        position: index,
      },
    });
  }
};

const fetchChatMessages = async (
  client: SupabaseClient,
  chatId: string,
): Promise<ChatMessageView[]> => {
  const { data: messages, error } = await client
    .from("chat_messages")
    .select("id,role,content,metadata,created_at")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new ApiError(
      500,
      "chat_messages_fetch_failed",
      "Could not fetch chat messages",
      error.message,
    );
  }

  return (messages ?? []) as ChatMessageView[];
};

const parseAssistantChatPayload = (
  message: Pick<ChatMessageView, "content">,
): {
  recipe: RecipePayload | null;
  assistantReply: AssistantReply | null;
  candidateSet: CandidateRecipeSet | null;
  responseContext: ChatLoopResponse["response_context"] | null;
} | null => {
  try {
    const parsed = JSON.parse(message.content) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const candidate = parsed as Record<string, unknown>;
    const envelopeRecipe = candidate.recipe as RecipePayload | undefined;

    const recipe = envelopeRecipe && envelopeRecipe.title &&
        Array.isArray(envelopeRecipe.ingredients) &&
        Array.isArray(envelopeRecipe.steps)
      ? envelopeRecipe
      : (() => {
        const directRecipe = parsed as RecipePayload;
        if (
          directRecipe && directRecipe.title &&
          Array.isArray(directRecipe.ingredients) &&
          Array.isArray(directRecipe.steps)
        ) {
          return directRecipe;
        }
        return null;
      })();
    const candidateSet =
      normalizeCandidateRecipeSet(candidate.candidate_recipe_set) ??
        (recipe ? wrapRecipeInCandidateSet(recipe) : null);

    const replyCandidate = candidate.assistant_reply ??
      ((candidate.data as Record<string, unknown> | undefined)
        ?.assistant_reply as unknown) ??
      ((candidate.result as Record<string, unknown> | undefined)
        ?.assistant_reply as unknown);
    const assistantReply = (() => {
      if (
        typeof replyCandidate === "string" && replyCandidate.trim().length > 0
      ) {
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
    const rawResponseContext = candidate.response_context;
    const responseContext = rawResponseContext &&
        typeof rawResponseContext === "object" &&
        !Array.isArray(rawResponseContext)
      ? (() => {
        const raw = rawResponseContext as Record<string, unknown>;
        const intent = typeof raw.intent === "string" &&
            (
              raw.intent === "in_scope_ideation" ||
              raw.intent === "in_scope_generate" ||
              raw.intent === "out_of_scope"
            )
          ? (raw.intent as ChatIntent)
          : undefined;
        return {
          mode: typeof raw.mode === "string" ? raw.mode : undefined,
          intent,
          changed_sections: Array.isArray(raw.changed_sections)
            ? raw.changed_sections.filter((item): item is string =>
              typeof item === "string"
            )
            : undefined,
          personalization_notes: Array.isArray(raw.personalization_notes)
            ? raw.personalization_notes.filter((item): item is string =>
              typeof item === "string"
            )
            : undefined,
          preference_updates: raw.preference_updates &&
              typeof raw.preference_updates === "object" &&
              !Array.isArray(raw.preference_updates)
            ? (raw.preference_updates as Record<string, JsonValue>)
            : undefined,
        };
      })()
      : null;

    if (!recipe && !assistantReply && !candidateSet && !responseContext) {
      return null;
    }

    return {
      recipe,
      assistantReply,
      candidateSet,
      responseContext,
    };
  } catch {
    return null;
  }

  return null;
};

const extractLatestAssistantRecipe = (
  messages: ChatMessageView[],
): RecipePayload | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") {
      continue;
    }

    const parsed = parseAssistantChatPayload(message);
    if (parsed?.recipe) {
      return parsed.recipe;
    }
    if (parsed?.candidateSet?.components?.[0]?.recipe) {
      return parsed.candidateSet.components[0].recipe;
    }
  }

  return null;
};

const extractLatestAssistantReply = (
  messages: ChatMessageView[],
): AssistantReply | null => {
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
    const summaryParts = [
      parsed.recipe.title,
      parsed.recipe.description,
      parsed.recipe.notes,
    ].filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    );
    return summaryParts.join(" — ");
  }

  return message.content;
};

const truncatePromptText = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
};

const normalizeChatIntent = (value: unknown): ChatIntent | null => {
  if (
    value === "in_scope_ideation" || value === "in_scope_generate" ||
    value === "out_of_scope"
  ) {
    return value;
  }
  return null;
};

const getChatIntentFromResponse = (
  response: Awaited<ReturnType<typeof llmGateway.converseChat>>,
): ChatIntent | null =>
  normalizeChatIntent(response.response_context?.intent);

const buildThreadForPrompt = (
  messages: ChatMessageView[],
  maxMessages = 6,
): Array<{ role: string; content: string }> => {
  const scoped = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-maxMessages);

  return scoped.map((message) => ({
    role: message.role,
    content: truncatePromptText(renderChatMessageForPrompt(message), 900),
  }));
};

const buildCompactChatContext = (
  context: ChatSessionContext,
): Record<string, JsonValue> => ({
  loop_state: context.loop_state ?? "ideation",
  candidate_revision: context.candidate_revision ?? 0,
  active_component_id: context.active_component_id ?? null,
});

const buildCandidateOutlineForPrompt = (
  candidate: CandidateRecipeSet | null,
): Record<string, JsonValue> | null => {
  if (!candidate) {
    return null;
  }

  return {
    candidate_id: candidate.candidate_id,
    revision: candidate.revision,
    active_component_id: candidate.active_component_id,
    components: candidate.components.map((component) => ({
      component_id: component.component_id,
      role: component.role,
      title: component.title,
      ingredient_count: Array.isArray(component.recipe.ingredients)
        ? component.recipe.ingredients.length
        : 0,
      step_count: Array.isArray(component.recipe.steps)
        ? component.recipe.steps.length
        : 0,
    })),
  };
};

const updateChatSessionLoopContext = async (params: {
  client: SupabaseClient;
  chatId: string;
  context: ChatSessionContext;
}): Promise<void> => {
  const { error } = await params.client
    .from("chat_sessions")
    .update({
      context: params.context,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.chatId);

  if (error) {
    throw new ApiError(
      500,
      "chat_context_update_failed",
      "Could not update chat context",
      error.message,
    );
  }
};

const buildChatLoopResponse = (params: {
  chatId: string;
  messages: ChatMessageView[];
  context: ChatSessionContext;
  assistantReply?: AssistantReply | null;
  responseContext?: ChatLoopResponse["response_context"] | null;
  memoryContextIds: string[];
  createdAt?: string;
  updatedAt?: string;
  uiHints?: ChatUiHints;
}): ChatLoopResponse => {
  const candidateSet = normalizeCandidateRecipeSet(
    params.context.candidate_recipe_set ?? null,
  );
  const loopState = deriveLoopState(params.context, candidateSet);
  const reply = params.assistantReply ??
    extractLatestAssistantReply(params.messages);
  const responseContext = params.responseContext ??
    (() => {
      for (let index = params.messages.length - 1; index >= 0; index -= 1) {
        const message = params.messages[index];
        if (message.role !== "assistant") {
          continue;
        }
        return parseAssistantChatPayload(message)?.responseContext ?? null;
      }
      return null;
    })();

  return {
    id: params.chatId,
    messages: params.messages,
    loop_state: loopState,
    assistant_reply: reply ?? null,
    candidate_recipe_set: candidateSet,
    response_context: responseContext ?? undefined,
    memory_context_ids: params.memoryContextIds,
    context_version: 2,
    ui_hints: params.uiHints,
    context: params.context as Record<string, JsonValue>,
    created_at: params.createdAt,
    updated_at: params.updatedAt,
  };
};

const mapCandidateRoleToRelation = (role: CandidateRecipeRole): string => {
  switch (role) {
    case "side":
      return "is_side_of";
    case "appetizer":
      return "is_appetizer_of";
    case "dessert":
      return "is_dessert_of";
    case "drink":
      return "pairs_with";
    case "main":
    default:
      return "pairs_with";
  }
};

const mapRelationTypeToCandidateRole = (
  relationType: string | null | undefined,
): CandidateRecipeRole => {
  const normalized = relationType?.trim().toLowerCase() ?? "";
  if (normalized.includes("side")) return "side";
  if (normalized.includes("appetizer")) return "appetizer";
  if (normalized.includes("dessert")) return "dessert";
  if (normalized.includes("drink") || normalized.includes("beverage")) {
    return "drink";
  }
  return "main";
};

const removeRecipeAttachments = (recipe: RecipePayload): RecipePayload => ({
  ...recipe,
  attachments: [],
});

const candidateFromRecipePayload = (
  recipe: RecipePayload,
  existing: CandidateRecipeSet | null = null,
): CandidateRecipeSet => {
  const components: CandidateRecipeComponent[] = [
    {
      component_id: existing?.components?.[0]?.component_id ??
        crypto.randomUUID(),
      role: "main",
      title: recipe.title,
      recipe: removeRecipeAttachments(recipe),
    },
  ];

  for (const attachment of recipe.attachments ?? []) {
    if (components.length >= 3) break;
    if (!attachment?.recipe) continue;
    components.push({
      component_id: crypto.randomUUID(),
      role: mapRelationTypeToCandidateRole(attachment.relation_type),
      title: attachment.title?.trim() || attachment.recipe.title,
      recipe: removeRecipeAttachments(attachment.recipe as RecipePayload),
    });
  }

  const activeComponentId = existing?.active_component_id &&
      components.some((component) =>
        component.component_id === existing.active_component_id
      )
    ? existing.active_component_id
    : components[0].component_id;

  return {
    candidate_id: existing?.candidate_id ?? crypto.randomUUID(),
    revision: Math.max(1, Number(existing?.revision ?? 0) + 1),
    active_component_id: activeComponentId,
    components,
  };
};

const mergeRecipeIntoCandidate = (
  existing: CandidateRecipeSet | null,
  recipe: RecipePayload,
): CandidateRecipeSet => {
  if (!existing) {
    return candidateFromRecipePayload(recipe, null);
  }

  if (Array.isArray(recipe.attachments) && recipe.attachments.length > 0) {
    return candidateFromRecipePayload(recipe, existing);
  }

  const nextComponents = existing.components.map((component) => {
    if (component.component_id !== existing.active_component_id) {
      return component;
    }
    return {
      ...component,
      title: recipe.title,
      recipe: removeRecipeAttachments(recipe),
    };
  });

  return {
    ...existing,
    revision: Math.max(1, Number(existing.revision ?? 0) + 1),
    components: nextComponents,
  };
};

const buildCookbookItems = async (
  client: SupabaseClient,
  userId: string,
): Promise<Array<Record<string, JsonValue>>> => {
  const { data: saves, error: savesError } = await client
    .from("recipe_saves")
    .select("recipe_id")
    .eq("user_id", userId);

  if (savesError) {
    throw new ApiError(
      500,
      "cookbook_saves_fetch_failed",
      "Could not fetch saved recipes",
      savesError.message,
    );
  }

  const recipeIds = (saves ?? []).map((row) => row.recipe_id);
  if (recipeIds.length === 0) {
    return [];
  }

  const preferredRecipesQuery = await client
    .from("recipes")
    .select(
      "id,title,hero_image_url,image_status,visibility,updated_at,current_version_id",
    )
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
      throw new ApiError(
        500,
        "cookbook_fetch_failed",
        "Could not load cookbook recipes",
        preferredRecipesQuery.error.message,
      );
    }

    const legacyRecipesQuery = await client
      .from("recipes")
      .select(
        "id,title,hero_image_url,visibility,updated_at,current_version_id",
      )
      .in("id", recipeIds)
      .order("updated_at", { ascending: false });

    if (legacyRecipesQuery.error) {
      throw new ApiError(
        500,
        "cookbook_fetch_failed",
        "Could not load cookbook recipes",
        legacyRecipesQuery.error.message,
      );
    }

    recipes = (legacyRecipesQuery.data ?? []).map((row) => ({
      ...row,
      image_status: row.hero_image_url ? "ready" : "pending",
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
      throw new ApiError(
        500,
        "cookbook_version_fetch_failed",
        "Could not load cookbook versions",
        versionsError.message,
      );
    }

    versionById = new Map(
      (versions ?? []).map((
        version,
      ) => [version.id, version.payload as RecipePayload]),
    );
  }

  const [{ data: userCategories }, { data: autoCategories }] = await Promise
    .all([
      client
        .from("recipe_user_categories")
        .select("recipe_id,category")
        .eq("user_id", userId),
      client
        .from("recipe_auto_categories")
        .select("recipe_id,category,confidence"),
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
    const payload = recipe.current_version_id
      ? versionById.get(recipe.current_version_id)
      : undefined;
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
      updated_at: recipe.updated_at,
    };
  });
};

const normalizeCookbookInsight = (
  candidate: string | null | undefined,
): string | null => {
  if (typeof candidate !== "string") {
    return null;
  }

  const collapsed = candidate.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) {
    return null;
  }

  const sentenceBoundary = collapsed.search(/[.!?]\s/);
  const firstSentence = sentenceBoundary >= 0
    ? collapsed.slice(0, sentenceBoundary + 1)
    : collapsed;
  if (firstSentence.length <= 150) {
    return firstSentence;
  }

  return `${firstSentence.slice(0, 147).trimEnd()}...`;
};

const generateCookbookInsight = async (params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  items: Array<Record<string, JsonValue>>;
}): Promise<string | null> => {
  if (params.items.length === 0) {
    return null;
  }

  const contextItems = params.items.slice(0, 12).map((item) => ({
    title: typeof item.title === "string" ? item.title : "",
    category: typeof item.category === "string" ? item.category : "",
    summary: typeof item.summary === "string" ? item.summary.slice(0, 220) : "",
  }));

  try {
    const response = await llmGateway.converseChat({
      client: params.client,
      userId: params.userId,
      requestId: params.requestId,
      prompt:
        "Write a single warm sentence for a cookbook header subtitle based on the user's saved recipes. Mention one clear pattern you infer. Keep it under 20 words. No markdown.",
      context: {
        task: "cookbook_header_insight",
        cookbook_items: contextItems,
        cookbook_recipe_count: params.items.length,
      },
    });

    return normalizeCookbookInsight(response.assistant_reply.text);
  } catch (error) {
    console.error("cookbook_insight_failed", {
      request_id: params.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

const converseChatWithRetry = async (params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  prompt: string;
  context: Record<string, JsonValue>;
  scopeHint?: "chat_ideation" | "chat_generation" | "chat_iteration";
  modelOverrides?: ModelOverrideMap;
}): Promise<Awaited<ReturnType<typeof llmGateway.converseChat>>> => {
  const maxAttempts = params.scopeHint === "chat_generation" ||
      params.scopeHint === "chat_iteration"
    ? 2
    : 1;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await llmGateway.converseChat({
        client: params.client,
        userId: params.userId,
        requestId: params.requestId,
        prompt: params.prompt,
        context: params.context,
        scopeHint: params.scopeHint,
        modelOverrides: params.modelOverrides,
      });
    } catch (error) {
      lastError = error;
      const code = error instanceof ApiError ? error.code : "";
      const retryable = code === "llm_invalid_json" ||
        code === "llm_empty_output" ||
        code === "chat_schema_invalid";
      if (!retryable || attempt >= maxAttempts) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new ApiError(502, "chat_generation_failed", "Chat generation failed");
};

const sanitizePreferenceStringList = (values: unknown): string[] => {
  if (!Array.isArray(values)) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLocaleLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(normalized);
    if (out.length >= 32) {
      break;
    }
  }
  return out;
};

const clampMaxDifficulty = (value: unknown, fallback: number): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(1, Math.min(5, Math.round(numeric)));
};

const normalizePreferencePatchDeterministic = (
  patch: ReturnType<typeof sanitizeModelPreferencePatch>,
): ReturnType<typeof sanitizeModelPreferencePatch> => {
  const normalized = { ...patch };
  if ("dietary_preferences" in normalized) {
    normalized.dietary_preferences = sanitizePreferenceStringList(
      normalized.dietary_preferences,
    );
  }
  if ("dietary_restrictions" in normalized) {
    normalized.dietary_restrictions = sanitizePreferenceStringList(
      normalized.dietary_restrictions,
    );
  }
  if ("equipment" in normalized) {
    normalized.equipment = sanitizePreferenceStringList(normalized.equipment);
  }
  if ("cuisines" in normalized) {
    normalized.cuisines = sanitizePreferenceStringList(normalized.cuisines);
  }
  if ("aversions" in normalized) {
    normalized.aversions = sanitizePreferenceStringList(normalized.aversions);
  }
  if (typeof normalized.skill_level === "string") {
    normalized.skill_level = normalized.skill_level.trim().slice(0, 48);
  }
  if (typeof normalized.cooking_for === "string") {
    normalized.cooking_for = normalized.cooking_for.trim().slice(0, 120);
  }
  if (typeof normalized.max_difficulty !== "undefined") {
    normalized.max_difficulty = clampMaxDifficulty(
      normalized.max_difficulty,
      3,
    );
  }
  return normalized;
};

type OrchestratedChatTurn = {
  assistantChatResponse: Awaited<ReturnType<typeof llmGateway.converseChat>>;
  nextCandidateSet: CandidateRecipeSet | null;
  nextLoopState: ChatLoopState;
  nextContext: ChatSessionContext;
  effectivePreferences: PreferenceContext;
  responseContext: ChatLoopResponse["response_context"] | null;
  justGenerated: boolean;
};

const orchestrateChatTurn = async (params: {
  client: SupabaseClient;
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  message: string;
  existingCandidate: CandidateRecipeSet | null;
  sessionContext: ChatSessionContext;
  contextPack: ContextPack;
  threadForPrompt: Array<{ role: string; content: string }>;
  modelOverrides?: ModelOverrideMap;
}): Promise<OrchestratedChatTurn> => {
  const candidateOutlineForPrompt = buildCandidateOutlineForPrompt(
    params.existingCandidate,
  );
  const compactChatContext = buildCompactChatContext(params.sessionContext);
  const activeComponent = params.existingCandidate?.components.find((component) =>
    component.component_id === params.existingCandidate?.active_component_id
  ) ??
    params.existingCandidate?.components[0] ??
    null;

  let assistantChatResponse = await converseChatWithRetry({
    client: params.serviceClient,
    userId: params.userId,
    requestId: params.requestId,
    prompt: params.message,
    context: {
      chat_context: compactChatContext,
      thread: params.threadForPrompt,
      active_recipe: activeComponent?.recipe
        ? (activeComponent.recipe as unknown as JsonValue)
        : null,
      candidate_recipe_set_outline: candidateOutlineForPrompt,
      loop_state: deriveLoopState(params.sessionContext, params.existingCandidate),
      preferences: params.contextPack.preferences,
      preferences_natural_language: params.contextPack.preferencesNaturalLanguage,
      memory_snapshot: params.contextPack.memorySnapshot,
      selected_memories: params.contextPack.selectedMemories,
    },
    scopeHint: params.existingCandidate ? "chat_iteration" : "chat_ideation",
    modelOverrides: params.modelOverrides,
  });

  const intent = getChatIntentFromResponse(assistantChatResponse);
  const isOutOfScope = intent === "out_of_scope";

  if (!params.existingCandidate && !isOutOfScope) {
    const shouldGenerate = intent === "in_scope_generate" ||
      assistantChatResponse.trigger_recipe === true;
    if (
      shouldGenerate && !assistantChatResponse.candidate_recipe_set &&
      !assistantChatResponse.recipe
    ) {
      const generationResponse = await converseChatWithRetry({
        client: params.serviceClient,
        userId: params.userId,
        requestId: params.requestId,
        prompt: params.message,
        context: {
          chat_context: compactChatContext,
          thread: params.threadForPrompt,
          loop_state: "iterating",
          preferences: params.contextPack.preferences,
          preferences_natural_language:
            params.contextPack.preferencesNaturalLanguage,
          memory_snapshot: params.contextPack.memorySnapshot,
          selected_memories: params.contextPack.selectedMemories,
          candidate_recipe_set_outline: candidateOutlineForPrompt,
        },
        scopeHint: "chat_generation",
        modelOverrides: params.modelOverrides,
      });

      if (
        !generationResponse.candidate_recipe_set && !generationResponse.recipe
      ) {
        throw new ApiError(
          502,
          "chat_generation_missing_candidate",
          "Generation trigger did not produce a candidate recipe set",
        );
      }

      assistantChatResponse = generationResponse;
    }
  }

  if (isOutOfScope) {
    assistantChatResponse = {
      ...assistantChatResponse,
      trigger_recipe: false,
      recipe: undefined,
      candidate_recipe_set: undefined,
      response_context: {
        ...(assistantChatResponse.response_context ?? {}),
        mode: "ideation",
        intent: "out_of_scope",
      },
      assistant_reply: assistantChatResponse.assistant_reply?.text?.trim()
        ? assistantChatResponse.assistant_reply
        : {
          text:
            "I can’t help with that here. I can help with recipes, cooking techniques, or meal planning.",
        },
    };
  }

  const effectivePreferences = await applyModelPreferenceUpdates({
    client: params.client,
    serviceClient: params.serviceClient,
    userId: params.userId,
    requestId: params.requestId,
    currentPreferences: params.contextPack.preferences,
    preferenceUpdates: assistantChatResponse.response_context
      ?.preference_updates,
    latestUserMessage: params.message,
  });

  const modelCandidateSet = normalizeCandidateRecipeSet(
    assistantChatResponse.candidate_recipe_set ?? null,
  );
  let nextCandidateSet: CandidateRecipeSet | null = modelCandidateSet;
  if (!nextCandidateSet && assistantChatResponse.recipe && !isOutOfScope) {
    nextCandidateSet = mergeRecipeIntoCandidate(
      params.existingCandidate,
      assistantChatResponse.recipe,
    );
  }
  if (!nextCandidateSet && params.existingCandidate) {
    nextCandidateSet = params.existingCandidate;
  }

  if (params.existingCandidate && nextCandidateSet) {
    nextCandidateSet = {
      ...nextCandidateSet,
      candidate_id: params.existingCandidate.candidate_id,
      revision: Math.max(
        params.existingCandidate.revision + 1,
        nextCandidateSet.revision,
      ),
      active_component_id: nextCandidateSet.active_component_id &&
          nextCandidateSet.components.some((component) =>
            component.component_id === nextCandidateSet?.active_component_id
          )
        ? nextCandidateSet.active_component_id
        : nextCandidateSet.components[0]?.component_id ??
          params.existingCandidate.active_component_id,
    };
  }

  const nextLoopState: ChatLoopState = nextCandidateSet
    ? "candidate_presented"
    : "ideation";
  const responseContext = assistantChatResponse.response_context
    ? {
      mode: assistantChatResponse.response_context.mode,
      intent: normalizeChatIntent(assistantChatResponse.response_context.intent) ??
        (nextCandidateSet ? "in_scope_generate" : "in_scope_ideation"),
      changed_sections: assistantChatResponse.response_context.changed_sections,
      personalization_notes: assistantChatResponse.response_context
        .personalization_notes,
      preference_updates: assistantChatResponse.response_context
        .preference_updates,
    }
    : null;

  const nextContext: ChatSessionContext = {
    preferences: effectivePreferences,
    memory_snapshot: params.contextPack.memorySnapshot,
    selected_memory_ids: params.contextPack.selectedMemoryIds,
    loop_state: nextLoopState,
    candidate_recipe_set: nextCandidateSet,
    candidate_revision: nextCandidateSet?.revision ?? 0,
    active_component_id: nextCandidateSet?.active_component_id ?? null,
  };

  return {
    assistantChatResponse,
    nextCandidateSet,
    nextLoopState,
    nextContext,
    effectivePreferences,
    responseContext,
    justGenerated: !params.existingCandidate && Boolean(nextCandidateSet),
  };
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
    throw new ApiError(
      500,
      "image_jobs_fetch_failed",
      "Could not fetch image jobs",
      jobsError.message,
    );
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
        locked_by: "v1_image_jobs_process",
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
          locked_by: null,
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
          reason: "recipe_or_current_version_missing",
        },
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
          locked_by: null,
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
          reason: "recipe_payload_missing",
        },
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
          preferences_natural_language: buildNaturalLanguagePreferenceContext(
            preferences,
          ),
          memory_snapshot: snapshot,
        },
      });

      await params.userClient
        .from("recipes")
        .update({
          hero_image_url: imageUrl,
          image_status: "ready",
          image_last_error: null,
          image_updated_at: new Date().toISOString(),
          image_generation_attempts: nextAttempt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.recipe_id);

      await params.userClient
        .from("recipe_image_jobs")
        .update({
          status: "ready",
          last_error: null,
          updated_at: new Date().toISOString(),
          locked_at: null,
          locked_by: null,
        })
        .eq("id", job.id);

      await logChangelog({
        serviceClient: params.serviceClient,
        actorUserId: params.userId,
        scope: "image",
        entityType: "recipe",
        entityId: job.recipe_id,
        action: "image_ready",
        requestId: params.requestId,
      });
      ready += 1;
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "image_generation_failed";
      const terminalFailure = nextAttempt >= Number(job.max_attempts);
      await params.userClient
        .from("recipes")
        .update({
          image_status: terminalFailure ? "failed" : "pending",
          image_last_error: message,
          image_updated_at: new Date().toISOString(),
          image_generation_attempts: nextAttempt,
          updated_at: new Date().toISOString(),
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
          locked_by: null,
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
          terminal_failure: terminalFailure,
        },
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
    pending,
  };
};

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  const respond = (status: number, body: unknown): Response => {
    const response = jsonResponse(status, body);
    response.headers.set("x-request-id", requestId);
    response.headers.set("x-alchemy-request-id", requestId);
    return response;
  };

  try {
    const url = new URL(request.url);
    const rawSegments = normalizePath(url.pathname);
    const segments = [...rawSegments];
    const method = request.method.toUpperCase();

    if (
      segments.length === 1 && segments[0] === "healthz" && method === "GET"
    ) {
      return respond(200, {
        status: "ok",
        service: "alchemy-api",
        timestamp: new Date().toISOString(),
        request_id: requestId,
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
      avatarUrl: auth.avatarUrl,
    });

    if (segments.length === 1 && segments[0] === "preferences") {
      if (method === "GET") {
        const preferences = await getPreferences(client, auth.userId);
        return respond(200, preferences);
      }

      if (method === "PATCH") {
        const body = await requireJsonBody<Record<string, unknown>>(request);
        const patch = normalizePreferencePatch(body);
        if (!patch) {
          throw new ApiError(
            400,
            "invalid_preferences_payload",
            "No valid preference fields were provided",
          );
        }

        const normalizedPatch = await normalizePreferencePatchWithLlm({
          client: serviceClient,
          userId: auth.userId,
          requestId,
          patch,
        });

        const currentPreferences = await getPreferences(client, auth.userId);
        const nextPreferences: PreferenceContext = {
          ...currentPreferences,
          ...normalizedPatch,
        };

        const payload = {
          user_id: auth.userId,
          ...nextPreferences,
          updated_at: new Date().toISOString(),
        };
        const { data, error } = await client.from("preferences").upsert(payload)
          .select("*").single();
        if (error) {
          throw new ApiError(
            500,
            "preferences_update_failed",
            "Could not update preferences",
            error.message,
          );
        }

        await logChangelog({
          serviceClient,
          actorUserId: auth.userId,
          scope: "preferences",
          entityType: "preferences",
          entityId: auth.userId,
          action: "updated",
          requestId,
          afterJson: data as unknown as JsonValue,
        });

        return respond(200, data);
      }
    }

    if (
      segments.length === 2 && segments[0] === "onboarding" &&
      segments[1] === "state" && method === "GET"
    ) {
      const preferences = await getPreferences(client, auth.userId);
      const storedState = extractOnboardingStateFromPreferences(preferences);
      const derivedState = deriveOnboardingStateFromPreferences(preferences);

      const onboardingState = storedState && storedState.completed
        ? storedState
        : {
          ...derivedState,
          state: storedState?.state ?? {},
        };

      return respond(200, onboardingState);
    }

    if (
      segments.length === 2 && segments[0] === "onboarding" &&
      segments[1] === "chat" && method === "POST"
    ) {
      const body = await requireJsonBody<{
        message?: string;
        transcript?: Array<
          { role?: string; content?: string; created_at?: string }
        >;
        state?: Record<string, JsonValue>;
      }>(request);

      const normalizedMessage = typeof body.message === "string"
        ? body.message.trim()
        : "";
      const transcript = Array.isArray(body.transcript)
        ? body.transcript
          .filter((entry) =>
            entry && typeof entry.content === "string" &&
            typeof entry.role === "string"
          )
          .map((entry) => ({
            role: entry.role === "assistant" ? "assistant" : "user",
            content: entry.content?.trim() ?? "",
            created_at: entry.created_at,
          }))
          .filter((entry) => entry.content.length > 0)
        : [];
      const state = body.state && typeof body.state === "object" &&
          !Array.isArray(body.state)
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
          state,
        },
        selectionMode: "fast",
      });

      const interview = await llmGateway.runOnboardingInterview({
        client: serviceClient,
        userId: auth.userId,
        requestId,
        prompt: normalizedMessage || "start onboarding",
        context: {
          preferences: contextPack.preferences,
          preferences_natural_language: contextPack.preferencesNaturalLanguage,
          memory_snapshot: contextPack.memorySnapshot,
          selected_memories: contextPack.selectedMemories,
          transcript,
          state,
        },
      });

      const effectivePreferences = await applyModelPreferenceUpdates({
        client,
        serviceClient,
        userId: auth.userId,
        requestId,
        currentPreferences: contextPack.preferences,
        preferenceUpdates: interview.preference_updates,
        latestUserMessage: normalizedMessage,
        userMessages: transcript
          .filter((entry) => entry.role === "user")
          .map((entry) => entry.content),
      });

      const inferredState = deriveOnboardingStateFromPreferences(
        effectivePreferences,
      );
      const userSkipRequested = normalizedMessage.length > 0 &&
        /\b(skip|later|not now|start using|use the app|done for now|skip onboarding)\b/i
          .test(normalizedMessage);

      const onboardingState: OnboardingState = userSkipRequested
        ? {
          completed: true,
          progress: 1,
          missing_topics: [],
          state: {
            ...interview.onboarding_state.state,
            skip_requested: true,
          },
        }
        : interview.onboarding_state.completed || inferredState.completed
        ? {
          completed: true,
          progress: 1,
          missing_topics: [],
          state: {
            ...interview.onboarding_state.state,
            readiness_inferred: inferredState.completed,
          },
        }
        : {
          completed: false,
          progress: Math.max(
            interview.onboarding_state.progress,
            inferredState.progress,
          ),
          missing_topics: Array.from(
            new Set([
              ...interview.onboarding_state.missing_topics,
              ...inferredState.missing_topics,
            ]),
          ),
          state: interview.onboarding_state.state,
        };

      const mergedPresentationPreferences = {
        ...(effectivePreferences.presentation_preferences ?? {}),
        onboarding_state: onboardingState,
      } as Record<string, JsonValue>;

      const { data: persistedPreferences, error: persistedPreferencesError } =
        await client
          .from("preferences")
          .upsert({
            user_id: auth.userId,
            ...effectivePreferences,
            presentation_preferences: mergedPresentationPreferences,
            updated_at: new Date().toISOString(),
          })
          .select("*")
          .single();

      if (persistedPreferencesError) {
        throw new ApiError(
          500,
          "onboarding_preferences_persist_failed",
          "Could not persist onboarding preferences",
          persistedPreferencesError.message,
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
              effective_preferences: persistedPreferences as unknown as Record<
                string,
                JsonValue
              >,
            },
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
              preference_updates: interview.preference_updates ?? {},
            },
          });
        } catch (bgError) {
          console.error("onboarding_background_task_failed", bgError);
        }
      })();

      return respond(200, {
        assistant_reply: interview.assistant_reply,
        onboarding_state: onboardingState,
        preference_updates: interview.preference_updates ?? {},
      });
    }

    if (segments.length === 1 && segments[0] === "memories") {
      if (method === "GET") {
        const memories = await getActiveMemories(
          client,
          auth.userId,
          getLimit(url, 100),
        );
        const snapshot = await getMemorySnapshot(client, auth.userId);
        return respond(200, { items: memories, snapshot });
      }
    }

    if (
      segments.length === 2 && segments[0] === "memories" &&
      segments[1] === "reset" && method === "POST"
    ) {
      const resetResult = await client
        .from("memories")
        .update({ status: "deleted", updated_at: new Date().toISOString() })
        .eq("user_id", auth.userId)
        .eq("status", "active");

      if (resetResult.error) {
        if (!isSchemaMissingError(resetResult.error)) {
          throw new ApiError(
            500,
            "memory_reset_failed",
            "Could not reset memories",
            resetResult.error.message,
          );
        }

        const legacyDelete = await client.from("memories").delete().eq(
          "user_id",
          auth.userId,
        );
        if (legacyDelete.error) {
          throw new ApiError(
            500,
            "memory_reset_failed",
            "Could not reset memories",
            legacyDelete.error.message,
          );
        }
      }

      const snapshotResult = await client.from("memory_snapshots").upsert({
        user_id: auth.userId,
        summary: {},
        token_estimate: 0,
        updated_at: new Date().toISOString(),
      });
      if (snapshotResult.error && !isSchemaMissingError(snapshotResult.error)) {
        throw new ApiError(
          500,
          "memory_reset_failed",
          "Could not reset memory snapshot",
          snapshotResult.error.message,
        );
      }

      await logChangelog({
        serviceClient,
        actorUserId: auth.userId,
        scope: "memory",
        entityType: "memory",
        entityId: auth.userId,
        action: "reset",
        requestId,
      });

      return respond(200, { ok: true });
    }

    if (
      segments.length === 2 && segments[0] === "memories" &&
      segments[1] === "forget" && method === "POST"
    ) {
      const body = await requireJsonBody<{ memory_id: string }>(request);
      const memoryId = parseUuid(body.memory_id);

      const forgetResult = await client
        .from("memories")
        .update({ status: "deleted", updated_at: new Date().toISOString() })
        .eq("id", memoryId)
        .eq("user_id", auth.userId);

      if (forgetResult.error) {
        if (!isSchemaMissingError(forgetResult.error)) {
          throw new ApiError(
            500,
            "memory_forget_failed",
            "Could not forget memory",
            forgetResult.error.message,
          );
        }

        const legacyDelete = await client.from("memories").delete().eq(
          "id",
          memoryId,
        ).eq("user_id", auth.userId);
        if (legacyDelete.error) {
          throw new ApiError(
            500,
            "memory_forget_failed",
            "Could not forget memory",
            legacyDelete.error.message,
          );
        }
      }

      await logChangelog({
        serviceClient,
        actorUserId: auth.userId,
        scope: "memory",
        entityType: "memory",
        entityId: memoryId,
        action: "forgotten",
        requestId,
      });

      return respond(200, { ok: true });
    }

    if (
      segments.length === 1 && segments[0] === "changelog" && method === "GET"
    ) {
      const limit = getLimit(url, 100);
      const changelogResult = await client
        .from("changelog_events")
        .select(
          "id,scope,entity_type,entity_id,action,request_id,before_json,after_json,metadata,created_at",
        )
        .eq("actor_user_id", auth.userId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (changelogResult.error) {
        if (!isSchemaMissingError(changelogResult.error)) {
          throw new ApiError(
            500,
            "changelog_fetch_failed",
            "Could not load changelog",
            changelogResult.error.message,
          );
        }

        const legacyEvents = await client
          .from("events")
          .select("id,event_type,request_id,event_payload,created_at")
          .eq("user_id", auth.userId)
          .order("created_at", { ascending: false })
          .limit(limit);

        if (legacyEvents.error) {
          throw new ApiError(
            500,
            "changelog_fetch_failed",
            "Could not load changelog",
            legacyEvents.error.message,
          );
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
          created_at: event.created_at,
        }));
        return respond(200, { items });
      }

      return respond(200, { items: changelogResult.data ?? [] });
    }

    if (
      segments.length === 2 && segments[0] === "image-jobs" &&
      segments[1] === "process" && method === "POST"
    ) {
      const body = await requireJsonBody<{ limit?: number }>(request).catch(
        () => ({ limit: 5 }),
      );
      const limit = Number.isFinite(Number(body.limit))
        ? Math.max(1, Math.min(20, Number(body.limit)))
        : 5;

      const result = await processImageJobs({
        userClient: client,
        serviceClient,
        userId: auth.userId,
        requestId,
        limit,
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
          pending: result.pending,
        },
      });

      return respond(200, result);
    }

    if (
      segments.length === 2 && segments[0] === "metadata-jobs" &&
      segments[1] === "process" && method === "POST"
    ) {
      const body = await requireJsonBody<{ limit?: number }>(request).catch(
        () => ({ limit: 10 }),
      );
      const limit = Number.isFinite(Number(body.limit))
        ? Math.max(0, Math.min(50, Number(body.limit)))
        : 10;

      const result = await processMetadataJobs({
        serviceClient,
        actorUserId: auth.userId,
        requestId,
        limit,
      });

      await logChangelog({
        serviceClient,
        actorUserId: auth.userId,
        scope: "metadata",
        entityType: "metadata_job",
        action: "process_batch",
        requestId,
        afterJson: {
          reaped: result.reaped,
          claimed: result.claimed,
          processed: result.processed,
          ready: result.ready,
          failed: result.failed,
          pending: result.pending,
          queue: result.queue,
        },
      });

      return respond(200, result);
    }

    if (
      segments.length === 2 && segments[0] === "metadata-jobs" &&
      segments[1] === "retry" && method === "POST"
    ) {
      const body = await requireJsonBody<{ job_id?: string }>(request);
      const jobId = parseUuid(body.job_id ?? "");

      const { data: retried, error: retryError } = await serviceClient
        .from("recipe_metadata_jobs")
        .update({
          status: "pending",
          attempts: 0,
          next_attempt_at: new Date().toISOString(),
          locked_at: null,
          locked_by: null,
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .in("status", ["pending", "processing", "failed"])
        .select("id,status,attempts,next_attempt_at")
        .maybeSingle();

      if (retryError) {
        throw new ApiError(
          500,
          "metadata_job_retry_failed",
          "Could not retry metadata job",
          retryError.message,
        );
      }
      if (!retried) {
        throw new ApiError(
          404,
          "metadata_job_not_found",
          "Metadata job not found",
        );
      }

      await logChangelog({
        serviceClient,
        actorUserId: auth.userId,
        scope: "metadata",
        entityType: "metadata_job",
        entityId: jobId,
        action: "manual_retry",
        requestId,
      });

      return respond(200, { ok: true, job: retried });
    }

    if (
      segments.length === 2 && segments[0] === "memory-jobs" &&
      segments[1] === "process" && method === "POST"
    ) {
      const body = await requireJsonBody<{ limit?: number }>(request).catch(
        () => ({ limit: 25 }),
      );
      const limit = Number.isFinite(Number(body.limit))
        ? Math.max(1, Math.min(100, Number(body.limit)))
        : 25;

      const result = await processMemoryJobs({
        userClient: client,
        serviceClient,
        actorUserId: auth.userId,
        requestId,
        limit,
      });

      await logChangelog({
        serviceClient,
        actorUserId: auth.userId,
        scope: "memory",
        entityType: "memory_job",
        action: "process_batch",
        requestId,
        afterJson: {
          processed: result.processed,
          succeeded: result.succeeded,
          failed: result.failed,
          queue: result.queue,
        },
      });

      return respond(200, result);
    }

    if (
      segments.length === 2 && segments[0] === "memory-jobs" &&
      segments[1] === "retry" && method === "POST"
    ) {
      const body = await requireJsonBody<{ job_id?: string }>(request);
      const jobId = parseUuid(body.job_id ?? "");

      const { data: retried, error: retryError } = await client
        .from("memory_jobs")
        .update({
          status: "pending",
          attempts: 0,
          next_attempt_at: new Date().toISOString(),
          locked_at: null,
          locked_by: null,
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .select("id,status,attempts,next_attempt_at")
        .maybeSingle();

      if (retryError) {
        throw new ApiError(
          500,
          "memory_job_retry_failed",
          "Could not retry memory job",
          retryError.message,
        );
      }
      if (!retried) {
        throw new ApiError(404, "memory_job_not_found", "Memory job not found");
      }

      await logChangelog({
        serviceClient,
        actorUserId: auth.userId,
        scope: "memory",
        entityType: "memory_job",
        entityId: jobId,
        action: "manual_retry",
        requestId,
      });

      return respond(200, { ok: true, job: retried });
    }

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
      segments.length === 3 && segments[0] === "collections" &&
      segments[2] === "items" && method === "POST"
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
      segments.length === 2 && segments[0] === "recipes" &&
      segments[1] === "cookbook" && method === "GET"
    ) {
      const items = await buildCookbookItems(client, auth.userId);
      const cookbookInsight = await generateCookbookInsight({
        client,
        userId: auth.userId,
        requestId,
        items,
      });
      return respond(200, { items, cookbook_insight: cookbookInsight });
    }

    if (
      segments.length === 2 && segments[0] === "recipes" && method === "GET"
    ) {
      const recipeId = parseUuid(segments[1]);
      const preferences = await getPreferences(client, auth.userId);
      const viewOptions = resolvePresentationOptions({
        query: url.searchParams,
        presentationPreferences: preferences.presentation_preferences as Record<
          string,
          unknown
        >,
      });
      const recipe = await fetchRecipeView(client, recipeId, true, viewOptions);
      return respond(200, recipe);
    }

    if (
      segments.length === 3 && segments[0] === "recipes" &&
      segments[2] === "history" && method === "GET"
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
        .select(
          "id,parent_version_id,diff_summary,created_at,payload,created_by",
        )
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
          .select(
            "id,recipe_version_id,event_type,request_id,metadata,created_at",
          )
          .in("recipe_version_id", versionIds)
          .order("created_at", { ascending: true });

        if (versionEventsResult.error) {
          if (!isSchemaMissingError(versionEventsResult.error)) {
            throw new ApiError(
              500,
              "recipe_version_events_fetch_failed",
              "Could not fetch recipe version events",
              versionEventsResult.error.message,
            );
          }
        } else {
          events = (versionEventsResult.data ?? []) as unknown as Array<
            Record<string, JsonValue>
          >;
        }
      }

      let chatMessages: ChatMessageView[] = [];
      if (recipe.source_chat_id) {
        chatMessages = await fetchChatMessages(client, recipe.source_chat_id);
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
      segments.length === 3 && segments[0] === "recipes" &&
      segments[2] === "attachments" && method === "POST"
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
          parent_recipe: {
            id: parentRecipe.id,
            title: parentRecipe.title,
            ingredients: parentRecipe.ingredients,
            steps: parentRecipe.steps,
            metadata: parentRecipe.metadata,
          },
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
            parent_recipe: {
              id: parentRecipe.id,
              title: parentRecipe.title,
              ingredients: parentRecipe.ingredients,
              steps: parentRecipe.steps,
              metadata: parentRecipe.metadata,
            },
            preferences: contextPack.preferences,
            preferences_natural_language:
              contextPack.preferencesNaturalLanguage,
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
      segments.length === 4 && segments[0] === "recipes" &&
      segments[2] === "attachments" && method === "PATCH"
    ) {
      const parentRecipeId = parseUuid(segments[1]);
      const attachmentId = parseUuid(segments[3]);
      const body = await requireJsonBody<
        { relation_type?: string; position?: number }
      >(request);

      const updatePayload: Record<string, JsonValue> = {
        updated_at: new Date().toISOString(),
      };

      if (
        typeof body.position === "number" && Number.isInteger(body.position)
      ) {
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
      segments.length === 4 && segments[0] === "recipes" &&
      segments[2] === "attachments" && method === "DELETE"
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
      segments.length === 3 && segments[0] === "recipes" &&
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

        // Enqueue image generation now that the recipe is saved to cookbook
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
      segments.length === 4 && segments[0] === "recipes" &&
      segments[2] === "categories" && segments[3] === "override"
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
      segments.length === 5 && segments[0] === "recipes" &&
      segments[2] === "categories" && segments[3] === "override"
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

    if (
      segments.length === 3 && segments[0] === "recipes" &&
      segments[2] === "graph" && method === "GET"
    ) {
      const recipeId = parseUuid(segments[1]);

      const { data: recipe, error: recipeError } = await client
        .from("recipes")
        .select("current_version_id")
        .eq("id", recipeId)
        .maybeSingle();

      if (recipeError || !recipe?.current_version_id) {
        throw new ApiError(
          404,
          "recipe_or_version_not_found",
          "Recipe graph source was not found",
          recipeError?.message,
        );
      }

      const { data: links, error: linksError } = await client
        .from("recipe_graph_links")
        .select("entity_id")
        .eq("recipe_version_id", recipe.current_version_id);

      if (linksError) {
        throw new ApiError(
          500,
          "graph_links_fetch_failed",
          "Could not fetch graph links",
          linksError.message,
        );
      }

      const entityIds = (links ?? []).map((item) => item.entity_id);
      if (entityIds.length === 0) {
        return respond(200, { entities: [], edges: [] });
      }

      const { data: entities, error: entitiesError } = await client
        .from("graph_entities")
        .select("id,entity_type,label,metadata")
        .in("id", entityIds);

      if (entitiesError) {
        throw new ApiError(
          500,
          "graph_entities_fetch_failed",
          "Could not fetch graph entities",
          entitiesError.message,
        );
      }

      const [
        { data: edgesFrom, error: edgesFromError },
        { data: edgesTo, error: edgesToError },
      ] = await Promise.all([
        client
          .from("graph_edges")
          .select(
            "id,from_entity_id,to_entity_id,confidence,source,relation_type_id",
          )
          .in("from_entity_id", entityIds),
        client
          .from("graph_edges")
          .select(
            "id,from_entity_id,to_entity_id,confidence,source,relation_type_id",
          )
          .in("to_entity_id", entityIds),
      ]);

      if (edgesFromError || edgesToError) {
        throw new ApiError(
          500,
          "graph_edges_fetch_failed",
          "Could not fetch graph edges",
          edgesFromError?.message ?? edgesToError?.message,
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

      const relationTypeIds = Array.from(
        new Set((edges ?? []).map((edge) => edge.relation_type_id)),
      );
      let relationById = new Map<string, string>();
      if (relationTypeIds.length > 0) {
        const { data: relationTypes, error: relationTypesError } = await client
          .from("graph_relation_types")
          .select("id,name")
          .in("id", relationTypeIds);

        if (relationTypesError) {
          throw new ApiError(
            500,
            "graph_relation_types_fetch_failed",
            "Could not fetch graph relation types",
            relationTypesError.message,
          );
        }

        relationById = new Map(
          (relationTypes ?? []).map((
            relationType,
          ) => [relationType.id, relationType.name]),
        );
      }

      const responseEdges = (edges ?? []).map((edge) => ({
        id: edge.id,
        from_entity_id: edge.from_entity_id,
        to_entity_id: edge.to_entity_id,
        relation_type: relationById.get(edge.relation_type_id) ?? "unknown",
        confidence: edge.confidence,
        source: edge.source,
      }));

      return respond(200, {
        entities: entities ?? [],
        edges: responseEdges,
      });
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
        selectionMode: "fast",
      });

      const { data: chatSession, error: chatError } = await client
        .from("chat_sessions")
        .insert({
          owner_user_id: auth.userId,
          context: {
            preferences: contextPack.preferences,
            memory_snapshot: contextPack.memorySnapshot,
            selected_memory_ids: contextPack.selectedMemoryIds,
            loop_state: "ideation",
            candidate_recipe_set: null,
            candidate_revision: 0,
            active_component_id: null,
          },
        })
        .select("id,created_at,updated_at")
        .single();

      if (chatError || !chatSession) {
        throw new ApiError(
          500,
          "chat_create_failed",
          "Could not create chat session",
          chatError?.message,
        );
      }

      const { data: userMessage, error: userMessageError } = await client
        .from("chat_messages")
        .insert({
          chat_id: chatSession.id,
          role: "user",
          content: message,
        })
        .select("id")
        .single();

      if (userMessageError || !userMessage) {
        throw new ApiError(
          500,
          "chat_message_create_failed",
          "Could not store chat message",
          userMessageError?.message ?? "chat_message_insert_missing",
        );
      }

      const threadMessages = await fetchChatMessages(client, chatSession.id);
      const threadForPrompt = buildThreadForPrompt(threadMessages);
      const initialContext: ChatSessionContext = {
        preferences: contextPack.preferences,
        memory_snapshot: contextPack.memorySnapshot,
        selected_memory_ids: contextPack.selectedMemoryIds,
        loop_state: "ideation",
        candidate_recipe_set: null,
        candidate_revision: 0,
        active_component_id: null,
      };
      const orchestrated = await orchestrateChatTurn({
        client,
        serviceClient,
        userId: auth.userId,
        requestId,
        message,
        existingCandidate: null,
        sessionContext: initialContext,
        contextPack,
        threadForPrompt,
        modelOverrides,
      });

      await updateChatSessionLoopContext({
        client,
        chatId: chatSession.id,
        context: orchestrated.nextContext,
      });

      const { error: assistantMessageError } = await client.from(
        "chat_messages",
      ).insert({
        chat_id: chatSession.id,
        role: "assistant",
        content: JSON.stringify({
          assistant_reply: orchestrated.assistantChatResponse.assistant_reply,
          trigger_recipe: orchestrated.assistantChatResponse.trigger_recipe ??
            Boolean(orchestrated.nextCandidateSet),
          candidate_recipe_set: orchestrated.nextCandidateSet,
          recipe: orchestrated.assistantChatResponse.recipe,
          response_context: orchestrated.responseContext,
        }),
        metadata: {
          format: "assistant_chat_envelope_v2",
          loop_state: orchestrated.nextLoopState,
          intent: orchestrated.responseContext?.intent ?? null,
        },
      });

      if (assistantMessageError) {
        throw new ApiError(
          500,
          "chat_assistant_message_failed",
          "Could not store assistant chat message",
          assistantMessageError.message,
        );
      }

      const interactionContext: Record<string, JsonValue> = {
        prompt: message,
        chat_id: chatSession.id,
        assistant_reply: orchestrated.assistantChatResponse.assistant_reply,
        preferences: orchestrated.effectivePreferences,
        selected_memory_ids: contextPack.selectedMemoryIds,
        loop_state: orchestrated.nextLoopState,
        response_context: (orchestrated.responseContext ??
          {}) as unknown as JsonValue,
        thread_size: threadMessages.length,
      };
      if (orchestrated.nextCandidateSet) {
        interactionContext.candidate_recipe_set =
          orchestrated.nextCandidateSet as unknown as JsonValue;
      } else if (orchestrated.assistantChatResponse.recipe) {
        interactionContext.assistant_recipe = orchestrated.assistantChatResponse
          .recipe as unknown as JsonValue;
      }

      await enqueueMemoryJob({
        serviceClient,
        userId: auth.userId,
        chatId: chatSession.id,
        messageId: userMessage.id,
        interactionContext,
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
          message_count: messages.length,
        },
      });

      return respond(
        200,
        buildChatLoopResponse({
          chatId: chatSession.id,
          messages,
          context: orchestrated.nextContext,
          assistantReply: orchestrated.assistantChatResponse.assistant_reply,
          responseContext: orchestrated.responseContext,
          memoryContextIds: contextPack.selectedMemoryIds,
          createdAt: chatSession.created_at,
          updatedAt: new Date().toISOString(),
          uiHints: orchestrated.nextCandidateSet
            ? {
              show_generation_animation: orchestrated.justGenerated,
              focus_component_id:
                orchestrated.nextCandidateSet.active_component_id,
            }
            : undefined,
        }),
      );
    }

    if (segments.length === 2 && segments[0] === "chat" && method === "GET") {
      const chatId = parseUuid(segments[1]);

      const { data: chatSession, error: chatError } = await client
        .from("chat_sessions")
        .select("id,created_at,updated_at,context")
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

      const messages = await fetchChatMessages(client, chatId);
      const context = extractChatContext(chatSession.context);
      const memoryContextIds = Array.isArray(context.selected_memory_ids)
        ? context.selected_memory_ids.filter((item): item is string =>
          typeof item === "string"
        )
        : [];

      return respond(
        200,
        buildChatLoopResponse({
          chatId: chatSession.id,
          messages,
          context,
          assistantReply: extractLatestAssistantReply(messages),
          memoryContextIds,
          createdAt: chatSession.created_at,
          updatedAt: chatSession.updated_at,
        }),
      );
    }

    if (
      segments.length === 3 && segments[0] === "chat" &&
      segments[2] === "messages" && method === "POST"
    ) {
      const chatId = parseUuid(segments[1]);
      const body = await requireJsonBody<{ message: string }>(request);
      const message = body.message?.trim();

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
          chat_context: (chatSession.context as Record<string, JsonValue>) ??
            {},
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
        .select("id")
        .single();

      if (userMessageError || !userMessage) {
        throw new ApiError(
          500,
          "chat_message_create_failed",
          "Could not store chat message",
          userMessageError?.message ?? "chat_message_insert_missing",
        );
      }

      const threadMessages = await fetchChatMessages(client, chatId);
      const threadForPrompt = buildThreadForPrompt(threadMessages);
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
      });

      await updateChatSessionLoopContext({
        client,
        chatId,
        context: orchestrated.nextContext,
      });

      const { error: assistantMessageError } = await client.from(
        "chat_messages",
      ).insert({
        chat_id: chatId,
        role: "assistant",
        content: JSON.stringify({
          assistant_reply: orchestrated.assistantChatResponse.assistant_reply,
          trigger_recipe: orchestrated.assistantChatResponse.trigger_recipe ??
            Boolean(orchestrated.nextCandidateSet),
          candidate_recipe_set: orchestrated.nextCandidateSet,
          recipe: orchestrated.assistantChatResponse.recipe,
          response_context: orchestrated.responseContext,
        }),
        metadata: {
          format: "assistant_chat_envelope_v2",
          loop_state: orchestrated.nextLoopState,
          intent: orchestrated.responseContext?.intent ?? null,
        },
      });

      if (assistantMessageError) {
        throw new ApiError(
          500,
          "chat_assistant_message_failed",
          "Could not store assistant chat message",
          assistantMessageError.message,
        );
      }

      const interactionContext: Record<string, JsonValue> = {
        prompt: message,
        chat_id: chatId,
        assistant_reply: orchestrated.assistantChatResponse.assistant_reply,
        thread_size: threadMessages.length,
        preferences: orchestrated.effectivePreferences,
        selected_memory_ids: contextPack.selectedMemoryIds,
        loop_state: orchestrated.nextLoopState,
        response_context: (orchestrated.responseContext ??
          {}) as unknown as JsonValue,
      };
      if (orchestrated.nextCandidateSet) {
        interactionContext.candidate_recipe_set =
          orchestrated.nextCandidateSet as unknown as JsonValue;
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

      const messages = await fetchChatMessages(client, chatId);

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
          uiHints: orchestrated.justGenerated
            ? {
              show_generation_animation: true,
              focus_component_id: orchestrated.nextCandidateSet
                ?.active_component_id,
            }
            : orchestrated.nextCandidateSet
            ? {
              focus_component_id:
                orchestrated.nextCandidateSet.active_component_id,
            }
            : undefined,
        }),
      );
    }

    if (
      segments.length === 3 && segments[0] === "chat" &&
      segments[2] === "candidate" && method === "PATCH"
    ) {
      const chatId = parseUuid(segments[1]);
      const body = await requireJsonBody<{
        action?:
          | "set_active_component"
          | "delete_component"
          | "clear_candidate";
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

      const context = extractChatContext(chatSession.context);
      const candidateSet = normalizeCandidateRecipeSet(
        context.candidate_recipe_set ?? null,
      );
      let nextCandidateSet = candidateSet;

      if (body.action === "clear_candidate") {
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
      }

      const nextLoopState: ChatLoopState = nextCandidateSet
        ? "candidate_presented"
        : "ideation";
      const memoryContextIds = Array.isArray(context.selected_memory_ids)
        ? context.selected_memory_ids.filter((item): item is string =>
          typeof item === "string"
        )
        : [];
      const nextContext: ChatSessionContext = {
        ...context,
        loop_state: nextLoopState,
        candidate_recipe_set: nextCandidateSet,
        candidate_revision: nextCandidateSet?.revision ?? 0,
        active_component_id: nextCandidateSet?.active_component_id ?? null,
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
          revision: nextCandidateSet?.revision ?? null,
          active_component_id: nextCandidateSet?.active_component_id ?? null,
        },
      });

      const messages = await fetchChatMessages(client, chatId);
      return respond(
        200,
        buildChatLoopResponse({
          chatId,
          messages,
          context: nextContext,
          memoryContextIds,
          createdAt: chatSession.created_at,
          updatedAt: new Date().toISOString(),
          uiHints: nextCandidateSet
            ? {
              focus_component_id: nextCandidateSet.active_component_id,
            }
            : undefined,
        }),
      );
    }

    if (
      segments.length === 3 && segments[0] === "chat" &&
      segments[2] === "commit" && method === "POST"
    ) {
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

      const context = extractChatContext(chatSession.context);
      const candidateSet = normalizeCandidateRecipeSet(
        context.candidate_recipe_set ?? null,
      );
      if (!candidateSet || candidateSet.components.length === 0) {
        throw new ApiError(
          409,
          "candidate_missing",
          "No candidate recipe set is available to commit",
        );
      }

      const selectedMemoryIds = Array.isArray(context.selected_memory_ids)
        ? context.selected_memory_ids.filter((item): item is string =>
          typeof item === "string"
        )
        : [];

      const committedComponents = await Promise.all(
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

          const { error: saveError } = await client
            .from("recipe_saves")
            .upsert(
              {
                user_id: auth.userId,
                recipe_id: saved.recipeId,
              },
              { onConflict: "user_id,recipe_id" },
            );
          if (saveError) {
            throw new ApiError(
              500,
              "recipe_save_failed",
              "Could not save committed recipe to cookbook",
              saveError.message,
            );
          }

          await enqueueImageJob(client, saved.recipeId);

          return {
            component_id: component.component_id,
            role: component.role,
            title: component.title,
            recipe_id: saved.recipeId,
            recipe_version_id: saved.versionId,
          };
        }),
      );

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
        ...context,
        loop_state: "ideation",
        candidate_recipe_set: null,
        candidate_revision: candidateSet.revision,
        active_component_id: null,
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

      const messages = await fetchChatMessages(client, chatId);
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
    }

    throw new ApiError(
      404,
      "route_not_found",
      "Requested route does not exist",
    );
  } catch (error) {
    const response = errorResponse(requestId, error);
    response.headers.set("x-request-id", requestId);
    response.headers.set("x-alchemy-request-id", requestId);
    return response;
  }
});
