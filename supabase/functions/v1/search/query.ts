import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../../_shared/errors.ts";
import { llmGateway, type ModelOverrideMap } from "../../_shared/llm-gateway.ts";
import type { JsonValue } from "../../_shared/types.ts";
import type {
  AllFeedCursor,
  InternalRecipeSearchResponse,
  RecipeSearchAppliedContext,
  RecipeSearchConversationContext,
  RecipeSearchIntent,
  RecipeSearchSortBy,
  RecipeSearchSurface,
  SearchSafetyExclusions,
} from "./types.ts";
import {
  PAGE1_RERANK_LIMIT,
} from "./types.ts";
import {
  buildNoMatch,
  clampLimit,
  decodeSearchCursor,
  derivePresetText,
  encodeSearchCursor,
  filterSessionItems,
  normalizeRerankResult,
  normalizeSearchIntent,
  normalizeSearchText,
  normalizeStoredCards,
  serializeSearchCard,
  serializeVector,
} from "./filters.ts";
import {
  applyRationaleTagsToCards,
  createSearchSession,
  fetchSearchSession,
  logRecipeSearchEvent,
  paginateSessionItems,
} from "./session-store.ts";
import {
  buildInterpretSearchContext,
  fetchAllFeedPage,
  fetchHybridCandidates,
} from "./retrieval.ts";

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
    const rationaleTagsByRecipe = (
      typeof session.rationale_tags_by_recipe === "object" &&
        session.rationale_tags_by_recipe !== null &&
        !Array.isArray(session.rationale_tags_by_recipe)
    )
      ? session.rationale_tags_by_recipe as Record<string, string[]>
      : {};
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

    await logRecipeSearchEvent({
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
        rationale_tags_by_recipe: rationaleTagsByRecipe,
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

    await logRecipeSearchEvent({
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

    await logRecipeSearchEvent({
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

  await logRecipeSearchEvent({
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
