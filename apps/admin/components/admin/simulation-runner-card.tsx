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
      {steps.map((step, index) => (
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
            {step.status === "running" ? "..." : `${step.latency_ms.toLocaleString()}ms`}
          </span>
        </div>
      ))}
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
  const totalMs = result?.checks?.total_latency_ms ?? result?.steps.reduce((sum, step) => sum + step.latency_ms, 0) ?? 0;

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
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">{totalMs.toLocaleString()}ms total</span>
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
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Full Trace</p>
        <TraceTimeline trace={result?.trace ?? []} />
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

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">A/B Latency Comparison</p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-zinc-50">
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Step</th>
              <th className="px-3 py-2 text-center font-medium text-muted-foreground">Run A</th>
              <th className="px-3 py-2 text-center font-medium text-muted-foreground">Run B</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Delta</th>
            </tr>
          </thead>
          <tbody>
            {stepNames.map((stepName) => {
              const stepA = aByName.get(stepName);
              const stepB = bByName.get(stepName);
              const delta = stepA && stepB ? stepB.latency_ms - stepA.latency_ms : null;

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
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t bg-zinc-50 font-semibold">
              <td className="px-3 py-1.5">Total</td>
              <td className="px-3 py-1.5 text-center font-mono">{totalA.toLocaleString()}ms</td>
              <td className="px-3 py-1.5 text-center font-mono">{totalB.toLocaleString()}ms</td>
              <td className="px-3 py-1.5 text-right font-mono">
                <span className={totalDelta < 0 ? "text-emerald-600" : totalDelta > 0 ? "text-red-600" : "text-muted-foreground"}>
                  {totalDelta > 0 ? "+" : ""}
                  {totalDelta.toLocaleString()}ms
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

  const runLane = async (variant: "A" | "B"): Promise<void> => {
    const setRunning = variant === "A" ? setRunningA : setRunningB;
    const setResult = variant === "A" ? setResultA : setResultB;
    const overrides = variant === "A" ? overridesA : overridesB;

    setRunning(true);
    setResult(emptyResult());

    const response = await fetch("/api/admin/simulations/run?stream=1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scenario: "default_api_ux",
        variant,
        model_overrides: buildOverridePayload(overrides)
      })
    });

    if (!response.ok || !response.body) {
      setRunning(false);
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

    if (!finalPayload) {
      finalPayload = current;
    }

    setRunning(false);

    if (finalPayload.ok) {
      toast.success(`Run ${variant} complete · ${finalPayload.request_id}`);
    } else {
      toast.error(finalPayload.error ?? `Run ${variant} failed`);
    }
  };

  const runConcurrentAB = (): void => {
    if (runningA || runningB) {
      return;
    }

    void Promise.all([runLane("A"), runLane("B")]);
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Simulation Runner — Single or A/B Concurrent</CardTitle>
            <CardDescription>
              Runs against live <code className="rounded bg-muted px-1 text-xs">/v1</code> with full real-time trace.
              Every run is fresh data and every step is latency-timed.
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
