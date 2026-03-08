import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../../_shared/errors.ts";
import type { JsonValue } from "../../_shared/types.ts";
import type { ModelOverrideMap } from "../../_shared/llm-gateway.ts";
import { isOptionalSemanticCapabilityUnavailable } from "./routing-utils.ts";
import { processMetadataJobs } from "./metadata-pipeline.ts";
import { processImageJobs as processCandidateImageJobs } from "../recipe-image-pipeline.ts";
import { processMemoryJobs } from "./context-pack.ts";

/** Clamp a numeric-ish value to [0, 1], returning fallback if non-finite. */
const clampConfidence = (value: unknown, fallback = 0.5): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, numeric));
};

export const runInBackground = (task: Promise<void>): void => {
  const runtime = (globalThis as {
    EdgeRuntime?: { waitUntil?: (promise: Promise<void>) => void };
  }).EdgeRuntime;
  if (runtime && typeof runtime.waitUntil === "function") {
    runtime.waitUntil(task);
    return;
  }
  void task;
};

export const scheduleMetadataQueueDrain = (params: {
  serviceClient: SupabaseClient;
  actorUserId: string;
  requestId: string;
  limit?: number;
}): void => {
  const limit = Number.isFinite(Number(params.limit))
    ? Math.max(1, Math.min(50, Number(params.limit)))
    : 2;

  const task = processMetadataJobs({
    serviceClient: params.serviceClient,
    actorUserId: params.actorUserId,
    requestId: params.requestId,
    limit,
  }).then(() => undefined).catch((error) => {
    console.error("metadata_queue_drain_failed", {
      request_id: params.requestId,
      actor_user_id: params.actorUserId,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  runInBackground(task);
};

export const scheduleImageQueueDrain = (params: {
  serviceClient: SupabaseClient;
  actorUserId: string;
  requestId: string;
  limit?: number;
  modelOverrides?: ModelOverrideMap;
}): void => {
  const limit = Number.isFinite(Number(params.limit))
    ? Math.max(1, Math.min(20, Number(params.limit)))
    : 5;

  const task = processCandidateImageJobs({
    serviceClient: params.serviceClient,
    userId: params.actorUserId,
    requestId: params.requestId,
    limit,
    modelOverrides: params.modelOverrides,
  }).then(() => undefined).catch((error) => {
    console.error("image_queue_drain_failed", {
      request_id: params.requestId,
      actor_user_id: params.actorUserId,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  runInBackground(task);
};

export const scheduleMemoryQueueDrain = (params: {
  serviceClient: SupabaseClient;
  actorUserId: string;
  requestId: string;
  limit?: number;
  processor?: typeof processMemoryJobs;
}): void => {
  const limit = Number.isFinite(Number(params.limit))
    ? Math.max(1, Math.min(10, Number(params.limit)))
    : 2;

  const processor = params.processor ?? processMemoryJobs;
  const task = processor({
    serviceClient: params.serviceClient,
    actorUserId: params.actorUserId,
    requestId: params.requestId,
    limit,
  }).then(() => undefined).catch((error) => {
    console.error("memory_queue_drain_failed", {
      request_id: params.requestId,
      actor_user_id: params.actorUserId,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  runInBackground(task);
};

export const fetchGraphNeighborhood = async (params: {
  client: SupabaseClient;
  seedEntityIds: string[];
  depth: number;
  minConfidence: number;
  relationTypeFilter: Set<string>;
  entityTypeFilter: Set<string>;
}): Promise<{
  entities: Array<{
    id: string;
    entity_type: string;
    label: string;
    metadata: Record<string, JsonValue>;
  }>;
  edges: Array<{
    id: string;
    from_entity_id: string;
    to_entity_id: string;
    relation_type: string;
    confidence: number;
    source: string;
    metadata: Record<string, JsonValue>;
    evidence_count: number;
    is_inferred: boolean;
  }>;
}> => {
  const initial = Array.from(
    new Set(params.seedEntityIds.filter((id) => id.length > 0)),
  );
  if (initial.length === 0) {
    return { entities: [], edges: [] };
  }

  const maxDepth = Math.max(1, Math.min(2, Number(params.depth || 1)));
  const visited = new Set(initial);
  let frontier = initial;
  type EdgeRow = {
    id: string;
    from_entity_id: string;
    to_entity_id: string;
    confidence: number;
    source: string;
    relation_type_id: string;
    metadata: Record<string, JsonValue> | null;
  };
  const edgeById = new Map<string, EdgeRow>();

  for (let level = 0; level < maxDepth; level += 1) {
    if (frontier.length === 0) {
      break;
    }

    const [
      { data: edgesFrom, error: edgesFromError },
      { data: edgesTo, error: edgesToError },
    ] = await Promise.all([
      params.client
        .from("graph_edges")
        .select(
          "id,from_entity_id,to_entity_id,confidence,source,relation_type_id,metadata",
        )
        .in("from_entity_id", frontier),
      params.client
        .from("graph_edges")
        .select(
          "id,from_entity_id,to_entity_id,confidence,source,relation_type_id,metadata",
        )
        .in("to_entity_id", frontier),
    ]);

    if (edgesFromError || edgesToError) {
      throw new ApiError(
        500,
        "graph_edges_fetch_failed",
        "Could not fetch graph edges",
        edgesFromError?.message ?? edgesToError?.message,
      );
    }

    const nextFrontierSet = new Set<string>();
    for (const edge of [...(edgesFrom ?? []), ...(edgesTo ?? [])]) {
      const confidence = clampConfidence(edge.confidence, 0.5);
      if (confidence < params.minConfidence) {
        continue;
      }
      edgeById.set(edge.id, {
        ...edge,
        confidence,
        metadata: edge.metadata && typeof edge.metadata === "object" &&
            !Array.isArray(edge.metadata)
          ? edge.metadata as Record<string, JsonValue>
          : {},
      });
      if (!visited.has(edge.from_entity_id)) {
        nextFrontierSet.add(edge.from_entity_id);
      }
      if (!visited.has(edge.to_entity_id)) {
        nextFrontierSet.add(edge.to_entity_id);
      }
      visited.add(edge.from_entity_id);
      visited.add(edge.to_entity_id);
    }

    frontier = Array.from(nextFrontierSet);
  }

  const visitedIds = Array.from(visited);
  const { data: entities, error: entitiesError } = await params.client
    .from("graph_entities")
    .select("id,entity_type,label,metadata")
    .in("id", visitedIds);
  if (entitiesError) {
    throw new ApiError(
      500,
      "graph_entities_fetch_failed",
      "Could not fetch graph entities",
      entitiesError.message,
    );
  }

  const relationTypeIds = Array.from(
    new Set(Array.from(edgeById.values()).map((edge) => edge.relation_type_id)),
  );
  const relationById = new Map<string, string>();
  if (relationTypeIds.length > 0) {
    const { data: relationTypes, error: relationTypesError } = await params
      .client
      .from("graph_relation_types")
      .select("id,name")
      .in("id", relationTypeIds);
    if (relationTypesError) {
      throw new ApiError(
        500,
        "graph_relation_types_fetch_failed",
        "Could not fetch graph relation types",
        relationTypesError.message,
      );
    }
    for (const relationType of relationTypes ?? []) {
      relationById.set(relationType.id, relationType.name);
    }
  }

  const filteredEntities = (entities ?? []).filter((entity) =>
    params.entityTypeFilter.size === 0 ||
    params.entityTypeFilter.has(entity.entity_type.toLocaleLowerCase())
  ).map((entity) => ({
    id: entity.id,
    entity_type: entity.entity_type,
    label: entity.label,
    metadata: entity.metadata && typeof entity.metadata === "object" &&
        !Array.isArray(entity.metadata)
      ? entity.metadata as Record<string, JsonValue>
      : {},
  }));
  const filteredEntityIds = new Set(
    filteredEntities.map((entity) => entity.id),
  );

  const responseEdgesBase = Array.from(edgeById.values())
    .map((edge) => ({
      id: edge.id,
      from_entity_id: edge.from_entity_id,
      to_entity_id: edge.to_entity_id,
      relation_type: relationById.get(edge.relation_type_id) ?? "unknown",
      confidence: edge.confidence,
      source: edge.source,
      metadata: edge.metadata ?? {},
    }))
    .filter((edge) =>
      (params.relationTypeFilter.size === 0 ||
        params.relationTypeFilter.has(
          edge.relation_type.toLocaleLowerCase(),
        )) &&
      filteredEntityIds.has(edge.from_entity_id) &&
      filteredEntityIds.has(edge.to_entity_id)
    );

  const edgeIds = responseEdgesBase.map((edge) => edge.id);
  const evidenceCountByEdgeId = new Map<string, number>();
  if (edgeIds.length > 0) {
    const { data: evidenceRows, error: evidenceError } = await params.client
      .from("graph_edge_evidence")
      .select("graph_edge_id")
      .in("graph_edge_id", edgeIds);
    if (
      evidenceError && !isOptionalSemanticCapabilityUnavailable(evidenceError)
    ) {
      throw new ApiError(
        500,
        "graph_edge_evidence_fetch_failed",
        "Could not fetch graph edge evidence",
        evidenceError.message,
      );
    }
    for (const row of evidenceRows ?? []) {
      const current = evidenceCountByEdgeId.get(row.graph_edge_id) ?? 0;
      evidenceCountByEdgeId.set(row.graph_edge_id, current + 1);
    }
  }

  const responseEdges = responseEdgesBase.map((edge) => ({
    ...edge,
    evidence_count: evidenceCountByEdgeId.get(edge.id) ?? 0,
    is_inferred: edge.source.toLocaleLowerCase().includes("llm"),
  }));

  return {
    entities: filteredEntities,
    edges: responseEdges,
  };
};
