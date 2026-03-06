import { getAdminClient } from "@/lib/supabase-admin";
import { isSchemaMissingError } from "./shared";

const getMetadataQueueSnapshot = async (
  client: ReturnType<typeof getAdminClient>
): Promise<{ pending: number; processing: number; ready: number; failed: number }> => {
  const [pending, processing, ready, failed] = await Promise.all([
    client.from("recipe_metadata_jobs").select("id", { count: "exact", head: true }).eq("status", "pending"),
    client.from("recipe_metadata_jobs").select("id", { count: "exact", head: true }).eq("status", "processing"),
    client.from("recipe_metadata_jobs").select("id", { count: "exact", head: true }).eq("status", "ready"),
    client.from("recipe_metadata_jobs").select("id", { count: "exact", head: true }).eq("status", "failed")
  ]);

  const errors = [pending.error, processing.error, ready.error, failed.error].filter(
    (error): error is NonNullable<typeof pending.error> => Boolean(error)
  );

  const blockingError = errors.find((error) => !isSchemaMissingError(error));
  if (blockingError) {
    throw new Error(blockingError.message);
  }

  return {
    pending: pending.count ?? 0,
    processing: processing.count ?? 0,
    ready: ready.count ?? 0,
    failed: failed.count ?? 0
  };
};

export const getGraphData = async (recipeId?: string): Promise<{
  context_recipe_id: string | null;
  entities: Array<{ id: string; entity_type: string; label: string; metadata: Record<string, unknown> }>;
  edges: Array<{
    id: string;
    from_entity_id: string;
    to_entity_id: string;
    from_label: string;
    to_label: string;
    relation_type: string;
    confidence: number;
    source: string;
  }>;
  relation_types: string[];
  metadata_queue: {
    pending: number;
    processing: number;
    ready: number;
    failed: number;
  };
}> => {
  const client = getAdminClient();

  let entityIds: string[] = [];
  let contextRecipeId: string | null = null;

  if (recipeId) {
    const { data: recipe, error: recipeError } = await client
      .from("recipes")
      .select("id,current_version_id")
      .eq("id", recipeId)
      .maybeSingle();

    if (recipeError && !isSchemaMissingError(recipeError)) {
      throw new Error(recipeError.message);
    }

    if (recipe?.current_version_id) {
      contextRecipeId = recipe.id;
      const { data: links, error: linksError } = await client
        .from("recipe_graph_links")
        .select("entity_id")
        .eq("recipe_version_id", recipe.current_version_id);

      if (linksError && !isSchemaMissingError(linksError)) {
        throw new Error(linksError.message);
      }

      entityIds = Array.from(new Set((links ?? []).map((link) => String(link.entity_id))));
    }
  }

  let entities: Array<{ id: string; entity_type: string; label: string; metadata: Record<string, unknown> }> = [];
  if (entityIds.length > 0) {
    const { data: byId, error: byIdError } = await client
      .from("graph_entities")
      .select("id,entity_type,label,metadata")
      .in("id", entityIds)
      .limit(400);

    if (byIdError && !isSchemaMissingError(byIdError)) {
      throw new Error(byIdError.message);
    }

    entities = ((byId ?? []) as Array<{ id: string; entity_type: string; label: string; metadata: Record<string, unknown> }>).slice(0, 400);
  } else {
    const { data: recentEntities, error: entitiesError } = await client
      .from("graph_entities")
      .select("id,entity_type,label,metadata")
      .order("updated_at", { ascending: false })
      .limit(400);

    if (entitiesError && !isSchemaMissingError(entitiesError)) {
      throw new Error(entitiesError.message);
    }

    entities = (recentEntities ?? []) as Array<{ id: string; entity_type: string; label: string; metadata: Record<string, unknown> }>;
    entityIds = entities.map((entity) => entity.id);
  }

  if (entityIds.length === 0) {
    const queue = await getMetadataQueueSnapshot(client);
    return { context_recipe_id: contextRecipeId, entities: [], edges: [], relation_types: [], metadata_queue: queue };
  }

  const [{ data: edgesFrom, error: edgesFromError }, { data: edgesTo, error: edgesToError }] = await Promise.all([
    client.from("graph_edges").select("id,from_entity_id,to_entity_id,relation_type_id,confidence,source").in("from_entity_id", entityIds).limit(500),
    client.from("graph_edges").select("id,from_entity_id,to_entity_id,relation_type_id,confidence,source").in("to_entity_id", entityIds).limit(500)
  ]);

  if (edgesFromError && !isSchemaMissingError(edgesFromError)) {
    throw new Error(edgesFromError.message);
  }
  if (edgesToError && !isSchemaMissingError(edgesToError)) {
    throw new Error(edgesToError.message);
  }

  const rawEdges = [...(edgesFrom ?? []), ...(edgesTo ?? [])] as Array<{
    id: string;
    from_entity_id: string;
    to_entity_id: string;
    relation_type_id: string;
    confidence: number;
    source: string;
  }>;
  const entityIdSet = new Set(entityIds);
  const edgeById = new Map<string, (typeof rawEdges)[number]>();
  for (const edge of rawEdges) {
    if (!entityIdSet.has(edge.from_entity_id) || !entityIdSet.has(edge.to_entity_id)) {
      continue;
    }
    edgeById.set(edge.id, edge);
  }
  const edges = Array.from(edgeById.values());

  const relationTypeIds = Array.from(new Set(edges.map((edge) => edge.relation_type_id)));
  let relationNameById = new Map<string, string>();
  if (relationTypeIds.length > 0) {
    const { data: relationRows, error: relationError } = await client
      .from("graph_relation_types")
      .select("id,name")
      .in("id", relationTypeIds);
    if (relationError && !isSchemaMissingError(relationError)) {
      throw new Error(relationError.message);
    }
    relationNameById = new Map((relationRows ?? []).map((row) => [row.id, row.name]));
  }

  const entityLabelById = new Map(entities.map((entity) => [entity.id, entity.label]));

  return {
    context_recipe_id: contextRecipeId,
    entities,
    edges: edges.map((edge) => ({
      id: edge.id,
      from_entity_id: edge.from_entity_id,
      to_entity_id: edge.to_entity_id,
      from_label: entityLabelById.get(edge.from_entity_id) ?? edge.from_entity_id.slice(0, 8),
      to_label: entityLabelById.get(edge.to_entity_id) ?? edge.to_entity_id.slice(0, 8),
      relation_type: relationNameById.get(edge.relation_type_id) ?? "unknown",
      confidence: Number(edge.confidence ?? 0),
      source: String(edge.source ?? "unknown")
    })),
    relation_types: Array.from(new Set(edges.map((edge) => relationNameById.get(edge.relation_type_id) ?? "unknown"))).sort(),
    metadata_queue: await getMetadataQueueSnapshot(client)
  };
};
