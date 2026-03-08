import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../../_shared/errors.ts";
import type { JsonValue } from "../../_shared/types.ts";
import { buildNoMatch, filterSessionItems, serializeSearchCard } from "./filters.ts";
import {
  type RecipeSearchAppliedContext,
  type RecipeSearchCard,
  type RecipeSearchResponse,
  type RecipeSearchSessionRow,
  type RecipeSearchSurface,
  type SearchSessionCreateInput,
  SEARCH_SESSION_TTL_MS,
} from "./types.ts";
import { encodeSearchCursor } from "./filters.ts";

export const createSearchSession = async (
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
      algorithm_version: params.algorithmVersion ?? null,
      profile_state: params.profileState ?? null,
      rationale_tags_by_recipe: params.rationaleTagsByRecipe ?? {},
      expires_at: expiresAt,
    })
    .select("id")
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

export const fetchSearchSession = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  searchId: string;
}): Promise<RecipeSearchSessionRow> => {
  const { data, error } = await params.serviceClient
    .from("recipe_search_sessions")
    .select(
      [
        "id",
        "owner_user_id",
        "surface",
        "applied_context",
        "normalized_input",
        "preset_id",
        "interpreted_intent",
        "query_embedding",
        "snapshot_cutoff_indexed_at",
        "page1_promoted_recipe_ids",
        "hybrid_items",
        "algorithm_version",
        "profile_state",
        "rationale_tags_by_recipe",
        "expires_at",
        "created_at",
      ].join(","),
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

  const row = data as unknown as RecipeSearchSessionRow;

  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new ApiError(
      410,
      "recipe_search_session_expired",
      "Search session has expired",
    );
  }

  return row;
};

export const fetchLatestReusableSearchSession = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  surface: RecipeSearchSurface;
  appliedContext: RecipeSearchAppliedContext;
  normalizedInput: string;
  presetId: string | null;
  algorithmVersion: string;
}): Promise<RecipeSearchSessionRow | null> => {
  let query = params.serviceClient
    .from("recipe_search_sessions")
    .select(
      [
        "id",
        "owner_user_id",
        "surface",
        "applied_context",
        "normalized_input",
        "preset_id",
        "interpreted_intent",
        "query_embedding",
        "snapshot_cutoff_indexed_at",
        "page1_promoted_recipe_ids",
        "hybrid_items",
        "algorithm_version",
        "profile_state",
        "rationale_tags_by_recipe",
        "expires_at",
        "created_at",
      ].join(","),
    )
    .eq("owner_user_id", params.userId)
    .eq("surface", params.surface)
    .eq("applied_context", params.appliedContext)
    .eq("normalized_input", params.normalizedInput)
    .eq("algorithm_version", params.algorithmVersion)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1);

  query = params.presetId
    ? query.eq("preset_id", params.presetId)
    : query.is("preset_id", null);

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new ApiError(
      500,
      "recipe_search_session_lookup_failed",
      "Could not load cached search session",
      error.message,
    );
  }

  return data ? data as unknown as RecipeSearchSessionRow : null;
};

export const logRecipeSearchEvent = async (params: {
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

export const applyRationaleTagsToCards = (
  items: RecipeSearchCard[],
  rationaleTagsByRecipe: Record<string, string[]>,
): RecipeSearchCard[] => {
  if (Object.keys(rationaleTagsByRecipe).length === 0) {
    return items;
  }

  return items.map((item) => ({
    ...item,
    why_tags: rationaleTagsByRecipe[item.id]?.slice(0, 4) ?? item.why_tags,
  }));
};

export const paginateSessionItems = (params: {
  searchId: string;
  items: RecipeSearchCard[];
  promotedRecipeIds: string[];
  offset: number;
  limit: number;
  noMatchContext?: RecipeSearchAppliedContext;
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
    no_match: pageItems.length === 0
      ? buildNoMatch(params.noMatchContext ?? "query")
      : null,
  };
};
