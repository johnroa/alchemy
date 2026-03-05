"use client";

import { useEffect, useMemo, useState } from "react";
import { Network } from "lucide-react";
import { EntityTypeIcon } from "@/components/admin/entity-type-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

type GraphNode = GraphEntity & { degree: number };

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export function GraphTablesPanel({
  graph,
  entityTypeColors
}: {
  graph: GraphData;
  entityTypeColors: Record<string, string>;
}): React.JSX.Element {
  const entityTypes = useMemo(
    () => Array.from(new Set(graph.entities.map((entity) => entity.entity_type))).sort(),
    [graph.entities]
  );

  const [maxNodes, setMaxNodes] = useState(220);
  const [activeTypes, setActiveTypes] = useState<string[]>(entityTypes);
  const [relationFilter, setRelationFilter] = useState("all");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    setActiveTypes((current) => {
      if (current.length === 0) {
        return entityTypes;
      }
      const next = current.filter((type) => entityTypes.includes(type));
      return next.length > 0 ? next : entityTypes;
    });
  }, [entityTypes]);

  const filtered = useMemo(() => {
    const degreeByEntityId = new Map<string, number>();
    for (const edge of graph.edges) {
      degreeByEntityId.set(edge.from_entity_id, (degreeByEntityId.get(edge.from_entity_id) ?? 0) + 1);
      degreeByEntityId.set(edge.to_entity_id, (degreeByEntityId.get(edge.to_entity_id) ?? 0) + 1);
    }

    const typeFilteredEntities = graph.entities.filter((entity) => activeTypes.includes(entity.entity_type));
    const constrainedEntities = [...typeFilteredEntities]
      .sort((left, right) => {
        const degreeDiff = (degreeByEntityId.get(right.id) ?? 0) - (degreeByEntityId.get(left.id) ?? 0);
        if (degreeDiff !== 0) return degreeDiff;
        return left.label.localeCompare(right.label);
      })
      .slice(0, clamp(maxNodes, 10, 500));

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

    const degreeWithinFiltered = new Map<string, number>();
    for (const edge of constrainedEdges) {
      degreeWithinFiltered.set(edge.from_entity_id, (degreeWithinFiltered.get(edge.from_entity_id) ?? 0) + 1);
      degreeWithinFiltered.set(edge.to_entity_id, (degreeWithinFiltered.get(edge.to_entity_id) ?? 0) + 1);
    }

    const nodes: GraphNode[] = constrainedEntities.map((entity) => ({
      ...entity,
      degree: degreeWithinFiltered.get(entity.id) ?? 0
    }));

    return { nodes, edges: constrainedEdges };
  }, [activeTypes, graph.edges, graph.entities, maxNodes, relationFilter]);

  useEffect(() => {
    if (!selectedNodeId || filtered.nodes.some((node) => node.id === selectedNodeId)) {
      return;
    }
    setSelectedNodeId(null);
  }, [filtered.nodes, selectedNodeId]);

  const selectedNode = useMemo(
    () => filtered.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [filtered.nodes, selectedNodeId]
  );

  const connectedEdges = useMemo(() => {
    if (!selectedNode) {
      return [];
    }
    return filtered.edges.filter(
      (edge) => edge.from_entity_id === selectedNode.id || edge.to_entity_id === selectedNode.id
    );
  }, [filtered.edges, selectedNode]);

  const toggleType = (type: string): void => {
    setActiveTypes((current) => {
      if (current.includes(type)) {
        const next = current.filter((value) => value !== type);
        return next.length > 0 ? next : current;
      }
      return [...current, type];
    });
  };

  return (
    <div className="min-w-0 space-y-3">
      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-3">
          <div className="flex min-w-0 flex-wrap items-end gap-3 rounded-md border bg-white p-3">
            <label className="w-full text-xs font-medium text-muted-foreground sm:w-32">
              Max Nodes
              <Input
                type="number"
                min={10}
                max={500}
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

            <label className="w-full text-xs font-medium text-muted-foreground sm:w-44">
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

            <div className="flex min-w-0 flex-wrap gap-1.5">
              {entityTypes.map((type) => (
                <Button
                  key={type}
                  type="button"
                  size="sm"
                  variant={activeTypes.includes(type) ? "default" : "outline"}
                  className="h-7 px-2 text-[11px]"
                  onClick={() => toggleType(type)}
                >
                  <EntityTypeIcon entityType={type} className="mr-1 h-3.5 w-3.5" />
                  {type}
                </Button>
              ))}
            </div>
          </div>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Network className="h-4 w-4 text-muted-foreground" />
                Entity Catalog
              </CardTitle>
              <CardDescription>Click any row to load the same node detail sidebar used in Visual mode.</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Label</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Degree</TableHead>
                    <TableHead>ID</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.nodes.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                        No graph entities match the current filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.nodes.slice(0, 160).map((node) => (
                      <TableRow
                        key={node.id}
                        onClick={() => setSelectedNodeId(node.id)}
                        className={cn("cursor-pointer", selectedNodeId === node.id && "bg-primary/5 hover:bg-primary/10")}
                      >
                        <TableCell className="font-medium">{node.label}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={entityTypeColors[node.entity_type] ?? "text-xs"}>
                            {node.entity_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{node.degree}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{node.id}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Edge Snapshot</CardTitle>
              <CardDescription>Click any row to focus this edge in the connected-edge detail list.</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead>Relation</TableHead>
                    <TableHead>Confidence</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.edges.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                        No edges match the current filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.edges.slice(0, 220).map((edge) => (
                      <TableRow
                        key={edge.id}
                        onClick={() => {
                          if (selectedNodeId === edge.from_entity_id) {
                            setSelectedNodeId(edge.to_entity_id);
                            return;
                          }
                          setSelectedNodeId(edge.from_entity_id);
                        }}
                        className={cn(
                          "cursor-pointer",
                          selectedNodeId != null &&
                            (edge.from_entity_id === selectedNodeId || edge.to_entity_id === selectedNodeId) &&
                            "bg-primary/5 hover:bg-primary/10"
                        )}
                      >
                        <TableCell className="font-medium text-sm">{edge.from_label}</TableCell>
                        <TableCell className="font-medium text-sm">{edge.to_label}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {edge.relation_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs tabular-nums text-muted-foreground">{edge.confidence.toFixed(2)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-3">
          <div className="rounded-md border bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Filtered Graph</p>
            <p className="mt-1 text-sm tabular-nums">{filtered.nodes.length} nodes</p>
            <p className="text-sm tabular-nums">{filtered.edges.length} edges</p>
          </div>

          <div className="rounded-md border bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Node Detail</p>
            {!selectedNode ? (
              <p className="mt-2 text-sm text-muted-foreground">Click a row for detail.</p>
            ) : (
              <div className="mt-2 space-y-2 text-sm">
                <p className="font-medium">{selectedNode.label}</p>
                <Badge variant="outline" className="inline-flex items-center gap-1 text-[10px]">
                  <EntityTypeIcon entityType={selectedNode.entity_type} className="h-3 w-3" />
                  {selectedNode.entity_type}
                </Badge>
                <p className="text-xs text-muted-foreground">Degree: {selectedNode.degree}</p>
                <p className="font-mono text-[11px] text-muted-foreground">{selectedNode.id}</p>
                <p className="text-xs text-muted-foreground">Connected edges: {connectedEdges.length}</p>
                <div className="max-h-48 overflow-auto rounded border bg-zinc-50 p-2 text-[11px]">
                  {Object.keys(selectedNode.metadata ?? {}).length === 0 ? (
                    <p className="text-muted-foreground">No metadata</p>
                  ) : (
                    <pre className="whitespace-pre-wrap break-words">{JSON.stringify(selectedNode.metadata, null, 2)}</pre>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-md border bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Connected Edges</p>
            {connectedEdges.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No selected node.</p>
            ) : (
              <div className="mt-2 space-y-1">
                {connectedEdges.slice(0, 14).map((edge) => (
                  <div key={edge.id} className="rounded border px-2 py-1 text-[11px]">
                    <p>{edge.from_label} → {edge.to_label}</p>
                    <p className="text-muted-foreground">
                      {edge.relation_type} · {edge.confidence.toFixed(2)}
                    </p>
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
