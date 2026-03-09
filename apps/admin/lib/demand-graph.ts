import type { GraphData } from "@/components/admin/graph/types";
import type { DemandAnalyticsData } from "@/lib/admin-data/demand";

type DemandGraphRow = DemandAnalyticsData["graphRows"][number];

type DemandGraphNodeAccumulator = {
  id: string;
  entity_type: string;
  label: string;
  metadata: {
    facet: string;
    normalized_value: string;
    connected_edges: number;
    total_count: number;
    recency_score_total: number;
    acceptance_samples: number;
    acceptance_average: number | null;
    stages: string[];
    source_kinds: string[];
    last_observed_at: string | null;
  };
  stageSet: Set<string>;
  sourceKindSet: Set<string>;
  acceptanceTotal: number;
};

export type DemandGraphVisualizerData = {
  graph: GraphData;
  summary: {
    nodes: number;
    edges: number;
    facets: number;
    relationTypes: number;
    sourceKinds: number;
    window: "7d" | "30d" | null;
  };
};

const titleCase = (value: string): string =>
  value
    .replaceAll("_", " ")
    .split(" ")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const stageLabel = (value: string | null): string =>
  value == null || value.trim().length === 0 ? "Mixed Stages" : titleCase(value);

const nodeIdFor = (facet: string, value: string): string => `${facet}:${value}`;

const ensureNode = (
  nodesById: Map<string, DemandGraphNodeAccumulator>,
  facet: string,
  value: string,
): DemandGraphNodeAccumulator => {
  const id = nodeIdFor(facet, value);
  const existing = nodesById.get(id);
  if (existing) {
    return existing;
  }

  const next: DemandGraphNodeAccumulator = {
    id,
    entity_type: facet,
    label: titleCase(value),
    metadata: {
      facet,
      normalized_value: value,
      connected_edges: 0,
      total_count: 0,
      recency_score_total: 0,
      acceptance_samples: 0,
      acceptance_average: null,
      stages: [],
      source_kinds: [],
      last_observed_at: null,
    },
    stageSet: new Set<string>(),
    sourceKindSet: new Set<string>(),
    acceptanceTotal: 0,
  };

  nodesById.set(id, next);
  return next;
};

const updateNodeStats = (
  node: DemandGraphNodeAccumulator,
  row: DemandGraphRow,
): void => {
  node.metadata.connected_edges += 1;
  node.metadata.total_count += Math.max(0, Number(row.count ?? 0));
  node.metadata.recency_score_total += Math.max(0, Number(row.recencyWeightedScore ?? 0));

  if (row.acceptanceScore != null && Number.isFinite(row.acceptanceScore)) {
    node.metadata.acceptance_samples += 1;
    node.acceptanceTotal += row.acceptanceScore;
    node.metadata.acceptance_average = node.acceptanceTotal / Math.max(1, node.metadata.acceptance_samples);
  }

  if (row.stage) {
    node.stageSet.add(stageLabel(row.stage));
  }
  if (row.sourceKind) {
    node.sourceKindSet.add(titleCase(row.sourceKind));
  }

  if (
    node.metadata.last_observed_at == null ||
    Date.parse(row.lastObservedAt) > Date.parse(node.metadata.last_observed_at)
  ) {
    node.metadata.last_observed_at = row.lastObservedAt;
  }
};

const finalizeNode = (node: DemandGraphNodeAccumulator): GraphData["entities"][number] => ({
  id: node.id,
  entity_type: node.entity_type,
  label: node.label,
  metadata: {
    ...node.metadata,
    stages: Array.from(node.stageSet).sort(),
    source_kinds: Array.from(node.sourceKindSet).sort(),
    acceptance_average: node.metadata.acceptance_average == null
      ? null
      : Number(node.metadata.acceptance_average.toFixed(3)),
    recency_score_total: Number(node.metadata.recency_score_total.toFixed(3)),
  },
});

export const buildDemandGraphVisualizerData = (
  rows: DemandGraphRow[],
): DemandGraphVisualizerData => {
  if (rows.length === 0) {
    return {
      graph: {
        entities: [],
        edges: [],
        relation_types: [],
      },
      summary: {
        nodes: 0,
        edges: 0,
        facets: 0,
        relationTypes: 0,
        sourceKinds: 0,
        window: null,
      },
    };
  }

  const nodesById = new Map<string, DemandGraphNodeAccumulator>();
  const relationTypes = new Set<string>();
  const sourceKinds = new Set<string>();
  const maxCount = Math.max(...rows.map((row) => Math.max(0, Number(row.count ?? 0))), 1);
  const maxRecency = Math.max(...rows.map((row) => Math.max(0, Number(row.recencyWeightedScore ?? 0))), 1);

  const edges = rows.map((row, index) => {
    const fromNode = ensureNode(nodesById, row.fromFacet, row.fromValue);
    const toNode = ensureNode(nodesById, row.toFacet, row.toValue);

    updateNodeStats(fromNode, row);
    updateNodeStats(toNode, row);

    const relationType = stageLabel(row.stage);
    relationTypes.add(relationType);

    const sourceLabel = row.sourceKind == null ? "Derived" : titleCase(row.sourceKind);
    sourceKinds.add(sourceLabel);

    const countWeight = Math.max(0, Number(row.count ?? 0)) / maxCount;
    const recencyWeight = Math.max(0, Number(row.recencyWeightedScore ?? 0)) / maxRecency;
    const acceptanceWeight = row.acceptanceScore == null
      ? 0.55
      : Math.max(0, Math.min(1, Number(row.acceptanceScore)));
    const confidence = Math.max(
      0.22,
      Math.min(1, recencyWeight * 0.5 + countWeight * 0.25 + acceptanceWeight * 0.25),
    );

    return {
      id: `${fromNode.id}->${toNode.id}:${relationType}:${index}`,
      from_entity_id: fromNode.id,
      to_entity_id: toNode.id,
      from_label: fromNode.label,
      to_label: toNode.label,
      relation_type: relationType,
      confidence: Number(confidence.toFixed(3)),
      source: sourceLabel,
    };
  });

  const entities = Array.from(nodesById.values())
    .map(finalizeNode)
    .sort((left, right) => {
      const leftCount = Number(left.metadata["total_count"] ?? 0);
      const rightCount = Number(right.metadata["total_count"] ?? 0);
      if (rightCount !== leftCount) {
        return rightCount - leftCount;
      }
      return left.label.localeCompare(right.label);
    });

  return {
    graph: {
      entities,
      edges,
      relation_types: Array.from(relationTypes).sort(),
    },
    summary: {
      nodes: entities.length,
      edges: edges.length,
      facets: new Set(entities.map((entity) => entity.entity_type)).size,
      relationTypes: relationTypes.size,
      sourceKinds: sourceKinds.size,
      window: rows[0]?.timeWindow ?? null,
    },
  };
};
