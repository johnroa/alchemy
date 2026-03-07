import type { JsonValue, RecipePayload } from "../types.ts";
import type {
  RecipeDifficulty,
  RecipeMetadataNormalizationIssue,
  RecipeMetadataNormalizationResult,
  RecipeQuickStats,
} from "./types.ts";
import {
  RECIPE_STRING_FIELDS,
  RECIPE_STRING_ARRAY_FIELDS,
  NUTRITION_FIELDS,
  FLAVOR_AXES_FIELDS,
} from "./types.ts";

const asRecord = (value: unknown): Record<string, JsonValue> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, JsonValue>;
};

const parseFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const withoutPercent = trimmed.endsWith("%")
    ? trimmed.slice(0, -1).trim()
    : trimmed;
  const parsed = Number(withoutPercent);
  return Number.isFinite(parsed) ? parsed : null;
};

const clampInteger = (
  value: number,
  min: number,
  max: number,
): number => {
  const rounded = Math.round(value);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
};

const firstPresentValue = (...values: unknown[]): unknown => {
  for (const value of values) {
    if (typeof value === "undefined" || value === null) {
      continue;
    }
    if (typeof value === "string" && value.trim().length === 0) {
      continue;
    }
    return value;
  }
  return undefined;
};

const trimString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeStringList = (...values: unknown[]): string[] => {
  const items: string[] = [];
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        items.push(trimmed);
      }
      continue;
    }

    if (!Array.isArray(value)) {
      continue;
    }

    for (const item of value) {
      if (typeof item !== "string") {
        continue;
      }
      const trimmed = item.trim();
      if (trimmed.length > 0) {
        items.push(trimmed);
      }
    }
  }

  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.toLocaleLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const normalizeDifficulty = (value: unknown): RecipeDifficulty | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (
    normalized === "easy" || normalized === "simple" ||
    normalized === "beginner"
  ) {
    return "easy";
  }
  if (
    normalized === "medium" || normalized === "moderate" ||
    normalized === "intermediate"
  ) {
    return "medium";
  }
  if (
    normalized === "complex" || normalized === "advanced" ||
    normalized === "hard" || normalized === "challenging"
  ) {
    return "complex";
  }
  return null;
};

const sanitizeNumericRecord = <T extends readonly string[]>(
  value: unknown,
  fields: T,
): Record<T[number], JsonValue> | undefined => {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const next: Record<string, JsonValue> = {};
  for (const field of fields) {
    const numeric = parseFiniteNumber(record[field]);
    if (numeric !== null) {
      next[field] = numeric;
    }
  }

  return Object.keys(next).length > 0
    ? (next as Record<T[number], JsonValue>)
    : undefined;
};

const sanitizeSubstitutions = (
  value: unknown,
): Array<{ from: string; to: string; note?: string }> | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const substitutions: Array<{ from: string; to: string; note?: string }> = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }
    const from = trimString(record.from);
    const to = trimString(record.to);
    if (!from || !to) {
      continue;
    }
    const note = trimString(record.note);
    substitutions.push({
      from,
      to,
      ...(note ? { note } : {}),
    });
  }

  return substitutions.length > 0 ? substitutions : undefined;
};

const sanitizeStorageReheatProfile = (
  value: unknown,
  legacyStorage?: unknown,
): Record<string, JsonValue> | undefined => {
  const record = asRecord(value) ?? {};
  const storage = normalizeStringList(record.storage, legacyStorage);
  const reheat = normalizeStringList(record.reheat);
  if (storage.length === 0 && reheat.length === 0) {
    return undefined;
  }

  return {
    ...(storage.length > 0 ? { storage } : {}),
    ...(reheat.length > 0 ? { reheat } : {}),
  };
};

const sanitizePractical = (value: unknown): Record<string, JsonValue> | undefined => {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const costTier = trimString(record.cost_tier);
  const mealPrepFriendly = typeof record.meal_prep_friendly === "boolean"
    ? record.meal_prep_friendly
    : undefined;

  const next: Record<string, JsonValue> = {
    ...(costTier ? { cost_tier: costTier } : {}),
    ...(typeof mealPrepFriendly === "boolean"
      ? { meal_prep_friendly: mealPrepFriendly }
      : {}),
  };

  return Object.keys(next).length > 0 ? next : undefined;
};

