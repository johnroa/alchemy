import type { RecipePayload } from "../_shared/types.ts";

export type UnitPreference = "source" | "metric" | "imperial";
export type GroupByPreference = "flat" | "category" | "component";
export type NormalizedStatus = "normalized" | "needs_retry";
export type UnitKind = "mass" | "volume" | "count" | "unknown";

export type CanonicalIngredientRecord = {
  position: number;
  source_name: string;
  source_amount: number | null;
  source_unit: string | null;
  normalized_amount_si: number | null;
  normalized_unit: string | null;
  unit_kind: UnitKind;
  normalized_status: NormalizedStatus;
  category: string | null;
  component: string | null;
  preparation: string | null;
  normalized_key: string;
  canonical_name: string;
};

export type CanonicalIngredientView = RecipePayload["ingredients"][number] & {
  ingredient_id?: string | null;
  normalized_status?: NormalizedStatus;
  component?: string | null;
};

export type IngredientGroup = {
  key: string;
  label: string;
  ingredients: CanonicalIngredientView[];
};

const FRACTION_GLYPHS: Record<string, number> = {
  "¼": 0.25,
  "½": 0.5,
  "¾": 0.75,
  "⅐": 1 / 7,
  "⅑": 1 / 9,
  "⅒": 0.1,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅕": 0.2,
  "⅖": 0.4,
  "⅗": 0.6,
  "⅘": 0.8,
  "⅙": 1 / 6,
  "⅚": 5 / 6,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875
};

const MASS_FACTORS_TO_G: Record<string, number> = {
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  kilogram: 1000,
  kilograms: 1000,
  mg: 0.001,
  milligram: 0.001,
  milligrams: 0.001,
  oz: 28.349523125,
  ounce: 28.349523125,
  ounces: 28.349523125,
  lb: 453.59237,
  lbs: 453.59237,
  pound: 453.59237,
  pounds: 453.59237
};

const VOLUME_FACTORS_TO_ML: Record<string, number> = {
  ml: 1,
  milliliter: 1,
  milliliters: 1,
  l: 1000,
  liter: 1000,
  liters: 1000,
  tsp: 4.92892159375,
  teaspoon: 4.92892159375,
  teaspoons: 4.92892159375,
  tbsp: 14.78676478125,
  tablespoon: 14.78676478125,
  tablespoons: 14.78676478125,
  cup: 240,
  cups: 240,
  "fl oz": 29.5735295625,
  floz: 29.5735295625,
  pint: 473.176473,
  pints: 473.176473,
  quart: 946.352946,
  quarts: 946.352946,
  gallon: 3785.411784,
  gallons: 3785.411784
};

const COUNT_UNITS = new Set([
  "unit",
  "units",
  "piece",
  "pieces",
  "pc",
  "pcs",
  "egg",
  "eggs",
  "clove",
  "cloves",
  "slice",
  "slices",
  "can",
  "cans",
  "sprig",
  "sprigs",
  "bunch",
  "bunches",
  "leaf",
  "leaves"
]);

const UNIT_ALIAS: Record<string, string> = {
  grams: "g",
  gram: "g",
  g: "g",
  kilograms: "kg",
  kilogram: "kg",
  kg: "kg",
  milligrams: "mg",
  milligram: "mg",
  mg: "mg",
  ounces: "oz",
  ounce: "oz",
  oz: "oz",
  pounds: "lb",
  pound: "lb",
  lbs: "lb",
  lb: "lb",
  milliliters: "ml",
  milliliter: "ml",
  ml: "ml",
  liters: "l",
  liter: "l",
  l: "l",
  teaspoon: "tsp",
  teaspoons: "tsp",
  tsp: "tsp",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  tbsp: "tbsp",
  cups: "cup",
  cup: "cup",
  "fluid ounce": "fl oz",
  "fluid ounces": "fl oz",
  "fl oz": "fl oz",
  floz: "fl oz",
  pints: "pint",
  pint: "pint",
  quarts: "quart",
  quart: "quart",
  gallons: "gallon",
  gallon: "gallon",
  pieces: "piece",
  piece: "piece",
  units: "unit",
  unit: "unit"
};

const toStringOrNull = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const roundForDisplay = (value: number, digits = 2): number => {
  const power = 10 ** digits;
  return Math.round(value * power) / power;
};

