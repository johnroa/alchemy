/**
 * Shared types, constants, and utility functions for the simulation runner.
 *
 * Data flow: The simulation runner uses a step-by-step execution model where
 * each step is an independent HTTP request. Trace events are applied locally
 * to build up a SimResult, which is the primary state object consumed by all
 * sub-components. Utility functions here handle normalization of raw API
 * payloads (candidate snapshots, token usage, timing) and state reduction
 * (applyTraceEvent).
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type ModelOverride = { provider: string; model: string };
export type SimComplexity = "basic" | "medium" | "high";

/**
 * Scopes that can be individually overridden with a different model
 * in the simulation runner's A/B lanes.
 */
export const SIM_SCOPES = [
  "chat_ideation",
  "chat_generation",
  "chat_iteration",
  "ingredient_alias_normalize",
  "ingredient_phrase_split",
  "ingredient_enrich",
  "recipe_metadata_enrich",
  "ingredient_relation_infer",
  "preference_normalize",
  "equipment_filter",
] as const;
export type SimScope = (typeof SIM_SCOPES)[number];

export type LaneOverrides = Partial<Record<SimScope, ModelOverride>>;

export type SimulationRegistryModel = {
  id: string;
  provider: string;
  model: string;
  display_name: string;
  is_available: boolean;
};

export type SimStepStatus = "running" | "ok" | "failed";

export type SimStep = {
  name: string;
  status: SimStepStatus;
  latency_ms: number;
  started_at?: string;
  completed_at?: string;
  result?: Record<string, unknown>;
  error?: string;
};

export type SimChecks = {
  zero_failed_steps: boolean;
  steps_executed: number;
  total_latency_ms: number;
  timestamp: string;
};

type BaseTraceEvent = {
  request_id: string;
  at: string;
};

export type SimTraceEvent =
  | (BaseTraceEvent & { type: "run_started"; scenario: string; variant: "single" | "A" | "B" })
  | (BaseTraceEvent & { type: "step_started"; step: string })
  | (BaseTraceEvent & { type: "step_completed"; step: string; latency_ms: number; result: Record<string, unknown> })
  | (BaseTraceEvent & { type: "step_failed"; step: string; latency_ms: number; error: string })
  | (BaseTraceEvent & { type: "run_completed"; checks: SimChecks })
  | (BaseTraceEvent & { type: "run_failed"; error: string });

export type SimResult = {
  ok: boolean;
  request_id: string;
  checks?: SimChecks;
  error?: string;
  steps: SimStep[];
  trace: SimTraceEvent[];
};

export type CandidateIngredientSnapshot = {
  name: string;
  amount: string;
  unit: string;
  category: string;
  preparation: string;
};

export type CandidateStepSnapshot = {
  index: number;
  instruction: string;
  notes: string;
  timer_seconds: number | null;
};

export type CandidateComponentSnapshot = {
  component_id: string;
  role: string;
  title: string;
  recipe_title: string;
  description: string;
  servings: number | null;
  notes: string;
  ingredient_count: number;
  step_count: number;
  ingredients: CandidateIngredientSnapshot[];
  steps: CandidateStepSnapshot[];
};

export type CandidateSnapshot = {
  candidate_id: string;
  revision: number | null;
  active_component_id: string | null;
  components: CandidateComponentSnapshot[];
};

export type TokenUsageSummary = {
  request_id: string | null;
  llm_call_count: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  scopes: string[];
  scope_stats: Record<string, {
    llm_call_count: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cost_usd: number;
    latency_ms: number;
  }>;
};

export type RecipeSimulationRunnerCardProps = {
  registryModels: SimulationRegistryModel[];
};

// ---------------------------------------------------------------------------
// Factories & formatters
// ---------------------------------------------------------------------------

export const emptyResult = (): SimResult => ({
  ok: false,
  request_id: "",
  steps: [],
  trace: []
});

export const formatTime = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
};

export const formatSeconds = (ms: number): string => {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
};

export const formatSignedSeconds = (ms: number): string => {
  return `${ms > 0 ? "+" : ""}${(ms / 1000).toFixed(1)}s`;
};

// ---------------------------------------------------------------------------
// Type guards & coercions
// ---------------------------------------------------------------------------

export const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

export const asString = (value: unknown): string => {
  return typeof value === "string" ? value : "";
};

