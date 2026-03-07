"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Play, Timer } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type {
  LaneOverrides,
  ModelOverride,
  RecipeSimulationRunnerCardProps,
  SimChecks,
  SimComplexity,
  SimResult,
  SimStep,
  SimulationRegistryModel,
} from "./types";
import { applyTraceEvent, emptyResult, formatSeconds, getRunTokenTotals } from "./types";
import { OverridePanel } from "./simulation-config-form";
import { RecipeQualityPanel, StepList, TraceTimeline } from "./simulation-results-panel";
import { ComparisonTable } from "./simulation-comparison";

// ---------------------------------------------------------------------------
// RunLane — one side of the A/B comparison, composing the config form,
// step timeline, recipe quality panel, and trace log for a single run.
// ---------------------------------------------------------------------------

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
  registryModels: SimulationRegistryModel[];
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
      <div className="flex flex-wrap items-center justify-between gap-2">
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
        <div className="flex flex-wrap items-center gap-2 text-xs">
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
          <span className="font-mono text-[9px] text-muted-foreground sm:ml-auto">{formatSeconds(totalMs)}</span>
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
        <div className="flex flex-wrap items-center justify-between gap-2">
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

// ---------------------------------------------------------------------------
// RecipeSimulationRunnerCard — main orchestrator component.
//
// Manages two A/B lanes, each with independent model overrides and results.
// Runs are step-by-step HTTP requests (one per pipeline step) to avoid
// Cloudflare Worker wall-clock timeouts. Concurrent A/B runs share the
// same seed and simulation token for fair comparison.
// ---------------------------------------------------------------------------

/**
 * Ordered step sequence matching the server-side simulation pipeline.
 * Each step is executed as an independent HTTP POST to /api/admin/simulations/run.
 */
const STEP_SEQUENCE = [
  "chat_start",
  "chat_refine",
  "chat_generation_trigger",
  "candidate_set_active_component",
  "chat_iterate_candidate",
  "commit_candidate_set",
  "fetch_committed_recipe",
  "fetch_cookbook"
] as const;

