import type { RouteContext } from "../shared.ts";
import type { RecipesDeps } from "./types.ts";
import { handleCookbookRoutes } from "./cookbook.ts";
import { handleSearchRoutes } from "./search-routes.ts";
import { handleDetailRoutes } from "./detail.ts";
import { handleSaveRoutes } from "./save.ts";
import { handleVariantRoutes } from "./variant.ts";

export type { RecipesDeps } from "./types.ts";

/**
 * Top-level recipe route dispatcher. Tries each sub-handler in order and
 * returns the first non-null response. Order matters: cookbook and search
 * must be checked before the catch-all GET /recipes/:id in detail routes.
 */
export const handleRecipeRoutes = async (
  context: RouteContext,
  deps: RecipesDeps,
): Promise<Response | null> => {
  return (
    await handleCookbookRoutes(context, deps) ??
    await handleSearchRoutes(context, deps) ??
    await handleDetailRoutes(context, deps) ??
    await handleSaveRoutes(context, deps) ??
    await handleVariantRoutes(context, deps) ??
    null
  );
};
