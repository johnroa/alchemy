"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Loader2, Play, Timer, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type ModelOverride = { provider: string; model: string };

const SIM_SCOPES = ["chat_ideation", "chat_generation", "chat_iteration", "classify"] as const;
type SimScope = (typeof SIM_SCOPES)[number];

type LaneOverrides = Partial<Record<SimScope, ModelOverride>>;

type RegistryModel = { id: string; provider: string; model: string; display_name: string; is_available: boolean };

type SimStepStatus = "running" | "ok" | "failed";

type SimStep = {
  name: string;
  status: SimStepStatus;
  latency_ms: number;
  started_at?: string;
  completed_at?: string;
  result?: Record<string, unknown>;
  error?: string;
};

type SimChecks = {
  zero_failed_steps: boolean;
  steps_executed: number;
  total_latency_ms: number;
  timestamp: string;
};

type BaseTraceEvent = {
  request_id: string;
  at: string;
};

type SimTraceEvent =
  | (BaseTraceEvent & { type: "run_started"; scenario: string; variant: "single" | "A" | "B" })
  | (BaseTraceEvent & { type: "step_started"; step: string })
  | (BaseTraceEvent & { type: "step_completed"; step: string; latency_ms: number; result: Record<string, unknown> })
  | (BaseTraceEvent & { type: "step_failed"; step: string; latency_ms: number; error: string })
  | (BaseTraceEvent & { type: "run_completed"; checks: SimChecks })
  | (BaseTraceEvent & { type: "run_failed"; error: string });

type SimResult = {
  ok: boolean;
  request_id: string;
  checks?: SimChecks;
  error?: string;
  steps: SimStep[];
  trace: SimTraceEvent[];
};

type CandidateIngredientSnapshot = {
  name: string;
  amount: string;
  unit: string;
  category: string;
  preparation: string;
};

type CandidateStepSnapshot = {
  index: number;
  instruction: string;
  notes: string;
  timer_seconds: number | null;
};

type CandidateComponentSnapshot = {
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

type CandidateSnapshot = {
  candidate_id: string;
  revision: number | null;
  active_component_id: string | null;
  components: CandidateComponentSnapshot[];
};

type TokenUsageSummary = {
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

type StreamResultEvent = {
  type: "result";
  payload: SimResult;
};

type StreamEvent = SimTraceEvent | StreamResultEvent;

const emptyResult = (): SimResult => ({
  ok: false,
  request_id: "",
  steps: [],
  trace: []
});

const formatTime = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const parseStreamEvent = (line: string): StreamEvent | null => {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!isRecord(parsed) || typeof parsed["type"] !== "string") {
      return null;
    }

    return parsed as StreamEvent;
  } catch {
    return null;
  }
};

const asString = (value: unknown): string => {
  return typeof value === "string" ? value : "";
};

