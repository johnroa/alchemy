import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../../_shared/errors.ts";
import type { JsonValue } from "../../_shared/types.ts";
import {
  buildNoMatch,
  encodeSearchCursor,
  mapRpcRowToCard,
  mergeUnique,
  serializeVector,
} from "./filters.ts";
import type {
  AllFeedCursor,
  RecipeSearchAppliedContext,
  RecipeSearchCard,
  RecipeSearchConversationContext,
  RecipeSearchIntent,
  RecipeSearchResponse,
  RecipeSearchSurface,
  RecipeSearchSortBy,
  SearchRpcRow,
  SearchSafetyExclusions,
} from "./types.ts";
import { HYBRID_CANDIDATE_LIMIT } from "./types.ts";

export const buildInterpretSearchContext = (params: {
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
    candidate_recipe_set: params.conversationContext?.candidate_recipe_set ?? null,
  };
};

export const fetchAllFeedPage = async (params: {
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

export const fetchHybridCandidates = async (params: {
  serviceClient: SupabaseClient;
  surface: RecipeSearchSurface;
  snapshotCutoffIndexedAt: string;
  intent: RecipeSearchIntent;
  embeddingVector: number[];
  safetyExclusions?: SearchSafetyExclusions;
  limit?: number;
  excludeRecipeIds?: string[];
}): Promise<RecipeSearchCard[]> => {
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
      p_limit: params.limit ?? HYBRID_CANDIDATE_LIMIT,
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

  const candidates = Array.isArray(data)
    ? (data as SearchRpcRow[]).map(mapRpcRowToCard)
    : [];
  const excludeRecipeIds = new Set(params.excludeRecipeIds ?? []);

  return excludeRecipeIds.size === 0
    ? candidates
    : candidates.filter((item) => !excludeRecipeIds.has(item.id));
};
