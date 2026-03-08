import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../../_shared/errors.ts";
import { llmGateway, type ModelOverrideMap } from "../../_shared/llm-gateway.ts";
import type { JsonValue } from "../../_shared/types.ts";
import {
  asRecord,
  clampLimit,
  decodeSearchCursor,
  derivePresetText,
  encodeSearchCursor,
  filterSessionItems,
  normalizeRerankResult,
  normalizeScalarText,
  normalizeSearchIntent,
  normalizeStoredCards,
  normalizeStringList,
  serializeSearchCard,
  serializeVector,
} from "./filters.ts";
import {
  applyRationaleTagsToCards,
  createSearchSession,
  fetchSearchSession,
  paginateSessionItems,
} from "./session-store.ts";
import { buildInterpretSearchContext, fetchHybridCandidates } from "./retrieval.ts";
import type {
  ExploreAlgorithmVersionRow,
  ForYouProfileState,
  InternalForYouFeedResponse,
  RecipeSearchCard,
  RecipeSearchIntent,
  SearchSafetyExclusions,
  UserTasteProfileRow,
} from "./types.ts";

type BehaviorEventRow = {
  event_type: string | null;
  occurred_at: string | null;
  entity_id: string | null;
  session_id: string | null;
  payload: JsonValue;
  algorithm_version: string | null;
};

type BehaviorFactRow = {
  fact_type: string | null;
  fact_value: JsonValue;
  created_at: string | null;
};

type CookbookEntryRow = {
  canonical_recipe_id: string;
  saved_at: string | null;
};

type RecipeDocumentSummaryRow = {
  recipe_id: string;
  title: string;
  summary: string;
  category: string | null;
  cuisine_tags: string[];
  diet_tags: string[];
  technique_tags: string[];
  keyword_terms: string[];
  time_minutes: number | null;
  difficulty: string | null;
  health_score: number | null;
  ingredient_count: number;
};

type AlgorithmConfig = {
  candidatePoolLimit: number;
  page1RerankLimit: number;
  page1Limit: number;
  explorationRatio: number;
  suppressSavedOnPage1: boolean;
  freshnessWindowHours: number;
};

type TasteProfileMaterialized = {
  profileState: ForYouProfileState;
  algorithmVersion: string;
  retrievalText: string;
  retrievalEmbedding: number[];
  profileJson: Record<string, JsonValue>;
  signalSummary: Record<string, JsonValue>;
  sourceEventWatermark: string | null;
  rebuilt: boolean;
  fallbackPath: string | null;
};

type RecipeSignalSummary = {
  events: BehaviorEventRow[];
  facts: BehaviorFactRow[];
  cookbookEntries: CookbookEntryRow[];
  savedRecipeIds: Set<string>;
  recentExposureRecipeIds: Set<string>;
  positiveRecipeIds: string[];
  profileState: ForYouProfileState;
  sourceEventWatermark: string | null;
  signalSummary: Record<string, JsonValue>;
};

const DEFAULT_CANDIDATE_POOL_LIMIT = 160;
const DEFAULT_RERANK_LIMIT = 30;
const DEFAULT_EXPLORATION_RATIO = 0.2;
const DEFAULT_FRESHNESS_WINDOW_HOURS = 48;

const parseTimestamp = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const maxIsoTimestamp = (timestamps: Array<string | null | undefined>): string | null => {
  let current: number | null = null;
  for (const timestamp of timestamps) {
    const parsed = parseTimestamp(timestamp);
    if (parsed == null) continue;
    if (current == null || parsed > current) {
      current = parsed;
    }
  }
  return current == null ? null : new Date(current).toISOString();
};

const parseVectorString = (value: string | null | undefined): number[] | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return null;
  }
  const values = trimmed
    .slice(1, -1)
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry));
  return values.length > 0 ? values : null;
};

const normalizeProfileState = (value: unknown): ForYouProfileState | null => {
  const normalized = normalizeScalarText(value)?.toLowerCase();
  return normalized === "cold" || normalized === "warm" ||
      normalized === "established"
    ? normalized
    : null;
};

const buildCardContentSignature = (item: RecipeSearchCard): string | null => {
  const title = normalizeScalarText(item.title)?.toLowerCase() ?? null;
  const summary = normalizeScalarText(item.summary)?.toLowerCase() ?? null;
  const imageUrl = normalizeScalarText(item.image_url) ?? null;

  if (!title) return null;
  return [title, summary ?? "", imageUrl ?? ""].join("|");
};

