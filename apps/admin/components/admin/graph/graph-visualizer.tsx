"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ForceGraphMethods, NodeObject } from "react-force-graph-2d";
import { GraphCanvas } from "./graph-canvas";
import { GraphControls } from "./graph-controls";
import { GraphDetailPanel } from "./graph-detail-panel";
import {
  type FilteredGraph,
  type ForceLink,
  type ForceNode,
  type GraphData,
  clamp,
  hashColor,
  nodeColors,
  resolveNodeId,
} from "./types";

export { type GraphData } from "./types";

/**
 * Interactive force-directed graph visualizer.
 *
 * Orchestrates state (filters, selection, fullscreen) and delegates
 * rendering to GraphCanvas, controls to GraphControls, and the detail
 * sidebar to GraphDetailPanel.
 */
export function GraphVisualizer({ graph }: { graph: GraphData }): React.JSX.Element {
  const entityTypes = useMemo(
    () => Array.from(new Set(graph.entities.map((entity) => entity.entity_type))).sort(),
    [graph.entities]
  );

  const [maxNodes, setMaxNodes] = useState(220);
  const [activeTypes, setActiveTypes] = useState<string[]>(entityTypes);
  const [relationFilter, setRelationFilter] = useState<string>("all");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<ForceGraphMethods<ForceNode, ForceLink> | undefined>(undefined);
  const autoFitPendingRef = useRef<boolean>(true);
  const hasUserCameraControlRef = useRef<boolean>(false);

  /* Sync active type filters when the available entity types change */
  useEffect(() => {
    setActiveTypes((current) => {
      if (current.length === 0) {
        return entityTypes;
      }
      const next = current.filter((type) => entityTypes.includes(type));
      return next.length > 0 ? next : entityTypes;
    });
  }, [entityTypes]);

  /* Track browser fullscreen state */
  useEffect(() => {
    const onFullscreenChange = (): void => {
      setIsFullscreen(document.fullscreenElement === surfaceRef.current);
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  /* ---------- Data processing: filter + build force-graph structures ---------- */
  const filtered: FilteredGraph = useMemo(() => {
    const degreeByEntityId = new Map<string, number>();
    for (const edge of graph.edges) {
      degreeByEntityId.set(edge.from_entity_id, (degreeByEntityId.get(edge.from_entity_id) ?? 0) + 1);
      degreeByEntityId.set(edge.to_entity_id, (degreeByEntityId.get(edge.to_entity_id) ?? 0) + 1);
    }

    const typeFilteredEntities = graph.entities.filter((entity) => activeTypes.includes(entity.entity_type));
    const constrainedEntities = [...typeFilteredEntities]
      .sort((left, right) => {
        const degreeDiff = (degreeByEntityId.get(right.id) ?? 0) - (degreeByEntityId.get(left.id) ?? 0);
        if (degreeDiff !== 0) {
          return degreeDiff;
        }
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

    const nodes: ForceNode[] = constrainedEntities.map((entity) => {
      const degree = degreeWithinFiltered.get(entity.id) ?? 0;
      return {
        ...entity,
        degree,
        val: Math.max(1, Math.sqrt(degree + 1)),
        color: nodeColors[entity.entity_type] ?? "#334155",
      };
    });

    const links: ForceLink[] = constrainedEdges.map((edge) => ({
      ...edge,
      source: edge.from_entity_id,
      target: edge.to_entity_id,
      color: hashColor(edge.relation_type),
    }));

    return {
      nodes,
      links,
      nodeById: new Map(nodes.map((node) => [node.id, node])),
    };
  }, [activeTypes, graph.edges, graph.entities, maxNodes, relationFilter]);

  /* Deselect node if it's no longer in the filtered set */
  useEffect(() => {
    if (!selectedNodeId) {
      return;
    }
    if (!filtered.nodeById.has(selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [filtered.nodeById, selectedNodeId]);

  /* ---------- Derived selection data ---------- */
  const selectedNode = selectedNodeId ? filtered.nodeById.get(selectedNodeId) ?? null : null;

  const connectedEdges = useMemo(() => {
    if (!selectedNodeId) {
      return [] as ForceLink[];
    }

    return filtered.links.filter((edge) => {
      const sourceId = resolveNodeId(edge.source as string | number | NodeObject<ForceNode> | undefined);
      const targetId = resolveNodeId(edge.target as string | number | NodeObject<ForceNode> | undefined);
      return sourceId === selectedNodeId || targetId === selectedNodeId;
    });
  }, [filtered.links, selectedNodeId]);

  /* ---------- Control handlers ---------- */
  const toggleType = (type: string): void => {
    setActiveTypes((current) => {
      if (current.includes(type)) {
        const next = current.filter((value) => value !== type);
        return next.length > 0 ? next : current;
      }
      return [...current, type];
    });
  };

  const markUserCamera = (): void => {
    hasUserCameraControlRef.current = true;
    autoFitPendingRef.current = false;
  };

  const fitGraph = (): void => {
    markUserCamera();
    graphRef.current?.zoomToFit(250, 26);
  };

  const centerGraph = (): void => {
    markUserCamera();
    graphRef.current?.centerAt(0, 0, 250);
  };

  const releasePinnedNodes = (): void => {
    markUserCamera();
    for (const node of filtered.nodes) {
      delete node.fx;
      delete node.fy;
    }
    graphRef.current?.d3ReheatSimulation();
  };

  const toggleFullscreen = async (): Promise<void> => {
    const surface = surfaceRef.current;
    if (!surface) {
      return;
    }

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }

      await surface.requestFullscreen();
    } catch {
      // Ignore browser-level fullscreen errors; the control remains usable.
    }
  };

  return (
    <div className="min-w-0 space-y-3">
      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div ref={surfaceRef} className="min-w-0 space-y-2">
          <GraphControls
            maxNodes={maxNodes}
            onMaxNodesChange={setMaxNodes}
            relationFilter={relationFilter}
            onRelationFilterChange={setRelationFilter}
            relationTypes={graph.relation_types}
            entityTypes={entityTypes}
            activeTypes={activeTypes}
            onToggleType={toggleType}
            onFit={fitGraph}
            onCenter={centerGraph}
            onReleasePins={releasePinnedNodes}
            onToggleFullscreen={() => void toggleFullscreen()}
            isFullscreen={isFullscreen}
          />

          <GraphCanvas
            filtered={filtered}
            relationTypes={graph.relation_types}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            isFullscreen={isFullscreen}
            graphRef={graphRef}
            autoFitPendingRef={autoFitPendingRef}
            hasUserCameraControlRef={hasUserCameraControlRef}
          />
        </div>

        <GraphDetailPanel
          nodeCount={filtered.nodes.length}
          linkCount={filtered.links.length}
          selectedNode={selectedNode}
          connectedEdges={connectedEdges}
        />
      </div>
    </div>
  );
}
