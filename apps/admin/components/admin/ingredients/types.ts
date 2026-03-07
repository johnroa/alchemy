export type IngredientRow = {
  id: string;
  canonical_name: string;
  normalized_key: string;
  alias_count: number;
  usage_count: number;
  metadata: Record<string, unknown>;
  metadata_key_count: number;
  enrichment_confidence: number | null;
  ontology_link_count: number;
  pair_link_count: number;
  updated_at: string;
};

export type IngredientDetail = {
  ingredient: {
    id: string;
    canonical_name: string;
    normalized_key: string;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  };
  aliases: Array<{
    id: string;
    alias_key: string;
    source: string;
    confidence: number;
    created_at: string;
    updated_at: string;
  }>;
  ontology_links: Array<{
    id: string;
    relation_type: string;
    source: string;
    confidence: number;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
    term: {
      id: string;
      term_type: string;
      term_key: string;
      label: string;
      source: string;
      metadata: Record<string, unknown>;
    } | null;
  }>;
  pair_links: Array<{
    ingredient_id: string;
    canonical_name: string;
    normalized_key: string | null;
    co_occurrence_count: number;
    recipe_count: number;
    pmi: number | null;
    lift: number | null;
    updated_at: string;
  }>;
  usages: Array<{
    id: string;
    recipe_id: string | null;
    recipe_title: string;
    recipe_visibility: string | null;
    recipe_image_status: string | null;
    recipe_version_id: string;
    source_name: string;
    source_amount: number | null;
    source_unit: string | null;
    normalized_amount_si: number | null;
    normalized_unit: string | null;
    normalized_status: string;
    category: string | null;
    component: string | null;
    position: number;
    updated_at: string;
  }>;
  graph: {
    entity_id: string | null;
    outgoing_edges: number;
    incoming_edges: number;
    total_edges: number;
  };
};

export type FilterValue =
  | "all"
  | "enriched"
  | "unenriched"
  | "mapped"
  | "unmapped"
  | "ontology"
  | "pairs"
  | "high_confidence";

export type SortValue =
  | "updated_desc"
  | "updated_asc"
  | "name_asc"
  | "name_desc"
  | "confidence_desc"
  | "usage_desc"
  | "ontology_desc"
  | "pairs_desc"
  | "aliases_desc";

export type PageSizeValue = "20" | "40" | "80";

export const FILTER_OPTIONS: Array<{ value: FilterValue; label: string }> = [
  { value: "all", label: "All" },
  { value: "enriched", label: "Enriched" },
  { value: "unenriched", label: "Unenriched" },
  { value: "mapped", label: "Mapped" },
  { value: "unmapped", label: "Unmapped" },
  { value: "ontology", label: "Has Ontology" },
  { value: "pairs", label: "Has Pair Stats" },
  { value: "high_confidence", label: "Confidence ≥ 0.85" }
];

export const SORT_OPTIONS: Array<{ value: SortValue; label: string }> = [
  { value: "updated_desc", label: "Updated (Newest)" },
  { value: "updated_asc", label: "Updated (Oldest)" },
  { value: "name_asc", label: "Name (A-Z)" },
  { value: "name_desc", label: "Name (Z-A)" },
  { value: "confidence_desc", label: "Confidence (High-Low)" },
  { value: "usage_desc", label: "Usage (High-Low)" },
  { value: "ontology_desc", label: "Ontology Links (High-Low)" },
  { value: "pairs_desc", label: "Pair Links (High-Low)" },
  { value: "aliases_desc", label: "Aliases (High-Low)" }
];

export const PAGE_SIZE_OPTIONS: Array<{ value: PageSizeValue; label: string }> = [
  { value: "20", label: "20 / page" },
  { value: "40", label: "40 / page" },
  { value: "80", label: "80 / page" }
];

export const formatMaybeNumber = (value: number | null, digits = 2): string => {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
};

export const metadataValueLabel = (value: unknown): string => {
  if (value == null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[${value.slice(0, 4).map((item) => metadataValueLabel(item)).join(", ")}${value.length > 4 ? ", …" : ""}]`;
  }
  if (typeof value === "object") return "{…}";
  return String(value);
};

export const shortId = (value: string): string => {
  if (value.length < 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
};

export const applyFilter = (row: IngredientRow, filter: FilterValue): boolean => {
  if (filter === "all") return true;
  if (filter === "enriched") return row.enrichment_confidence != null;
  if (filter === "unenriched") return row.enrichment_confidence == null;
  if (filter === "mapped") return row.usage_count > 0;
  if (filter === "unmapped") return row.usage_count === 0;
  if (filter === "ontology") return row.ontology_link_count > 0;
  if (filter === "pairs") return row.pair_link_count > 0;
  if (filter === "high_confidence") return (row.enrichment_confidence ?? 0) >= 0.85;
  return true;
};

export const compareIngredients = (a: IngredientRow, b: IngredientRow, sort: SortValue): number => {
  if (sort === "updated_desc") return Date.parse(b.updated_at) - Date.parse(a.updated_at);
  if (sort === "updated_asc") return Date.parse(a.updated_at) - Date.parse(b.updated_at);
  if (sort === "name_asc") return a.canonical_name.localeCompare(b.canonical_name);
  if (sort === "name_desc") return b.canonical_name.localeCompare(a.canonical_name);
  if (sort === "confidence_desc") return (b.enrichment_confidence ?? -1) - (a.enrichment_confidence ?? -1);
  if (sort === "usage_desc") return b.usage_count - a.usage_count;
  if (sort === "ontology_desc") return b.ontology_link_count - a.ontology_link_count;
  if (sort === "pairs_desc") return b.pair_link_count - a.pair_link_count;
  if (sort === "aliases_desc") return b.alias_count - a.alias_count;
  return 0;
};