export const dedupeCardsByContentSignature = (
  items: RecipeSearchCard[],
): RecipeSearchCard[] => {
  const seen = new Set<string>();
  const result: RecipeSearchCard[] = [];

  for (const item of items) {
    const signature = buildCardContentSignature(item);
    if (signature && seen.has(signature)) {
      continue;
    }
    if (signature) {
      seen.add(signature);
    }
    result.push(item);
  }

  return result;
};

const normalizeAlgorithmConfig = (value: JsonValue): AlgorithmConfig => {
  const record = asRecord(value);
  const candidatePoolLimit = Number(record?.candidate_pool_limit);
  const page1RerankLimit = Number(record?.page1_rerank_limit);
  const page1Limit = Number(record?.page1_limit);
  const explorationRatio = Number(record?.exploration_ratio);
  const freshnessWindowHours = Number(record?.freshness_window_hours);

  return {
    candidatePoolLimit: Number.isFinite(candidatePoolLimit) && candidatePoolLimit > 0
      ? Math.trunc(candidatePoolLimit)
      : DEFAULT_CANDIDATE_POOL_LIMIT,
    page1RerankLimit: Number.isFinite(page1RerankLimit) && page1RerankLimit > 0
      ? Math.trunc(page1RerankLimit)
      : DEFAULT_RERANK_LIMIT,
    page1Limit: Number.isFinite(page1Limit) && page1Limit > 0
      ? Math.trunc(page1Limit)
      : 10,
    explorationRatio: Number.isFinite(explorationRatio) && explorationRatio >= 0 && explorationRatio <= 1
      ? explorationRatio
      : DEFAULT_EXPLORATION_RATIO,
    suppressSavedOnPage1: record?.suppress_saved_on_page1 === true,
    freshnessWindowHours: Number.isFinite(freshnessWindowHours) && freshnessWindowHours > 0
      ? Math.trunc(freshnessWindowHours)
      : DEFAULT_FRESHNESS_WINDOW_HOURS,
  };
};

const toRecipeSnippet = (row: RecipeDocumentSummaryRow): Record<string, JsonValue> => ({
  recipe_id: row.recipe_id,
  title: row.title,
  summary: row.summary,
  category: row.category,
  cuisine_tags: row.cuisine_tags,
  diet_tags: row.diet_tags,
  technique_tags: row.technique_tags,
  keyword_terms: row.keyword_terms,
  time_minutes: row.time_minutes,
  difficulty: row.difficulty,
  health_score: row.health_score,
  ingredient_count: row.ingredient_count,
});

const computeProfileState = (events: BehaviorEventRow[], cookbookEntries: CookbookEntryRow[]): ForYouProfileState => {
  let score = cookbookEntries.length * 2;
  for (const row of events) {
    switch (row.event_type) {
      case "recipe_cooked_inferred":
        score += 4;
        break;
      case "recipe_saved":
      case "explore_saved_recipe":
        score += 3;
        break;
      case "explore_opened_recipe":
      case "cookbook_recipe_opened":
        score += 1;
        break;
      case "ingredient_substitution_applied":
      case "chat_commit_completed":
        score += 2;
        break;
      default:
        break;
    }
  }

  if (score >= 12) return "established";
  if (score >= 4) return "warm";
  return "cold";
};

const buildSignalSummary = (events: BehaviorEventRow[], facts: BehaviorFactRow[], cookbookEntries: CookbookEntryRow[]): Record<string, JsonValue> => {
  const eventCounts = new Map<string, number>();
  for (const row of events) {
    if (!row.event_type) continue;
    eventCounts.set(row.event_type, (eventCounts.get(row.event_type) ?? 0) + 1);
  }

  return {
    cookbook_count: cookbookEntries.length,
    fact_count: facts.length,
    explore_impressions: eventCounts.get("explore_impression") ?? 0,
    explore_opens: eventCounts.get("explore_opened_recipe") ?? 0,
    recipe_saves: eventCounts.get("recipe_saved") ?? 0,
    cooks: eventCounts.get("recipe_cooked_inferred") ?? 0,
    substitutions: eventCounts.get("ingredient_substitution_applied") ?? 0,
    commits: eventCounts.get("chat_commit_completed") ?? 0,
  };
};

