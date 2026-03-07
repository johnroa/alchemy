import {
  ApiError,
  requireJsonBody,
} from "../../_shared/errors.ts";
import type { JsonValue } from "../../_shared/types.ts";
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
  resolveRelationTypeId: (
    client: RouteContext["serviceClient"],
    name: string,
  ) => Promise<string>;
  logChangelog: (input: {
    serviceClient: RouteContext["serviceClient"];
    actorUserId: string;
    scope: string;
    entityType: string;
    entityId: string;
    action: string;
    requestId: string;
    afterJson?: JsonValue;
  }) => Promise<void>;
};

/**
 * Aggregated substitution pattern from variant provenance.
 * Keyed by "original → replacement" pair, tracks which constraints
 * triggered the substitution and how many times it appeared.
 */
type SubstitutionPattern = {
  original: string;
  replacement: string;
  constraints: Map<string, number>;
  reasons: Set<string>;
  count: number;
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

  // ── POST /graph/substitution-aggregate ──
  // Batch job that scans variant provenance for substitution_diffs,
  // aggregates patterns across all users, and creates/strengthens
  // substitutes_for and alternative_to graph edges. Run periodically
  // from the admin UI or a scheduled GitHub Action.
  //
  // Body: { limit?: number, min_count?: number, min_confidence?: number }
  // - limit: max variant versions to scan per invocation (default 500)
  // - min_count: minimum occurrences before creating an edge (default 3)
  // - min_confidence: floor confidence for new edges (default 0.5)
  if (
    segments.length === 2 &&
    segments[0] === "graph" &&
    segments[1] === "substitution-aggregate" &&
    method === "POST"
  ) {
    const { serviceClient, auth, requestId, respond: respondCtx } = context;
    const body = await requireJsonBody<{
      limit?: number;
      min_count?: number;
      min_confidence?: number;
    }>(context.request);

    const scanLimit = Math.max(1, Math.min(2000, Number(body.limit ?? 500)));
    const minCount = Math.max(1, Number(body.min_count ?? 3));
    // Floor confidence for new edges — higher count pushes toward 1.0.
    const baseConfidence = Math.max(0.1, Math.min(1, Number(body.min_confidence ?? 0.5)));

    // 1. Load recent variant versions with substitution_diffs in provenance.
    // We scan versions that haven't been aggregated yet by checking a
    // metadata flag or simply scanning the most recent N versions.
    const { data: versions, error: versionsError } = await serviceClient
      .from("user_recipe_variant_versions")
      .select("id, provenance")
      .not("provenance->substitution_diffs", "is", null)
      .order("created_at", { ascending: false })
      .limit(scanLimit);

    if (versionsError) {
      throw new ApiError(
        500,
        "substitution_aggregate_scan_failed",
        "Could not scan variant versions for substitution diffs",
        versionsError.message,
      );
    }

    if (!versions || versions.length === 0) {
      return respondCtx(200, {
        scanned: 0,
        patterns_found: 0,
        edges_created: 0,
        edges_strengthened: 0,
      });
    }

    // 2. Extract and aggregate substitution patterns.
    const patternMap = new Map<string, SubstitutionPattern>();

    for (const version of versions) {
      const provenance = version.provenance as Record<string, unknown> | null;
      const diffs = provenance?.substitution_diffs;
      if (!Array.isArray(diffs)) continue;

      for (const diff of diffs) {
        if (
          !diff || typeof diff !== "object" || Array.isArray(diff) ||
          typeof (diff as Record<string, unknown>).original !== "string" ||
          typeof (diff as Record<string, unknown>).replacement !== "string"
        ) continue;

        const entry = diff as Record<string, string>;
        const original = entry.original.toLowerCase().trim();
        const replacement = entry.replacement.toLowerCase().trim();
        if (!original || !replacement || original === replacement) continue;

        // Canonical key ensures bidirectional dedup for alternative_to.
        const key = `${original}::${replacement}`;
        const existing = patternMap.get(key);
        if (existing) {
          existing.count += 1;
          const constraint = (entry.constraint ?? "unspecified").toLowerCase();
          existing.constraints.set(
            constraint,
            (existing.constraints.get(constraint) ?? 0) + 1,
          );
          if (entry.reason) existing.reasons.add(entry.reason);
        } else {
          const constraint = (entry.constraint ?? "unspecified").toLowerCase();
          patternMap.set(key, {
            original,
            replacement,
            constraints: new Map([[constraint, 1]]),
            reasons: new Set(entry.reason ? [entry.reason] : []),
            count: 1,
          });
        }
      }
    }

    // 3. Filter patterns by min_count threshold.
    const qualifiedPatterns = [...patternMap.values()].filter(
      (p) => p.count >= minCount,
    );

    if (qualifiedPatterns.length === 0) {
      return respondCtx(200, {
        scanned: versions.length,
        patterns_found: patternMap.size,
        patterns_qualified: 0,
        edges_created: 0,
        edges_strengthened: 0,
      });
    }

    // 4. Resolve graph relation type IDs.
    const [substitutesForId, alternativeToId] = await Promise.all([
      deps.resolveRelationTypeId(serviceClient, "substitutes_for"),
      deps.resolveRelationTypeId(serviceClient, "alternative_to"),
    ]);

    // 5. For each qualified pattern, find or create graph entities
    //    and upsert edges with confidence proportional to count.
    let edgesCreated = 0;
    let edgesStrengthened = 0;

    for (const pattern of qualifiedPatterns) {
      // Resolve ingredient entities by label (case-insensitive).
      const [{ data: originalEntity }, { data: replacementEntity }] =
        await Promise.all([
          serviceClient
            .from("graph_entities")
            .select("id")
            .eq("entity_type", "ingredient")
            .ilike("label", pattern.original)
            .maybeSingle(),
          serviceClient
            .from("graph_entities")
            .select("id")
            .eq("entity_type", "ingredient")
            .ilike("label", pattern.replacement)
            .maybeSingle(),
        ]);

      // Skip if either ingredient isn't in the graph yet — we only
      // strengthen edges between known entities to avoid noise.
      if (!originalEntity?.id || !replacementEntity?.id) continue;

      // Confidence scales with count: base + log2(count) * 0.1, capped at 0.95.
      // This gives diminishing returns so a single popular swap doesn't
      // immediately saturate confidence.
      const confidence = Math.min(
        0.95,
        baseConfidence + Math.log2(pattern.count) * 0.1,
      );

      const topConstraints = [...pattern.constraints.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => ({ name, count }));

      const edgeMetadata = {
        aggregated_count: pattern.count,
        top_constraints: topConstraints,
        sample_reasons: [...pattern.reasons].slice(0, 3),
        last_aggregated_at: new Date().toISOString(),
      };

      // Upsert substitutes_for edge (original → replacement).
      const { data: subEdge } = await serviceClient
        .from("graph_edges")
        .upsert(
          {
            from_entity_id: originalEntity.id,
            to_entity_id: replacementEntity.id,
            relation_type_id: substitutesForId,
            source: "variant_aggregation",
            confidence,
            metadata: edgeMetadata,
          },
          { onConflict: "from_entity_id,to_entity_id,relation_type_id,source" },
        )
        .select("id, created_at, metadata")
        .single();

      if (subEdge) {
        const wasExisting = subEdge.metadata &&
          typeof subEdge.metadata === "object" &&
          (subEdge.metadata as Record<string, unknown>).aggregated_count !== undefined &&
          (subEdge.metadata as Record<string, unknown>).aggregated_count !== pattern.count;
        if (wasExisting) {
          edgesStrengthened += 1;
        } else {
          edgesCreated += 1;
        }
      }

      // Upsert alternative_to edge (bidirectional: replacement → original).
      const { data: altEdge } = await serviceClient
        .from("graph_edges")
        .upsert(
          {
            from_entity_id: replacementEntity.id,
            to_entity_id: originalEntity.id,
            relation_type_id: alternativeToId,
            source: "variant_aggregation",
            confidence,
            metadata: edgeMetadata,
          },
          { onConflict: "from_entity_id,to_entity_id,relation_type_id,source" },
        )
        .select("id, created_at, metadata")
        .single();

      if (altEdge) {
        const wasExisting = altEdge.metadata &&
          typeof altEdge.metadata === "object" &&
          (altEdge.metadata as Record<string, unknown>).aggregated_count !== undefined &&
          (altEdge.metadata as Record<string, unknown>).aggregated_count !== pattern.count;
        if (wasExisting) {
          edgesStrengthened += 1;
        } else {
          edgesCreated += 1;
        }
      }
    }

    await deps.logChangelog({
      serviceClient,
      actorUserId: auth.userId,
      scope: "graph",
      entityType: "substitution_aggregation",
      entityId: requestId,
      action: "batch_aggregated",
      requestId,
      afterJson: {
        scanned: versions.length,
        patterns_found: patternMap.size,
        patterns_qualified: qualifiedPatterns.length,
        edges_created: edgesCreated,
        edges_strengthened: edgesStrengthened,
      } as unknown as JsonValue,
    });

    return respondCtx(200, {
      scanned: versions.length,
      patterns_found: patternMap.size,
      patterns_qualified: qualifiedPatterns.length,
      edges_created: edgesCreated,
      edges_strengthened: edgesStrengthened,
    });
  }

  return null;
};
