type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type RecipeSemanticDescriptor = {
  id: string;
  key: string;
  label: string;
  axis: string;
  confidence: number;
  evidence?: string;
};

export type RecipeSemanticProfile = {
  descriptors: RecipeSemanticDescriptor[];
};

export type SuggestedChip = {
  id: string;
  label: string;
  matched_count: number;
};

const asRecord = (
  value: unknown,
): Record<string, Json> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, Json>;
};

const COMBINING_MARKS_PATTERN = /[\u0300-\u036f]/g;

const escapeForCharacterClass = (value: string): string =>
  value.replace(/[\\\-\]^]/g, "\\$&");

const escapeForRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeFoldedText = (
  value: string,
  options?: {
    separator?: string;
    preserveCharacters?: string;
  },
): string => {
  const separator = options?.separator ?? " ";
  const preserveCharacters = options?.preserveCharacters ?? "";
  const lowered = value.normalize("NFKD").replace(COMBINING_MARKS_PATTERN, "")
    .trim()
    .toLocaleLowerCase();
  if (!lowered) {
    return "";
  }

  const allowedCharacters = `a-z0-9\\s${
    escapeForCharacterClass(preserveCharacters)
  }`;
  const sanitized = lowered.replace(
    new RegExp(`[^${allowedCharacters}]`, "g"),
    " ",
  );
  const collapsedWhitespace = sanitized.replace(/\s+/g, separator);

  if (!separator) {
    return collapsedWhitespace.trim();
  }

  const escapedSeparator = escapeForRegExp(separator);
  return collapsedWhitespace
    .replace(new RegExp(`${escapedSeparator}+`, "g"), separator)
    .replace(
      new RegExp(`^${escapedSeparator}+|${escapedSeparator}+$`, "g"),
      "",
    );
};

const normalizeDelimitedToken = (
  value: string,
  preserveCharacters = ":_-",
): string =>
  normalizeFoldedText(value, {
    separator: "_",
    preserveCharacters,
  });

const SEMANTIC_AXIS_ALIASES = new Map<string, string>([
  ["diet_compatibility", "diet"],
  ["dietary", "diet"],
  ["dietary_flags", "diet"],
  ["health_framing", "health"],
  ["health_flags", "health"],
  ["meal_context", "occasion"],
  ["occasion_tags", "occasion"],
  ["seasonality", "season"],
  ["social", "social_setting"],
  ["social_context", "social_setting"],
  ["social_setting", "social_setting"],
  ["serving_style", "serving_style"],
  ["flavor_profile", "flavor"],
  ["time", "time_shape"],
]);

const normalizeLabel = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
};

const clampConfidence = (value: unknown): number | null => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.max(0, Math.min(1, numeric));
};

export const normalizeSemanticAxis = (value: unknown): string | null => {
  const normalized = normalizeLabel(value);
  if (!normalized) {
    return null;
  }
  const token = normalizeFoldedText(normalized, {
    separator: "_",
  });
  const aliased = SEMANTIC_AXIS_ALIASES.get(token) ?? token;
  return aliased.length > 0 ? aliased : null;
};

export const normalizeSemanticKey = (value: unknown): string | null => {
  const normalized = normalizeLabel(value);
  if (!normalized) {
    return null;
  }
  const token = normalizeDelimitedToken(normalized);
  return token.length > 0 ? token : null;
};

export const buildSemanticDescriptorId = (axis: string, key: string): string =>
  `${axis}:${key}`;

export const normalizeSemanticDescriptor = (
  value: unknown,
): RecipeSemanticDescriptor | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const label = normalizeLabel(record["label"]);
  const axis = normalizeSemanticAxis(record["axis"]);
  const key = normalizeSemanticKey(record["key"] ?? label);
  const confidence = clampConfidence(record["confidence"]);

  if (!label || !axis || !key || confidence === null) {
    return null;
  }

  const evidence = normalizeLabel(record["evidence"]);

  return {
    id: buildSemanticDescriptorId(axis, key),
    key,
    label,
    axis,
    confidence,
    ...(evidence ? { evidence } : {}),
  };
};

export const normalizeRecipeSemanticProfile = (
  value: unknown,
): RecipeSemanticProfile | undefined => {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const rawDescriptors = Array.isArray(record["descriptors"])
    ? record["descriptors"]
    : [];
  const descriptorById = new Map<string, RecipeSemanticDescriptor>();

  for (const rawDescriptor of rawDescriptors) {
    const descriptor = normalizeSemanticDescriptor(rawDescriptor);
    if (!descriptor) {
      continue;
    }

    const existing = descriptorById.get(descriptor.id);
    if (!existing || descriptor.confidence > existing.confidence) {
      descriptorById.set(descriptor.id, descriptor);
    }
  }

  if (descriptorById.size === 0) {
    return undefined;
  }

  return {
    descriptors: [...descriptorById.values()].sort((left, right) => {
      if (left.axis !== right.axis) {
        return left.axis.localeCompare(right.axis);
      }
      if (left.label !== right.label) {
        return left.label.localeCompare(right.label);
      }
      return right.confidence - left.confidence;
    }),
  };
};
