import { normalizeWhitespaceToken } from "../../../../packages/shared/src/text-normalization.ts";
import type { RecipePayload } from "../../_shared/types.ts";
import {
  type CanonicalIngredientRecord,
  type CanonicalIngredientView,
  COUNT_UNITS,
  FRACTION_GLYPHS,
  type GroupByPreference,
  type IngredientGroup,
  MASS_FACTORS_TO_G,
  type NormalizedStatus,
  type UnitKind,
  type UnitPreference,
  UNIT_ALIAS,
  VOLUME_FACTORS_TO_ML,
  roundForDisplay,
  toStringOrNull,
} from "./types.ts";

// ── Ingredient identity ───────────────────────────────────────────────

export const normalizeIngredientKey = (input: string): string => {
  return normalizeWhitespaceToken(input);
};

export const toCanonicalIngredientName = (
  normalizedKey: string,
  fallback: string,
): string => {
  if (normalizedKey.length === 0) {
    return fallback.trim();
  }

  return normalizedKey
    .split(" ")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
};

export const deriveCanonicalIngredientIdentity = (
  input: string,
  fallback?: string,
): { canonicalName: string; canonicalKey: string } => {
  const canonicalKey = normalizeIngredientKey(input);
  if (canonicalKey.length > 0) {
    return {
      canonicalKey,
      canonicalName: toCanonicalIngredientName(canonicalKey, input),
    };
  }

  const fallbackValue = typeof fallback === "string" && fallback.trim().length > 0
    ? fallback
    : input;
  const fallbackKey = normalizeIngredientKey(fallbackValue);
  return {
    canonicalKey: fallbackKey,
    canonicalName: toCanonicalIngredientName(fallbackKey, fallbackValue),
  };
};

// ── Amount parsing ────────────────────────────────────────────────────
// Handles plain numbers, unicode fraction glyphs (½), mixed numbers (1 1/2),
// slash fractions (3/4), and combinations thereof.

export const parseAmountValue = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed in FRACTION_GLYPHS) {
    return FRACTION_GLYPHS[trimmed] ?? null;
  }

  const glyphExpanded = trimmed.replace(/[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g, (match) => {
    const numeric = FRACTION_GLYPHS[match] ?? 0;
    return ` ${numeric} `;
  });

  const mixedMatch = glyphExpanded.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixedMatch) {
    const whole = Number(mixedMatch[1]);
    const numerator = Number(mixedMatch[2]);
    const denominator = Number(mixedMatch[3]);
    if (Number.isFinite(whole) && Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
      return whole + numerator / denominator;
    }
  }

  const fractionMatch = glyphExpanded.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fractionMatch) {
    const numerator = Number(fractionMatch[1]);
    const denominator = Number(fractionMatch[2]);
    if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
      return numerator / denominator;
    }
  }

  const numeric = Number(glyphExpanded);
  return Number.isFinite(numeric) ? numeric : null;
};

// ── Unit normalization ────────────────────────────────────────────────

export const normalizeUnitToken = (value: unknown): string | null => {
  const raw = toStringOrNull(value);
  if (!raw) {
    return null;
  }

  const cleaned = raw.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  return UNIT_ALIAS[cleaned] ?? cleaned;
};

// ── SI conversion ─────────────────────────────────────────────────────
// Converts a parsed amount + unit token into SI base units (grams / milliliters)
// and classifies the unit kind. Returns needs_retry when the unit is unrecognized.

export const toSi = (amount: number | null, unitToken: string | null): {
  normalized_amount_si: number | null;
  normalized_unit: string | null;
  unit_kind: UnitKind;
  normalized_status: NormalizedStatus;
} => {
  if (amount == null || !Number.isFinite(amount)) {
    return {
      normalized_amount_si: null,
      normalized_unit: null,
      unit_kind: "unknown",
      normalized_status: "needs_retry"
    };
  }

  if (!unitToken) {
    return {
      normalized_amount_si: null,
      normalized_unit: null,
      unit_kind: "unknown",
      normalized_status: "needs_retry"
    };
  }

  if (unitToken in MASS_FACTORS_TO_G) {
    return {
      normalized_amount_si: amount * (MASS_FACTORS_TO_G[unitToken] ?? 1),
      normalized_unit: "g",
      unit_kind: "mass",
      normalized_status: "normalized"
    };
  }

  if (unitToken in VOLUME_FACTORS_TO_ML) {
    return {
      normalized_amount_si: amount * (VOLUME_FACTORS_TO_ML[unitToken] ?? 1),
      normalized_unit: "ml",
      unit_kind: "volume",
      normalized_status: "normalized"
    };
  }

  if (COUNT_UNITS.has(unitToken)) {
    return {
      normalized_amount_si: amount,
      normalized_unit: "unit",
      unit_kind: "count",
      normalized_status: "normalized"
    };
  }

  return {
    normalized_amount_si: null,
    normalized_unit: null,
    unit_kind: "unknown",
    normalized_status: "needs_retry"
  };
};

// ── Canonicalize raw ingredients ──────────────────────────────────────

export const canonicalizeIngredients = (ingredients: RecipePayload["ingredients"]): CanonicalIngredientRecord[] => {
  return ingredients.map((ingredient, position) => {
    const sourceName = ingredient.name.trim();
    const identity = deriveCanonicalIngredientIdentity(sourceName);

    const parsedAmount = parseAmountValue(
      ingredient.amount ?? ingredient.display_amount ?? null
    );
    const normalizedUnitToken = normalizeUnitToken(ingredient.unit);
    const si = toSi(parsedAmount, normalizedUnitToken);

    const dynamicIngredient = ingredient as Record<string, unknown>;

    return {
      position,
      source_name: sourceName,
      source_amount: parsedAmount,
      source_unit: normalizedUnitToken,
      normalized_amount_si: si.normalized_amount_si,
      normalized_unit: si.normalized_unit,
      unit_kind: si.unit_kind,
      normalized_status: si.normalized_status,
      category: toStringOrNull(ingredient.category),
      component: toStringOrNull(dynamicIngredient["component"]),
      preparation: toStringOrNull(ingredient.preparation),
      normalized_key: identity.canonicalKey,
      canonical_name: identity.canonicalName
    };
  });
};