const buildPositiveRecipeIds = (events: BehaviorEventRow[], cookbookEntries: CookbookEntryRow[]): string[] => {
  const counts = new Map<string, number>();

  for (const row of events) {
    if (!row.entity_id) continue;
    const increment = row.event_type === "recipe_cooked_inferred"
      ? 4
      : row.event_type === "recipe_saved" || row.event_type === "explore_saved_recipe"
      ? 3
      : row.event_type === "explore_opened_recipe" || row.event_type === "cookbook_recipe_opened"
      ? 1
      : row.event_type === "ingredient_substitution_applied"
      ? 2
      : 0;
    if (increment <= 0) continue;
    counts.set(row.entity_id, (counts.get(row.entity_id) ?? 0) + increment);
  }

  for (const row of cookbookEntries) {
    counts.set(row.canonical_recipe_id, (counts.get(row.canonical_recipe_id) ?? 0) + 3);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 12)
    .map(([recipeId]) => recipeId);
};

const extractRecentExposureRecipeIds = (
  events: BehaviorEventRow[],
  freshnessWindowHours: number,
): Set<string> => {
  const cutoffMs = Date.now() - freshnessWindowHours * 60 * 60 * 1000;
  const result = new Set<string>();

  for (const row of events) {
    const occurredAtMs = parseTimestamp(row.occurred_at);
    if (occurredAtMs == null || occurredAtMs < cutoffMs || !row.entity_id) {
      continue;
    }
    if (row.event_type === "explore_impression" || row.event_type === "explore_opened_recipe") {
      result.add(row.entity_id);
    }
  }

  return result;
};

const buildFallbackRetrievalText = (params: {
  preferences: Record<string, JsonValue>;
  memorySnapshot: Record<string, JsonValue>;
  activeMemories: JsonValue;
  recipeSnippets: Record<string, JsonValue>[];
  facts: BehaviorFactRow[];
}): string => {
  const parts: string[] = [];
  const preferences = params.preferences;
  const memorySnapshot = params.memorySnapshot;

  const cuisines = normalizeStringList(preferences["cuisines"]);
  const dietaryRestrictions = normalizeStringList(preferences["dietary_restrictions"]);
  const dietaryPreferences = normalizeStringList(preferences["dietary_preferences"]);
  const aversions = normalizeStringList(preferences["aversions"]);
  const equipment = normalizeStringList(preferences["equipment"]);

  if (cuisines.length > 0) parts.push(`Preferred cuisines: ${cuisines.join(", ")}`);
  if (dietaryRestrictions.length > 0) parts.push(`Hard dietary restrictions: ${dietaryRestrictions.join(", ")}`);
  if (dietaryPreferences.length > 0) parts.push(`Dietary preferences: ${dietaryPreferences.join(", ")}`);
  if (aversions.length > 0) parts.push(`Avoid: ${aversions.join(", ")}`);
  if (equipment.length > 0) parts.push(`Available equipment: ${equipment.join(", ")}`);
  if (typeof preferences["free_form"] === "string" && preferences["free_form"].trim().length > 0) {
    parts.push(`Preferences note: ${preferences["free_form"].trim()}`);
  }
  if (Object.keys(memorySnapshot).length > 0) {
    parts.push(`Memory snapshot: ${JSON.stringify(memorySnapshot)}`);
  }
  if (Array.isArray(params.activeMemories) && params.activeMemories.length > 0) {
    parts.push(`Active memories: ${JSON.stringify(params.activeMemories.slice(0, 6))}`);
  }
  if (params.recipeSnippets.length > 0) {
    parts.push(
      `Positive recipe history: ${
        params.recipeSnippets
          .map((recipe) => normalizeScalarText(recipe["title"]) ?? "Unknown recipe")
          .join(", ")
      }`,
    );
  }
  if (params.facts.length > 0) {
    parts.push(
      `Recent semantic facts: ${
        params.facts
          .slice(0, 8)
          .map((fact) => `${fact.fact_type ?? "fact"}=${JSON.stringify(fact.fact_value)}`)
          .join("; ")
      }`,
    );
  }

  return parts.join(". ").slice(0, 4000);
};

const normalizeProfilePayload = (params: {
  raw: unknown;
  fallbackRetrievalText: string;
  computedSignalSummary: Record<string, JsonValue>;
}): {
  retrievalText: string;
  profileJson: Record<string, JsonValue>;
  signalSummary: Record<string, JsonValue>;
} => {
  const record = asRecord(params.raw);
  const profileJson: Record<string, JsonValue> = {
    profile_summary: normalizeScalarText(record?.profile_summary) ?? "",
    focus_axes: normalizeStringList(record?.focus_axes),
    novelty_axes: normalizeStringList(record?.novelty_axes),
    avoid_axes: normalizeStringList(record?.avoid_axes),
    anchor_recipes: normalizeStringList(record?.anchor_recipes),
  };
  const retrievalText = normalizeScalarText(record?.retrieval_text) ??
    params.fallbackRetrievalText;

  return {
    retrievalText,
    profileJson,
    signalSummary: {
      ...params.computedSignalSummary,
      focus_axes: profileJson.focus_axes,
      novelty_axes: profileJson.novelty_axes,
      avoid_axes: profileJson.avoid_axes,
    },
  };
};

