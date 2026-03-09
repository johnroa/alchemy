import type { RecipePayload } from "../../_shared/types.ts";
import {
  type GroupByPreference,
  type InstructionPart,
  type InstructionVerbosity,
  type TemperatureUnitPreference,
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

const DEFAULT_VERBOSITY: InstructionVerbosity = "balanced";
const DEFAULT_TEMPERATURE_UNIT: TemperatureUnitPreference = "fahrenheit";

const formatMeasurement = (amount: number, unit: string | null): string => {
  if (!unit) {
    return stringifyAmount(amount);
  }
  return `${stringifyAmount(amount)} ${unit}`;
};

const convertTemperature = (
  value: number,
  unit: TemperatureUnitPreference,
  targetUnit: TemperatureUnitPreference,
): number => {
  if (unit === targetUnit) {
    return value;
  }

  if (targetUnit === "celsius") {
    return Math.round((value - 32) * (5 / 9));
  }

  return Math.round((value * (9 / 5)) + 32);
};

const formatTemperature = (
  value: number,
  unit: TemperatureUnitPreference,
): string => `${Math.round(value)}°${unit === "celsius" ? "C" : "F"}`;

const renderInstructionPart = (
  part: InstructionPart,
  temperatureUnit: TemperatureUnitPreference,
): string => {
  if (part.type === "temperature") {
    return formatTemperature(
      convertTemperature(part.value, part.unit, temperatureUnit),
      temperatureUnit,
    );
  }

  return part.value;
};

const buildFallbackInstructionParts = (
  instruction: string,
): InstructionPart[] => [{ type: "text", value: instruction }];

const resolveInstructionParts = (
  step: RecipePayload["steps"][number],
  verbosity: InstructionVerbosity,
): InstructionPart[] => {
  const views = step.instruction_views ?? {};
  const selected = views[verbosity] ??
    views.balanced ??
    views.detailed ??
    views.concise;
  return Array.isArray(selected) && selected.length > 0
    ? selected
    : buildFallbackInstructionParts(step.instruction);
};

export const renderInstructionText = (params: {
  step: RecipePayload["steps"][number];
  verbosity: InstructionVerbosity;
  temperatureUnit: TemperatureUnitPreference;
}): string => {
  const parts = resolveInstructionParts(params.step, params.verbosity);
  const rendered = parts.map((part) =>
    renderInstructionPart(part, params.temperatureUnit)
  ).join("");
  return rendered.trim().length > 0 ? rendered : params.step.instruction;
};

export const projectInstructionViews = (params: {
  steps: RecipePayload["steps"];
  verbosity: InstructionVerbosity;
  temperatureUnit: TemperatureUnitPreference;
}): RecipePayload["steps"] => {
  return params.steps.map((step) => ({
    ...step,
    instruction: renderInstructionText({
      step,
      verbosity: params.verbosity,
      temperatureUnit: params.temperatureUnit,
    }),
  }));
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
          return `${measurement.ingredient}: ${
            formatMeasurement(parsedAmount, normalizedUnit)
          }`;
        }

        const si = toSi(parsedAmount, normalizedUnit);
        if (si.normalized_status !== "normalized") {
          if (parsedAmount == null) {
            return null;
          }
          return `${measurement.ingredient}: ${
            formatMeasurement(parsedAmount, normalizedUnit)
          }`;
        }

        const converted = convertFromSi(
          si.normalized_amount_si,
          si.unit_kind,
          params.units,
        );
        if (converted.amount == null) {
          return `${measurement.ingredient}: ${
            formatMeasurement(parsedAmount ?? 0, normalizedUnit)
          }`;
        }

        return `${measurement.ingredient}: ${
          formatMeasurement(converted.amount, converted.unit)
        }`;
      })
      .filter((value): value is string => Boolean(value));

    if (renderedInline.length === 0) {
      return step;
    }

    const inlineText = renderedInline.join("; ");
    const alreadyInline = step.instruction.includes(inlineText);

    return {
      ...step,
      instruction: alreadyInline
        ? step.instruction
        : `${step.instruction} (${inlineText})`,
    };
  });
};

export const projectStepsForOutput = (params: {
  steps: RecipePayload["steps"];
  units: UnitPreference;
  includeInlineMeasurements: boolean;
  verbosity: InstructionVerbosity;
  temperatureUnit: TemperatureUnitPreference;
}): RecipePayload["steps"] => {
  const renderedSteps = projectInstructionViews({
    steps: params.steps,
    verbosity: params.verbosity,
    temperatureUnit: params.temperatureUnit,
  });

  return projectInlineMeasurements({
    steps: renderedSteps,
    units: params.units,
    includeInlineMeasurements: params.includeInlineMeasurements,
  });
};

export const resolvePresentationOptions = (params: {
  query: URLSearchParams;
  presentationPreferences: Record<string, unknown>;
}): {
  units: UnitPreference;
  groupBy: GroupByPreference;
  inlineMeasurements: boolean;
  verbosity: InstructionVerbosity;
  temperatureUnit: TemperatureUnitPreference;
} => {
  const queryUnits = params.query.get("units");
  const queryGroupBy = params.query.get("group_by");
  const queryInlineMeasurements = params.query.get("inline_measurements");
  const queryVerbosity = params.query.get("verbosity");
  const queryTemperatureUnit = params.query.get("temperature_unit");

  const prefUnits =
    typeof params.presentationPreferences["recipe_units"] === "string"
      ? params.presentationPreferences["recipe_units"]
      : null;
  const prefGroupBy =
    typeof params.presentationPreferences["recipe_group_by"] === "string"
      ? params.presentationPreferences["recipe_group_by"]
      : null;
  const prefInline = toBoolean(
    params.presentationPreferences["recipe_inline_measurements"],
  );
  const prefVerbosity =
    typeof params.presentationPreferences["recipe_instruction_verbosity"] ===
        "string"
      ? params.presentationPreferences["recipe_instruction_verbosity"]
      : null;
  const prefTemperatureUnit =
    typeof params.presentationPreferences["recipe_temperature_unit"] ===
        "string"
      ? params.presentationPreferences["recipe_temperature_unit"]
      : null;

  const unitsCandidate = queryUnits ?? prefUnits;
  const units: UnitPreference =
    unitsCandidate === "metric" || unitsCandidate === "imperial" ||
        unitsCandidate === "source"
      ? unitsCandidate
      : "source";

  const groupCandidate = queryGroupBy ?? prefGroupBy;
  const groupBy: GroupByPreference =
    groupCandidate === "category" || groupCandidate === "component" ||
        groupCandidate === "flat"
      ? groupCandidate
      : "component";

  const inlineCandidate = toBoolean(queryInlineMeasurements) ?? prefInline;
  const verbosityCandidate = queryVerbosity ?? prefVerbosity;
  const verbosity: InstructionVerbosity =
    verbosityCandidate === "concise" || verbosityCandidate === "balanced" ||
        verbosityCandidate === "detailed"
      ? verbosityCandidate
      : DEFAULT_VERBOSITY;
  const temperatureCandidate = queryTemperatureUnit ?? prefTemperatureUnit;
  const temperatureUnit: TemperatureUnitPreference =
    temperatureCandidate === "celsius" || temperatureCandidate === "fahrenheit"
      ? temperatureCandidate
      : DEFAULT_TEMPERATURE_UNIT;

  return {
    units,
    groupBy,
    inlineMeasurements: inlineCandidate ?? false,
    verbosity,
    temperatureUnit,
  };
};