const stringifyAmount = (value: number): string => {
  const fixed = roundForDisplay(value, 2).toFixed(2);
  return fixed.replace(/\.00$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
};

export const normalizeIngredientKey = (input: string): string => {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const toCanonicalName = (normalizedKey: string, fallback: string): string => {
  if (normalizedKey.length === 0) {
    return fallback.trim();
  }

  return normalizedKey
    .split(" ")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
};

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

export const normalizeUnitToken = (value: unknown): string | null => {
  const raw = toStringOrNull(value);
  if (!raw) {
    return null;
  }

  const cleaned = raw.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  return UNIT_ALIAS[cleaned] ?? cleaned;
};

const toSi = (amount: number | null, unitToken: string | null): {
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

export const canonicalizeIngredients = (ingredients: RecipePayload["ingredients"]): CanonicalIngredientRecord[] => {
  return ingredients.map((ingredient, position) => {
    const sourceName = ingredient.name.trim();
    const normalizedKey = normalizeIngredientKey(sourceName);
    const canonicalName = toCanonicalName(normalizedKey, sourceName);

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
      normalized_key: normalizedKey,
      canonical_name: canonicalName
    };
  });
};

const convertFromSi = (
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

const formatMeasurement = (amount: number, unit: string | null): string => {
  if (!unit) {
    return stringifyAmount(amount);
  }
  return `${stringifyAmount(amount)} ${unit}`;
};

export const projectInlineMeasurements = (params: {
  steps: RecipePayload["steps"];
  units: UnitPreference;
  includeInlineMeasurements: boolean;
}): RecipePayload["steps"] => {
  if (!params.includeInlineMeasurements) {
    return params.steps;
  }

  return params.steps.map((step) => {
    const inline = step.inline_measurements ?? [];
    if (inline.length === 0) {
      return step;
    }

    const renderedInline = inline
      .map((measurement) => {
        const parsedAmount = parseAmountValue(measurement.amount);
        const normalizedUnit = normalizeUnitToken(measurement.unit);

        if (params.units === "source") {
          if (parsedAmount == null) {
            return null;
          }
          return `${measurement.ingredient}: ${formatMeasurement(parsedAmount, normalizedUnit)}`;
        }

        const si = toSi(parsedAmount, normalizedUnit);
        if (si.normalized_status !== "normalized") {
          if (parsedAmount == null) {
            return null;
          }
          return `${measurement.ingredient}: ${formatMeasurement(parsedAmount, normalizedUnit)}`;
        }

        const converted = convertFromSi(si.normalized_amount_si, si.unit_kind, params.units);
        if (converted.amount == null) {
          return `${measurement.ingredient}: ${formatMeasurement(parsedAmount ?? 0, normalizedUnit)}`;
        }

        return `${measurement.ingredient}: ${formatMeasurement(converted.amount, converted.unit)}`;
      })
      .filter((value): value is string => Boolean(value));

    if (renderedInline.length === 0) {
      return step;
    }

    const inlineText = renderedInline.join("; ");
    const alreadyInline = step.instruction.includes(inlineText);

    return {
      ...step,
      instruction: alreadyInline ? step.instruction : `${step.instruction} (${inlineText})`
    };
  });
};

const toBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return undefined;
};

export const resolvePresentationOptions = (params: {
  query: URLSearchParams;
  presentationPreferences: Record<string, unknown>;
}): {
  units: UnitPreference;
  groupBy: GroupByPreference;
  inlineMeasurements: boolean;
} => {
  const queryUnits = params.query.get("units");
  const queryGroupBy = params.query.get("group_by");
  const queryInlineMeasurements = params.query.get("inline_measurements");

  const prefUnits = typeof params.presentationPreferences["recipe_units"] === "string"
    ? params.presentationPreferences["recipe_units"]
    : null;
  const prefGroupBy = typeof params.presentationPreferences["recipe_group_by"] === "string"
    ? params.presentationPreferences["recipe_group_by"]
    : null;
  const prefInline = toBoolean(params.presentationPreferences["recipe_inline_measurements"]);

  const unitsCandidate = queryUnits ?? prefUnits;
  const units: UnitPreference =
    unitsCandidate === "metric" || unitsCandidate === "imperial" || unitsCandidate === "source"
      ? unitsCandidate
      : "source";

  const groupCandidate = queryGroupBy ?? prefGroupBy;
  const groupBy: GroupByPreference =
    groupCandidate === "category" || groupCandidate === "component" || groupCandidate === "flat"
      ? groupCandidate
      : "flat";

  const inlineCandidate = toBoolean(queryInlineMeasurements) ?? prefInline;

  return {
    units,
    groupBy,
    inlineMeasurements: inlineCandidate ?? false
  };
};
