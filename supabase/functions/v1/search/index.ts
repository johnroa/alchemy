// Re-export facade — exposes exactly the public API that recipe-search.ts
// originally exported. Internal types and helpers stay module-private.

export type {
  RecipeSearchSurface,
  RecipeSearchAppliedContext,
  RecipeSearchDifficulty,
  RecipeSearchCard,
  RecipeSearchNoMatch,
  RecipeSearchConversationContext,
  RecipeSearchIntent,
  RecipeSearchResponse,
  InternalRecipeSearchResponse,
  SearchSafetyExclusions,
  RecipeSearchSortBy,
} from "./types.ts";

export {
  encodeSearchCursor,
  decodeSearchCursor,
} from "./filters.ts";

export {
  buildRecipeSearchDocument,
  loadRecipeSearchDocumentSource,
  upsertRecipeSearchDocument,
  backfillRecipeSearchDocuments,
} from "./index-management.ts";

export { searchRecipes } from "./query.ts";
