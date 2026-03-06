import {
  ApiError,
} from "../../_shared/errors.ts";
import type { RouteContext } from "./shared.ts";

type GraphDeps = {
  parseUuid: (value: string) => string;
  parseCsvParam: (value: string | null) => string[];
  fetchGraphNeighborhood: (input: {
    client: RouteContext["client"];
    seedEntityIds: string[];
    depth: number;
    minConfidence: number;
    relationTypeFilter: Set<string>;
    entityTypeFilter: Set<string>;
  }) => Promise<unknown>;
};

export const handleGraphRoutes = async (
  context: RouteContext,
  deps: GraphDeps,
): Promise<Response | null> => {
  const { url, segments, method, client, respond } = context;
  const { parseUuid, parseCsvParam, fetchGraphNeighborhood } = deps;

  if (
    segments.length === 3 &&
    segments[0] === "recipes" &&
    segments[2] === "graph" &&
    method === "GET"
  ) {
    const recipeId = parseUuid(segments[1]);
    const minConfidence = Math.max(
      0,
      Math.min(1, Number(url.searchParams.get("min_confidence") ?? "0") || 0),
    );
    const depth = Math.max(
      1,
      Math.min(2, Number(url.searchParams.get("depth") ?? "1") || 1),
    );
    const relationTypeFilter = new Set(
      parseCsvParam(url.searchParams.get("relation_types")),
    );
    const entityTypeFilter = new Set(
      parseCsvParam(url.searchParams.get("entity_types")),
    );

    const { data: recipe, error: recipeError } = await client
      .from("recipes")
      .select("current_version_id")
      .eq("id", recipeId)
      .maybeSingle();

    if (recipeError || !recipe?.current_version_id) {
      throw new ApiError(
        404,
        "recipe_or_version_not_found",
        "Recipe graph source was not found",
        recipeError?.message,
      );
    }

    const { data: links, error: linksError } = await client
      .from("recipe_graph_links")
      .select("entity_id")
      .eq("recipe_version_id", recipe.current_version_id);

    if (linksError) {
      throw new ApiError(
        500,
        "graph_links_fetch_failed",
        "Could not fetch graph links",
        linksError.message,
      );
    }

    const entityIds = (links ?? []).map((item) => item.entity_id);
    if (entityIds.length === 0) {
      return respond(200, { entities: [], edges: [] });
    }

    const graph = await fetchGraphNeighborhood({
      client,
      seedEntityIds: entityIds,
      depth,
      minConfidence,
      relationTypeFilter,
      entityTypeFilter,
    });

    return respond(200, graph);
  }

  if (
    segments.length === 3 &&
    segments[0] === "ingredients" &&
    segments[2] === "graph" &&
    method === "GET"
  ) {
    const ingredientId = parseUuid(segments[1]);
    const minConfidence = Math.max(
      0,
      Math.min(1, Number(url.searchParams.get("min_confidence") ?? "0") || 0),
    );
    const depth = Math.max(
      1,
      Math.min(2, Number(url.searchParams.get("depth") ?? "1") || 1),
    );
    const relationTypeFilter = new Set(
      parseCsvParam(url.searchParams.get("relation_types")),
    );
    const entityTypeFilter = new Set(
      parseCsvParam(url.searchParams.get("entity_types")),
    );

    const { data: ingredient, error: ingredientError } = await client
      .from("ingredients")
      .select("id,canonical_name")
      .eq("id", ingredientId)
      .maybeSingle();

    if (ingredientError || !ingredient) {
      throw new ApiError(
        404,
        "ingredient_not_found",
        "Ingredient graph source was not found",
        ingredientError?.message,
      );
    }

    const { data: entity, error: entityError } = await client
      .from("graph_entities")
      .select("id")
      .eq("entity_type", "ingredient")
      .ilike("label", ingredient.canonical_name)
      .maybeSingle();

    if (entityError || !entity?.id) {
      return respond(200, { entities: [], edges: [] });
    }

    const graph = await fetchGraphNeighborhood({
      client,
      seedEntityIds: [entity.id],
      depth,
      minConfidence,
      relationTypeFilter,
      entityTypeFilter,
    });

    return respond(200, graph);
  }

  return null;
};
