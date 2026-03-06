import { normalizeDelimitedToken } from "../../../packages/shared/src/text-normalization.ts";
import type { JsonValue } from "../_shared/types.ts";

export type SemanticDietIncompatibilityRule = {
  source_term_type: string;
  source_term_key: string;
  blocked_diet_tag: string;
  reason?: string | null;
  is_active?: boolean;
};

type Signal = {
  term_type: string;
  term_key: string;
};

const normalizeToken = (value: string): string =>
  normalizeDelimitedToken(value);

const normalizeDietTag = (value: string): string =>
  normalizeToken(value).replace(/_/g, "");

const listifyText = (value: JsonValue | undefined): string[] => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

const extractSignals = (params: {
  metadata: Record<string, JsonValue>;
  ontologyTerms?: Array<{ term_type?: string; term_key?: string; label?: string }>;
}): Signal[] => {
  const signals: Signal[] = [];

  const addSignal = (termType: string, value: string): void => {
    const typeKey = normalizeToken(termType);
    const termKey = normalizeToken(value);
    if (!typeKey || !termKey) return;
    signals.push({ term_type: typeKey, term_key: termKey });
  };

  for (const value of listifyText(params.metadata.food_group)) {
    addSignal("food_group", value);
  }
  for (const value of listifyText(params.metadata.functional_classes)) {
    addSignal("functional_class", value);
  }
  for (const value of listifyText(params.metadata.ingredient_family)) {
    addSignal("ingredient_family", value);
  }
  for (const value of listifyText(params.metadata.processing_level)) {
    addSignal("processing_level", value);
  }

  for (const term of params.ontologyTerms ?? []) {
    const rawType = typeof term.term_type === "string"
      ? term.term_type
      : "";
    const rawKey = typeof term.term_key === "string" && term.term_key.trim().length > 0
      ? term.term_key
      : typeof term.label === "string"
      ? term.label
      : "";
    if (!rawType || !rawKey) continue;
    addSignal(rawType, rawKey);
  }

  return Array.from(
    new Map(
      signals.map((signal) => [
        `${signal.term_type}:${signal.term_key}`,
        signal,
      ]),
    ).values(),
  );
};

export const applySemanticDietIncompatibilityRules = (params: {
  metadata: Record<string, JsonValue>;
  rules: SemanticDietIncompatibilityRule[];
  ontologyTerms?: Array<{ term_type?: string; term_key?: string; label?: string }>;
}): {
  metadata: Record<string, JsonValue>;
  removedDietTags: string[];
  removalsByReason: Array<{ diet_tag: string; reason: string | null }>;
} => {
  const dietTags = listifyText(params.metadata.diet_compatibility);
  if (dietTags.length === 0 || params.rules.length === 0) {
    return {
      metadata: params.metadata,
      removedDietTags: [],
      removalsByReason: [],
    };
  }

  const activeRules = params.rules.filter((rule) => rule.is_active !== false)
    .map((rule) => ({
      signalKey:
        `${normalizeToken(rule.source_term_type)}:${normalizeToken(rule.source_term_key)}`,
      blockedDiet: normalizeDietTag(rule.blocked_diet_tag),
      reason: rule.reason ?? null,
    }))
    .filter((rule) =>
      rule.signalKey.length > 1 && rule.blockedDiet.length > 0
    );

  if (activeRules.length === 0) {
    return {
      metadata: params.metadata,
      removedDietTags: [],
      removalsByReason: [],
    };
  }

  const blockedBySignal = new Map<string, Array<{ blockedDiet: string; reason: string | null }>>();
  for (const rule of activeRules) {
    const current = blockedBySignal.get(rule.signalKey) ?? [];
    current.push({ blockedDiet: rule.blockedDiet, reason: rule.reason });
    blockedBySignal.set(rule.signalKey, current);
  }

  const signals = extractSignals({
    metadata: params.metadata,
    ontologyTerms: params.ontologyTerms,
  });
  if (signals.length === 0) {
    return {
      metadata: params.metadata,
      removedDietTags: [],
      removalsByReason: [],
    };
  }

  const blockedDietToReason = new Map<string, string | null>();
  for (const signal of signals) {
    const rules = blockedBySignal.get(`${signal.term_type}:${signal.term_key}`) ?? [];
    for (const rule of rules) {
      if (!blockedDietToReason.has(rule.blockedDiet)) {
        blockedDietToReason.set(rule.blockedDiet, rule.reason);
      }
    }
  }

  if (blockedDietToReason.size === 0) {
    return {
      metadata: params.metadata,
      removedDietTags: [],
      removalsByReason: [],
    };
  }

  const seen = new Set<string>();
  const kept: string[] = [];
  const removedDietTags: string[] = [];
  const removalsByReason: Array<{ diet_tag: string; reason: string | null }> = [];

  for (const tag of dietTags) {
    const normalized = normalizeDietTag(tag);
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    if (blockedDietToReason.has(normalized)) {
      removedDietTags.push(tag);
      removalsByReason.push({
        diet_tag: tag,
        reason: blockedDietToReason.get(normalized) ?? null,
      });
      continue;
    }

    kept.push(tag);
  }

  if (removedDietTags.length === 0) {
    return {
      metadata: params.metadata,
      removedDietTags: [],
      removalsByReason: [],
    };
  }

  return {
    metadata: {
      ...params.metadata,
      diet_compatibility: kept,
    },
    removedDietTags,
    removalsByReason,
  };
};
