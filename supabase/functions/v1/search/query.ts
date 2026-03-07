import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../../_shared/errors.ts";
import { llmGateway, type ModelOverrideMap } from "../../_shared/llm-gateway.ts";
import type { JsonValue } from "../../_shared/types.ts";
import type {
  AllFeedCursor,
  InternalRecipeSearchResponse,
  RecipeSearchAppliedContext,
  RecipeSearchCard,
  RecipeSearchConversationContext,
  RecipeSearchIntent,
  RecipeSearchResponse,
  RecipeSearchSessionRow,
  RecipeSearchSortBy,
  RecipeSearchSurface,
  SearchSafetyExclusions,
  SearchSessionCreateInput,
  SearchRpcRow,
} from "./types.ts";
import {
  HYBRID_CANDIDATE_LIMIT,
  PAGE1_RERANK_LIMIT,
  SEARCH_SESSION_TTL_MS,
} from "./types.ts";
import {
  buildNoMatch,
  clampLimit,
  decodeSearchCursor,
  derivePresetText,
  encodeSearchCursor,
  filterSessionItems,
  mapRpcRowToCard,
  mergeUnique,
  normalizeRerankResult,
  normalizeSearchIntent,
  normalizeSearchText,
  normalizeStoredCards,
  serializeSearchCard,
  serializeVector,
} from "./filters.ts";

// ---------------------------------------------------------------------------
// Session management — create, fetch, log
// ---------------------------------------------------------------------------

const createSearchSession = async (
  params: SearchSessionCreateInput,
): Promise<string> => {
  const expiresAt = new Date(Date.now() + SEARCH_SESSION_TTL_MS).toISOString();
  const { data, error } = await params.serviceClient
    .from("recipe_search_sessions")
    .insert({
      owner_user_id: params.userId,
      surface: params.surface,
      applied_context: params.appliedContext,
      normalized_input: params.normalizedInput,
      preset_id: params.presetId,
      interpreted_intent: params.interpretedIntent
        ? (params.interpretedIntent as unknown as JsonValue)
        : {},
      query_embedding: params.queryEmbedding,
      snapshot_cutoff_indexed_at: params.snapshotCutoffIndexedAt,
      page1_promoted_recipe_ids: params.page1PromotedRecipeIds ?? [],
      hybrid_items: (params.hybridItems ?? []).map(serializeSearchCard),
      expires_at: expiresAt,
    })
    .select(
      "id",
    )
    .single();

  if (error || !data?.id) {
    throw new ApiError(
      500,
      "recipe_search_session_create_failed",
      "Could not create search session",
      error?.message,
    );
  }

  return data.id;
};

const fetchSearchSession = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  searchId: string;
}): Promise<RecipeSearchSessionRow> => {
  const { data, error } = await params.serviceClient
    .from("recipe_search_sessions")
    .select(
      "id,owner_user_id,surface,applied_context,normalized_input,preset_id,interpreted_intent,query_embedding,snapshot_cutoff_indexed_at,page1_promoted_recipe_ids,hybrid_items,expires_at",
    )
    .eq("id", params.searchId)
    .eq("owner_user_id", params.userId)
    .maybeSingle();

  if (error || !data) {
    throw new ApiError(
      404,
      "recipe_search_session_not_found",
      "Search session was not found",
      error?.message,
    );
  }

  if (new Date(data.expires_at).getTime() < Date.now()) {
    throw new ApiError(
      410,
      "recipe_search_session_expired",
      "Search session has expired",
    );
  }

  return data as RecipeSearchSessionRow;
};

const logSearchEvent = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  searchId: string;
  surface: RecipeSearchSurface;
  appliedContext: RecipeSearchAppliedContext;
  normalizedInput: string | null;
  latencyMs: number;
  candidateCount: number;
  rerankUsed: boolean;
  noMatch: boolean;
}): Promise<void> => {
  const { error } = await params.serviceClient.from("events").insert({
    user_id: params.userId,
    event_type: "recipe_search",
    request_id: params.requestId,
    latency_ms: params.latencyMs,
    event_payload: {
      search_id: params.searchId,
      surface: params.surface,
      applied_context: params.appliedContext,
      normalized_input: params.normalizedInput,
      candidate_count: params.candidateCount,
      rerank_used: params.rerankUsed,
      no_match: params.noMatch,
    },
  });

  if (error) {
    console.error("recipe_search_event_failed", error);
  }
};

// ---------------------------------------------------------------------------
// Feed / candidate fetching
// ---------------------------------------------------------------------------

