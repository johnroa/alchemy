import { normalizeDelimitedToken, normalizeWhitespaceToken } from "../../../../../packages/shared/src/text-normalization.ts";
import type { JsonValue } from "../../../_shared/types.ts";

export const DEMAND_STAGES = [
  "intent",
  "iteration",
  "import",
  "selection",
  "commit",
  "consumption",
  "feedback",
] as const;

export type DemandStage = (typeof DEMAND_STAGES)[number];

export const DEMAND_FACETS = [
  "goal",
  "dish",
  "cuisine",
  "ingredient_want",
  "ingredient_avoid",
  "pantry_item",
  "diet_constraint",
  "health_goal",
  "time_budget",
  "budget_tier",
  "occasion",
  "appliance",
  "household_context",
  "novelty_preference",
  "requested_substitution",
] as const;

export type DemandFacet = (typeof DEMAND_FACETS)[number];

export const DEMAND_OUTCOME_TYPES = [
  "candidate_selected",
  "candidate_rejected",
  "recipe_committed",
  "recipe_saved",
  "variant_refreshed",
  "substitution_accepted",
  "substitution_reverted",
  "cook_inferred",
  "repeat_cook",
] as const;

export type DemandOutcomeType = (typeof DEMAND_OUTCOME_TYPES)[number];

export type DemandFactRecord = {
  facet: DemandFacet;
  normalizedValue: string;
  rawValue: string | null;
  polarity: "positive" | "negative" | "neutral";
  confidence: number;
  rank: number;
  entityId: string | null;
  metadata: Record<string, JsonValue>;
};

export type DemandObservationRecord = {
  sourceKind: string;
  sourceId: string;
  userId: string | null;
  chatSessionId: string | null;
  recipeId: string | null;
  variantId: string | null;
  observedAt: string;
  stage: DemandStage;
  extractorScope: string;
  extractorVersion: number;
  confidence: number;
  privacyTier: "derived" | "redacted_snippet";
  adminSnippetRedacted: string | null;
  rawTraceRef: string | null;
  summary: Record<string, JsonValue>;
  sampledForReview: boolean;
  sampledAt: string | null;
};

export type DemandOutcomeRecord = {
  observationId: string;
  originObservationId: string | null;
  outcomeType: DemandOutcomeType;
  sourceKind: string;
  sourceId: string;
  recipeId: string | null;
  variantId: string | null;
  candidateId: string | null;
  occurredAt: string;
  payload: Record<string, JsonValue>;
};

export const isDemandStage = (value: string): value is DemandStage =>
  (DEMAND_STAGES as readonly string[]).includes(value);

export const isDemandFacet = (value: string): value is DemandFacet =>
  (DEMAND_FACETS as readonly string[]).includes(value);

export const isDemandOutcomeType = (value: string): value is DemandOutcomeType =>
  (DEMAND_OUTCOME_TYPES as readonly string[]).includes(value);

export const clampConfidence = (value: unknown, fallback = 0.5): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, numeric));
};

export const toRecord = (value: unknown): Record<string, JsonValue> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, JsonValue>;
};

export const asTrimmedString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const normalizeDemandValue = (value: string): string => {
  const normalized = normalizeDelimitedToken(value, ":-_");
  return normalized.length > 0 ? normalized : normalizeWhitespaceToken(value);
};

export const normalizeDemandSnippet = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const redacted = value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\bhttps?:\/\/\S+\b/gi, "[redacted-url]")
    .replace(/\b\d{3}[-.\s]?\d{2,4}[-.\s]?\d{4}\b/g, "[redacted-number]")
    .replace(/\s+/g, " ")
    .trim();

  if (redacted.length === 0) {
    return null;
  }

  return redacted.slice(0, 220);
};

export const shouldSampleDemandObservation = (
  sourceKey: string,
  confidence: number,
): boolean => {
  if (confidence < 0.72) {
    return true;
  }

  let hash = 0;
  for (let index = 0; index < sourceKey.length; index += 1) {
    hash = ((hash << 5) - hash + sourceKey.charCodeAt(index)) | 0;
  }

  return Math.abs(hash) % 20 === 0;
};

export const toIsoString = (value: unknown, fallback?: string): string => {
  if (typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value))) {
    return value;
  }
  return fallback ?? new Date().toISOString();
};
