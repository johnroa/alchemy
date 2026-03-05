"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject
} from "react-force-graph-2d";
import { EntityTypeIcon } from "@/components/admin/entity-type-icon";
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

type ForceNode = GraphEntity & {
  val: number;
  degree: number;
  color: string;
  x?: number;
  y?: number;
  fx?: number;
  fy?: number;
};

type ForceLink = GraphEdge & {
  source: string;
  target: string;
  color: string;
};

type ConfigurableForce = {
  strength?: (value: number) => unknown;
  distanceMax?: (value: number) => unknown;
  distance?: (value: number | ((link: ForceLink) => number)) => unknown;
  iterations?: (value: number) => unknown;
};

const nodeColors: Record<string, string> = {
  recipe: "#2563eb",
  ingredient: "#047857",
  category: "#b45309",
  keyword: "#be123c"
};

const relationColors = ["#0ea5e9", "#f97316", "#10b981", "#a855f7", "#ef4444", "#14b8a6", "#64748b"];

const hashColor = (value: string): string => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }

  return relationColors[Math.abs(hash) % relationColors.length] ?? "#64748b";
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const resolveNodeId = (node: string | number | NodeObject<ForceNode> | undefined): string => {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (node && node.id != null) {
    return String(node.id);
  }
  return "";
};

