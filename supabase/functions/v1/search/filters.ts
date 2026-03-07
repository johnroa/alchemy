import type { JsonValue } from "../../_shared/types.ts";
import {
  buildRecipePreview,
  normalizeRecipePreview,
  serializeRecipePreview,
} from "../recipe-preview.ts";
import type {
  AllFeedCursor,
  RecipeSearchAppliedContext,
  RecipeSearchCard,
  RecipeSearchDifficulty,
  RecipeSearchIntent,
  RecipeSearchNoMatch,
  SearchCursor,
  SearchRpcRow,
  SessionCursor,
} from "./types.ts";
import { DEFAULT_LIMIT, MAX_LIMIT } from "./types.ts";

// ---------------------------------------------------------------------------
// Generic normalizers — used across search modules
// ---------------------------------------------------------------------------

export const asRecord = (value: unknown): Record<string, JsonValue> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, JsonValue>;
};

export const normalizeScalarText = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
};

export const normalizeStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    const normalized = normalizeScalarText(entry);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
};

export const normalizeDifficulty = (
  value: unknown,
): RecipeSearchDifficulty | null => {
  const normalized = normalizeScalarText(value)?.toLowerCase();
  if (
    normalized !== "easy" && normalized !== "medium" &&
    normalized !== "complex"
  ) {
    return null;
  }
  return normalized;
};

export const normalizeFiniteInteger = (value: unknown): number | null => {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string"
    ? Number(value)
    : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.trunc(parsed);
};

export const clampLimit = (value: number | null | undefined): number => {
  if (!Number.isFinite(value)) {
    return DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(Number(value))));
};

// ---------------------------------------------------------------------------
// Base64url cursor encoding
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toBase64Url = (value: string): string => {
  let binary = "";
  for (const byte of encoder.encode(value)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/g,
    "",
  );
};

const fromBase64Url = (value: string): string => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return decoder.decode(bytes);
};

export const encodeSearchCursor = (cursor: SearchCursor): string => {
  return toBase64Url(JSON.stringify(cursor));
};

export const decodeSearchCursor = (
  value: string | null | undefined,
): SearchCursor | null => {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(fromBase64Url(value)) as {
      v?: unknown;
      kind?: unknown;
      search_id?: unknown;
      last_indexed_at?: unknown;
      last_recipe_id?: unknown;
      offset?: unknown;
    };

    if (parsed.v !== 1 || typeof parsed.search_id !== "string") {
      return null;
    }
    if (
      parsed.kind === "all" && typeof parsed.last_indexed_at === "string" &&
      typeof parsed.last_recipe_id === "string"
    ) {
      return {
        v: 1,
        kind: "all",
        search_id: parsed.search_id,
        last_indexed_at: parsed.last_indexed_at,
        last_recipe_id: parsed.last_recipe_id,
      } satisfies AllFeedCursor;
    }
    if (
      parsed.kind === "session" && Number.isInteger(parsed.offset) &&
      Number(parsed.offset) >= 0
    ) {
      return {
        v: 1,
        kind: "session",
        search_id: parsed.search_id,
        offset: Number(parsed.offset),
      } satisfies SessionCursor;
    }
  } catch {
    return null;
  }

  return null;
};

// ---------------------------------------------------------------------------
// Card normalization / serialization
// ---------------------------------------------------------------------------

export const normalizeRecipeSearchCard = normalizeRecipePreview;

export const normalizeStoredCards = (value: unknown): RecipeSearchCard[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: RecipeSearchCard[] = [];
  for (const entry of value) {
    const item = normalizeRecipeSearchCard(entry);
    if (item) {
      result.push(item);
    }
  }
  return result;
};

export const serializeSearchCard = serializeRecipePreview;

export const serializeVector = (vector: number[]): string => {
  return `[${vector.map((value) => Number(value).toFixed(12)).join(",")}]`;
};

export const mapRpcRowToCard = (row: SearchRpcRow): RecipeSearchCard =>
  buildRecipePreview({
    id: row.recipe_id,
    title: row.title,
    summary: row.summary,
    image_url: row.image_url,
    image_status: row.image_status,
    category: row.category,
    visibility: row.visibility,
    updated_at: row.updated_at,
    quick_stats: row.quick_stats,
    save_count: row.save_count,
    variant_count: row.variant_count,
  });

// ---------------------------------------------------------------------------
// Search text helpers
// ---------------------------------------------------------------------------

