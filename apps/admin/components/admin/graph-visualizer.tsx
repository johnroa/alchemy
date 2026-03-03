"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type GraphEntity = {
  id: string;
  entity_type: string;
  label: string;
  metadata: Record<string, unknown>;
};

type GraphEdge = {
  id: string;
  from_entity_id: string;
  to_entity_id: string;
  from_label: string;
  to_label: string;
  relation_type: string;
  confidence: number;
  source: string;
};

type GraphData = {
  entities: GraphEntity[];
  edges: GraphEdge[];
  relation_types: string[];
};

const nodeColors: Record<string, string> = {
  recipe: "#1d4ed8",
  ingredient: "#047857",
  category: "#b45309",
  keyword: "#be123c"
};

const relationColors = ["#0ea5e9", "#f97316", "#10b981", "#a855f7", "#ef4444", "#14b8a6"];

const hashColor = (value: string): string => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }

  return relationColors[Math.abs(hash) % relationColors.length] ?? "#64748b";
};

const truncate = (value: string, max = 18): string => {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
};

export function GraphVisualizer({ graph }: { graph: GraphData }): React.JSX.Element {
  const entityTypes = useMemo(
    () => Array.from(new Set(graph.entities.map((entity) => entity.entity_type))).sort(),
    [graph.entities]
  );
  const [maxNodes, setMaxNodes] = useState(120);
  const [activeTypes, setActiveTypes] = useState<string[]>(entityTypes);
  const [relationFilter, setRelationFilter] = useState<string>("all");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const constrainedEntities = graph.entities
      .filter((entity) => activeTypes.includes(entity.entity_type))
      .slice(0, Math.max(10, Math.min(400, maxNodes)));

    const entityIdSet = new Set(constrainedEntities.map((entity) => entity.id));
    const constrainedEdges = graph.edges.filter((edge) => {
      if (!entityIdSet.has(edge.from_entity_id) || !entityIdSet.has(edge.to_entity_id)) {
        return false;
      }
      if (relationFilter === "all") {
        return true;
      }
      return edge.relation_type === relationFilter;
    });

    return { entities: constrainedEntities, edges: constrainedEdges };
  }, [activeTypes, graph.edges, graph.entities, maxNodes, relationFilter]);

  const positionedNodes = useMemo(() => {
    const width = 980;
    const height = 620;
    const centerX = width / 2;
    const centerY = height / 2;

    const byType = new Map<string, GraphEntity[]>();
    for (const entity of filtered.entities) {
      const current = byType.get(entity.entity_type) ?? [];
      current.push(entity);
      byType.set(entity.entity_type, current);
    }

    const types = Array.from(byType.keys()).sort();
    const nodePositions = new Map<string, { x: number; y: number; entity: GraphEntity }>();

    types.forEach((type, typeIndex) => {
      const nodes = byType.get(type) ?? [];
      const ringRadius = Math.min(250, 90 + typeIndex * 85);
      const nodeCount = nodes.length;

      nodes.forEach((entity, entityIndex) => {
        const angle = (2 * Math.PI * entityIndex) / Math.max(1, nodeCount);
        const jitterX = Math.sin(entityIndex * 3.17) * 8;
        const jitterY = Math.cos(entityIndex * 2.71) * 8;
        const x = centerX + ringRadius * Math.cos(angle) + jitterX;
        const y = centerY + ringRadius * Math.sin(angle) + jitterY;

        nodePositions.set(entity.id, { x, y, entity });
      });
    });

    return {
      width,
      height,
      nodes: nodePositions
    };
  }, [filtered.entities]);

  const selectedNode = selectedNodeId ? positionedNodes.nodes.get(selectedNodeId)?.entity ?? null : null;
  const connectedEdges = useMemo(() => {
    if (!selectedNode) {
      return [] as GraphEdge[];
    }

    return filtered.edges.filter(
      (edge) => edge.from_entity_id === selectedNode.id || edge.to_entity_id === selectedNode.id
    );
  }, [filtered.edges, selectedNode]);

  const toggleType = (type: string): void => {
    setActiveTypes((current) => {
      if (current.includes(type)) {
        const next = current.filter((item) => item !== type);
        return next.length > 0 ? next : current;
      }
      return [...current, type];
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-3 rounded-md border bg-white p-3">
            <label className="w-32 text-xs font-medium text-muted-foreground">
              Max Nodes
              <Input
                type="number"
                min={10}
                max={400}
                value={maxNodes}
                className="mt-1 h-8"
                onChange={(event) => {
                  const parsed = Number(event.target.value);
                  if (Number.isFinite(parsed)) {
                    setMaxNodes(parsed);
                  }
                }}
              />
            </label>
            <label className="w-44 text-xs font-medium text-muted-foreground">
              Relation Filter
              <select
                className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={relationFilter}
                onChange={(event) => setRelationFilter(event.target.value)}
              >
                <option value="all">All relations</option>
                {graph.relation_types.map((relationType) => (
                  <option key={relationType} value={relationType}>
                    {relationType}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {entityTypes.map((type) => (
                <Button
                  key={type}
                  type="button"
                  size="sm"
                  variant={activeTypes.includes(type) ? "default" : "outline"}
                  className="h-7 px-2 text-[11px]"
                  onClick={() => toggleType(type)}
                >
                  {type}
                </Button>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border bg-white">
            <svg viewBox={`0 0 ${positionedNodes.width} ${positionedNodes.height}`} className="h-[620px] w-full">
              <rect x={0} y={0} width={positionedNodes.width} height={positionedNodes.height} fill="#fafafa" />

              {filtered.edges.map((edge) => {
                const from = positionedNodes.nodes.get(edge.from_entity_id);
                const to = positionedNodes.nodes.get(edge.to_entity_id);
                if (!from || !to) {
                  return null;
                }

                return (
                  <line
                    key={edge.id}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke={hashColor(edge.relation_type)}
                    strokeOpacity={Math.max(0.2, Math.min(1, edge.confidence))}
                    strokeWidth={Math.max(1, edge.confidence * 2.5)}
                  />
                );
              })}

              {Array.from(positionedNodes.nodes.values()).map((node) => {
                const active = selectedNode?.id === node.entity.id;
                const color = nodeColors[node.entity.entity_type] ?? "#334155";

                return (
                  <g
                    key={node.entity.id}
                    onClick={() => setSelectedNodeId(node.entity.id)}
                    className="cursor-pointer"
                  >
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={active ? 11 : 8}
                      fill={color}
                      stroke={active ? "#111827" : "#ffffff"}
                      strokeWidth={active ? 2 : 1}
                    />
                    <text
                      x={node.x + 10}
                      y={node.y - 10}
                      fontSize="11"
                      fill="#1f2937"
                    >
                      {truncate(node.entity.label)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-md border bg-white p-3">
            {graph.relation_types.map((relationType) => (
              <span key={relationType} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: hashColor(relationType) }} />
                {relationType}
              </span>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-md border bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Filtered Graph</p>
            <p className="mt-1 text-sm">{filtered.entities.length} nodes</p>
            <p className="text-sm">{filtered.edges.length} edges</p>
          </div>

          <div className="rounded-md border bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Node Detail</p>
            {!selectedNode ? (
              <p className="mt-2 text-sm text-muted-foreground">Click a node to inspect metadata and neighbors.</p>
            ) : (
              <div className="mt-2 space-y-2 text-sm">
                <p className="font-medium">{selectedNode.label}</p>
                <Badge variant="outline" className="text-[10px]">
                  {selectedNode.entity_type}
                </Badge>
                <p className="font-mono text-[11px] text-muted-foreground">{selectedNode.id}</p>
                <p className="text-xs text-muted-foreground">Connected edges: {connectedEdges.length}</p>
                <div className="max-h-48 overflow-auto rounded border bg-zinc-50 p-2 text-[11px]">
                  {Object.keys(selectedNode.metadata ?? {}).length === 0 ? (
                    <p className="text-muted-foreground">No metadata</p>
                  ) : (
                    <pre className="whitespace-pre-wrap break-words">
                      {JSON.stringify(selectedNode.metadata, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-md border bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Connected Nodes</p>
            {connectedEdges.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No node selected.</p>
            ) : (
              <div className="mt-2 space-y-1">
                {connectedEdges.slice(0, 12).map((edge) => (
                  <div key={edge.id} className={cn("rounded border px-2 py-1 text-[11px]")}>
                    <p>{edge.from_label} → {edge.to_label}</p>
                    <p className="text-muted-foreground">{edge.relation_type} · {edge.confidence.toFixed(2)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
