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
  const { request, url, segments, method, auth, client, serviceClient, requestId, respond, modelOverrides } = context;
  const {
    parseUuid,
    getPreferences,
    resolvePresentationOptions,
    fetchCookbookEntryDetail,
    deriveCanonicalForCookbookEntry,
    logChangelog,
    buildCookbookFeed,
    buildCookbookInsightDeterministic,
  } = deps;

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
    const { items, suggestedChips, staleContext } = await buildCookbookFeed(
      client,
      auth.userId,
    );
    const cookbookInsight = buildCookbookInsightDeterministic(items);
    return respond(200, {
      items,
      suggested_chips: suggestedChips,
      cookbook_insight: cookbookInsight,
      stale_context: staleContext,
    });
  }

  // ── GET/DELETE /recipes/cookbook/:entryId ──
  if (
    segments.length === 3 &&
    segments[0] === "recipes" &&
    segments[1] === "cookbook"
  ) {
    const cookbookEntryId = parseUuid(segments[2]);

    if (method === "GET") {
      const preferences = await getPreferences(client, auth.userId);
      const viewOptions = resolvePresentationOptions({
        query: url.searchParams,
        presentationPreferences:
          preferences.presentation_preferences as Record<string, unknown>,
      });
      const detail = await fetchCookbookEntryDetail({
        client,
        userId: auth.userId,
        cookbookEntryId,
        viewOptions,
      });
      return respond(200, detail);
    }

    if (method === "DELETE") {
      const { error } = await client
        .from("cookbook_entries")
        .delete()
        .eq("id", cookbookEntryId)
        .eq("user_id", auth.userId);

      if (error) {
        throw new ApiError(
          500,
          "cookbook_entry_delete_failed",
          "Could not delete cookbook entry",
          error.message,
        );
      }

      await logChangelog({
        serviceClient,
        actorUserId: auth.userId,
        scope: "cookbook",
        entityType: "cookbook_entry",
        entityId: cookbookEntryId,
        action: "deleted",
        requestId,
      });

      return respond(200, { deleted: true, cookbook_entry_id: cookbookEntryId });
    }
  }

  // ── POST /recipes/cookbook/:entryId/canon/retry ──
  if (
    segments.length === 5 &&
    segments[0] === "recipes" &&
    segments[1] === "cookbook" &&
    segments[3] === "canon" &&
    segments[4] === "retry" &&
    method === "POST"
  ) {
    const cookbookEntryId = parseUuid(segments[2]);

    const result = await deriveCanonicalForCookbookEntry({
      serviceClient,
      userId: auth.userId,
      requestId,
      cookbookEntryId,
      canonicalizeRecipePayload: deps.canonicalizeRecipePayload,
      resolveAndPersistCanonicalRecipe: deps.resolveAndPersistCanonicalRecipe,
      ensurePersistedRecipeImageRequest: deps.ensurePersistedRecipeImageRequest,
      scheduleImageQueueDrain: deps.scheduleImageQueueDrain,
      modelOverrides,
    });

    await logChangelog({
      serviceClient,
      actorUserId: auth.userId,
      scope: "cookbook",
      entityType: "cookbook_entry",
      entityId: cookbookEntryId,
      action: "canon_retry",
      requestId,
      afterJson: result as unknown as JsonValue,
    });

    return respond(200, {
      cookbook_entry_id: result.cookbookEntryId,
      canonical_recipe_id: result.canonicalRecipeId,
      canonical_status: result.canonicalStatus,
    });
  }

  return null;
};
