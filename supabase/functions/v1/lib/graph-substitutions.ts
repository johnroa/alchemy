/**
 * Graph-grounded substitution lookup for variant personalization.
 *
 * Before invoking the LLM for recipe personalization, the system queries
 * the knowledge graph for proven ingredient substitution patterns that
 * match the user's dietary constraints. This gives the LLM concrete
 * grounding data rather than inventing substitutions from scratch.
 *
 * If no relevant edges exist the caller falls back to unconstrained
 * LLM generation — "no grounding available, LLM invents freely."
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { JsonValue } from "../../_shared/types.ts";

/**
 * Fetches graph-backed substitution patterns relevant to a canonical
 * recipe's ingredients and the user's dietary constraints.
 *
 * How it works:
 * 1. Load ingredient entity IDs linked to the canonical version
 * 2. Query substitutes_for edges from variant_aggregation source
 * 3. Filter by edges whose metadata.top_constraints overlap the user's
 *    active constraints (dietary_restrictions + aversions)
 * 4. Return formatted objects the LLM can use as grounding context
 *
 * Returns an empty array if no relevant substitutions exist, which
 * the caller treats as "no grounding available — LLM invents freely."
 */
export const fetchGraphSubstitutions = async (params: {
  serviceClient: SupabaseClient;
  recipeVersionId: string;
  constraints: string[];
}): Promise<Record<string, JsonValue>[]> => {
  if (params.constraints.length === 0) return [];

  // 1. Find ingredient entities linked to this recipe version.
  const { data: links } = await params.serviceClient
    .from("recipe_graph_links")
    .select("entity_id")
    .eq("recipe_version_id", params.recipeVersionId);

  const entityIds = (links ?? []).map((l) => l.entity_id);
  if (entityIds.length === 0) return [];

  // 2. Resolve the substitutes_for relation type ID.
  const { data: relType } = await params.serviceClient
    .from("graph_relation_types")
    .select("id")
    .eq("name", "substitutes_for")
    .maybeSingle();

  if (!relType?.id) return [];

  // 3. Query edges from recipe ingredients with variant_aggregation source.
  const { data: edges } = await params.serviceClient
    .from("graph_edges")
    .select("from_entity_id, to_entity_id, confidence, metadata")
    .eq("relation_type_id", relType.id)
    .eq("source", "variant_aggregation")
    .in("from_entity_id", entityIds)
    .gte("confidence", 0.4)
    .order("confidence", { ascending: false })
    .limit(30);

  if (!edges || edges.length === 0) return [];

  // 4. Filter edges whose aggregated constraints overlap the user's.
  const constraintSet = new Set(params.constraints);
  const relevant: Record<string, JsonValue>[] = [];

  // Batch-load entity labels for the substitution targets.
  const targetIds = edges.map((e) => e.to_entity_id);
  const sourceIds = edges.map((e) => e.from_entity_id);
  const allEntityIds = [...new Set([...targetIds, ...sourceIds])];

  const { data: entities } = await params.serviceClient
    .from("graph_entities")
    .select("id, label")
    .in("id", allEntityIds);

  const entityLabel = new Map<string, string>();
  for (const e of entities ?? []) {
    entityLabel.set(e.id, e.label);
  }

  for (const edge of edges) {
    const meta = edge.metadata as Record<string, unknown> | null;
    const topConstraints = Array.isArray(meta?.top_constraints)
      ? (meta.top_constraints as Array<{ name: string; count: number }>)
      : [];

    // Check if any of the edge's driving constraints match the user's.
    const matchingConstraints = topConstraints.filter((c) =>
      constraintSet.has(c.name.toLowerCase())
    );
    if (matchingConstraints.length === 0) continue;

    const originalLabel = entityLabel.get(edge.from_entity_id) ?? "unknown";
    const replacementLabel = entityLabel.get(edge.to_entity_id) ?? "unknown";

    relevant.push({
      original: originalLabel,
      replacement: replacementLabel,
      confidence: edge.confidence,
      constraints: matchingConstraints.map((c) => c.name) as unknown as JsonValue,
      reasons: (Array.isArray(meta?.sample_reasons) ? meta.sample_reasons : []) as unknown as JsonValue,
      source: "knowledge_graph",
    });
  }

  return relevant;
};
