"use client";

import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from "react-force-graph-2d";
import { cn } from "@/lib/utils";
import {
  type ConfigurableForce,
  type FilteredGraph,
  type ForceLink,
  type ForceNode,
  clamp,
  escapeHtml,
  hashColor,
  labelForDisplay,
  resolveNodeId,
} from "./types";

interface GraphCanvasProps {
  filtered: FilteredGraph;
  relationTypes: string[];
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  isFullscreen: boolean;
  /** Exposes the graph ref and camera helpers to the parent orchestrator. */
  graphRef: MutableRefObject<ForceGraphMethods<ForceNode, ForceLink> | undefined>;
  /** Ref the parent reads to decide whether auto-fit should still fire. */
  autoFitPendingRef: MutableRefObject<boolean>;
  /** Ref the parent reads to know if the user has manually interacted with the camera. */
  hasUserCameraControlRef: MutableRefObject<boolean>;
}

const GRAPH_CANVAS_COLORS = {
  background: "#020817",
  defaultNodeOutline: "rgba(2, 6, 23, 0.9)",
  selectedNodeOutline: "#f8fafc",
  labelBackground: "rgba(15, 23, 42, 0.9)",
  labelForeground: "#e2e8f0",
  fadedLink: "rgba(148, 163, 184, 0.18)",
  tooltipBackground: "rgba(2, 6, 23, 0.96)",
  tooltipBorder: "rgba(148, 163, 184, 0.35)",
  tooltipForeground: "#e2e8f0",
  tooltipMuted: "rgba(226, 232, 240, 0.72)",
} as const;