const fetchAllFeedPage = async (params: {
  serviceClient: SupabaseClient;
  searchId: string;
  surface: RecipeSearchSurface;
  snapshotCutoffIndexedAt: string;
  limit: number;
  cursor: AllFeedCursor | null;
  safetyExclusions?: SearchSafetyExclusions;
  sortBy?: RecipeSearchSortBy;
}): Promise<Pick<RecipeSearchResponse, "items" | "next_cursor" | "no_match">> => {
  const { data, error } = await params.serviceClient.rpc(
    "list_recipe_search_documents",
    {
      p_snapshot_cutoff_indexed_at: params.snapshotCutoffIndexedAt,
      p_explore_only: params.surface === "explore",
      p_limit: params.limit + 1,
      p_cursor_indexed_at: params.cursor?.last_indexed_at ?? null,
      p_cursor_recipe_id: params.cursor?.last_recipe_id ?? null,
      p_exclude_ingredient_names:
        params.safetyExclusions?.excludeIngredients ?? [],
      p_require_diet_tags: params.safetyExclusions?.requireDietTags ?? [],
      p_sort_by: params.sortBy ?? "recent",
    },
  );

  if (error) {
    throw new ApiError(
      500,
      "recipe_search_all_feed_failed",
      "Could not load the explore feed",
      error.message,
    );
  }

  const rows = Array.isArray(data) ? data as SearchRpcRow[] : [];
  const pageRows = rows.slice(0, params.limit);
  const items = pageRows.map(mapRpcRowToCard);
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor = rows.length > params.limit && lastRow
    ? encodeSearchCursor({
      v: 1,
      kind: "all",
      search_id: params.searchId,
      last_indexed_at: lastRow.indexed_at,
      last_recipe_id: lastRow.recipe_id,
    })
    : null;

  return {
    items,
    next_cursor: nextCursor,
    no_match: items.length === 0 ? buildNoMatch("all") : null,
  };
};

const fetchHybridCandidates = async (params: {
  serviceClient: SupabaseClient;
  surface: RecipeSearchSurface;
  snapshotCutoffIndexedAt: string;
  intent: RecipeSearchIntent;
  embeddingVector: number[];
  safetyExclusions?: SearchSafetyExclusions;
}): Promise<RecipeSearchCard[]> => {
  // Merge user's safety exclusions with the query-derived hard filters.
  // Safety exclusions come from stored user preferences (allergies,
  // dietary restrictions) and must always apply regardless of what the
  // user typed in the search query.
  const mergedExcludeIngredients = mergeUnique(
    params.intent.hard_filters.exclude_ingredients,
    params.safetyExclusions?.excludeIngredients ?? [],
  );

  const { data, error } = await params.serviceClient.rpc(
    "hybrid_search_recipe_documents",
    {
      p_query_text: params.intent.normalized_query,
      p_query_embedding: serializeVector(params.embeddingVector),
      p_snapshot_cutoff_indexed_at: params.snapshotCutoffIndexedAt,
      p_explore_only: params.surface === "explore",
      p_limit: HYBRID_CANDIDATE_LIMIT,
      p_cuisine_tags: params.intent.hard_filters.cuisines,
      p_diet_tags: params.intent.hard_filters.diet_tags,
      p_technique_tags: params.intent.hard_filters.techniques,
      p_exclude_ingredient_names: mergedExcludeIngredients,
      p_max_time_minutes: params.intent.hard_filters.max_time_minutes,
      p_max_difficulty: params.intent.hard_filters.max_difficulty,
    },
  );

  if (error) {
    throw new ApiError(
      500,
      "recipe_search_hybrid_failed",
      "Could not load recipe search candidates",
      error.message,
    );
  }

  return Array.isArray(data)
    ? (data as SearchRpcRow[]).map(mapRpcRowToCard)
    : [];
};

// ---------------------------------------------------------------------------
// Query-specific helpers
// ---------------------------------------------------------------------------

const buildInterpretSearchContext = (params: {
  surface: RecipeSearchSurface;
  appliedContext: RecipeSearchAppliedContext;
  normalizedInput: string;
  presetId: string | null;
  conversationContext?: RecipeSearchConversationContext;
}): Record<string, JsonValue> => {
  return {
    surface: params.surface,
    applied_context: params.appliedContext,
    normalized_input: params.normalizedInput,
    preset_id: params.presetId,
    latest_user_message: params.conversationContext?.latest_user_message ?? null,
    thread: params.conversationContext?.thread as unknown as JsonValue ?? null,
    preferences: params.conversationContext?.preferences ?? null,
    selected_memories: params.conversationContext?.selected_memories ?? null,
    active_recipe: params.conversationContext?.active_recipe ?? null,
    candidate_recipe_set: params.conversationContext?.candidate_recipe_set ??
      null,
  };
};