// ── Convert from SI back to display units ─────────────────────────────
// Picks human-friendly units based on magnitude (e.g. ≥1000g → kg).

export const convertFromSi = (
  normalizedAmountSi: number | null,
  unitKind: UnitKind,
  units: UnitPreference
): { amount: number | null; unit: string | null } => {
  if (normalizedAmountSi == null || !Number.isFinite(normalizedAmountSi)) {
    return { amount: null, unit: null };
  }

  if (units === "metric") {
    if (unitKind === "mass") {
      if (normalizedAmountSi >= 1000) {
        return { amount: roundForDisplay(normalizedAmountSi / 1000, 2), unit: "kg" };
      }
      return { amount: roundForDisplay(normalizedAmountSi, 1), unit: "g" };
    }

    if (unitKind === "volume") {
      if (normalizedAmountSi >= 1000) {
        return { amount: roundForDisplay(normalizedAmountSi / 1000, 2), unit: "l" };
      }
      return { amount: roundForDisplay(normalizedAmountSi, 1), unit: "ml" };
    }

    if (unitKind === "count") {
      return { amount: roundForDisplay(normalizedAmountSi, 2), unit: "unit" };
    }

    return { amount: null, unit: null };
  }

  if (units === "imperial") {
    if (unitKind === "mass") {
      if (normalizedAmountSi >= 453.59237) {
        return { amount: roundForDisplay(normalizedAmountSi / 453.59237, 2), unit: "lb" };
      }
      return { amount: roundForDisplay(normalizedAmountSi / 28.349523125, 2), unit: "oz" };
    }

    if (unitKind === "volume") {
      if (normalizedAmountSi >= 240) {
        return { amount: roundForDisplay(normalizedAmountSi / 240, 2), unit: "cup" };
      }
      if (normalizedAmountSi >= 29.5735295625) {
        return { amount: roundForDisplay(normalizedAmountSi / 29.5735295625, 2), unit: "fl oz" };
      }
      if (normalizedAmountSi >= 14.78676478125) {
        return { amount: roundForDisplay(normalizedAmountSi / 14.78676478125, 2), unit: "tbsp" };
      }
      return { amount: roundForDisplay(normalizedAmountSi / 4.92892159375, 2), unit: "tsp" };
    }

    if (unitKind === "count") {
      return { amount: roundForDisplay(normalizedAmountSi, 2), unit: "unit" };
    }

    return { amount: null, unit: null };
  }

  return { amount: null, unit: null };
};

// ── Project canonical rows back to output view ────────────────────────
// Merges DB-stored canonical rows with source ingredients, applying unit
// conversion when the user has a non-source unit preference.

export const projectIngredientsForOutput = (params: {
  sourceIngredients: RecipePayload["ingredients"];
  canonicalRows: Array<{
    position: number;
    ingredient_id: string | null;
    source_name: string;
    source_amount: number | null;
    source_unit: string | null;
    normalized_amount_si: number | null;
    normalized_unit: string | null;
    unit_kind: UnitKind;
    normalized_status: NormalizedStatus;
    category: string | null;
    component: string | null;
  }>;
  units: UnitPreference;
}): CanonicalIngredientView[] => {
  const rowByPosition = new Map(params.canonicalRows.map((row) => [row.position, row]));

  return params.sourceIngredients.map((ingredient, index) => {
    const row = rowByPosition.get(index);

    const baseAmount = parseAmountValue(ingredient.amount);
    const baseUnit = normalizeUnitToken(ingredient.unit);

    let amount = baseAmount;
    let unit = baseUnit;

    if (params.units !== "source" && row && row.normalized_status === "normalized") {
      const converted = convertFromSi(row.normalized_amount_si, row.unit_kind, params.units);
      if (converted.amount != null && converted.unit) {
        amount = converted.amount;
        unit = converted.unit;
      }
    }

    return {
      ...ingredient,
      amount: amount ?? ingredient.amount,
      unit: unit ?? ingredient.unit,
      category: row?.category ?? ingredient.category,
      ingredient_id: row?.ingredient_id ?? null,
      normalized_status: row?.normalized_status,
      component: row?.component ?? null
    };
  });
};

// ── Group ingredients by category or component ────────────────────────

export const buildIngredientGroups = (params: {
  ingredients: CanonicalIngredientView[];
  groupBy: GroupByPreference;
}): IngredientGroup[] | undefined => {
  if (params.groupBy === "flat") {
    return undefined;
  }

  const groups = new Map<string, CanonicalIngredientView[]>();

  for (const ingredient of params.ingredients) {
    const rawGroup = params.groupBy === "category" ? ingredient.category : ingredient.component;
    const key = (rawGroup && rawGroup.trim().length > 0 ? rawGroup.trim() : params.groupBy === "category" ? "Other" : "Main").toLowerCase();
    const label = key
      .split(" ")
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(" ");

    const existing = groups.get(label) ?? [];
    existing.push(ingredient);
    groups.set(label, existing);
  }

  return Array.from(groups.entries()).map(([label, ingredients]) => ({
    key: label.toLowerCase(),
    label,
    ingredients
  }));
};