export const asNumber = (value: unknown): number | null => {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

// ---------------------------------------------------------------------------
// Candidate snapshot normalization
// ---------------------------------------------------------------------------

/**
 * Normalizes raw API payload into a typed CandidateSnapshot.
 * Tolerates missing/malformed fields by coercing or skipping them,
 * returning null only when the data has zero usable components.
 */
export const normalizeCandidateSnapshot = (value: unknown): CandidateSnapshot | null => {
  if (!isRecord(value) || !Array.isArray(value["components"])) {
    return null;
  }

  const components: CandidateComponentSnapshot[] = [];
  for (const rawComponent of value["components"]) {
    if (!isRecord(rawComponent)) {
      continue;
    }
    const recipe = isRecord(rawComponent["recipe"]) ? rawComponent["recipe"] : {};
    const rawIngredients = Array.isArray(recipe["ingredients"]) ? recipe["ingredients"] : [];
    const rawSteps = Array.isArray(recipe["steps"]) ? recipe["steps"] : [];

    const ingredients: CandidateIngredientSnapshot[] = rawIngredients
      .map((rawIngredient) => {
        if (!isRecord(rawIngredient)) {
          return null;
        }
        const name = asString(rawIngredient["name"]).trim();
        if (!name) {
          return null;
        }
        const amountValue = rawIngredient["amount"];
        const amount =
          typeof amountValue === "number" && Number.isFinite(amountValue)
            ? String(amountValue)
            : asString(amountValue).trim();
        return {
          name,
          amount,
          unit: asString(rawIngredient["unit"]).trim(),
          category: asString(rawIngredient["category"]).trim(),
          preparation: asString(rawIngredient["preparation"]).trim()
        };
      })
      .filter((ingredient): ingredient is CandidateIngredientSnapshot => Boolean(ingredient));

    const steps: CandidateStepSnapshot[] = rawSteps
      .map((rawStep, index) => {
        if (!isRecord(rawStep)) {
          return null;
        }
        const instruction = asString(rawStep["instruction"]).trim();
        if (!instruction) {
          return null;
        }
        const indexValue = asNumber(rawStep["index"]);
        return {
          index: indexValue ?? index + 1,
          instruction,
          notes: asString(rawStep["notes"]).trim(),
          timer_seconds: asNumber(rawStep["timer_seconds"])
        };
      })
      .filter((step): step is CandidateStepSnapshot => Boolean(step));

    const ingredientCount =
      asNumber(recipe["ingredient_count"]) ?? ingredients.length;
    const stepCount = asNumber(recipe["step_count"]) ?? steps.length;

    components.push({
      component_id: asString(rawComponent["component_id"]),
      role: asString(rawComponent["role"]),
      title: asString(rawComponent["title"]),
      recipe_title: asString(recipe["title"]) || asString(rawComponent["title"]),
      description: asString(recipe["description"]),
      servings: asNumber(recipe["servings"]),
      notes: asString(recipe["notes"]),
      ingredient_count: ingredientCount ?? ingredients.length,
      step_count: stepCount ?? steps.length,
      ingredients,
      steps
    });
  }

  if (components.length === 0) {
    return null;
  }

  const revision = asNumber(value["revision"]);
  const activeComponentId = asString(value["active_component_id"]).trim();

  return {
    candidate_id: asString(value["candidate_id"]),
    revision,
    active_component_id: activeComponentId.length > 0 ? activeComponentId : null,
    components
  };
};

// ---------------------------------------------------------------------------
// Step result accessors
// ---------------------------------------------------------------------------

export const getStepResult = (result: SimResult | null, stepName: string): Record<string, unknown> | null => {
  if (!result) {
    return null;
  }
  const step = (result.steps ?? []).find((entry) => entry.name === stepName);
  if (!step || !isRecord(step.result)) {
    return null;
  }
  return step.result;
};

export const getCandidateFromStep = (
  result: SimResult | null,
  stepName: string,
  key = "candidate_snapshot"
): CandidateSnapshot | null => {
  const payload = getStepResult(result, stepName);
  if (!payload) {
    return null;
  }
  return normalizeCandidateSnapshot(payload[key]);
};

export const getPromptFromStep = (result: SimResult | null, stepName: string, key: string): string | null => {
  const payload = getStepResult(result, stepName);
  if (!payload) {
    return null;
  }
  const value = payload[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

// ---------------------------------------------------------------------------
// Token usage normalization
// ---------------------------------------------------------------------------

export const normalizeTokenUsage = (value: unknown): TokenUsageSummary | null => {
  if (!isRecord(value)) {
    return null;
  }

  const requestIdRaw = value["request_id"];
  const requestId =
    typeof requestIdRaw === "string" && requestIdRaw.trim().length > 0 ? requestIdRaw.trim() : null;
  const llmCallCount = asNumber(value["llm_call_count"]) ?? 0;
  const inputTokens = asNumber(value["input_tokens"]) ?? 0;
  const outputTokens = asNumber(value["output_tokens"]) ?? 0;
  const totalTokens = asNumber(value["total_tokens"]) ?? inputTokens + outputTokens;
  const costUsd = asNumber(value["cost_usd"]) ?? 0;
  const scopes = Array.isArray(value["scopes"])
    ? value["scopes"]
        .map((scope) => asString(scope).trim())
        .filter((scope) => scope.length > 0)
    : [];
  const scopeStatsRaw = isRecord(value["scope_stats"]) ? value["scope_stats"] : {};
  const scopeStats: TokenUsageSummary["scope_stats"] = {};
  for (const [scope, statsRaw] of Object.entries(scopeStatsRaw)) {
    if (!isRecord(statsRaw)) {
      continue;
    }
    const input = asNumber(statsRaw["input_tokens"]) ?? 0;
    const output = asNumber(statsRaw["output_tokens"]) ?? 0;
    const total = asNumber(statsRaw["total_tokens"]) ?? input + output;
    scopeStats[scope] = {
      llm_call_count: asNumber(statsRaw["llm_call_count"]) ?? 0,
      input_tokens: input,
      output_tokens: output,
      total_tokens: Math.max(total, input + output),
      cost_usd: asNumber(statsRaw["cost_usd"]) ?? 0,
      latency_ms: asNumber(statsRaw["latency_ms"]) ?? 0
    };
  }

  return {
    request_id: requestId,
    llm_call_count: llmCallCount,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: Math.max(totalTokens, inputTokens + outputTokens),
    cost_usd: costUsd,
    scopes,
    scope_stats: scopeStats
  };
};

export const getTokenUsageFromStep = (step: SimStep | undefined): TokenUsageSummary | null => {
  if (!step || !isRecord(step.result)) {
    return null;
  }
  return normalizeTokenUsage(step.result["token_usage"]);
};

export const getStepTimingFromStep = (
  step: SimStep | undefined
): { llm_ms: number; api_ms: number; usage_query_ms: number; server_ms: number } | null => {
  if (!step || !isRecord(step.result)) {
    return null;
  }
  const timing = step.result["timing"];
  if (!isRecord(timing)) {
    return null;
  }
  return {
    llm_ms: Math.max(0, asNumber(timing["llm_ms"]) ?? 0),
    api_ms: Math.max(0, asNumber(timing["api_ms"]) ?? 0),
    usage_query_ms: Math.max(0, asNumber(timing["usage_query_ms"]) ?? 0),
    server_ms: Math.max(0, asNumber(timing["server_ms"]) ?? 0)
  };
};

/**
 * Aggregates token usage across all steps in a simulation result.
 * Used for run-level summaries and A/B comparison totals.
 */
export const getRunTokenTotals = (
  result: SimResult | null
): { input_tokens: number; output_tokens: number; total_tokens: number; cost_usd: number } => {
  if (!result) {
    return { input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0 };
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let totalCostUsd = 0;
  for (const step of result.steps ?? []) {
    const usage = getTokenUsageFromStep(step);
    if (!usage) {
      continue;
    }
    inputTokens += Math.max(0, usage.input_tokens);
    outputTokens += Math.max(0, usage.output_tokens);
    totalTokens += Math.max(0, usage.total_tokens);
    totalCostUsd += Math.max(0, usage.cost_usd);
  }

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    cost_usd: Number(totalCostUsd.toFixed(6))
  };
};

export const candidateSnapshotsEqual = (a: CandidateSnapshot | null, b: CandidateSnapshot | null): boolean => {
  if (!a || !b) {
    return false;
  }
  return JSON.stringify(a) === JSON.stringify(b);
};

// ---------------------------------------------------------------------------
// Trace event state reducer
// ---------------------------------------------------------------------------

const withStep = (steps: SimStep[], step: SimStep): SimStep[] => {
  const idx = steps.findIndex((existing) => existing.name === step.name);
  if (idx === -1) {
    return [...steps, step];
  }

  const next = [...steps];
  next[idx] = step;
  return next;
};

/**
 * Pure reducer: applies a single trace event to the current SimResult,
 * producing the next state. Called sequentially as events arrive from
 * the step-by-step HTTP execution loop.
 */
export const applyTraceEvent = (current: SimResult, event: SimTraceEvent): SimResult => {
  const base: SimResult = {
    ...current,
    request_id: event.request_id || current.request_id,
    trace: [...current.trace, event]
  };

  if (event.type === "step_started") {
    return {
      ...base,
      steps: withStep(base.steps, {
        name: event.step,
        status: "running",
        latency_ms: 0,
        started_at: event.at
      })
    };
  }

  if (event.type === "step_completed") {
    const prior = base.steps.find((s) => s.name === event.step);
    const nextStep: SimStep = {
      name: event.step,
      status: "ok",
      latency_ms: event.latency_ms,
      completed_at: event.at,
      result: event.result
    };
    if (prior?.started_at) {
      nextStep.started_at = prior.started_at;
    }

    return {
      ...base,
      steps: withStep(base.steps, nextStep)
    };
  }

  if (event.type === "step_failed") {
    const prior = base.steps.find((s) => s.name === event.step);
    const nextStep: SimStep = {
      name: event.step,
      status: "failed",
      latency_ms: event.latency_ms,
      completed_at: event.at,
      error: event.error
    };
    if (prior?.started_at) {
      nextStep.started_at = prior.started_at;
    }

    return {
      ...base,
      ok: false,
      error: event.error,
      steps: withStep(base.steps, nextStep)
    };
  }

  if (event.type === "run_completed") {
    return {
      ...base,
      ok: true,
      checks: event.checks
    };
  }

  if (event.type === "run_failed") {
    return {
      ...base,
      ok: false,
      error: event.error
    };
  }

  return base;
};
