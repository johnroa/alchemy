import {
  ApiError,
  requireJsonBody,
} from "../../../_shared/errors.ts";
import type { JsonValue } from "../../../_shared/types.ts";
import type { RouteContext } from "../shared.ts";
import type { RecipesDeps } from "./types.ts";

export const handleCookbookRoutes = async (
  context: RouteContext,
  deps: RecipesDeps,
): Promise<Response | null> => {
  const { request, segments, method, auth, client, serviceClient, requestId, respond } = context;
  const { parseUuid, logChangelog, buildCookbookItems, buildCookbookInsightDeterministic } = deps;

  // ── GET/POST /collections ──
  if (segments.length === 1 && segments[0] === "collections") {
    if (method === "GET") {
      const { data, error } = await client
        .from("collections")
        .select("id,name,created_at")
        .order("created_at", { ascending: false });
      if (error) {
        throw new ApiError(
          500,
          "collections_fetch_failed",
          "Could not fetch collections",
          error.message,
        );
      }

      return respond(200, { items: data ?? [] });
    }

    if (method === "POST") {
      const body = await requireJsonBody<{ name: string }>(request);
      const name = body.name?.trim();
      if (!name) {
        throw new ApiError(
          400,
          "invalid_collection_name",
          "Collection name is required",
        );
      }

      const { data, error } = await client
        .from("collections")
        .insert({ name, owner_user_id: auth.userId })
        .select("id,name,created_at")
        .single();

      if (error || !data) {
        throw new ApiError(
          500,
          "collection_create_failed",
          "Could not create collection",
          error?.message,
        );
      }

      await logChangelog({
        serviceClient,
        actorUserId: auth.userId,
        scope: "collections",
        entityType: "collection",
        entityId: data.id,
        action: "created",
        requestId,
        afterJson: data as unknown as JsonValue,
      });

      return respond(200, data);
    }
  }

  // ── POST /collections/:id/items ──
  if (
    segments.length === 3 &&
    segments[0] === "collections" &&
    segments[2] === "items" &&
    method === "POST"
  ) {
    const collectionId = parseUuid(segments[1]);
    const body = await requireJsonBody<{ recipe_id: string }>(request);
    const recipeId = parseUuid(body.recipe_id);

    const { error } = await client.from("collection_items").upsert({
      collection_id: collectionId,
      recipe_id: recipeId,
    });

    if (error) {
      throw new ApiError(
        500,
        "collection_item_create_failed",
        "Could not add recipe to collection",
        error.message,
      );
    }

    await logChangelog({
      serviceClient,
      actorUserId: auth.userId,
      scope: "collections",
      entityType: "collection_item",
      entityId: `${collectionId}:${recipeId}`,
      action: "added",
      requestId,
    });

    return respond(200, { ok: true });
  }

  // ── GET /recipes/cookbook ──
  if (
    segments.length === 2 &&
    segments[0] === "recipes" &&
    segments[1] === "cookbook" &&
    method === "GET"
  ) {
    const items = await buildCookbookItems(client, auth.userId);
    const cookbookInsight = buildCookbookInsightDeterministic(items);
    return respond(200, { items, cookbook_insight: cookbookInsight });
  }

  return null;
};
