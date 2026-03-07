import type { RecipePayload } from "../../_shared/types.ts";

// ── Type aliases ──────────────────────────────────────────────────────

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

// ── Fraction glyph → decimal lookup ───────────────────────────────────

export const FRACTION_GLYPHS: Record<string, number> = {
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

// ── SI conversion factors ─────────────────────────────────────────────
// Every recognized mass unit → grams, every recognized volume unit → milliliters.

export const MASS_FACTORS_TO_G: Record<string, number> = {
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

export const VOLUME_FACTORS_TO_ML: Record<string, number> = {
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

export const COUNT_UNITS = new Set([
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

// ── Unit alias normalization map ──────────────────────────────────────
// Maps every recognized spelling/plural to its canonical short form.

export const UNIT_ALIAS: Record<string, string> = {
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

// ── Shared utility helpers ────────────────────────────────────────────

export const toStringOrNull = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const roundForDisplay = (value: number, digits = 2): number => {
  const power = 10 ** digits;
  return Math.round(value * power) / power;
};

export const stringifyAmount = (value: number): string => {
  const fixed = roundForDisplay(value, 2).toFixed(2);
  return fixed.replace(/\.00$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
};

export const toBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return undefined;
};
