import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { JsonValue, RecipePayload } from "../../_shared/types.ts";
import type { RecipePreview } from "../recipe-preview.ts";

// ---------------------------------------------------------------------------
// Public types — re-exported through search/index.ts
// ---------------------------------------------------------------------------

export type RecipeSearchSurface = "explore" | "chat";
export type RecipeSearchAppliedContext = "all" | "preset" | "query" | "for_you";
export type RecipeSearchDifficulty = "easy" | "medium" | "complex";
export type ForYouProfileState = "cold" | "warm" | "established";

export type RecipeSearchCard = RecipePreview;

export type RecipeSearchNoMatch = {
  code: string;
  message: string;
  suggested_action: string;
};

export type RecipeSearchConversationContext = {
  latest_user_message?: string;
  thread?: Array<{ role: string; content: string }>;
  preferences?: JsonValue;
  selected_memories?: JsonValue;
  active_recipe?: JsonValue;
  candidate_recipe_set?: JsonValue;
};

export type RecipeSearchIntent = {
  normalized_query: string;
  applied_context: RecipeSearchAppliedContext;
  hard_filters: {
    cuisines: string[];
    diet_tags: string[];
    techniques: string[];
    exclude_ingredients: string[];
    max_time_minutes: number | null;
    max_difficulty: RecipeSearchDifficulty | null;
  };
  soft_targets: string[];
  exclusions: string[];
  sort_bias: string | null;
  query_style: "all" | "explicit" | "subjective" | "mixed";
};

export type RecipeSearchResponse = {
  search_id: string;
  applied_context: RecipeSearchAppliedContext;
  items: RecipeSearchCard[];
  next_cursor: string | null;
  no_match: RecipeSearchNoMatch | null;
};

export type ForYouFeedResponse = {
  feed_id: string;
  applied_context: "for_you" | "preset";
  profile_state: ForYouProfileState;
  algorithm_version: string;
  items: RecipeSearchCard[];
  next_cursor: string | null;
  no_match: RecipeSearchNoMatch | null;
};

export type InternalForYouFeedResponse = ForYouFeedResponse & {
  internal: {
    rerank_used: boolean;
    candidate_count: number;
    fallback_path: string | null;
    rationale_tags_by_recipe: Record<string, string[]>;
  };
};

export type InternalRecipeSearchResponse = RecipeSearchResponse & {
  internal: {
    interpreted_intent: RecipeSearchIntent | null;
    rerank_used: boolean;
    candidate_count: number;
    rationale_tags_by_recipe: Record<string, string[]>;
  };
};

/**
 * Safety exclusions derived from user constraint preferences. Injected
 * by the caller (which has access to the user's preference context)
 * so search results never surface recipes containing the user's
 * allergens or restricted ingredients.
 */
export type SearchSafetyExclusions = {
  /** Ingredients the user is allergic to or wants to avoid. Matched
   *  against canonical_ingredient_names via array overlap. */
  excludeIngredients: string[];
  /** Diet tags the recipe MUST have (e.g. "gluten-free", "nut-free").
   *  Recipes missing any of these tags are excluded. */
  requireDietTags: string[];
};

export type RecipeSearchSortBy = "recent" | "popular" | "trending";

// ---------------------------------------------------------------------------
// Internal types — used across search modules, not re-exported publicly
// ---------------------------------------------------------------------------

export type RecipeSearchSessionRow = {
  id: string;
  owner_user_id: string;
  surface: RecipeSearchSurface;
  applied_context: RecipeSearchAppliedContext;
  normalized_input: string | null;
  preset_id: string | null;
  interpreted_intent: JsonValue;
  query_embedding: string | null;
  snapshot_cutoff_indexed_at: string;
  page1_promoted_recipe_ids: string[] | null;
  hybrid_items: JsonValue;
  algorithm_version: string | null;
  profile_state: ForYouProfileState | null;
  rationale_tags_by_recipe: JsonValue;
  expires_at: string;
};

export type AllFeedCursor = {
  v: 1;
  kind: "all";
  search_id: string;
  last_indexed_at: string;
  last_recipe_id: string;
};

export type SessionCursor = {
  v: 1;
  kind: "session";
  search_id: string;
  offset: number;
};

export type SearchCursor = AllFeedCursor | SessionCursor;

export type SearchRpcRow = {
  recipe_id: string;
  recipe_version_id: string;
  title: string;
  summary: string | null;
  image_url: string | null;
  image_status: string;
  category: string | null;
  visibility: string;
  updated_at: string;
  quick_stats: JsonValue;
  indexed_at: string;
  save_count?: number;
  variant_count?: number;
  popularity_score?: number | string;
  trending_score?: number | string;
};

export type SearchDocumentSource = {
  recipeId: string;
  recipeVersionId: string;
  category: string | null;
  visibility: string;
  updatedAt: string;
  imageUrl: string | null;
  imageStatus: string;
  payload: RecipePayload;
  canonicalIngredientIds: string[];
  canonicalIngredientNames: string[];
  ontologyTermKeys: string[];
};

export type SearchBackfillTarget = {
  recipe_id: string;
  recipe_version_id: string;
};

export type SearchSessionCreateInput = {
  serviceClient: SupabaseClient;
  userId: string;
  surface: RecipeSearchSurface;
  appliedContext: RecipeSearchAppliedContext;
  normalizedInput: string | null;
  presetId: string | null;
  interpretedIntent: RecipeSearchIntent | null;
  queryEmbedding: string | null;
  snapshotCutoffIndexedAt: string;
  page1PromotedRecipeIds?: string[];
  hybridItems?: RecipeSearchCard[];
  algorithmVersion?: string | null;
  profileState?: ForYouProfileState | null;
  rationaleTagsByRecipe?: Record<string, string[]>;
};

export type UserTasteProfileRow = {
  user_id: string;
  profile_state: ForYouProfileState;
  algorithm_version: string;
  retrieval_text: string;
  retrieval_embedding: string | null;
  profile_json: JsonValue;
  signal_summary: JsonValue;
  source_event_watermark: string | null;
  last_built_at: string;
};

export type ExploreAlgorithmVersionRow = {
  version: string;
  status: "draft" | "active" | "retired";
  label: string;
  notes: string | null;
  profile_scope: string;
  profile_scope_version: number;
  rank_scope: string;
  rank_scope_version: number;
  novelty_policy: string;
  config: JsonValue;
  is_active: boolean;
  activated_at: string | null;
  retired_at: string | null;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SEARCH_SESSION_TTL_MS = 30 * 60 * 1000;
export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 20;
export const HYBRID_CANDIDATE_LIMIT = 200;
export const PAGE1_RERANK_LIMIT = 30;