const selectPage1Items = (params: {
  orderedItems: RecipeSearchCard[];
  limit: number;
  savedRecipeIds: Set<string>;
  recentExposureRecipeIds: Set<string>;
  suppressSavedOnPage1: boolean;
}): RecipeSearchCard[] => {
  const chosen: RecipeSearchCard[] = [];
  const seen = new Set<string>();

  const tryConsume = (predicate: (item: RecipeSearchCard) => boolean): void => {
    for (const item of params.orderedItems) {
      if (chosen.length >= params.limit) break;
      if (seen.has(item.id) || !predicate(item)) continue;
      chosen.push(item);
      seen.add(item.id);
    }
  };

  tryConsume((item) =>
    (!params.suppressSavedOnPage1 || !params.savedRecipeIds.has(item.id)) &&
    !params.recentExposureRecipeIds.has(item.id)
  );
  tryConsume((item) =>
    !params.suppressSavedOnPage1 || !params.savedRecipeIds.has(item.id)
  );
  tryConsume(() => true);

  return chosen;
};

const loadActiveExploreAlgorithmVersion = async (
  serviceClient: SupabaseClient,
): Promise<ExploreAlgorithmVersionRow> => {
  const { data, error } = await serviceClient
    .from("explore_algorithm_versions")
    .select(
      [
        "version",
        "status",
        "label",
        "notes",
        "profile_scope",
        "profile_scope_version",
        "rank_scope",
        "rank_scope_version",
        "novelty_policy",
        "config",
        "is_active",
        "activated_at",
        "retired_at",
      ].join(","),
    )
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) {
    throw new ApiError(
      500,
      "explore_algorithm_version_missing",
      "No active Explore algorithm version is configured",
      error?.message,
    );
  }

  return data as unknown as ExploreAlgorithmVersionRow;
};

const loadUserTasteProfile = async (
  serviceClient: SupabaseClient,
  userId: string,
): Promise<UserTasteProfileRow | null> => {
  const { data, error } = await serviceClient
    .from("user_taste_profiles")
    .select(
      [
        "user_id",
        "profile_state",
        "algorithm_version",
        "retrieval_text",
        "retrieval_embedding",
        "profile_json",
        "signal_summary",
        "source_event_watermark",
        "last_built_at",
      ].join(","),
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new ApiError(
      500,
      "user_taste_profile_lookup_failed",
      "Could not load the user taste profile",
      error.message,
    );
  }

  return (data ?? null) as UserTasteProfileRow | null;
};

const loadCookbookEntries = async (
  serviceClient: SupabaseClient,
  userId: string,
): Promise<CookbookEntryRow[]> => {
  const { data, error } = await serviceClient
    .from("cookbook_entries")
    .select("canonical_recipe_id,saved_at")
    .eq("user_id", userId)
    .order("saved_at", { ascending: false })
    .limit(24);

  if (error) {
    throw new ApiError(
      500,
      "explore_cookbook_entries_fetch_failed",
      "Could not load cookbook history",
      error.message,
    );
  }

  return (data ?? []) as CookbookEntryRow[];
};

const loadBehaviorSignals = async (
  serviceClient: SupabaseClient,
  userId: string,
): Promise<BehaviorEventRow[]> => {
  const { data, error } = await serviceClient
    .from("behavior_events")
    .select("event_type,occurred_at,entity_id,session_id,payload,algorithm_version")
    .eq("user_id", userId)
    .in("event_type", [
      "explore_impression",
      "explore_opened_recipe",
      "explore_saved_recipe",
      "recipe_saved",
      "recipe_cooked_inferred",
      "ingredient_substitution_applied",
      "cookbook_recipe_opened",
      "chat_commit_completed",
    ])
    .order("occurred_at", { ascending: false })
    .limit(240);

  if (error) {
    throw new ApiError(
      500,
      "explore_behavior_signal_fetch_failed",
      "Could not load behavior signals",
      error.message,
    );
  }

  return (data ?? []) as BehaviorEventRow[];
};