const buildTimingRecord = (
  metadata: Record<string, JsonValue>,
): Record<string, JsonValue> | undefined => {
  const timing = asRecord(metadata.timing);
  const timeBreakdown = asRecord(metadata.time_breakdown);
  const timingBreakdown = asRecord(metadata.timing_breakdown);

  const prepMinutes = firstPresentValue(
    timing?.prep_minutes,
    timeBreakdown?.prep_minutes,
    timingBreakdown?.prep_minutes,
    metadata.prep_time_minutes,
    metadata.prep_minutes,
  );
  const cookMinutes = firstPresentValue(
    timing?.cook_minutes,
    timeBreakdown?.cook_minutes,
    timingBreakdown?.cook_minutes,
    metadata.cook_time_minutes,
    metadata.cook_minutes,
  );
  const totalMinutes = firstPresentValue(
    timing?.total_minutes,
    timeBreakdown?.total_minutes,
    timingBreakdown?.total_minutes,
    metadata.total_time_minutes,
    metadata.timing_total_minutes,
    metadata.time_minutes,
  );

  const parsedPrep = parseFiniteNumber(prepMinutes);
  const parsedCook = parseFiniteNumber(cookMinutes);
  const parsedTotal = parseFiniteNumber(totalMinutes);

  const next: Record<string, JsonValue> = {};
  if (parsedPrep !== null && parsedPrep > 0) {
    next.prep_minutes = clampInteger(parsedPrep, 1, 720);
  }
  if (parsedCook !== null && parsedCook > 0) {
    next.cook_minutes = clampInteger(parsedCook, 1, 720);
  }
  if (parsedTotal !== null && parsedTotal > 0) {
    next.total_minutes = clampInteger(parsedTotal, 1, 720);
  }

  return Object.keys(next).length > 0 ? next : undefined;
};

const applyLegacyAliases = (
  metadata: Record<string, JsonValue>,
): Record<string, JsonValue> => {
  const next = { ...metadata };

  const difficulty = firstPresentValue(
    next.difficulty,
    next.difficulty_level,
    next.difficultyLevel,
  );
  if (typeof difficulty !== "undefined") {
    next.difficulty = difficulty as JsonValue;
  }

  const skillLevel = firstPresentValue(
    next.skill_level,
    next.skillLevel,
    next.skill_required,
  );
  if (typeof skillLevel !== "undefined") {
    next.skill_level = skillLevel as JsonValue;
  }

  const healthScore = firstPresentValue(
    next.health_score,
    next.health,
    next.healthiness_score,
    next.health_percentage,
  );
  if (typeof healthScore !== "undefined") {
    next.health_score = healthScore as JsonValue;
  }

  const items = firstPresentValue(
    next.items,
    next.item_count,
    next.ingredient_count,
    next.ingredients_count,
    next.key_ingredients_count,
  );
  if (typeof items !== "undefined") {
    next.items = items as JsonValue;
  }

  const timing = buildTimingRecord(next);
  if (timing) {
    next.timing = timing;
  }

  const dietTags = normalizeStringList(
    next.diet_tags,
    next.dietary_tags,
    next.dietary_flags,
    next.dietary_attributes,
    next.dietary_restrictions,
    next.diet_restrictions,
  );
  if (dietTags.length > 0) {
    next.diet_tags = dietTags;
  }

  const allergenFlags = normalizeStringList(
    next.allergen_flags,
    next.allergen_information,
    next.allergen_warnings,
  );
  if (allergenFlags.length > 0) {
    next.allergen_flags = allergenFlags;
  }

  const techniques = normalizeStringList(
    next.techniques,
    next.cooking_methods,
    next.cooking_method,
    next.cook_method,
    next.key_techniques,
  );
  if (techniques.length > 0) {
    next.techniques = techniques;
  }

  const equipment = normalizeStringList(
    next.equipment,
    next.equipment_required,
    next.equipment_needed,
  );
  if (equipment.length > 0) {
    next.equipment = equipment;
  }

  const courseType = trimString(
    firstPresentValue(
      next.course_type,
      next.meal_type,
      next.dish_type,
      next.dish_category,
      next.meal_category,
      next.recipe_type,
    ),
  );
  if (courseType) {
    next.course_type = courseType;
  }

  const occasionTags = normalizeStringList(
    next.occasion_tags,
    next.occasion,
    next.occasions,
  );
  if (occasionTags.length > 0) {
    next.occasion_tags = occasionTags;
  }

  const seasonality = normalizeStringList(
    next.seasonality,
    next.season,
    next.seasonal,
    next.season_suitability,
  );
  if (seasonality.length > 0) {
    next.seasonality = seasonality;
  }

  const cuisineTags = normalizeStringList(
    next.cuisine_tags,
    next.cuisine_type,
    next.regional_origin,
    next.recipe_origin,
    next.source_region,
  );
  if (cuisineTags.length > 0) {
    next.cuisine_tags = cuisineTags;
  }

  return next;
};

const resolveHealthScore = (metadata: Record<string, JsonValue>): number | null => {
  const quickStats = asRecord(metadata.quick_stats);
  const candidate = firstPresentValue(
    quickStats?.health_score,
    metadata.health_score,
  );
  const parsed = parseFiniteNumber(candidate);
  return parsed !== null ? clampInteger(parsed, 1, 100) : null;
};

const resolveDifficulty = (
  metadata: Record<string, JsonValue>,
): RecipeDifficulty | null => {
  const quickStats = asRecord(metadata.quick_stats);
  return normalizeDifficulty(quickStats?.difficulty) ??
    normalizeDifficulty(metadata.difficulty) ??
    normalizeDifficulty(metadata.skill_level);
};

