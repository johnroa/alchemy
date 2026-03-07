import {
  requireJsonBody,
} from "../../../_shared/errors.ts";
import type { RouteContext } from "../shared.ts";
import type { RecipesDeps } from "./types.ts";

export const handleSearchRoutes = async (
  context: RouteContext,
  deps: RecipesDeps,
): Promise<Response | null> => {
  const { request, segments, method, auth, client, serviceClient, requestId, respond } = context;
  const { getPreferences, computeSafetyExclusions, searchRecipes } = deps;

  if (
    segments.length === 2 &&
    segments[0] === "recipes" &&
    segments[1] === "search" &&
    method === "POST"
  ) {
    const body = await requireJsonBody<{
      query?: string;
      preset_id?: string;
      cursor?: string;
      limit?: number;
      sort_by?: string;
    }>(request);

    // Load user preferences for safety exclusions — ensures recipes
    // containing the user's allergens/restrictions are never surfaced.
    const searchPrefs = await getPreferences(client, auth.userId);
    const safetyExclusions = computeSafetyExclusions(searchPrefs);

    // Validate sort_by: only "recent", "popular", "trending" are valid.
    const validSorts = ["recent", "popular", "trending"] as const;
    type SortBy = typeof validSorts[number];
    const sortBy: SortBy = body.sort_by && validSorts.includes(body.sort_by as SortBy)
      ? (body.sort_by as SortBy)
      : "recent";

    const response = await searchRecipes({
      serviceClient,
      userId: auth.userId,
      requestId,
      surface: "explore",
      query: body.query ?? null,
      presetId: body.preset_id ?? null,
      cursor: body.cursor ?? null,
      limit: typeof body.limit === "number" ? body.limit : null,
      safetyExclusions,
      sortBy,
    });

    return respond(200, response);
  }

  return null;
};
