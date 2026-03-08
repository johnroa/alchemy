import {
  requireJsonBody,
} from "../../../_shared/errors.ts";
import type { JsonValue } from "../../../_shared/types.ts";
import { getInstallIdFromHeaders, logBehaviorEvents } from "../../lib/behavior-events.ts";
import type { RouteContext } from "../shared.ts";
import type { RecipesDeps } from "./types.ts";

export const handleSearchRoutes = async (
  context: RouteContext,
  deps: RecipesDeps,
): Promise<Response | null> => {
  const { request, segments, method, auth, client, serviceClient, requestId, respond } = context;
  const {
    getPreferences,
    getMemorySnapshot,
    getActiveMemories,
    computeSafetyExclusions,
    searchRecipes,
    getExploreForYouFeed,
  } = deps;

  if (
    segments.length === 3 &&
    segments[0] === "recipes" &&
    segments[1] === "explore" &&
    segments[2] === "for-you" &&
    method === "POST"
  ) {
    const startedAt = Date.now();
    const body = await requireJsonBody<{
      cursor?: string;
      limit?: number;
      preset_id?: string | null;
      chip_id?: string | null;
    }>(request);
    const installId = getInstallIdFromHeaders(request);
    const chipId = body.chip_id ?? body.preset_id ?? null;

    const isCursorRequest = typeof body.cursor === "string" && body.cursor.trim().length > 0;
    const preferences = isCursorRequest
      ? null
      : await getPreferences(client, auth.userId);
    const safetyExclusions = preferences ? computeSafetyExclusions(preferences) : undefined;
    const [memorySnapshot, activeMemories] = isCursorRequest
      ? [{}, []]
      : await Promise.all([
        getMemorySnapshot(client, auth.userId),
        getActiveMemories(client, auth.userId, 12),
      ]);

    const response = await getExploreForYouFeed({
      serviceClient,
      userId: auth.userId,
      requestId,
      cursor: body.cursor ?? null,
      limit: typeof body.limit === "number" ? body.limit : null,
      presetId: chipId,
      chipId,
      preferences: (preferences ?? {}) as Record<string, JsonValue>,
      memorySnapshot,
      activeMemories: activeMemories as unknown as JsonValue,
      safetyExclusions,
      modelOverrides: context.modelOverrides,
    });
    const { internal, ...publicResponse } = response;

    await logBehaviorEvents({
      serviceClient,
      events: [{
        eventId: crypto.randomUUID(),
        userId: auth.userId,
        installId,
        eventType: "explore_feed_served",
        surface: "explore",
        sessionId: response.feed_id,
        algorithmVersion: response.algorithm_version,
        payload: {
          applied_context: response.applied_context,
          preset_id: chipId,
          chip_id: chipId,
          profile_state: response.profile_state,
          candidate_count: internal.candidate_count,
          rerank_used: internal.rerank_used,
          fallback_path: internal.fallback_path,
          feed_latency_ms: Date.now() - startedAt,
        },
      }],
    });

    return respond(200, publicResponse);
  }

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
      modelOverrides: context.modelOverrides,
    });

    return respond(200, response);
  }

  return null;
};