const loadBehaviorFacts = async (
  serviceClient: SupabaseClient,
  userId: string,
): Promise<BehaviorFactRow[]> => {
  const { data, error } = await serviceClient
    .from("behavior_semantic_facts")
    .select("fact_type,fact_value,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(64);

  if (error) {
    throw new ApiError(
      500,
      "explore_behavior_fact_fetch_failed",
      "Could not load behavior semantic facts",
      error.message,
    );
  }

  return (data ?? []) as BehaviorFactRow[];
};

const loadRecipeSummaries = async (
  serviceClient: SupabaseClient,
  recipeIds: string[],
): Promise<RecipeDocumentSummaryRow[]> => {
  if (recipeIds.length === 0) return [];

  const { data, error } = await serviceClient
    .from("recipe_search_documents")
    .select(
      [
        "recipe_id",
        "title",
        "summary",
        "category",
        "cuisine_tags",
        "diet_tags",
        "technique_tags",
        "keyword_terms",
        "time_minutes",
        "difficulty",
        "health_score",
        "ingredient_count",
      ].join(","),
    )
    .in("recipe_id", recipeIds);

  if (error) {
    throw new ApiError(
      500,
      "explore_recipe_summary_fetch_failed",
      "Could not load recipe summaries for taste profiling",
      error.message,
    );
  }

  const rows = (data ?? []) as unknown as RecipeDocumentSummaryRow[];
  const order = new Map(recipeIds.map((recipeId, index) => [recipeId, index]));
  return rows.sort((left, right) =>
    (order.get(left.recipe_id) ?? Number.MAX_SAFE_INTEGER) -
    (order.get(right.recipe_id) ?? Number.MAX_SAFE_INTEGER)
  );
};

const collectRecipeSignals = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  freshnessWindowHours: number;
}): Promise<RecipeSignalSummary> => {
  const [events, facts, cookbookEntries] = await Promise.all([
    loadBehaviorSignals(params.serviceClient, params.userId),
    loadBehaviorFacts(params.serviceClient, params.userId),
    loadCookbookEntries(params.serviceClient, params.userId),
  ]);

  const savedRecipeIds = new Set(cookbookEntries.map((row) => row.canonical_recipe_id));
  const recentExposureRecipeIds = extractRecentExposureRecipeIds(
    events,
    params.freshnessWindowHours,
  );
  const positiveRecipeIds = buildPositiveRecipeIds(events, cookbookEntries);
  const profileState = computeProfileState(events, cookbookEntries);
  const sourceEventWatermark = maxIsoTimestamp([
    ...events.map((row) => row.occurred_at),
    ...facts.map((row) => row.created_at),
  ]);

  return {
    events,
    facts,
    cookbookEntries,
    savedRecipeIds,
    recentExposureRecipeIds,
    positiveRecipeIds,
    profileState,
    sourceEventWatermark,
    signalSummary: buildSignalSummary(events, facts, cookbookEntries),
  };
};

const shouldRebuildProfile = (params: {
  algorithmVersion: string;
  profile: UserTasteProfileRow | null;
  sourceEventWatermark: string | null;
}): boolean => {
  if (!params.profile) return true;
  if (params.profile.algorithm_version !== params.algorithmVersion) return true;
  if (!params.profile.retrieval_text.trim()) return true;

  const profileWatermark = parseTimestamp(params.profile.source_event_watermark);
  const sourceWatermark = parseTimestamp(params.sourceEventWatermark);
  if (sourceWatermark != null && (profileWatermark == null || sourceWatermark > profileWatermark)) {
    return true;
  }

  const lastBuiltAt = parseTimestamp(params.profile.last_built_at);
  return lastBuiltAt == null || (Date.now() - lastBuiltAt) > 12 * 60 * 60 * 1000;
};