const resolveTimeMinutes = (params: {
  metadata: Record<string, JsonValue>;
  stepTimerSecondsTotal: number;
}): number | null => {
  const quickStats = asRecord(params.metadata.quick_stats);
  const timing = buildTimingRecord(params.metadata);
  const derivedFromTiming = parseFiniteNumber(timing?.total_minutes) ??
    (() => {
      const prep = parseFiniteNumber(timing?.prep_minutes);
      const cook = parseFiniteNumber(timing?.cook_minutes);
      if (prep !== null && cook !== null) {
        return prep + cook;
      }
      return null;
    })();
  const fromStepTimers = params.stepTimerSecondsTotal > 0
    ? params.stepTimerSecondsTotal / 60
    : null;
  const candidate = firstPresentValue(
    quickStats?.time_minutes,
    params.metadata.time_minutes,
    derivedFromTiming,
    fromStepTimers,
  );
  const parsed = parseFiniteNumber(candidate);
  return parsed !== null && parsed > 0 ? clampInteger(parsed, 1, 720) : null;
};

const resolveItemCount = (params: {
  metadata: Record<string, JsonValue>;
  ingredientCount: number;
}): number | null => {
  const quickStats = asRecord(params.metadata.quick_stats);
  const candidate = firstPresentValue(
    quickStats?.items,
    params.metadata.items,
    params.ingredientCount,
  );
  const parsed = parseFiniteNumber(candidate);
  return parsed !== null && parsed > 0 ? clampInteger(parsed, 1, 200) : null;
};

export const sumRecipeStepTimerSeconds = (
  steps: RecipePayload["steps"] | undefined,
): number => {
  if (!Array.isArray(steps)) {
    return 0;
  }

  return steps.reduce((total, step) => {
    const timer = Number(step.timer_seconds);
    if (!Number.isFinite(timer) || timer <= 0) {
      return total;
    }
    return total + timer;
  }, 0);
};

export const normalizeRecipeMetadata = (params: {
  metadata?: Record<string, JsonValue>;
  ingredientCount: number;
  stepTimerSecondsTotal: number;
  requireModelSignals?: boolean;
}): RecipeMetadataNormalizationResult => {
  const sourceMetadata = params.metadata ? { ...params.metadata } : {};
  const metadata = applyLegacyAliases(sourceMetadata);
  const issues: RecipeMetadataNormalizationIssue[] = [];
  const normalized: Record<string, JsonValue> = {};

  for (const field of RECIPE_STRING_FIELDS) {
    const value = trimString(metadata[field]);
    if (value) {
      normalized[field] = value;
    }
  }

  for (const field of RECIPE_STRING_ARRAY_FIELDS) {
    const values = normalizeStringList(metadata[field]);
    if (values.length > 0) {
      normalized[field] = values;
    }
  }

  const nutrition = sanitizeNumericRecord(metadata.nutrition, NUTRITION_FIELDS);
  if (nutrition) {
    normalized.nutrition = nutrition;
  }

  const flavorAxes = sanitizeNumericRecord(metadata.flavor_axes, FLAVOR_AXES_FIELDS);
  if (flavorAxes) {
    normalized.flavor_axes = flavorAxes;
  }

  const substitutions = sanitizeSubstitutions(metadata.substitutions);
  if (substitutions) {
    normalized.substitutions = substitutions as unknown as JsonValue;
  }

  const storageReheatProfile = sanitizeStorageReheatProfile(
    metadata.storage_reheat_profile,
    metadata.storage,
  );
  if (storageReheatProfile) {
    normalized.storage_reheat_profile = storageReheatProfile;
  }

  const practical = sanitizePractical(metadata.practical);
  if (practical) {
    normalized.practical = practical;
  }

  const complexityScore = parseFiniteNumber(metadata.complexity_score);
  if (complexityScore !== null) {
    normalized.complexity_score = complexityScore;
  }

  const difficulty = resolveDifficulty(metadata);
  if (difficulty) {
    normalized.difficulty = difficulty;
  } else if (params.requireModelSignals) {
    issues.push("difficulty_missing");
  }

  const healthScore = resolveHealthScore(metadata);
  if (healthScore !== null) {
    normalized.health_score = healthScore;
  } else if (params.requireModelSignals) {
    issues.push("health_score_missing");
  }

  const timeMinutes = resolveTimeMinutes({
    metadata,
    stepTimerSecondsTotal: params.stepTimerSecondsTotal,
  });
  if (timeMinutes !== null) {
    normalized.time_minutes = timeMinutes;
  } else if (params.requireModelSignals) {
    issues.push("time_minutes_missing");
  }

  const items = resolveItemCount({
    metadata,
    ingredientCount: params.ingredientCount,
  });
  if (items !== null) {
    normalized.items = items;
  }

  const timing = buildTimingRecord(metadata) ?? {};
  if (timeMinutes !== null) {
    timing.total_minutes = timeMinutes;
  }
  if (Object.keys(timing).length > 0) {
    normalized.timing = timing;
  }

  if (
    difficulty && healthScore !== null && timeMinutes !== null &&
    items !== null
  ) {
    const quickStats: RecipeQuickStats = {
      time_minutes: timeMinutes,
      difficulty,
      health_score: healthScore,
      items,
    };
    normalized.quick_stats = quickStats;
  }

  if (Object.keys(normalized).length > 0) {
    normalized.metadata_schema_version = 2;
  }

  return {
    metadata: normalized,
    issues,
  };
};