export function GraphCanvas({
  filtered,
  relationTypes,
  selectedNodeId,
  onSelectNode,
  isFullscreen,
  graphRef,
  autoFitPendingRef,
  hasUserCameraControlRef,
}: GraphCanvasProps): React.JSX.Element {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [surfaceSize, setSurfaceSize] = useState({ width: 1080, height: 680 });

  /* ---- Resize observer keeps the canvas sized to its container ---- */
  useEffect(() => {
    const element = surfaceRef.current;
    if (!element) {
      return;
    }

    const update = (): void => {
      const width = Math.max(360, Math.floor(element.clientWidth));
      const height = Math.max(440, Math.floor(element.clientHeight));
      setSurfaceSize((current) =>
        current.width === width && current.height === height ? current : { width, height }
      );
    };

    update();

    const observer = new ResizeObserver(() => update());
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [isFullscreen]);

  /* ---- Configure d3 forces whenever the graph data changes -------- */
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
  }, [filtered.links.length, filtered.nodes.length, graphRef, autoFitPendingRef, hasUserCameraControlRef]);

  /* ---- Auto-fit once the physics engine settles ------------------- */
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
  }, [filtered.links.length, filtered.nodes.length, graphRef, autoFitPendingRef, hasUserCameraControlRef]);

  /* ---- Canvas draw callback for each node ------------------------- */
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
      canvasContext.strokeStyle = isSelected
        ? GRAPH_CANVAS_COLORS.selectedNodeOutline
        : GRAPH_CANVAS_COLORS.defaultNodeOutline;
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

      canvasContext.fillStyle = GRAPH_CANVAS_COLORS.labelBackground;
      canvasContext.fillRect(labelX - boxPaddingX, labelTop, textWidth + boxPaddingX * 2, labelHeight);

      canvasContext.fillStyle = GRAPH_CANVAS_COLORS.labelForeground;
      canvasContext.textBaseline = "middle";
      canvasContext.fillText(label, labelX, labelY);
    },
    [filtered.nodes.length, selectedNodeId]
  );

  /* ---- Link visual callbacks -------------------------------------- */
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
      return GRAPH_CANVAS_COLORS.fadedLink;
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
      return sourceId === selectedNodeId || targetId === selectedNodeId
        ? Math.max(base, 1.25)
        : Math.max(0.16, base * 0.35);
    },
    [selectedNodeId]
  );

  /* ---- Tooltip builders ------------------------------------------- */
  const nodeLabel = useCallback((node: NodeObject<ForceNode>) => {
    const label = escapeHtml(String(node.label ?? "unknown"));
    const type = escapeHtml(String(node.entity_type ?? "unknown"));
    const degree = Number(node.degree ?? 0);
    const nodeId = escapeHtml(String(node.id ?? ""));

    return `
      <div style="padding:8px 10px; max-width: 280px; border-radius: 12px; border: 1px solid ${GRAPH_CANVAS_COLORS.tooltipBorder}; background: ${GRAPH_CANVAS_COLORS.tooltipBackground}; color: ${GRAPH_CANVAS_COLORS.tooltipForeground}; box-shadow: 0 16px 36px rgba(2, 6, 23, 0.35);">
        <div style="font-weight:600; margin-bottom:2px;">${label}</div>
        <div style="font-size:11px; color: ${GRAPH_CANVAS_COLORS.tooltipMuted}; margin-bottom:2px;">${type}</div>
        <div style="font-size:11px; color: ${GRAPH_CANVAS_COLORS.tooltipMuted};">degree: ${degree}</div>
        <div style="font-size:10px; color: ${GRAPH_CANVAS_COLORS.tooltipMuted}; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">${nodeId}</div>
      </div>
    `;
  }, []);

  const linkLabel = useCallback((link: LinkObject<ForceNode, ForceLink>) => {
    const relation = escapeHtml(String(link.relation_type ?? "relation"));
    const source = escapeHtml(
      String(link.from_label ?? resolveNodeId(link.source as string | number | NodeObject<ForceNode> | undefined))
    );
    const target = escapeHtml(
      String(link.to_label ?? resolveNodeId(link.target as string | number | NodeObject<ForceNode> | undefined))
    );
    const confidence = Number(link.confidence ?? 0).toFixed(2);

    return `
      <div style="padding:8px 10px; max-width: 320px; border-radius: 12px; border: 1px solid ${GRAPH_CANVAS_COLORS.tooltipBorder}; background: ${GRAPH_CANVAS_COLORS.tooltipBackground}; color: ${GRAPH_CANVAS_COLORS.tooltipForeground}; box-shadow: 0 16px 36px rgba(2, 6, 23, 0.35);">
        <div style="font-weight:600; margin-bottom:2px;">${relation}</div>
        <div style="font-size:11px; color: ${GRAPH_CANVAS_COLORS.tooltipMuted};">${source} → ${target}</div>
        <div style="font-size:11px; color: ${GRAPH_CANVAS_COLORS.tooltipMuted};">confidence: ${confidence}</div>
      </div>
    `;
  }, []);

  /* ---- Event handlers --------------------------------------------- */
  const onNodeClick = useCallback(
    (node: NodeObject<ForceNode>): void => {
      const id = resolveNodeId(node);
      if (!id) {
        return;
      }
      hasUserCameraControlRef.current = true;
      onSelectNode(id);
    },
    [onSelectNode, hasUserCameraControlRef]
  );

  const onNodeDragEnd = useCallback(
    (node: NodeObject<ForceNode>): void => {
      hasUserCameraControlRef.current = true;
      autoFitPendingRef.current = false;
      delete node.fx;
      delete node.fy;
      graphRef.current?.d3ReheatSimulation();
    },
    [graphRef, hasUserCameraControlRef, autoFitPendingRef]
  );

  const forceGraphData = useMemo(
    () => ({ nodes: filtered.nodes, links: filtered.links }),
    [filtered.links, filtered.nodes]
  );

  return (
    <>
      <div
        ref={surfaceRef}
        className={cn(
          "h-[420px] overflow-hidden rounded-lg border bg-card sm:h-[560px] xl:h-[680px] fullscreen:h-screen fullscreen:w-screen",
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
          backgroundColor={GRAPH_CANVAS_COLORS.background}
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
          onBackgroundClick={() => onSelectNode(null)}
          enableNodeDrag
          enableZoomInteraction
          enablePanInteraction
        />
      </div>

      {/* Relation-type color legend */}
      <div className="flex items-center gap-3 overflow-x-auto rounded-md border bg-card p-3 text-card-foreground">
        {relationTypes.map((relationType) => (
          <span
            key={relationType}
            className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: hashColor(relationType) }} />
            {relationType}
          </span>
        ))}
      </div>
    </>
  );
}
