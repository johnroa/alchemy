import type { NodeObject } from "react-force-graph-2d";

/* ------------------------------------------------------------------ */
/*  Domain types                                                       */
/* ------------------------------------------------------------------ */

export type GraphEntity = {
  id: string;
  entity_type: string;
  label: string;
  metadata: Record<string, unknown>;
};

export type GraphEdge = {
  id: string;
  from_entity_id: string;
  to_entity_id: string;
  from_label: string;
  to_label: string;
  relation_type: string;
  confidence: number;
  source: string;
};

export type GraphData = {
  entities: GraphEntity[];
  edges: GraphEdge[];
  relation_types: string[];
};

/* ------------------------------------------------------------------ */
/*  Force-graph node/link types extending the domain types with        */
/*  layout properties consumed by react-force-graph-2d                 */
/* ------------------------------------------------------------------ */

export type ForceNode = GraphEntity & {
  val: number;
  degree: number;
  color: string;
  x?: number;
  y?: number;
  fx?: number;
  fy?: number;
};

export type ForceLink = GraphEdge & {
  source: string;
  target: string;
  color: string;
};

/**
 * d3-force exposes optional configuration methods on each force.
 * We type-narrow the ones we actually call to avoid `any`.
 */
export type ConfigurableForce = {
  strength?: (value: number) => unknown;
  distanceMax?: (value: number) => unknown;
  distance?: (value: number | ((link: ForceLink) => number)) => unknown;
  iterations?: (value: number) => unknown;
};

/* ------------------------------------------------------------------ */
/*  Processed/filtered graph data passed between sub-components        */
/* ------------------------------------------------------------------ */

export type FilteredGraph = {
  nodes: ForceNode[];
  links: ForceLink[];
  nodeById: Map<string, ForceNode>;
};

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

export const nodeColors: Record<string, string> = {
  recipe: "#2563eb",
  ingredient: "#047857",
  category: "#b45309",
  keyword: "#be123c",
  goal: "#0f766e",
  dish: "#2563eb",
  cuisine: "#7c3aed",
  ingredient_want: "#047857",
  ingredient_avoid: "#be123c",
  pantry_item: "#16a34a",
  diet_constraint: "#dc2626",
  health_goal: "#ea580c",
  time_budget: "#ca8a04",
  budget_tier: "#57534e",
  occasion: "#c026d3",
  appliance: "#0891b2",
  household_context: "#4f46e5",
  novelty_preference: "#d97706",
  requested_substitution: "#ea580c",
  outcome: "#334155",
};

const relationColors = ["#0ea5e9", "#f97316", "#10b981", "#a855f7", "#ef4444", "#14b8a6", "#64748b"];

/* ------------------------------------------------------------------ */
/*  Utility helpers shared across graph sub-components                 */
/* ------------------------------------------------------------------ */

/** Deterministic color from a relation type string. */
export const hashColor = (value: string): string => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return relationColors[Math.abs(hash) % relationColors.length] ?? "#64748b";
};

export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

/**
 * react-force-graph-2d sometimes hands back a raw id (string | number)
 * and sometimes the full node object. This normalises to a string id.
 */
export const resolveNodeId = (node: string | number | NodeObject<ForceNode> | undefined): string => {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (node && node.id != null) {
    return String(node.id);
  }
  return "";
};

export const labelForDisplay = (value: string, max = 36): string => {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
};
