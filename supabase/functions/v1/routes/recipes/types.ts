import type {
  JsonValue,
  MemoryRecord,
  RecipePayload,
} from "../../../_shared/types.ts";
import type {
  ChatMessageView,
  CookbookRecipeDetail,
  ContextPack,
  CookbookEntry,
  SuggestedChip,
  PreferenceContext,
  RecipePreview,
  RecipeViewOptions,
  RecipeView,
  RouteContext,
  VariantStatus,
} from "../shared.ts";
import type { CookbookCanonicalStatus } from "../../lib/private-cookbook.ts";
import type { SearchSafetyExclusions } from "../../recipe-search.ts";

export type RecipesDeps = {
  parseUuid: (value: string) => string;
  getPreferences: (
    client: RouteContext["client"],
    userId: string,
  ) => Promise<PreferenceContext>;
  getMemorySnapshot: (
    client: RouteContext["client"],
    userId: string,
  ) => Promise<Record<string, JsonValue>>;
  getActiveMemories: (
    client: RouteContext["client"],
    userId: string,
    limit: number,
  ) => Promise<MemoryRecord[]>;
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
  canonicalizeRecipePayload: (input: {
    serviceClient: RouteContext["serviceClient"];
    userId: string;
    requestId: string;
    payload: RecipePayload;
    lineageMetadata?: Record<string, JsonValue>;
    modelOverrides?: RouteContext["modelOverrides"];
  }) => Promise<RecipePayload>;
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
  resolveAndPersistCanonicalRecipe: (input: {
    client: RouteContext["client"];
    serviceClient: RouteContext["serviceClient"];
    userId: string;
    requestId: string;
    payload: RecipePayload;
    sourceChatId?: string;
    diffSummary?: string;
    selectedMemoryIds?: string[];
    modelOverrides?: RouteContext["modelOverrides"];
  }) => Promise<{
    action: "reuse_existing_version" | "append_existing_canon" | "create_new_canon";
    reason: string;
    recipeId: string;
    versionId: string;
    matchedRecipeId: string | null;
    matchedRecipeVersionId: string | null;
    judgeInvoked: boolean;
    judgeCandidateCount: number;
    judgeConfidence: number | null;
  }>;
  createPrivateCookbookEntry: (input: {
    serviceClient: RouteContext["serviceClient"];
    userId: string;
    requestId: string;
    payload: RecipePayload;
    sourceKind: "created_private" | "imported_private";
    previewImageUrl?: string | null;
    previewImageStatus?: string | null;
    sourceChatId?: string | null;
    selectedMemoryIds?: string[];
    computePreferenceFingerprint: (
      preferences: PreferenceContext,
    ) => Promise<string | null>;
    computeVariantTags: (params: {
      canonicalPayload: RecipePayload;
      variantPayload: RecipePayload;
      tagDiff: { added: string[]; removed: string[] };
    }) => Record<string, unknown>;
    preferences: PreferenceContext;
  }) => Promise<{
    cookbookEntryId: string;
    variantId: string;
    variantVersionId: string;
    canonicalStatus: CookbookCanonicalStatus;
    variantStatus: VariantStatus;
  }>;
  deriveCanonicalForCookbookEntry: (input: {
    serviceClient: RouteContext["serviceClient"];
    userId: string;
    requestId: string;
    cookbookEntryId: string;
    canonicalizeRecipePayload: RecipesDeps["canonicalizeRecipePayload"];
    resolveAndPersistCanonicalRecipe: RecipesDeps["resolveAndPersistCanonicalRecipe"];
    ensurePersistedRecipeImageRequest?: RecipesDeps["ensurePersistedRecipeImageRequest"];
    scheduleImageQueueDrain?: RecipesDeps["scheduleImageQueueDrain"];
    modelOverrides?: RouteContext["modelOverrides"];
  }) => Promise<{
    cookbookEntryId: string;
    canonicalRecipeId: string | null;
    canonicalStatus: CookbookCanonicalStatus;
  }>;
  fetchCookbookEntryDetail: (input: {
    client: RouteContext["client"];
    userId: string;
    cookbookEntryId: string;
    viewOptions: RecipeViewOptions;
  }) => Promise<CookbookRecipeDetail>;
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
  buildCookbookFeed: (
    client: RouteContext["client"],
    userId: string,
  ) => Promise<{ items: CookbookEntry[]; suggestedChips: SuggestedChip[]; staleContext: { changed_fields: string[]; stale_recipe_ids: string[]; count: number } | null }>;
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
    sortBy?: "recent" | "popular" | "trending";
    safetyExclusions?: SearchSafetyExclusions;
    modelOverrides?: RouteContext["modelOverrides"];
  }) => Promise<{
    search_id: string;
    applied_context: "all" | "preset" | "query" | "for_you";
    items: RecipePreview[];
    next_cursor: string | null;
    no_match: {
      code: string;
      message: string;
      suggested_action: string;
    } | null;
  }>;
  getExploreForYouFeed: (input: {
    serviceClient: RouteContext["serviceClient"];
    userId: string;
    requestId: string;
    cursor?: string | null;
    limit?: number | null;
    presetId?: string | null;
    chipId?: string | null;
    preferences: Record<string, JsonValue>;
    memorySnapshot: Record<string, JsonValue>;
    activeMemories: JsonValue;
    safetyExclusions?: SearchSafetyExclusions;
    modelOverrides?: RouteContext["modelOverrides"];
  }) => Promise<{
    feed_id: string;
    applied_context: "for_you" | "preset";
    profile_state: "cold" | "warm" | "established";
    algorithm_version: string;
    items: RecipePreview[];
    suggested_chips: SuggestedChip[];
    next_cursor: string | null;
    no_match: {
      code: string;
      message: string;
      suggested_action: string;
    } | null;
    internal: {
      rerank_used: boolean;
      candidate_count: number;
      fallback_path: string | null;
      rationale_tags_by_recipe: Record<string, string[]>;
    };
  }>;
  toJsonValue: (value: unknown) => JsonValue;
  computePreferenceFingerprint: (
    preferences: PreferenceContext,
  ) => Promise<string | null>;
  computeSafetyExclusions: (
    preferences: PreferenceContext,
  ) => SearchSafetyExclusions | undefined;
  computeVariantTags: (params: {
    canonicalPayload: RecipePayload;
    variantPayload: RecipePayload;
    tagDiff: { added: string[]; removed: string[] };
  }) => Record<string, unknown>;
  fetchGraphSubstitutions: (params: {
    serviceClient: RouteContext["serviceClient"];
    recipeVersionId: string;
    constraints: string[];
  }) => Promise<Record<string, JsonValue>[]>;
  enqueueDemandExtractionJob?: (input: {
    serviceClient: RouteContext["serviceClient"];
    sourceKind: string;
    sourceId: string;
    userId?: string | null;
    stage: "intent" | "iteration" | "import" | "selection" | "commit" | "consumption" | "feedback";
    extractorScope: string;
    extractorVersion?: number;
    observedAt?: string | null;
    payload?: Record<string, JsonValue>;
  }) => Promise<void>;
  scheduleDemandQueueDrain?: (input: {
    serviceClient: RouteContext["serviceClient"];
    actorUserId: string;
    requestId: string;
    limit?: number;
  }) => void;
};