const upsertUserTasteProfile = async (
  serviceClient: SupabaseClient,
  userId: string,
  profile: TasteProfileMaterialized,
): Promise<void> => {
  const { error } = await serviceClient
    .from("user_taste_profiles")
    .upsert({
      user_id: userId,
      profile_state: profile.profileState,
      algorithm_version: profile.algorithmVersion,
      retrieval_text: profile.retrievalText,
      retrieval_embedding: serializeVector(profile.retrievalEmbedding),
      profile_json: profile.profileJson,
      signal_summary: profile.signalSummary,
      source_event_watermark: profile.sourceEventWatermark,
      last_built_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

  if (error) {
    throw new ApiError(
      500,
      "user_taste_profile_upsert_failed",
      "Could not persist the user taste profile",
      error.message,
    );
  }
};

const ensureUserTasteProfile = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  algorithmVersion: string;
  algorithmConfig: AlgorithmConfig;
  signals: RecipeSignalSummary;
  preferences: Record<string, JsonValue>;
  memorySnapshot: Record<string, JsonValue>;
  activeMemories: JsonValue;
  modelOverrides?: ModelOverrideMap;
}): Promise<TasteProfileMaterialized> => {
  const existingProfile = await loadUserTasteProfile(params.serviceClient, params.userId);
  const positiveRecipeSummaries = await loadRecipeSummaries(
    params.serviceClient,
    params.signals.positiveRecipeIds,
  );
  const fallbackRetrievalText = buildFallbackRetrievalText({
    preferences: params.preferences,
    memorySnapshot: params.memorySnapshot,
    activeMemories: params.activeMemories,
    recipeSnippets: positiveRecipeSummaries.map(toRecipeSnippet),
    facts: params.signals.facts,
  });

  const rebuild = shouldRebuildProfile({
    algorithmVersion: params.algorithmVersion,
    profile: existingProfile,
    sourceEventWatermark: params.signals.sourceEventWatermark,
  });

  if (!rebuild && existingProfile) {
    const embedding = parseVectorString(existingProfile.retrieval_embedding);
    if (embedding) {
      return {
        profileState: existingProfile.profile_state,
        algorithmVersion: existingProfile.algorithm_version,
        retrievalText: existingProfile.retrieval_text,
        retrievalEmbedding: embedding,
        profileJson: asRecord(existingProfile.profile_json) ?? {},
        signalSummary: asRecord(existingProfile.signal_summary) ?? {},
        sourceEventWatermark: existingProfile.source_event_watermark,
        rebuilt: false,
        fallbackPath: null,
      };
    }
  }

  let profilePayload: unknown = null;
  let fallbackPath: string | null = null;
  try {
    profilePayload = await llmGateway.buildExploreForYouProfile({
      client: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      context: {
        preferences: params.preferences,
        memory_snapshot: params.memorySnapshot,
        active_memories: params.activeMemories,
        signal_summary: params.signals.signalSummary,
        recent_positive_recipes: positiveRecipeSummaries.map(toRecipeSnippet),
        recent_events: params.signals.events.slice(0, 60).map((row) => ({
          event_type: row.event_type,
          occurred_at: row.occurred_at,
          entity_id: row.entity_id,
          payload: row.payload,
        })) as unknown as JsonValue,
        recent_semantic_facts: params.signals.facts.slice(0, 24).map((row) => ({
          fact_type: row.fact_type,
          fact_value: row.fact_value,
          created_at: row.created_at,
        })) as unknown as JsonValue,
      },
      modelOverrides: params.modelOverrides,
    });
  } catch {
    fallbackPath = "profile_scope_failed";
  }

  const normalizedProfile = normalizeProfilePayload({
    raw: profilePayload,
    fallbackRetrievalText,
    computedSignalSummary: params.signals.signalSummary,
  });
  const embedding = await llmGateway.embedRecipeSearchQuery({
    client: params.serviceClient,
    userId: params.userId,
    requestId: params.requestId,
    inputText: normalizedProfile.retrievalText,
    modelOverrides: params.modelOverrides,
  });

  const materialized: TasteProfileMaterialized = {
    profileState: params.signals.profileState,
    algorithmVersion: params.algorithmVersion,
    retrievalText: normalizedProfile.retrievalText,
    retrievalEmbedding: embedding.vector,
    profileJson: normalizedProfile.profileJson,
    signalSummary: normalizedProfile.signalSummary,
    sourceEventWatermark: params.signals.sourceEventWatermark,
    rebuilt: true,
    fallbackPath,
  };
  await upsertUserTasteProfile(params.serviceClient, params.userId, materialized);
  return materialized;
};

const resolvePresetIntent = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  presetId: string;
  preferences: Record<string, JsonValue>;
  activeMemories: JsonValue;
  modelOverrides?: ModelOverrideMap;
}): Promise<RecipeSearchIntent> => {
  const interpretedRaw = await llmGateway.interpretRecipeSearch({
    client: params.serviceClient,
    userId: params.userId,
    requestId: params.requestId,
    context: buildInterpretSearchContext({
      surface: "explore",
      appliedContext: "preset",
      normalizedInput: derivePresetText(params.presetId),
      presetId: params.presetId,
      conversationContext: {
        preferences: params.preferences,
        selected_memories: params.activeMemories,
      },
    }),
    modelOverrides: params.modelOverrides,
  });

  return normalizeSearchIntent({
    appliedContext: "preset",
    normalizedInput: derivePresetText(params.presetId),
    raw: interpretedRaw,
  });
};

