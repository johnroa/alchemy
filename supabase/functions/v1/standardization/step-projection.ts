import type { RecipePayload } from "../../_shared/types.ts";
import {
  type GroupByPreference,
  type UnitPreference,
  stringifyAmount,
  toBoolean,
} from "./types.ts";
import {
  convertFromSi,
  normalizeUnitToken,
  parseAmountValue,
  toSi,
} from "./ingredient-projection.ts";

// ── Measurement formatting ────────────────────────────────────────────

const formatMeasurement = (amount: number, unit: string | null): string => {
  if (!unit) {
    return stringifyAmount(amount);
  }
  return `${stringifyAmount(amount)} ${unit}`;
};

// ── Inline measurement projection ────────────────────────────────────
// Appends per-step ingredient measurements (converted to the user's
// preferred unit system) as parenthetical text after each step instruction.

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

// ── Presentation option resolution ────────────────────────────────────
// Merges query-string overrides with stored user presentation preferences.
// Query params take priority over stored prefs; falls back to sensible defaults.

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
      : "component";

  const inlineCandidate = toBoolean(queryInlineMeasurements) ?? prefInline;

  return {
    units,
    groupBy,
    inlineMeasurements: inlineCandidate ?? false
  };
};