export function RecipeSimulationRunnerCard({ registryModels }: RecipeSimulationRunnerCardProps): React.JSX.Element {
  const [runningA, setRunningA] = useState(false);
  const [runningB, setRunningB] = useState(false);
  const [resultA, setResultA] = useState<SimResult | null>(null);
  const [resultB, setResultB] = useState<SimResult | null>(null);
  const [overridesA, setOverridesA] = useState<LaneOverrides>({});
  const [overridesB, setOverridesB] = useState<LaneOverrides>({});
  const [complexity, setComplexity] = useState<SimComplexity>("medium");

  const buildOverridePayload = (overrides: LaneOverrides): Record<string, ModelOverride> => {
    const out: Record<string, ModelOverride> = {};
    for (const [scope, val] of Object.entries(overrides)) {
      if (val?.provider.trim() && val.model.trim()) {
        out[scope] = { provider: val.provider.trim(), model: val.model.trim() };
      }
    }
    return out;
  };

  const fetchSharedSimulationToken = async (): Promise<string> => {
    const response = await fetch("/api/admin/simulations/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "token" })
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "Failed to acquire shared simulation token");
      throw new Error(text);
    }

    const payload = await response.json() as { token?: string };
    const token = payload.token?.trim() ?? "";
    if (!token) {
      throw new Error("Simulation token response missing token");
    }

    return token;
  };

  const runLane = async (
    variant: "A" | "B",
    options?: { seed?: number; runGroupId?: string; sharedToken?: string }
  ): Promise<void> => {
    const setRunning = variant === "A" ? setRunningA : setRunningB;
    const setResult = variant === "A" ? setResultA : setResultB;
    const overrides = variant === "A" ? overridesA : overridesB;
    const seed = options?.seed ?? Math.max(1, Math.floor(Date.now() % 2_147_483_647));
    const runGroupId = options?.runGroupId ?? crypto.randomUUID();
    const sharedToken = options?.sharedToken?.trim() ?? "";

    setRunning(true);
    let current = emptyResult();
    setResult(current);

    try {
      const initRes = await fetch("/api/admin/simulations/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "init",
          scenario: "default_api_ux",
          complexity,
          variant,
          seed,
          run_group_id: runGroupId,
          model_overrides: buildOverridePayload(overrides),
          token: sharedToken || undefined
        })
      });

      if (!initRes.ok) {
        const text = await initRes.text().catch(() => "Init failed");
        current = { ...current, ok: false, error: text };
        setResult(current);
        toast.error(`Run ${variant} init failed`);
        return;
      }

      const initData = await initRes.json() as {
        request_id: string;
        token: string;
        api_base: string;
        prompts: { start: string; refine: string; trigger: string; iterate: string };
        actor_id: string | null;
      };

      current = { ...current, request_id: initData.request_id };

      current = applyTraceEvent(current, {
        type: "run_started",
        request_id: initData.request_id,
        at: new Date().toISOString(),
        scenario: "default_api_ux",
        variant
      });
      setResult({ ...current });

      const context: Record<string, unknown> = {};
      let allOk = true;

      for (const stepName of STEP_SEQUENCE) {
        current = applyTraceEvent(current, {
          type: "step_started",
          request_id: initData.request_id,
          step: stepName,
          at: new Date().toISOString()
        });
        setResult({ ...current });

        const stepRes = await fetch("/api/admin/simulations/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "step",
            step_name: stepName,
            token: initData.token,
            api_base: initData.api_base,
            prompts: initData.prompts,
            model_overrides: buildOverridePayload(overrides),
            request_id: initData.request_id,
            context
          })
        });

        const stepData = await stepRes.json() as {
          step: SimStep;
          context_updates: Record<string, unknown>;
        };

        Object.assign(context, stepData.context_updates);

        if (stepData.step.status === "ok") {
          current = applyTraceEvent(current, {
            type: "step_completed",
            request_id: initData.request_id,
            step: stepName,
            latency_ms: stepData.step.latency_ms,
            at: new Date().toISOString(),
            result: stepData.step.result ?? {}
          });
        } else {
          allOk = false;
          current = applyTraceEvent(current, {
            type: "step_failed",
            request_id: initData.request_id,
            step: stepName,
            latency_ms: stepData.step.latency_ms,
            at: new Date().toISOString(),
            error: stepData.step.error ?? "Step failed"
          });
        }
        setResult({ ...current });

        if (!allOk) break;
      }

      const totalMs = current.steps.reduce((sum, s) => sum + s.latency_ms, 0);
      const checks: SimChecks = {
        zero_failed_steps: allOk,
        steps_executed: current.steps.length,
        total_latency_ms: totalMs,
        timestamp: new Date().toISOString()
      };
      current = { ...current, ok: allOk, checks };

      /* Best-effort completion event — fire-and-forget */
      fetch("/api/admin/simulations/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "complete",
          request_id: initData.request_id,
          actor_id: initData.actor_id,
          scenario: "default_api_ux",
          complexity,
          variant,
          seed,
          run_group_id: runGroupId,
          prompts: initData.prompts,
          steps: current.steps,
          ok: allOk,
          error: allOk ? undefined : current.error
        })
      }).catch(() => { /* best-effort */ });

      if (allOk) {
        current = applyTraceEvent(current, {
          type: "run_completed",
          request_id: initData.request_id,
          at: new Date().toISOString(),
          checks
        });
        toast.success(`Run ${variant} complete · ${initData.request_id}`);
      } else {
        current = applyTraceEvent(current, {
          type: "run_failed",
          request_id: initData.request_id,
          at: new Date().toISOString(),
          error: current.error ?? "One or more steps failed"
        });
        toast.error(current.error ?? `Run ${variant} failed`);
      }
      setResult({ ...current });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setResult({ ...emptyResult(), ok: false, error: message });
      toast.error(`Run ${variant} failed`);
    } finally {
      setRunning(false);
    }
  };

  const runConcurrentAB = (): void => {
    if (runningA || runningB) {
      return;
    }

    void (async () => {
      const seed = Math.max(1, Math.floor(Date.now() % 2_147_483_647));
      const runGroupId = crypto.randomUUID();

      let sharedToken: string;
      try {
        sharedToken = await fetchSharedSimulationToken();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(message || "Failed to acquire shared simulation token");
        return;
      }

      await Promise.all([
        runLane("A", { seed, runGroupId, sharedToken }),
        runLane("B", { seed, runGroupId, sharedToken })
      ]);
    })();
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Recipe Simulation Runner — Single or A/B Concurrent</CardTitle>
            <CardDescription>
              Runs against live <code className="rounded bg-muted px-1 text-xs">/v1</code> with full real-time trace.
              Every run uses fresh seeded prompts, and concurrent A/B lanes share the same seed for fair comparison.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Complexity
              <select
                value={complexity}
                onChange={(event) => setComplexity(event.target.value as SimComplexity)}
                className="h-8 rounded-md border bg-background px-2 py-1 font-mono text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="basic">Basic</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
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

export { RecipeSimulationRunnerCard as SimulationRunnerCard };