const normalizeRationaleTagsFromSession = (value: JsonValue): Record<string, string[]> => {
  const record = asRecord(value);
  if (!record) return {};
  const result: Record<string, string[]> = {};
  for (const [recipeId, tags] of Object.entries(record)) {
    const normalized = normalizeStringList(tags).slice(0, 4);
    if (normalized.length > 0) {
      result[recipeId] = normalized;
    }
  }
  return result;
};

export const getExploreForYouFeed = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  cursor?: string | null;
  limit?: number | null;
  presetId?: string | null;
  preferences: Record<string, JsonValue>;
  memorySnapshot: Record<string, JsonValue>;
  activeMemories: JsonValue;
  safetyExclusions?: SearchSafetyExclusions;
  modelOverrides?: ModelOverrideMap;
}): Promise<InternalForYouFeedResponse> => {
  const startedAt = Date.now();
  const limit = clampLimit(params.limit);
  const decodedCursor = decodeSearchCursor(params.cursor);
  if (params.cursor && !decodedCursor) {
    throw new ApiError(400, "recipe_search_cursor_invalid", "Cursor is invalid");
  }
  if (decodedCursor?.kind === "all") {
    throw new ApiError(400, "recipe_search_cursor_invalid", "Cursor is invalid");
  }

  if (decodedCursor?.kind === "session") {
    const session = await fetchSearchSession({
      serviceClient: params.serviceClient,
      userId: params.userId,
      searchId: decodedCursor.search_id,
    });
    if (session.applied_context !== "for_you" && session.applied_context !== "preset") {
      throw new ApiError(400, "recipe_search_cursor_invalid", "Cursor is invalid");
    }
    const rationaleTagsByRecipe = normalizeRationaleTagsFromSession(
      session.rationale_tags_by_recipe,
    );
    const items = applyRationaleTagsToCards(
      normalizeStoredCards(session.hybrid_items),
      rationaleTagsByRecipe,
    );
    const promotedRecipeIds = Array.isArray(session.page1_promoted_recipe_ids)
      ? session.page1_promoted_recipe_ids
      : [];
    const page = paginateSessionItems({
      searchId: session.id,
      items,
      promotedRecipeIds,
      offset: decodedCursor.offset,
      limit,
      noMatchContext: session.applied_context,
    });

    return {
      feed_id: session.id,
      applied_context: session.applied_context === "preset" ? "preset" : "for_you",
      profile_state: session.profile_state ?? "cold",
      algorithm_version: session.algorithm_version ?? "for_you_v1",
      items: page.items,
      next_cursor: page.next_cursor,
      no_match: page.no_match,
      internal: {
        rerank_used: promotedRecipeIds.length > 0,
        candidate_count: items.length,
        fallback_path: null,
        rationale_tags_by_recipe: rationaleTagsByRecipe,
      },
    };
  }

  const algorithm = await loadActiveExploreAlgorithmVersion(params.serviceClient);
  const algorithmConfig = normalizeAlgorithmConfig(algorithm.config);
  const signals = await collectRecipeSignals({
    serviceClient: params.serviceClient,
    userId: params.userId,
    freshnessWindowHours: algorithmConfig.freshnessWindowHours,
  });
  const tasteProfile = await ensureUserTasteProfile({
    serviceClient: params.serviceClient,
    userId: params.userId,
    requestId: params.requestId,
    algorithmVersion: algorithm.version,
    algorithmConfig,
    signals,
    preferences: params.preferences,
    memorySnapshot: params.memorySnapshot,
    activeMemories: params.activeMemories,
    modelOverrides: params.modelOverrides,
  });

  let presetIntent: RecipeSearchIntent | null = null;
  if (normalizeScalarText(params.presetId)) {
    presetIntent = await resolvePresetIntent({
      serviceClient: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      presetId: normalizeScalarText(params.presetId) as string,
      preferences: params.preferences,
      activeMemories: params.activeMemories,
      modelOverrides: params.modelOverrides,
    });
  }

  const retrievalIntent: RecipeSearchIntent = {
    normalized_query: tasteProfile.retrievalText,
    applied_context: presetIntent ? "preset" : "for_you",
    hard_filters: presetIntent?.hard_filters ?? {
      cuisines: [],
      diet_tags: [],
      techniques: [],
      exclude_ingredients: [],
      max_time_minutes: null,
      max_difficulty: null,
    },
    soft_targets: [],
    exclusions: [],
    sort_bias: null,
    query_style: "mixed",
  };

  const hybridItems = dedupeCardsByContentSignature(await fetchHybridCandidates({
    serviceClient: params.serviceClient,
    surface: "explore",
    snapshotCutoffIndexedAt: new Date().toISOString(),
    intent: retrievalIntent,
    embeddingVector: tasteProfile.retrievalEmbedding,
    safetyExclusions: params.safetyExclusions,
    limit: algorithmConfig.candidatePoolLimit,
  }));

  let rerankUsed = false;
  let fallbackPath = tasteProfile.fallbackPath;
  let rationaleTagsByRecipe: Record<string, string[]> = {};
  let orderedItems = hybridItems;

  if (hybridItems.length > 1) {
    const rerankCandidates = hybridItems.slice(0, algorithmConfig.page1RerankLimit);
    try {
      const rerankRaw = await llmGateway.rerankExploreForYou({
        client: params.serviceClient,
        userId: params.userId,
        requestId: params.requestId,
        timeoutMs: 2_200,
        context: {
          algorithm_version: algorithm.version,
          profile_state: tasteProfile.profileState,
          exploration_ratio: algorithmConfig.explorationRatio,
          profile: tasteProfile.profileJson,
          signal_summary: tasteProfile.signalSummary,
          preset_id: normalizeScalarText(params.presetId),
          hard_filters: retrievalIntent.hard_filters as unknown as JsonValue,
          recent_exposure_recipe_ids: [...signals.recentExposureRecipeIds],
          saved_recipe_ids: [...signals.savedRecipeIds],
          candidates: rerankCandidates.map(serializeSearchCard),
        },
        modelOverrides: params.modelOverrides,
      });
      const reranked = normalizeRerankResult({
        raw: rerankRaw,
        candidates: rerankCandidates,
      });
      rerankUsed = true;
      rationaleTagsByRecipe = reranked.rationaleTagsByRecipe;
      orderedItems = [
        ...reranked.orderedItems,
        ...hybridItems.slice(rerankCandidates.length),
      ];
    } catch {
      fallbackPath = fallbackPath ?? "rank_scope_failed";
    }
  }

  orderedItems = applyRationaleTagsToCards(orderedItems, rationaleTagsByRecipe);
  const page1Items = selectPage1Items({
    orderedItems,
    limit: Math.min(limit, algorithmConfig.page1Limit),
    savedRecipeIds: signals.savedRecipeIds,
    recentExposureRecipeIds: signals.recentExposureRecipeIds,
    suppressSavedOnPage1: algorithmConfig.suppressSavedOnPage1,
  });

  const feedId = await createSearchSession({
    serviceClient: params.serviceClient,
    userId: params.userId,
    surface: "explore",
    appliedContext: presetIntent ? "preset" : "for_you",
    normalizedInput: tasteProfile.retrievalText,
    presetId: normalizeScalarText(params.presetId),
    interpretedIntent: retrievalIntent,
    queryEmbedding: serializeVector(tasteProfile.retrievalEmbedding),
    snapshotCutoffIndexedAt: new Date().toISOString(),
    page1PromotedRecipeIds: page1Items.map((item) => item.id),
    hybridItems: orderedItems,
    algorithmVersion: algorithm.version,
    profileState: tasteProfile.profileState,
    rationaleTagsByRecipe,
  });

  const nextCursor = filterSessionItems(
      orderedItems,
      page1Items.map((item) => item.id),
    ).length > 0
    ? encodeSearchCursor({
      v: 1,
      kind: "session",
      search_id: feedId,
      offset: 0,
    })
    : null;

  return {
    feed_id: feedId,
    applied_context: presetIntent ? "preset" : "for_you",
    profile_state: tasteProfile.profileState,
    algorithm_version: algorithm.version,
    items: page1Items,
    next_cursor: nextCursor,
    no_match: orderedItems.length === 0
      ? {
        code: "for_you_feed_empty",
        message: "Alchemy does not have enough matching public recipes yet.",
        suggested_action: "Try another Explore filter or generate something new.",
      }
      : null,
    internal: {
      rerank_used: rerankUsed,
      candidate_count: orderedItems.length,
      fallback_path: fallbackPath,
      rationale_tags_by_recipe: rationaleTagsByRecipe,
    },
  };
};
