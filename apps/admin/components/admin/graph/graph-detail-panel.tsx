"use client";

import { EntityTypeIcon } from "@/components/admin/entity-type-icon";
import { Badge } from "@/components/ui/badge";
import type { ForceLink, ForceNode } from "./types";

interface GraphDetailPanelProps {
  nodeCount: number;
  linkCount: number;
  selectedNode: ForceNode | null;
  connectedEdges: ForceLink[];
}

export function GraphDetailPanel({
  nodeCount,
  linkCount,
  selectedNode,
  connectedEdges,
}: GraphDetailPanelProps): React.JSX.Element {
  return (
    <div className="min-w-0 space-y-3">
      {/* Filtered graph stats */}
      <div className="rounded-md border bg-white p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Filtered Graph</p>
        <p className="mt-1 text-sm tabular-nums">{nodeCount} nodes</p>
        <p className="text-sm tabular-nums">{linkCount} edges</p>
      </div>

      {/* Node detail */}
      <div className="rounded-md border bg-white p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Node Detail</p>
        {!selectedNode ? (
          <p className="mt-2 text-sm text-muted-foreground">Click a node for detail. Drag nodes to pull/pin them.</p>
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
                <pre className="whitespace-pre-wrap break-words">
                  {JSON.stringify(selectedNode.metadata, null, 2)}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Connected edges */}
      <div className="rounded-md border bg-white p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Connected Edges</p>
        {connectedEdges.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No selected node.</p>
        ) : (
          <div className="mt-2 space-y-1">
            {connectedEdges.slice(0, 14).map((edge) => (
              <div key={edge.id} className="rounded border px-2 py-1 text-[11px]">
                <p>
                  {edge.from_label} → {edge.to_label}
                </p>
                <p className="text-muted-foreground">
                  {edge.relation_type} · {edge.confidence.toFixed(2)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
