import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../errors.ts";
import { executeScope } from "../llm-executor.ts";
import type { JsonValue } from "../types.ts";
import type {
  DemandEntityLinkResult,
  DemandEntityLinkSelection,
  DemandFacetExtraction,
  DemandObservationExtraction,
  DemandOutcomeSummary,
  TokenAccum,
} from "./types.ts";
import { addTokens, logLlmEvent } from "./config.ts";

const clampConfidence = (value: unknown, fallback = 0.5): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, numeric));
};

const toRecord = (value: unknown): Record<string, JsonValue> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, JsonValue>;
};

const asTrimmedString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeDemandFact = (value: unknown, index: number): DemandFacetExtraction | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const facet = asTrimmedString(raw.facet);
  const normalizedValue = asTrimmedString(raw.normalized_value);
  if (!facet || !normalizedValue) {
    return null;
  }

  const polarity = asTrimmedString(raw.polarity);
  return {
    facet,
    normalized_value: normalizedValue,
    raw_value: asTrimmedString(raw.raw_value),
    polarity:
      polarity === "negative" || polarity === "neutral" || polarity === "positive"
        ? polarity
        : "positive",
    confidence: clampConfidence(raw.confidence, 0.5),
    rank: Number.isFinite(Number(raw.rank)) ? Math.max(1, Math.trunc(Number(raw.rank))) : index + 1,
    metadata: toRecord(raw.metadata),
  };
};

const normalizeObservationExtraction = (
  result: DemandObservationExtraction,
): DemandObservationExtraction => {
  const facts = Array.isArray(result.facts)
    ? result.facts
      .map((item, index) => normalizeDemandFact(item, index))
      .filter((item): item is DemandFacetExtraction => item !== null)
      .slice(0, 24)
    : [];

  return {
    summary: asTrimmedString(result.summary),
    why_now: asTrimmedString(result.why_now),
    privacy_tier: result.privacy_tier === "redacted_snippet" ? "redacted_snippet" : "derived",
    admin_snippet_redacted: asTrimmedString(result.admin_snippet_redacted),
    facts,
  };
};

const runDemandScope = async <T>(params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  scope:
    | "demand_extract_observation"
    | "demand_extract_iteration_delta"
    | "demand_link_entities"
    | "demand_summarize_outcome_reason";
  task: string;
  userInput: Record<string, JsonValue>;
}): Promise<{ result: T; accum: TokenAccum }> => {
  const startedAt = Date.now();
  const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };

  try {
    const { result, inputTokens, outputTokens, config } = await executeScope<T>({
      client: params.client,
      scope: params.scope,
      userInput: {
        task: params.task,
        ...params.userInput,
      },
    });

    addTokens(accum, inputTokens, outputTokens, config);
    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      params.scope,
      Date.now() - startedAt,
      "ok",
      {
        task: params.task,
      },
      accum,
    );

    return { result, accum };
  } catch (error) {
    const errorCode = error instanceof ApiError ? error.code : "unknown_error";
    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      params.scope,
      Date.now() - startedAt,
      "error",
      {
        task: params.task,
        error_code: errorCode,
      },
      accum,
    );
    throw error;
  }
};

export const extractDemandObservation = async (params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  stage: string;
  sourceContext: Record<string, JsonValue>;
}): Promise<DemandObservationExtraction> => {
  const { result } = await runDemandScope<DemandObservationExtraction>({
    client: params.client,
    userId: params.userId,
    requestId: params.requestId,
    scope: "demand_extract_observation",
    task: "extract_demand_observation",
    userInput: {
      stage: params.stage,
      source_context: params.sourceContext,
    },
  });

  return normalizeObservationExtraction(result);
};

export const extractDemandIterationDelta = async (params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  stage: string;
  sourceContext: Record<string, JsonValue>;
}): Promise<DemandObservationExtraction> => {
  const { result } = await runDemandScope<DemandObservationExtraction>({
    client: params.client,
    userId: params.userId,
    requestId: params.requestId,
    scope: "demand_extract_iteration_delta",
    task: "extract_demand_iteration_delta",
    userInput: {
      stage: params.stage,
      source_context: params.sourceContext,
    },
  });

  return normalizeObservationExtraction(result);
};

export const linkDemandEntities = async (params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  facts: DemandFacetExtraction[];
  candidateEntities: Array<{
    fact_index: number;
    entity_id: string;
    entity_type: string;
    label: string;
    entity_key: string | null;
  }>;
}): Promise<DemandEntityLinkSelection[]> => {
  if (params.facts.length === 0 || params.candidateEntities.length === 0) {
    return [];
  }

  const allowedEntityIds = new Set(
    params.candidateEntities.map((candidate) => candidate.entity_id),
  );
  const { result } = await runDemandScope<DemandEntityLinkResult>({
    client: params.client,
    userId: params.userId,
    requestId: params.requestId,
    scope: "demand_link_entities",
    task: "link_demand_entities",
    userInput: {
      facts: params.facts as unknown as JsonValue,
      candidate_entities: params.candidateEntities as unknown as JsonValue,
    },
  });

  const selections: Array<DemandEntityLinkSelection | null> = (Array.isArray(result.items) ? result.items : [])
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }
      const raw = item as Record<string, unknown>;
      const factIndex = Number(raw.fact_index);
      const entityId = asTrimmedString(raw.entity_id);
      if (!Number.isFinite(factIndex) || factIndex < 0 || factIndex >= params.facts.length) {
        return null;
      }
      if (!entityId || !allowedEntityIds.has(entityId)) {
        return null;
      }
      return {
        fact_index: Math.trunc(factIndex),
        entity_id: entityId,
        confidence: clampConfidence(raw.confidence, 0.5),
      } satisfies DemandEntityLinkSelection;
    });

  return selections.filter((item): item is DemandEntityLinkSelection => item !== null);
};

export const summarizeDemandOutcomeReason = async (params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  outcomeType: string;
  sourceContext: Record<string, JsonValue>;
}): Promise<DemandOutcomeSummary> => {
  const { result } = await runDemandScope<DemandOutcomeSummary>({
    client: params.client,
    userId: params.userId,
    requestId: params.requestId,
    scope: "demand_summarize_outcome_reason",
    task: "summarize_demand_outcome_reason",
    userInput: {
      outcome_type: params.outcomeType,
      source_context: params.sourceContext,
    },
  });

  return {
    summary: asTrimmedString(result.summary),
    admin_snippet_redacted: asTrimmedString(result.admin_snippet_redacted),
  };
};
