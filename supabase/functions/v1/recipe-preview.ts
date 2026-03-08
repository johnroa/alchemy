import {
  normalizeRecipeMetadata,
  sumRecipeStepTimerSeconds,
} from "../_shared/recipe-metadata-normalization.ts";
import type {
  JsonValue,
  RecipePayload,
} from "../_shared/types.ts";

export type RecipePreviewDifficulty = "easy" | "medium" | "complex";

export type RecipeQuickStats = {
  time_minutes: number;
  difficulty: RecipePreviewDifficulty;
  health_score: number;
  items: number;
};

export type RecipePreview = {
  id: string;
  title: string;
  summary: string;
  image_url: string | null;
  image_status: string;
  category: string;
  visibility: string;
  updated_at: string;
  quick_stats: RecipeQuickStats | null;
  save_count?: number;
  variant_count?: number;
  popularity_score?: number;
  trending_score?: number;
  why_tags?: string[];
};

export type RecipeCategoryCandidate = {
  recipe_id: string;
  category: string;
  confidence?: number | null;
};

const FALLBACK_CATEGORY = "Auto Organized";
const FALLBACK_VISIBILITY = "public";
const FALLBACK_UPDATED_AT = "1970-01-01T00:00:00.000Z";

const asRecord = (value: unknown): Record<string, JsonValue> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, JsonValue>;
};

const normalizeScalarText = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
};

export const resolveRecipePayloadSummary = (
  payload: Pick<RecipePayload, "summary" | "description" | "notes">,
): string => {
  return normalizeScalarText(payload.summary) ??
    normalizeScalarText(payload.description) ??
    normalizeScalarText(payload.notes) ??
    "";
};

export const resolveRecipePayloadDescription = (
  payload: Pick<RecipePayload, "summary" | "description">,
): string | undefined => {
  return normalizeScalarText(payload.description) ??
    normalizeScalarText(payload.summary) ??
    undefined;
};

const normalizeFiniteInteger = (value: unknown): number | null => {
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

const normalizeFiniteNumber = (value: unknown): number | null => {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string"
    ? Number(value)
    : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
};

const normalizeStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const normalized = normalizeScalarText(entry);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
};

const normalizeDifficulty = (
  value: unknown,
): RecipePreviewDifficulty | null => {
  const normalized = normalizeScalarText(value)?.toLowerCase();
  if (
    normalized !== "easy" && normalized !== "medium" &&
    normalized !== "complex"
  ) {
    return null;
  }

  return normalized;
};

export const canonicalizeRecipePayloadMetadata = (
  payload: Pick<RecipePayload, "metadata" | "ingredients" | "steps">,
): Record<string, JsonValue> | undefined => {
  const { metadata } = normalizeRecipeMetadata({
    metadata: payload.metadata &&
        typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
      ? payload.metadata as Record<string, JsonValue>
      : undefined,
    ingredientCount: Array.isArray(payload.ingredients)
      ? payload.ingredients.length
      : 0,
    stepTimerSecondsTotal: sumRecipeStepTimerSeconds(payload.steps),
  });

  return Object.keys(metadata).length > 0 ? metadata : undefined;
};

export const normalizeQuickStats = (input: {
  quickStats?: unknown;
  timeMinutes?: unknown;
  difficulty?: unknown;
  healthScore?: unknown;
  items?: unknown;
}): RecipeQuickStats | null => {
  const quickStats = asRecord(input.quickStats);
  const timeMinutes = normalizeFiniteInteger(
    quickStats?.time_minutes ?? input.timeMinutes,
  );
  const difficulty = normalizeDifficulty(
    quickStats?.difficulty ?? input.difficulty,
  );
  const healthScore = normalizeFiniteInteger(
    quickStats?.health_score ?? input.healthScore,
  );
  const items = normalizeFiniteInteger(quickStats?.items ?? input.items);

  if (
    timeMinutes === null || difficulty === null || healthScore === null ||
    items === null
  ) {
    return null;
  }

  return {
    time_minutes: timeMinutes,
    difficulty,
    health_score: healthScore,
    items,
  };
};