const labelForDisplay = (value: string, max = 36): string => {
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

  const [maxNodes, setMaxNodes] = useState(220);
  const [activeTypes, setActiveTypes] = useState<string[]>(entityTypes);
  const [relationFilter, setRelationFilter] = useState<string>("all");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<ForceGraphMethods<ForceNode, ForceLink> | undefined>(undefined);
  const autoFitPendingRef = useRef<boolean>(true);
  const hasUserCameraControlRef = useRef<boolean>(false);
  const [surfaceSize, setSurfaceSize] = useState({ width: 1080, height: 680 });

  useEffect(() => {
    setActiveTypes((current) => {
      if (current.length === 0) {
        return entityTypes;
      }
      const next = current.filter((type) => entityTypes.includes(type));
      return next.length > 0 ? next : entityTypes;
    });
  }, [entityTypes]);

  useEffect(() => {
    const element = surfaceRef.current;
    if (!element) {
      return;
    }

    const update = (): void => {
      const width = Math.max(360, Math.floor(element.clientWidth));
      const height = Math.max(440, Math.floor(element.clientHeight));
      setSurfaceSize((current) => (current.width === width && current.height === height ? current : { width, height }));
    };

    update();

    const observer = new ResizeObserver(() => update());
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [isFullscreen]);

  useEffect(() => {
    const onFullscreenChange = (): void => {
      setIsFullscreen(document.fullscreenElement === surfaceRef.current);
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

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
        color: nodeColors[entity.entity_type] ?? "#334155"
      };
    });

    const links: ForceLink[] = constrainedEdges.map((edge) => ({
      ...edge,
      source: edge.from_entity_id,
      target: edge.to_entity_id,
      color: hashColor(edge.relation_type)
    }));

    return {
      nodes,
      links,
      nodeById: new Map(nodes.map((node) => [node.id, node]))
    };
  }, [activeTypes, graph.edges, graph.entities, maxNodes, relationFilter]);

  useEffect(() => {
    if (!selectedNodeId) {
      return;
    }
    if (!filtered.nodeById.has(selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [filtered.nodeById, selectedNodeId]);

  useEffect(() => {
    const instance = graphRef.current;
    if (!instance || filtered.nodes.length === 0) {
      return;
    }

    const chargeForce = instance.d3Force("charge") as ConfigurableForce | undefined;
    chargeForce?.strength?.(-220);
    chargeForce?.distanceMax?.(900);

    const linkForce = instance.d3Force("link") as ConfigurableForce | undefined;
    linkForce?.distance?.((link: ForceLink) => clamp(90 - Number(link.confidence ?? 0.5) * 34, 52, 98));
    linkForce?.iterations?.(2);

    autoFitPendingRef.current = true;
    hasUserCameraControlRef.current = false;
    instance.d3ReheatSimulation();
  }, [filtered.links.length, filtered.nodes.length]);

  const onEngineStop = useCallback((): void => {
    const instance = graphRef.current;
    if (!instance || filtered.nodes.length === 0 || filtered.links.length === 0) {
      return;
    }

    if (!autoFitPendingRef.current || hasUserCameraControlRef.current) {
      return;
    }

    instance.zoomToFit(0, 24);
    autoFitPendingRef.current = false;
  }, [filtered.links.length, filtered.nodes.length]);

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

  const forceGraphData = useMemo(
    () => ({
      nodes: filtered.nodes,
      links: filtered.links
    }),
    [filtered.links, filtered.nodes]
  );

  const toggleType = (type: string): void => {
    setActiveTypes((current) => {
      if (current.includes(type)) {
        const next = current.filter((value) => value !== type);
        return next.length > 0 ? next : current;
      }
      return [...current, type];
    });
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

  const onNodeClick = (node: NodeObject<ForceNode>): void => {
    const id = resolveNodeId(node);
    if (!id) {
      return;
    }
    hasUserCameraControlRef.current = true;
    setSelectedNodeId(id);
  };

  const onNodeDragEnd = (node: NodeObject<ForceNode>): void => {
    markUserCamera();
    delete node.fx;
    delete node.fy;
    graphRef.current?.d3ReheatSimulation();
  };

  const nodeCanvasObject = useCallback(
    (node: NodeObject<ForceNode>, canvasContext: CanvasRenderingContext2D, globalScale: number) => {
      const degree = Number(node.degree ?? 0);
      const baseRadius = 2 + Math.sqrt(Math.max(1, degree + 1)) * 0.8;
      const radius = Math.max(2.4, Math.min(8, baseRadius));
      const isSelected = selectedNodeId != null && resolveNodeId(node) === selectedNodeId;
      const color = typeof node.color === "string" ? node.color : "#334155";
      const x = Number(node.x ?? 0);
      const y = Number(node.y ?? 0);

      canvasContext.beginPath();
      canvasContext.arc(x, y, radius, 0, 2 * Math.PI, false);
      canvasContext.fillStyle = color;
      canvasContext.fill();

      canvasContext.lineWidth = isSelected ? 2.8 : 1.1;
      canvasContext.strokeStyle = isSelected ? "#0f172a" : "#f8fafc";
      canvasContext.stroke();

      const shouldDrawLabel =
        isSelected ||
        degree >= 10 ||
        (filtered.nodes.length <= 220 && globalScale >= 1.18) ||
        globalScale >= 1.7;
      if (!shouldDrawLabel) {
        return;
      }

      const label = labelForDisplay(String(node.label ?? node.id ?? ""), 32);
      const fontSize = (isSelected ? 11 : 10) / globalScale;
      canvasContext.font = `600 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
      const textWidth = canvasContext.measureText(label).width;
      const boxPaddingX = 3 / globalScale;
      const boxPaddingY = 2 / globalScale;
      const labelX = x + radius + 3 / globalScale;
      const labelY = y;
      const labelTop = labelY - fontSize / 2 - boxPaddingY;
      const labelHeight = fontSize + boxPaddingY * 2;

      canvasContext.fillStyle = "rgba(255,255,255,0.9)";
      canvasContext.fillRect(
        labelX - boxPaddingX,
        labelTop,
        textWidth + boxPaddingX * 2,
        labelHeight
      );

      canvasContext.fillStyle = "#0f172a";
      canvasContext.textBaseline = "middle";
      canvasContext.fillText(label, labelX, labelY);
    },
    [filtered.nodes.length, selectedNodeId]
  );

  const linkColor = useCallback(
    (link: LinkObject<ForceNode, ForceLink>) => {
      const color = typeof link.color === "string" ? link.color : "#64748b";
      if (!selectedNodeId) {
        return color;
      }

      const sourceId = resolveNodeId(link.source as string | number | NodeObject<ForceNode> | undefined);
      const targetId = resolveNodeId(link.target as string | number | NodeObject<ForceNode> | undefined);
      if (sourceId === selectedNodeId || targetId === selectedNodeId) {
        return color;
      }
      return "rgba(148,163,184,0.20)";
    },
    [selectedNodeId]
  );

  const linkWidth = useCallback(
    (link: LinkObject<ForceNode, ForceLink>) => {
      const confidence = Number(link.confidence ?? 0.45);
      const base = Math.max(0.35, confidence * 1.7);
      if (!selectedNodeId) {
        return base;
      }
      const sourceId = resolveNodeId(link.source as string | number | NodeObject<ForceNode> | undefined);
      const targetId = resolveNodeId(link.target as string | number | NodeObject<ForceNode> | undefined);
      return sourceId === selectedNodeId || targetId === selectedNodeId ? Math.max(base, 1.25) : Math.max(0.16, base * 0.35);
    },
    [selectedNodeId]
  );

  const nodeLabel = useCallback((node: NodeObject<ForceNode>) => {
    const label = escapeHtml(String(node.label ?? "unknown"));
    const type = escapeHtml(String(node.entity_type ?? "unknown"));
    const degree = Number(node.degree ?? 0);
    const nodeId = escapeHtml(String(node.id ?? ""));

    return `
      <div style="padding:6px 8px; max-width: 280px;">
        <div style="font-weight:600; margin-bottom:2px;">${label}</div>
        <div style="font-size:11px; opacity:0.8; margin-bottom:2px;">${type}</div>
        <div style="font-size:11px; opacity:0.75;">degree: ${degree}</div>
        <div style="font-size:10px; opacity:0.6; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">${nodeId}</div>
      </div>
    `;
  }, []);

  const linkLabel = useCallback((link: LinkObject<ForceNode, ForceLink>) => {
    const relation = escapeHtml(String(link.relation_type ?? "relation"));
    const source = escapeHtml(String(link.from_label ?? resolveNodeId(link.source as string | number | NodeObject<ForceNode> | undefined)));
    const target = escapeHtml(String(link.to_label ?? resolveNodeId(link.target as string | number | NodeObject<ForceNode> | undefined)));
    const confidence = Number(link.confidence ?? 0).toFixed(2);

    return `
      <div style="padding:6px 8px; max-width: 320px;">
        <div style="font-weight:600; margin-bottom:2px;">${relation}</div>
        <div style="font-size:11px; opacity:0.8;">${source} → ${target}</div>
        <div style="font-size:11px; opacity:0.75;">confidence: ${confidence}</div>
      </div>
    `;
  }, []);

  return (
    <div className="min-w-0 space-y-3">
      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-2">
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

            <div className="flex w-full flex-wrap gap-1.5 md:justify-end">
              <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={fitGraph}>
                Fit
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={centerGraph}>
                Center
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={fitGraph}>
                Reset Zoom
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={releasePinnedNodes}>
                Release Pins
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => void toggleFullscreen()}>
                {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
              </Button>
            </div>
          </div>

          <div
            ref={surfaceRef}
            className={cn(
              "h-[420px] overflow-hidden rounded-lg border bg-white sm:h-[560px] xl:h-[680px] fullscreen:h-screen fullscreen:w-screen",
              isFullscreen && "fullscreen:rounded-none fullscreen:border-0"
            )}
          >
            <ForceGraph2D
              ref={graphRef}
              width={surfaceSize.width}
              height={surfaceSize.height}
              graphData={forceGraphData}
              nodeId="id"
              linkSource="source"
              linkTarget="target"
              nodeRelSize={2}
              warmupTicks={80}
              cooldownTicks={160}
              cooldownTime={4500}
              d3AlphaDecay={0.05}
              d3VelocityDecay={0.35}
              minZoom={0.22}
              maxZoom={10}
              linkColor={linkColor}
              linkWidth={linkWidth}
              linkDirectionalParticles={0}
              nodeLabel={nodeLabel}
              linkLabel={linkLabel}
              nodeCanvasObject={nodeCanvasObject}
              nodeCanvasObjectMode={() => "replace"}
              onNodeClick={onNodeClick}
              onNodeHover={(node) => {
                const canvas = surfaceRef.current?.querySelector("canvas");
                if (!canvas) {
                  return;
                }
                canvas.style.cursor = node ? "pointer" : "grab";
              }}
              onNodeDragEnd={onNodeDragEnd}
              onZoom={() => {
                hasUserCameraControlRef.current = true;
                autoFitPendingRef.current = false;
              }}
              onEngineStop={onEngineStop}
              onBackgroundClick={() => setSelectedNodeId(null)}
              enableNodeDrag
              enableZoomInteraction
              enablePanInteraction
            />
          </div>

          <div className="flex items-center gap-3 overflow-x-auto rounded-md border bg-white p-3">
            {graph.relation_types.map((relationType) => (
              <span
                key={relationType}
                className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: hashColor(relationType) }} />
                {relationType}
              </span>
            ))}
          </div>
        </div>

        <div className="min-w-0 space-y-3">
          <div className="rounded-md border bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Filtered Graph</p>
            <p className="mt-1 text-sm tabular-nums">{filtered.nodes.length} nodes</p>
            <p className="text-sm tabular-nums">{filtered.links.length} edges</p>
          </div>

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