const asNumber = (value: unknown): number | null => {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const normalizeCandidateSnapshot = (value: unknown): CandidateSnapshot | null => {
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

const getStepResult = (result: SimResult | null, stepName: string): Record<string, unknown> | null => {
  if (!result) {
    return null;
  }
  const step = (result.steps ?? []).find((entry) => entry.name === stepName);
  if (!step || !isRecord(step.result)) {
    return null;
  }
  return step.result;
};

const getCandidateFromStep = (
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

const getPromptFromStep = (result: SimResult | null, stepName: string, key: string): string | null => {
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

const normalizeTokenUsage = (value: unknown): TokenUsageSummary | null => {
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

const getTokenUsageFromStep = (step: SimStep | undefined): TokenUsageSummary | null => {
  if (!step || !isRecord(step.result)) {
    return null;
  }
  return normalizeTokenUsage(step.result["token_usage"]);
};

const getStepTimingFromStep = (
  step: SimStep | undefined
): { llm_ms: number; api_ms: number; db_ms: number; server_ms: number } | null => {
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
    db_ms: Math.max(0, asNumber(timing["db_ms"]) ?? 0),
    server_ms: Math.max(0, asNumber(timing["server_ms"]) ?? 0)
  };
};

const getRunTokenTotals = (
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

const candidateSnapshotsEqual = (a: CandidateSnapshot | null, b: CandidateSnapshot | null): boolean => {
  if (!a || !b) {
    return false;
  }
  return JSON.stringify(a) === JSON.stringify(b);
};

const withStep = (steps: SimStep[], step: SimStep): SimStep[] => {
  const idx = steps.findIndex((existing) => existing.name === step.name);
  if (idx === -1) {
    return [...steps, step];
  }

  const next = [...steps];
  next[idx] = step;
  return next;
};

const applyTraceEvent = (current: SimResult, event: SimTraceEvent): SimResult => {
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

function CandidateSnapshotPanel({
  title,
  snapshot
}: {
  title: string;
  snapshot: CandidateSnapshot;
}): React.JSX.Element {
  return (
    <div className="space-y-2 rounded border bg-background p-2.5">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <Badge variant="outline" className="font-mono text-[10px]">
          {title}
        </Badge>
        <span className="font-mono text-muted-foreground">
          components={snapshot.components.length}
        </span>
        {snapshot.revision !== null && (
          <span className="font-mono text-muted-foreground">revision={snapshot.revision}</span>
        )}
      </div>

      <div className="space-y-2">
        {snapshot.components.map((component, index) => {
          const isActive =
            snapshot.active_component_id !== null && component.component_id === snapshot.active_component_id;
          return (
            <div key={`${component.component_id || component.title}-${index}`} className="rounded border bg-zinc-50/40 p-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant={isActive ? "default" : "outline"} className="font-mono text-[10px]">
                  {component.role || "component"}
                </Badge>
                <span className="font-medium text-zinc-900">{component.title || component.recipe_title}</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  ingredients={component.ingredient_count} · steps={component.step_count}
                </span>
              </div>

              {component.description && (
                <p className="mt-1 text-xs text-muted-foreground">{component.description}</p>
              )}

              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <div className="rounded border bg-background p-2">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Ingredients</p>
                  <div className="max-h-40 space-y-1 overflow-y-auto text-xs">
                    {component.ingredients.map((ingredient, ingredientIndex) => (
                      <div key={`${ingredient.name}-${ingredientIndex}`} className="font-mono text-[11px]">
                        <span className="text-zinc-900">{ingredient.name}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          {ingredient.amount ? `${ingredient.amount} ` : ""}
                          {ingredient.unit || ""}
                          {ingredient.category ? ` · ${ingredient.category}` : ""}
                        </span>
                      </div>
                    ))}
                    {component.ingredients.length === 0 && <p className="text-muted-foreground">No ingredients in snapshot</p>}
                  </div>
                </div>

                <div className="rounded border bg-background p-2">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Steps</p>
                  <div className="max-h-40 space-y-1 overflow-y-auto text-xs">
                    {component.steps.map((step) => (
                      <div key={`${component.component_id}-${step.index}`} className="text-[11px]">
                        <span className="mr-1 font-mono text-muted-foreground">{step.index}.</span>
                        <span className="text-zinc-900">{step.instruction}</span>
                      </div>
                    ))}
                    {component.steps.length === 0 && <p className="text-muted-foreground">No steps in snapshot</p>}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecipeQualityPanel({ result }: { result: SimResult | null }): React.JSX.Element {
  const generatedSnapshot =
    getCandidateFromStep(result, "chat_generation_trigger") ?? getCandidateFromStep(result, "chat_refine");
  const iteratedBefore = getCandidateFromStep(result, "chat_iterate_candidate", "candidate_snapshot_before");
  const iteratedSnapshot = getCandidateFromStep(result, "chat_iterate_candidate");
  const generationPrompt =
    getPromptFromStep(result, "chat_generation_trigger", "generation_prompt") ??
    getPromptFromStep(result, "chat_refine", "user_prompt");
  const tweakPrompt =
    getPromptFromStep(result, "chat_iterate_candidate", "tweak_prompt") ??
    getPromptFromStep(result, "chat_iterate_candidate", "user_prompt");
  const showIteratedBefore = Boolean(
    iteratedBefore && (!generatedSnapshot || !candidateSnapshotsEqual(generatedSnapshot, iteratedBefore))
  );

  if (!generatedSnapshot && !iteratedBefore && !iteratedSnapshot && !generationPrompt && !tweakPrompt) {
    return (
      <div className="rounded border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
        Recipe snapshots will appear after generation and tweak steps complete.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {(generationPrompt || tweakPrompt) && (
        <div className="grid gap-2 md:grid-cols-2">
          <div className="rounded border bg-background p-2">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Generation Prompt
            </p>
            <p className="text-xs text-zinc-900">
              {generationPrompt ?? "Not available in this run"}
            </p>
          </div>
          <div className="rounded border bg-background p-2">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Tweak Request
            </p>
            <p className="text-xs text-zinc-900">
              {tweakPrompt ?? "No tweak message in this run"}
            </p>
          </div>
        </div>
      )}
      {generatedSnapshot && <CandidateSnapshotPanel title="Generated Candidate" snapshot={generatedSnapshot} />}
      {showIteratedBefore && iteratedBefore && (
        <CandidateSnapshotPanel title="Tweak Input (Pre-Iteration)" snapshot={iteratedBefore} />
      )}
      {iteratedSnapshot && <CandidateSnapshotPanel title="Tweaked Candidate (Post-Iteration)" snapshot={iteratedSnapshot} />}
    </div>
  );
}

function OverridePanel({
  overrides,
  registryModels,
  onChange
}: {
  overrides: LaneOverrides;
  registryModels: RegistryModel[];
  onChange: (overrides: LaneOverrides) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const activeCount = Object.values(overrides).filter((o) => o?.model).length;
  const availableModels = registryModels.filter((m) => m.is_available);

  const selectedValue = (scope: SimScope): string => {
    const o = overrides[scope];
    return o ? `${o.provider}/${o.model}` : "";
  };

  const handleChange = (scope: SimScope, value: string): void => {
    if (!value) {
      const next = { ...overrides };
      delete next[scope];
      onChange(next);
      return;
    }

    const [provider, ...rest] = value.split("/");
    onChange({ ...overrides, [scope]: { provider, model: rest.join("/") } });
  };

  return (
    <div className="rounded-md border">
      <button
        className="flex w-full items-center justify-between px-3 py-2 text-xs"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="font-medium text-muted-foreground">
          Model overrides
          {activeCount > 0 && (
            <Badge className="ml-2 border-violet-300 bg-violet-50 text-violet-700 text-[10px]">
              {activeCount} active
            </Badge>
          )}
        </span>
        {open ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
      </button>

      {open && (
        <div className="space-y-2 border-t px-3 pb-3 pt-2">
          {SIM_SCOPES.map((scope) => (
            <div key={scope} className="flex items-center gap-3">
              <span className="w-24 flex-none font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {scope}
              </span>
              <select
                value={selectedValue(scope)}
                onChange={(e) => handleChange(scope, e.target.value)}
                className="flex-1 rounded-md border bg-background px-2 py-1 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">- DB default -</option>
                {availableModels.map((model) => (
                  <option key={`${model.provider}/${model.model}`} value={`${model.provider}/${model.model}`}>
                    {model.display_name} ({model.provider})
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StepList({ steps }: { steps: SimStep[] }): React.JSX.Element {
  if (steps.length === 0) {
    return (
      <div className="rounded border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
        Waiting for steps...
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {steps.map((step, index) => {
        const tokenUsage = getTokenUsageFromStep(step);
        const tokenTotal = tokenUsage ? Math.max(0, tokenUsage.total_tokens) : 0;
        const hasLlmTokens = Boolean(tokenUsage && tokenUsage.llm_call_count > 0);
        const timing = getStepTimingFromStep(step);
        return (
          <div
            key={`${step.name}-${index}`}
            className={cn(
              "flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs",
              step.status === "ok"
                ? "border-emerald-200 bg-emerald-50/50"
                : step.status === "failed"
                  ? "border-red-200 bg-red-50/50"
                  : "border-amber-200 bg-amber-50/50"
            )}
          >
            {step.status === "ok" ? (
              <CheckCircle2 className="h-3 w-3 flex-none text-emerald-500" />
            ) : step.status === "failed" ? (
              <XCircle className="h-3 w-3 flex-none text-red-500" />
            ) : (
              <Loader2 className="h-3 w-3 flex-none animate-spin text-amber-500" />
            )}

            <span
              className={cn(
                "flex-1 font-medium",
                step.status === "ok" ? "text-emerald-900" : step.status === "failed" ? "text-red-900" : "text-amber-900"
              )}
            >
              {step.name}
            </span>

            {step.error && (
              <span className="max-w-[180px] truncate text-red-600">{step.error}</span>
            )}

            <span className="flex-none font-mono text-muted-foreground">
              {hasLlmTokens ? `${tokenTotal.toLocaleString()} tok` : "— tok"}
            </span>
            {timing && (timing.llm_ms > 0 || timing.api_ms > 0 || timing.db_ms > 0 || timing.server_ms > 0) && (
              <span className="flex-none font-mono text-[11px] text-muted-foreground">
                llm {timing.llm_ms.toLocaleString()}ms · server {timing.server_ms.toLocaleString()}ms · api{" "}
                {timing.api_ms.toLocaleString()}ms · db {timing.db_ms.toLocaleString()}ms
              </span>
            )}
            <span className="flex-none font-mono text-muted-foreground">
              {step.status === "running" ? "..." : `${step.latency_ms.toLocaleString()}ms`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function TraceTimeline({ trace }: { trace: SimTraceEvent[] }): React.JSX.Element {
  if (trace.length === 0) {
    return (
      <div className="rounded border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
        Trace will stream here in real time.
      </div>
    );
  }

  return (
    <div className="max-h-80 space-y-2 overflow-y-auto rounded border bg-zinc-50/40 p-2">
      {trace.map((event, index) => (
        <div key={`${event.type}-${event.at}-${index}`} className="rounded border bg-background p-2">
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="outline" className="font-mono text-[10px]">
              {event.type}
            </Badge>
            <span className="font-mono text-[10px] text-muted-foreground">{formatTime(event.at)}</span>
            {"step" in event && (
              <span className="font-mono text-[10px] text-muted-foreground">{event.step}</span>
            )}
            {"latency_ms" in event && (
              <span className="font-mono text-[10px] text-muted-foreground">{event.latency_ms.toLocaleString()}ms</span>
            )}
          </div>

          {event.type === "step_completed" && Object.keys(event.result).length > 0 && (
            <pre className="mt-2 overflow-x-auto rounded bg-zinc-100 p-2 font-mono text-[10px] leading-relaxed text-zinc-700">
              {JSON.stringify(event.result, null, 2)}
            </pre>
          )}

          {event.type === "step_failed" && (
            <p className="mt-1 text-xs text-red-600">{event.error}</p>
          )}

          {event.type === "run_failed" && (
            <p className="mt-1 text-xs text-red-600">{event.error}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function RunLane({
  label,
  overrides,
  registryModels,
  onOverridesChange,
  running,
  result,
  onRun
}: {
  label: "A" | "B";
  overrides: LaneOverrides;
  registryModels: RegistryModel[];
  onOverridesChange: (o: LaneOverrides) => void;
  running: boolean;
  result: SimResult | null;
  onRun: () => void;
}): React.JSX.Element {
  const [traceOpen, setTraceOpen] = useState(false);
  const totalMs = result?.checks?.total_latency_ms ?? result?.steps.reduce((sum, step) => sum + step.latency_ms, 0) ?? 0;
  const tokenTotals = getRunTokenTotals(result);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Badge variant="outline" className="font-mono text-xs">
          Run {label}
        </Badge>
        <Button size="sm" variant="outline" onClick={onRun} disabled={running} className="h-7 gap-1.5 text-xs">
          {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          {running ? "Running..." : `Run ${label}`}
        </Button>
      </div>

      <OverridePanel overrides={overrides} registryModels={registryModels} onChange={onOverridesChange} />

      {result && (
        <div className="flex items-center gap-2 text-xs">
          <Badge
            variant="outline"
            className={
              result.ok
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : result.error
                  ? "border-red-300 bg-red-50 text-red-700"
                  : "border-amber-300 bg-amber-50 text-amber-700"
            }
          >
            {result.ok ? "Passed" : running ? "Running" : "Failed"}
          </Badge>
          <span className="font-mono text-[10px] text-muted-foreground">{result.request_id || "pending"}</span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {tokenTotals.total_tokens.toLocaleString()} tok
          </span>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">{totalMs.toLocaleString()}ms</span>
        </div>
      )}

      {result?.error && !running && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {result.error}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Step Timeline</p>
        <StepList steps={result?.steps ?? []} />
      </div>

      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Recipe Quality</p>
        <RecipeQualityPanel result={result} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Full Trace</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-6 gap-1 px-2 text-[10px]"
            onClick={() => setTraceOpen((open) => !open)}
          >
            {traceOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {traceOpen ? "Hide" : "Show"}
          </Button>
        </div>
        {traceOpen ? (
          <TraceTimeline trace={result?.trace ?? []} />
        ) : (
          <div className="rounded border border-dashed px-3 py-3 text-xs text-muted-foreground">
            Full trace hidden. Click Show to inspect raw step payloads.
          </div>
        )}
      </div>
    </div>
  );
}

function ComparisonTable({ a, b }: { a: SimResult; b: SimResult }): React.JSX.Element {
  const stepNames = useMemo(
    () => Array.from(new Set([...(a.steps ?? []).map((s) => s.name), ...(b.steps ?? []).map((s) => s.name)])),
    [a.steps, b.steps]
  );

  const aByName = new Map((a.steps ?? []).map((s) => [s.name, s]));
  const bByName = new Map((b.steps ?? []).map((s) => [s.name, s]));

  const totalA = a.checks?.total_latency_ms ?? (a.steps ?? []).reduce((sum, step) => sum + step.latency_ms, 0);
  const totalB = b.checks?.total_latency_ms ?? (b.steps ?? []).reduce((sum, step) => sum + step.latency_ms, 0);
  const totalDelta = totalB - totalA;
  const tokenTotalsA = getRunTokenTotals(a);
  const tokenTotalsB = getRunTokenTotals(b);
  const tokenDelta = tokenTotalsB.total_tokens - tokenTotalsA.total_tokens;

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">A/B Latency + Token Comparison</p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-zinc-50">
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Step</th>
              <th className="px-3 py-2 text-center font-medium text-muted-foreground">Run A Latency</th>
              <th className="px-3 py-2 text-center font-medium text-muted-foreground">Run B Latency</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Latency Δ</th>
              <th className="px-3 py-2 text-center font-medium text-muted-foreground">Run A Tokens</th>
              <th className="px-3 py-2 text-center font-medium text-muted-foreground">Run B Tokens</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Token Δ</th>
            </tr>
          </thead>
          <tbody>
            {stepNames.map((stepName) => {
              const stepA = aByName.get(stepName);
              const stepB = bByName.get(stepName);
              const delta = stepA && stepB ? stepB.latency_ms - stepA.latency_ms : null;
              const usageA = getTokenUsageFromStep(stepA);
              const usageB = getTokenUsageFromStep(stepB);
              const tokensA = usageA && usageA.llm_call_count > 0 ? Math.max(0, usageA.total_tokens) : null;
              const tokensB = usageB && usageB.llm_call_count > 0 ? Math.max(0, usageB.total_tokens) : null;
              const tokenStepDelta = tokensA !== null && tokensB !== null ? tokensB - tokensA : null;

              return (
                <tr key={stepName} className="border-b last:border-0">
                  <td className="px-3 py-1.5 font-mono font-medium">{stepName}</td>
                  <td className="px-3 py-1.5 text-center font-mono">
                    {stepA ? `${stepA.latency_ms.toLocaleString()}ms` : "-"}
                  </td>
                  <td className="px-3 py-1.5 text-center font-mono">
                    {stepB ? `${stepB.latency_ms.toLocaleString()}ms` : "-"}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">
                    {delta !== null ? (
                      <span className={delta < 0 ? "text-emerald-600" : delta > 0 ? "text-red-600" : "text-muted-foreground"}>
                        {delta > 0 ? "+" : ""}
                        {delta.toLocaleString()}ms
                      </span>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
              <td className="px-3 py-1.5 text-center font-mono">
                {tokensA !== null ? tokensA.toLocaleString() : "—"}
              </td>
              <td className="px-3 py-1.5 text-center font-mono">
                {tokensB !== null ? tokensB.toLocaleString() : "—"}
              </td>
                  <td className="px-3 py-1.5 text-right font-mono">
                    {tokenStepDelta !== null ? (
                      <span className={tokenStepDelta < 0 ? "text-emerald-600" : tokenStepDelta > 0 ? "text-red-600" : "text-muted-foreground"}>
                        {tokenStepDelta > 0 ? "+" : ""}
                        {tokenStepDelta.toLocaleString()}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t bg-zinc-50 font-semibold">
              <td className="px-3 py-1.5">Overall</td>
              <td className="px-3 py-1.5 text-center font-mono">{totalA.toLocaleString()}ms</td>
              <td className="px-3 py-1.5 text-center font-mono">{totalB.toLocaleString()}ms</td>
              <td className="px-3 py-1.5 text-right font-mono">
                <span className={totalDelta < 0 ? "text-emerald-600" : totalDelta > 0 ? "text-red-600" : "text-muted-foreground"}>
                  {totalDelta > 0 ? "+" : ""}
                  {totalDelta.toLocaleString()}ms
                </span>
              </td>
              <td className="px-3 py-1.5 text-center font-mono">
                {tokenTotalsA.total_tokens.toLocaleString()}
              </td>
              <td className="px-3 py-1.5 text-center font-mono">
                {tokenTotalsB.total_tokens.toLocaleString()}
              </td>
              <td className="px-3 py-1.5 text-right font-mono">
                <span className={tokenDelta < 0 ? "text-emerald-600" : tokenDelta > 0 ? "text-red-600" : "text-muted-foreground"}>
                  {tokenDelta > 0 ? "+" : ""}
                  {tokenDelta.toLocaleString()}
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

export function SimulationRunnerCard({ registryModels }: { registryModels: RegistryModel[] }): React.JSX.Element {
  const [runningA, setRunningA] = useState(false);
  const [runningB, setRunningB] = useState(false);
  const [resultA, setResultA] = useState<SimResult | null>(null);
  const [resultB, setResultB] = useState<SimResult | null>(null);
  const [overridesA, setOverridesA] = useState<LaneOverrides>({});
  const [overridesB, setOverridesB] = useState<LaneOverrides>({});

  const buildOverridePayload = (overrides: LaneOverrides): Record<string, ModelOverride> => {
    const out: Record<string, ModelOverride> = {};
    for (const [scope, val] of Object.entries(overrides)) {
      if (val?.provider.trim() && val.model.trim()) {
        out[scope] = { provider: val.provider.trim(), model: val.model.trim() };
      }
    }
    return out;
  };

  const runLane = async (
    variant: "A" | "B",
    options?: { seed?: number; runGroupId?: string }
  ): Promise<void> => {
    const setRunning = variant === "A" ? setRunningA : setRunningB;
    const setResult = variant === "A" ? setResultA : setResultB;
    const overrides = variant === "A" ? overridesA : overridesB;
    const seed = options?.seed ?? Math.max(1, Math.floor(Date.now() % 2_147_483_647));
    const runGroupId = options?.runGroupId ?? crypto.randomUUID();

    setRunning(true);
    setResult(emptyResult());

    try {
      const response = await fetch("/api/admin/simulations/run?stream=1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenario: "default_api_ux",
          variant,
          seed,
          run_group_id: runGroupId,
          model_overrides: buildOverridePayload(overrides)
        })
      });

      if (!response.ok || !response.body) {
        const fallback = (await response.text().catch(() => "Simulation request failed")) || "Simulation request failed";
        const failed = { ...emptyResult(), ok: false, error: fallback };
        setResult(failed);
        toast.error(`Run ${variant} failed`);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let current = emptyResult();
      let finalPayload: SimResult | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const event = parseStreamEvent(line);
          if (!event) {
            continue;
          }

          if (event.type === "result") {
            finalPayload = event.payload;
            current = event.payload;
            setResult({ ...current, steps: [...current.steps], trace: [...current.trace] });
            continue;
          }

          current = applyTraceEvent(current, event);
          setResult({ ...current, steps: [...current.steps], trace: [...current.trace] });
        }
      }

      const trailingEvent = parseStreamEvent(buffer);
      if (trailingEvent) {
        if (trailingEvent.type === "result") {
          finalPayload = trailingEvent.payload;
          current = trailingEvent.payload;
          setResult({ ...current, steps: [...current.steps], trace: [...current.trace] });
        } else {
          current = applyTraceEvent(current, trailingEvent);
          setResult({ ...current, steps: [...current.steps], trace: [...current.trace] });
        }
      }

      if (!finalPayload) {
        finalPayload = current;
      }

      if (finalPayload.ok) {
        toast.success(`Run ${variant} complete · ${finalPayload.request_id}`);
      } else {
        toast.error(finalPayload.error ?? `Run ${variant} failed`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = { ...emptyResult(), ok: false, error: message };
      setResult(failed);
      toast.error(`Run ${variant} failed`);
    } finally {
      setRunning(false);
    }
  };

  const runConcurrentAB = (): void => {
    if (runningA || runningB) {
      return;
    }

    const seed = Math.max(1, Math.floor(Date.now() % 2_147_483_647));
    const runGroupId = crypto.randomUUID();
    void Promise.all([
      runLane("A", { seed, runGroupId }),
      runLane("B", { seed, runGroupId })
    ]);
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Simulation Runner — Single or A/B Concurrent</CardTitle>
            <CardDescription>
              Runs against live <code className="rounded bg-muted px-1 text-xs">/v1</code> with full real-time trace.
              Every run uses fresh seeded prompts, and concurrent A/B lanes share the same seed for fair comparison.
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="default"
            onClick={runConcurrentAB}
            disabled={runningA || runningB}
            className="h-8 gap-1.5 text-xs"
          >
            {runningA || runningB ? <Loader2 className="h-3 w-3 animate-spin" /> : <Timer className="h-3 w-3" />}
            Run A/B Concurrent
          </Button>
        </div>
      </CardHeader>

      <Separator />

      <CardContent className="space-y-6 pt-4">
        <div className="grid gap-6 md:grid-cols-2">
          <RunLane
            label="A"
            overrides={overridesA}
            registryModels={registryModels}
            onOverridesChange={setOverridesA}
            running={runningA}
            result={resultA}
            onRun={() => void runLane("A")}
          />
          <RunLane
            label="B"
            overrides={overridesB}
            registryModels={registryModels}
            onOverridesChange={setOverridesB}
            running={runningB}
            result={resultB}
            onRun={() => void runLane("B")}
          />
        </div>

        {resultA && resultB && resultA.steps.length > 0 && resultB.steps.length > 0 && (
          <>
            <Separator />
            <ComparisonTable a={resultA} b={resultB} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