export const normalizeSearchText = (
  value: string | null | undefined,
): string | null => {
  const normalized = normalizeScalarText(value);
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, 400);
};

export const derivePresetText = (presetId: string): string => {
  return presetId
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
};

export const buildNoMatch = (
  appliedContext: RecipeSearchAppliedContext,
): RecipeSearchNoMatch => {
  if (appliedContext === "all") {
    return {
      code: "all_feed_empty",
      message: "No public recipes are available yet.",
      suggested_action: "Try again after more recipes are indexed.",
    };
  }

  return {
    code: "recipe_search_no_match",
    message: "No recipes matched that search yet.",
    suggested_action:
      "Try a broader description or remove one constraint.",
  };
};

// ---------------------------------------------------------------------------
// Array / filter helpers
// ---------------------------------------------------------------------------

/** Deduplicated union of two string arrays (case-insensitive, trimmed). */
export const mergeUnique = (a: string[], b: string[]): string[] => {
  const seen = new Set(a.map((s) => s.toLowerCase().trim()));
  const result = [...a];
  for (const s of b) {
    const key = s.toLowerCase().trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      result.push(s);
    }
  }
  return result;
};

export const filterSessionItems = (
  items: RecipeSearchCard[],
  promotedRecipeIds: string[],
): RecipeSearchCard[] => {
  if (promotedRecipeIds.length === 0) {
    return items;
  }
  const excluded = new Set(promotedRecipeIds);
  return items.filter((item) => !excluded.has(item.id));
};

// ---------------------------------------------------------------------------
// LLM result normalizers
// ---------------------------------------------------------------------------

export const normalizeSearchIntent = (params: {
  appliedContext: RecipeSearchAppliedContext;
  normalizedInput: string | null;
  raw: unknown;
}): RecipeSearchIntent => {
  const record = asRecord(params.raw);
  const hardFilters = asRecord(record?.hard_filters);

  return {
    normalized_query: normalizeScalarText(record?.normalized_query) ??
      params.normalizedInput ?? "",
    applied_context: params.appliedContext,
    hard_filters: {
      cuisines: normalizeStringList(hardFilters?.cuisines),
      diet_tags: normalizeStringList(hardFilters?.diet_tags),
      techniques: normalizeStringList(hardFilters?.techniques),
      exclude_ingredients: normalizeStringList(hardFilters?.exclude_ingredients),
      max_time_minutes: normalizeFiniteInteger(hardFilters?.max_time_minutes),
      max_difficulty: normalizeDifficulty(hardFilters?.max_difficulty),
    },
    soft_targets: normalizeStringList(record?.soft_targets),
    exclusions: normalizeStringList(record?.exclusions),
    sort_bias: normalizeScalarText(record?.sort_bias),
    query_style: params.appliedContext === "all"
      ? "all"
      : normalizeScalarText(record?.query_style) === "explicit" ||
          normalizeScalarText(record?.query_style) === "subjective" ||
          normalizeScalarText(record?.query_style) === "mixed"
      ? normalizeScalarText(record?.query_style) as
        | "explicit"
        | "subjective"
        | "mixed"
      : "mixed",
  };
};

export const normalizeRerankResult = (params: {
  raw: unknown;
  candidates: RecipeSearchCard[];
}): {
  orderedItems: RecipeSearchCard[];
  rationaleTagsByRecipe: Record<string, string[]>;
} => {
  const record = asRecord(params.raw);
  const orderedRecipeIds = normalizeStringList(record?.ordered_recipe_ids);
  const rationaleRaw = asRecord(record?.rationale_tags_by_recipe);
  const rationaleTagsByRecipe: Record<string, string[]> = {};
  for (const [recipeId, value] of Object.entries(rationaleRaw ?? {})) {
    rationaleTagsByRecipe[recipeId] = normalizeStringList(value);
  }

  const itemById = new Map(params.candidates.map((item) => [item.id, item]));
  const orderedItems: RecipeSearchCard[] = [];
  const seen = new Set<string>();

  for (const recipeId of orderedRecipeIds) {
    const item = itemById.get(recipeId);
    if (!item || seen.has(recipeId)) {
      continue;
    }
    seen.add(recipeId);
    orderedItems.push(item);
  }

  for (const item of params.candidates) {
    if (seen.has(item.id)) {
      continue;
    }
    orderedItems.push(item);
  }

  return { orderedItems, rationaleTagsByRecipe };
};
