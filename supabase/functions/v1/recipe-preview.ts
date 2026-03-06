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
}): RecipePreview => {
  return {
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
  });
};

export const serializeRecipePreview = (
  item: RecipePreview,
): Record<string, JsonValue> => ({
  id: item.id,
  title: item.title,
  summary: item.summary,
  image_url: item.image_url,
  image_status: item.image_status,
  category: item.category,
  visibility: item.visibility,
  updated_at: item.updated_at,
  quick_stats: item.quick_stats,
});

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