export const buildRecipePreview = (input: {
  id: string;
  title?: string | null;
  summary?: string | null;
  image_url?: string | null;
  image_status?: string | null;
  category?: string | null;
  visibility?: string | null;
  updated_at?: string | null;
  quick_stats?: unknown;
  time_minutes?: unknown;
  difficulty?: unknown;
  health_score?: unknown;
  items?: unknown;
  save_count?: number | null;
  variant_count?: number | null;
  popularity_score?: unknown;
  trending_score?: unknown;
  why_tags?: unknown;
}): RecipePreview => {
  const preview: RecipePreview = {
    id: input.id,
    title: normalizeScalarText(input.title) ?? "Untitled Recipe",
    summary: normalizeScalarText(input.summary) ?? "",
    image_url: normalizeScalarText(input.image_url),
    image_status: normalizeScalarText(input.image_status) ?? "pending",
    category: normalizeScalarText(input.category) ?? FALLBACK_CATEGORY,
    visibility: normalizeScalarText(input.visibility) ?? FALLBACK_VISIBILITY,
    updated_at: normalizeScalarText(input.updated_at) ?? FALLBACK_UPDATED_AT,
    quick_stats: normalizeQuickStats({
      quickStats: input.quick_stats,
      timeMinutes: input.time_minutes,
      difficulty: input.difficulty,
      healthScore: input.health_score,
      items: input.items,
    }),
  };
  // Only include popularity counts when present (search/explore responses).
  if (typeof input.save_count === "number" && input.save_count > 0) {
    preview.save_count = input.save_count;
  }
  if (typeof input.variant_count === "number" && input.variant_count > 0) {
    preview.variant_count = input.variant_count;
  }
  const popularityScore = normalizeFiniteNumber(input.popularity_score);
  if (popularityScore !== null && popularityScore > 0) {
    preview.popularity_score = popularityScore;
  }
  const trendingScore = normalizeFiniteNumber(input.trending_score);
  if (trendingScore !== null && trendingScore > 0) {
    preview.trending_score = trendingScore;
  }
  const whyTags = normalizeStringList(input.why_tags).slice(0, 4);
  if (whyTags.length > 0) {
    preview.why_tags = whyTags;
  }
  return preview;
};

export const normalizeRecipePreview = (value: unknown): RecipePreview | null => {
  const record = asRecord(value);
  const id = normalizeScalarText(record?.id);
  if (!record || !id) {
    return null;
  }

  return buildRecipePreview({
    id,
    title: normalizeScalarText(record.title),
    summary: normalizeScalarText(record.summary),
    image_url: normalizeScalarText(record.image_url),
    image_status: normalizeScalarText(record.image_status),
    category: normalizeScalarText(record.category),
    visibility: normalizeScalarText(record.visibility),
    updated_at: normalizeScalarText(record.updated_at),
    quick_stats: record.quick_stats,
    time_minutes: record.time_minutes,
    difficulty: record.difficulty,
    health_score: record.health_score,
    items: record.items ?? record.ingredient_count,
    save_count: normalizeFiniteInteger(record.save_count),
    variant_count: normalizeFiniteInteger(record.variant_count),
    popularity_score: normalizeFiniteNumber(record.popularity_score),
    trending_score: normalizeFiniteNumber(record.trending_score),
    why_tags: record.why_tags,
  });
};

export const serializeRecipePreview = (
  item: RecipePreview,
): Record<string, JsonValue> => {
  const serialized: Record<string, JsonValue> = {
    id: item.id,
    title: item.title,
    summary: item.summary,
    image_url: item.image_url,
    image_status: item.image_status,
    category: item.category,
    visibility: item.visibility,
    updated_at: item.updated_at,
    quick_stats: item.quick_stats,
  };

  if (typeof item.save_count === "number") {
    serialized.save_count = item.save_count;
  }
  if (typeof item.variant_count === "number") {
    serialized.variant_count = item.variant_count;
  }
  if (typeof item.popularity_score === "number") {
    serialized.popularity_score = item.popularity_score;
  }
  if (typeof item.trending_score === "number") {
    serialized.trending_score = item.trending_score;
  }
  if (Array.isArray(item.why_tags) && item.why_tags.length > 0) {
    serialized.why_tags = item.why_tags;
  }

  return serialized;
};

export const buildHighestConfidenceCategoryMap = (
  entries: RecipeCategoryCandidate[],
): Map<string, string> => {
  const result = new Map<string, { category: string; confidence: number }>();

  for (const entry of entries) {
    const recipeId = normalizeScalarText(entry.recipe_id);
    const category = normalizeScalarText(entry.category);
    if (!recipeId || !category) {
      continue;
    }

    const confidence = Number.isFinite(entry.confidence)
      ? Number(entry.confidence)
      : Number.NEGATIVE_INFINITY;
    const current = result.get(recipeId);

    if (
      !current ||
      confidence > current.confidence ||
      (confidence === current.confidence &&
        category.localeCompare(current.category) < 0)
    ) {
      result.set(recipeId, { category, confidence });
    }
  }

  return new Map(
    Array.from(result.entries()).map(([recipeId, value]) => [
      recipeId,
      value.category,
    ]),
  );
};

export const resolveCookbookPreviewCategory = (
  userOverride: unknown,
  autoCategory: unknown,
): string | null => {
  return normalizeScalarText(userOverride) ?? normalizeScalarText(autoCategory);
};

export const resolveSearchPreviewCategory = (
  autoCategory: unknown,
): string | null => {
  return normalizeScalarText(autoCategory);
};