const paginateSessionItems = (params: {
  searchId: string;
  items: RecipeSearchCard[];
  promotedRecipeIds: string[];
  offset: number;
  limit: number;
}): Pick<RecipeSearchResponse, "items" | "next_cursor" | "no_match"> => {
  const remainingItems = filterSessionItems(params.items, params.promotedRecipeIds);
  const pageItems = remainingItems.slice(params.offset, params.offset + params.limit);
  const nextCursor = remainingItems.length > params.offset + params.limit
    ? encodeSearchCursor({
      v: 1,
      kind: "session",
      search_id: params.searchId,
      offset: params.offset + params.limit,
    })
    : null;

  return {
    items: pageItems,
    next_cursor: nextCursor,
    no_match: pageItems.length === 0 ? buildNoMatch("query") : null,
  };
};

// ---------------------------------------------------------------------------
// Main search entry point
// ---------------------------------------------------------------------------

export const searchRecipes = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  surface: RecipeSearchSurface;
  query?: string | null;
  presetId?: string | null;
  cursor?: string | null;
  limit?: number | null;
  conversationContext?: RecipeSearchConversationContext;
  modelOverrides?: ModelOverrideMap;
  safetyExclusions?: SearchSafetyExclusions;
  sortBy?: RecipeSearchSortBy;
}): Promise<InternalRecipeSearchResponse> => {
  const startedAt = Date.now();
  const limit = clampLimit(params.limit);
  const decodedCursor = decodeSearchCursor(params.cursor);
  if (params.cursor && !decodedCursor) {
    throw new ApiError(
      400,
      "recipe_search_cursor_invalid",
      "Cursor is invalid",
    );
  }

  if (decodedCursor?.kind === "session") {
    const session = await fetchSearchSession({
      serviceClient: params.serviceClient,
      userId: params.userId,
      searchId: decodedCursor.search_id,
    });
    const items = normalizeStoredCards(session.hybrid_items);
    const promotedRecipeIds = Array.isArray(session.page1_promoted_recipe_ids)
      ? session.page1_promoted_recipe_ids
      : [];
    const page = paginateSessionItems({
      searchId: session.id,
      items,
      promotedRecipeIds,
      offset: decodedCursor.offset,
      limit,
    });

    await logSearchEvent({
      serviceClient: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      searchId: session.id,
      surface: session.surface,
      appliedContext: session.applied_context,
      normalizedInput: session.normalized_input,
      latencyMs: Date.now() - startedAt,
      candidateCount: items.length,
      rerankUsed: promotedRecipeIds.length > 0,
      noMatch: page.items.length === 0,
    });

    return {
      search_id: session.id,
      applied_context: session.applied_context,
      items: page.items,
      next_cursor: page.next_cursor,
      no_match: page.no_match,
      internal: {
        interpreted_intent: normalizeSearchIntent({
          appliedContext: session.applied_context,
          normalizedInput: session.normalized_input,
          raw: session.interpreted_intent,
        }),
        rerank_used: promotedRecipeIds.length > 0,
        candidate_count: items.length,
        rationale_tags_by_recipe: {},
      },
    };
  }

  if (decodedCursor?.kind === "all") {
    const session = await fetchSearchSession({
      serviceClient: params.serviceClient,
      userId: params.userId,
      searchId: decodedCursor.search_id,
    });
    const page = await fetchAllFeedPage({
      serviceClient: params.serviceClient,
      searchId: session.id,
      surface: session.surface,
      snapshotCutoffIndexedAt: session.snapshot_cutoff_indexed_at,
      limit,
      cursor: decodedCursor,
      safetyExclusions: params.safetyExclusions,
      sortBy: params.sortBy,
    });

    await logSearchEvent({
      serviceClient: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      searchId: session.id,
      surface: session.surface,
      appliedContext: session.applied_context,
      normalizedInput: session.normalized_input,
      latencyMs: Date.now() - startedAt,
      candidateCount: page.items.length,
      rerankUsed: false,
      noMatch: page.items.length === 0,
    });

    return {
      search_id: session.id,
      applied_context: session.applied_context,
      items: page.items,
      next_cursor: page.next_cursor,
      no_match: page.no_match,
      internal: {
        interpreted_intent: null,
        rerank_used: false,
        candidate_count: page.items.length,
        rationale_tags_by_recipe: {},
      },
    };
  }

  const normalizedQuery = normalizeSearchText(params.query);
  const normalizedPresetId = !normalizedQuery
    ? normalizeSearchText(params.presetId)
    : null;
  const appliedContext: RecipeSearchAppliedContext = normalizedQuery
    ? "query"
    : normalizedPresetId
    ? "preset"
    : "all";
  const normalizedInput = normalizedQuery ??
    (normalizedPresetId ? derivePresetText(normalizedPresetId) : null);
  const snapshotCutoffIndexedAt = new Date().toISOString();

  if (appliedContext === "all") {
    const searchId = await createSearchSession({
      serviceClient: params.serviceClient,
      userId: params.userId,
      surface: params.surface,
      appliedContext,
      normalizedInput: null,
      presetId: null,
      interpretedIntent: null,
      queryEmbedding: null,
      snapshotCutoffIndexedAt,
    });

    const page = await fetchAllFeedPage({
      serviceClient: params.serviceClient,
      searchId,
      surface: params.surface,
      snapshotCutoffIndexedAt,
      limit,
      cursor: null,
      safetyExclusions: params.safetyExclusions,
      sortBy: params.sortBy,
    });

    await logSearchEvent({
      serviceClient: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      searchId,
      surface: params.surface,
      appliedContext,
      normalizedInput: null,
      latencyMs: Date.now() - startedAt,
      candidateCount: page.items.length,
      rerankUsed: false,
      noMatch: page.items.length === 0,
    });

    return {
      search_id: searchId,
      applied_context: appliedContext,
      items: page.items,
      next_cursor: page.next_cursor,
      no_match: page.no_match,
      internal: {
        interpreted_intent: null,
        rerank_used: false,
        candidate_count: page.items.length,
        rationale_tags_by_recipe: {},
      },
    };
  }

  const interpretedRaw = await llmGateway.interpretRecipeSearch({
    client: params.serviceClient,
    userId: params.userId,
    requestId: params.requestId,
    context: buildInterpretSearchContext({
      surface: params.surface,
      appliedContext,
      normalizedInput: normalizedInput ?? "",
      presetId: normalizedPresetId,
      conversationContext: params.conversationContext,
    }),
    modelOverrides: params.modelOverrides,
  });
  const interpretedIntent = normalizeSearchIntent({
    appliedContext,
    normalizedInput,
    raw: interpretedRaw,
  });

  const embedding = await llmGateway.embedRecipeSearchQuery({
    client: params.serviceClient,
    userId: params.userId,
    requestId: params.requestId,
    inputText: interpretedIntent.normalized_query,
    modelOverrides: params.modelOverrides,
  });
  const hybridItems = await fetchHybridCandidates({
    serviceClient: params.serviceClient,
    surface: params.surface,
    snapshotCutoffIndexedAt,
    intent: interpretedIntent,
    embeddingVector: embedding.vector,
    safetyExclusions: params.safetyExclusions,
  });

  let page1Items = hybridItems.slice(0, limit);
  let rerankUsed = false;
  let rationaleTagsByRecipe: Record<string, string[]> = {};

  if (hybridItems.length > 1) {
    const rerankCandidates = hybridItems.slice(0, PAGE1_RERANK_LIMIT);
    try {
      const rerankRaw = await llmGateway.rerankRecipeSearch({
        client: params.serviceClient,
        userId: params.userId,
        requestId: params.requestId,
        context: {
          intent: interpretedIntent as unknown as JsonValue,
          candidates: rerankCandidates.map(serializeSearchCard),
        },
        timeoutMs: params.surface === "chat" ? 2_000 : 1_200,
        modelOverrides: params.modelOverrides,
      });
      const reranked = normalizeRerankResult({
        raw: rerankRaw,
        candidates: rerankCandidates,
      });
      rerankUsed = true;
      rationaleTagsByRecipe = reranked.rationaleTagsByRecipe;
      page1Items = reranked.orderedItems.slice(0, limit);
    } catch {
      rerankUsed = false;
    }
  }

  const searchId = await createSearchSession({
    serviceClient: params.serviceClient,
    userId: params.userId,
    surface: params.surface,
    appliedContext,
    normalizedInput: interpretedIntent.normalized_query,
    presetId: normalizedPresetId,
    interpretedIntent,
    queryEmbedding: serializeVector(embedding.vector),
    snapshotCutoffIndexedAt,
    page1PromotedRecipeIds: page1Items.map((item) => item.id),
    hybridItems,
  });

  const nextCursor = filterSessionItems(
      hybridItems,
      page1Items.map((item) => item.id),
    ).length > 0
    ? encodeSearchCursor({
      v: 1,
      kind: "session",
      search_id: searchId,
      offset: 0,
    })
    : null;
  const noMatch = hybridItems.length === 0 ? buildNoMatch(appliedContext) : null;

  await logSearchEvent({
    serviceClient: params.serviceClient,
    userId: params.userId,
    requestId: params.requestId,
    searchId,
    surface: params.surface,
    appliedContext,
    normalizedInput: interpretedIntent.normalized_query,
    latencyMs: Date.now() - startedAt,
    candidateCount: hybridItems.length,
    rerankUsed,
    noMatch: hybridItems.length === 0,
  });

  return {
    search_id: searchId,
    applied_context: appliedContext,
    items: page1Items,
    next_cursor: nextCursor,
    no_match: noMatch,
    internal: {
      interpreted_intent: interpretedIntent,
      rerank_used: rerankUsed,
      candidate_count: hybridItems.length,
      rationale_tags_by_recipe: rationaleTagsByRecipe,
    },
  };
};
