"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Play, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type ModelOverride = { provider: string; model: string };

const SIM_SCOPES = ["generate", "tweak", "classify"] as const;
type SimScope = (typeof SIM_SCOPES)[number];

type LaneOverrides = Partial<Record<SimScope, ModelOverride>>;

type RegistryModel = { id: string; provider: string; model: string; display_name: string; is_available: boolean };

type SimStep = {
  name: string;
  status: "ok" | "failed";
  latency_ms: number;
  result?: Record<string, unknown>;
  error?: string;
};

type SimResult = {
  ok: boolean;
  request_id: string;
  error?: string;
  steps?: SimStep[];
};

// ── Model Override Panel ──────────────────────────────────────────────────────

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
    } else {
      const [provider, ...rest] = value.split("/");
      onChange({ ...overrides, [scope]: { provider, model: rest.join("/") } });
    }
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
        <div className="border-t px-3 pb-3 pt-2 space-y-2">
          {SIM_SCOPES.map((scope) => (
            <div key={scope} className="flex items-center gap-3">
              <span className="w-16 flex-none font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {scope}
              </span>
              <select
                value={selectedValue(scope)}
                onChange={(e) => handleChange(scope, e.target.value)}
                className="flex-1 rounded-md border bg-background px-2 py-1 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">— DB default —</option>
                {availableModels.map((m) => (
                  <option key={`${m.provider}/${m.model}`} value={`${m.provider}/${m.model}`}>
                    {m.display_name} ({m.provider})
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

// ── Step List ─────────────────────────────────────────────────────────────────

function StepList({ steps }: { steps: SimStep[] }): React.JSX.Element {
  return (
    <div className="space-y-1">
      {steps.map((step, index) => (
        <div
          key={`${step.name}-${index}`}
          className={cn(
            "flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs",
            step.status === "ok"
              ? "border-emerald-200 bg-emerald-50/50"
              : "border-red-200 bg-red-50/50"
          )}
        >
          {step.status === "ok" ? (
            <CheckCircle2 className="h-3 w-3 flex-none text-emerald-500" />
          ) : (
            <XCircle className="h-3 w-3 flex-none text-red-500" />
          )}
          <span className={cn("flex-1 font-medium", step.status === "ok" ? "text-emerald-900" : "text-red-900")}>
            {step.name}
          </span>
          {step.error && (
            <span className="max-w-[160px] truncate text-red-600">{step.error}</span>
          )}
          {step.name === "generate_recipe" && step.result && (
            <span className="flex-none text-[10px] text-muted-foreground">
              {typeof step.result["ingredient_count"] === "number" && `${step.result["ingredient_count"]}ing`}
              {" · "}
              {typeof step.result["step_count"] === "number" && `${step.result["step_count"]}steps`}
              {typeof step.result["quality_score"] === "number" && (
                <span className={cn(
                  "ml-1 font-semibold",
                  (step.result["quality_score"] as number) >= 80 ? "text-emerald-600" : "text-amber-600"
                )}>
                  Q{step.result["quality_score"]}%
                </span>
              )}
            </span>
          )}
          <span className="flex-none font-mono text-muted-foreground">{step.latency_ms.toLocaleString()}ms</span>
        </div>
      ))}
    </div>
  );
}

// ── Run Lane ─────────────────────────────────────────────────────────────────

function RunLane({
  label,
  overrides,
  registryModels,
  onOverridesChange,
  running,
  result,
  onRun
}: {
  label: string;
  overrides: LaneOverrides;
  registryModels: RegistryModel[];
  onOverridesChange: (o: LaneOverrides) => void;
  running: boolean;
  result: SimResult | null;
  onRun: () => void;
}): React.JSX.Element {
  const totalMs = result?.steps?.reduce((sum, s) => sum + s.latency_ms, 0) ?? 0;
  const generateStep = result?.steps?.find((s) => s.name === "generate_recipe");
  const qualityScore = generateStep?.result?.["quality_score"] as number | undefined;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Badge variant="outline" className="font-mono text-xs">{label}</Badge>
        <Button size="sm" variant="outline" onClick={onRun} disabled={running} className="h-7 gap-1.5 text-xs">
          <Play className="h-3 w-3" />
          {running ? "Running…" : `Run ${label}`}
        </Button>
      </div>

      <OverridePanel overrides={overrides} registryModels={registryModels} onChange={onOverridesChange} />

      {!result && !running && (
        <div className="rounded-md border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
          Click &ldquo;Run {label}&rdquo; to start
        </div>
      )}

      {running && (
        <div className="rounded-md border px-4 py-6 text-center text-xs text-muted-foreground animate-pulse">
          Executing simulation…
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {result.ok ? (
              <CheckCircle2 className="h-4 w-4 flex-none text-emerald-500" />
            ) : (
              <XCircle className="h-4 w-4 flex-none text-red-500" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium">
                {result.ok ? "Passed" : "Failed"}
              </p>
              <p className="truncate font-mono text-[10px] text-muted-foreground">
                {result.request_id}
                {totalMs > 0 && <span className="ml-2">{totalMs.toLocaleString()}ms total</span>}
              </p>
            </div>
            {qualityScore !== undefined && (
              <Badge
                variant="outline"
                className={cn(
                  "text-xs",
                  qualityScore >= 80
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                    : qualityScore >= 60
                      ? "border-amber-300 bg-amber-50 text-amber-700"
                      : "border-red-300 bg-red-50 text-red-700"
                )}
              >
                Q{qualityScore}%
              </Badge>
            )}
            <Badge
              variant="outline"
              className={result.ok ? "border-emerald-300 bg-emerald-50 text-emerald-700 text-xs" : "border-red-300 bg-red-50 text-red-700 text-xs"}
            >
              {result.steps?.length ?? 0} steps
            </Badge>
          </div>

          {result.error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {result.error}
            </div>
          )}

          {result.steps && result.steps.length > 0 && (
            <StepList steps={result.steps} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Comparison Table ──────────────────────────────────────────────────────────

function ComparisonTable({ a, b }: { a: SimResult; b: SimResult }): React.JSX.Element {
  const stepNames = Array.from(
    new Set([...(a.steps ?? []).map((s) => s.name), ...(b.steps ?? []).map((s) => s.name)])
  );
  const aByName = new Map((a.steps ?? []).map((s) => [s.name, s]));
  const bByName = new Map((b.steps ?? []).map((s) => [s.name, s]));

  const totalA = (a.steps ?? []).reduce((s, r) => s + r.latency_ms, 0);
  const totalB = (b.steps ?? []).reduce((s, r) => s + r.latency_ms, 0);
  const totalDelta = totalB - totalA;

  const generateA = aByName.get("generate_recipe");
  const generateB = bByName.get("generate_recipe");
  const qualityA = generateA?.result?.["quality_score"] as number | undefined;
  const qualityB = generateB?.result?.["quality_score"] as number | undefined;

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">A / B Comparison</p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-zinc-50">
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Step</th>
              <th className="px-3 py-2 text-center font-medium text-muted-foreground">Run A</th>
              <th className="px-3 py-2 text-center font-medium text-muted-foreground">Run B</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Δ Latency</th>
            </tr>
          </thead>
          <tbody>
            {stepNames.map((name) => {
              const stepA = aByName.get(name);
              const stepB = bByName.get(name);
              const delta = stepA && stepB ? stepB.latency_ms - stepA.latency_ms : null;

              return (
                <tr key={name} className="border-b last:border-0">
                  <td className="px-3 py-1.5 font-mono font-medium">{name}</td>
                  <td className="px-3 py-1.5 text-center">
                    {stepA ? (
                      <span className={cn("font-mono", stepA.status === "ok" ? "text-emerald-700" : "text-red-700")}>
                        {stepA.status === "ok" ? "✓" : "✗"} {stepA.latency_ms.toLocaleString()}ms
                      </span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {stepB ? (
                      <span className={cn("font-mono", stepB.status === "ok" ? "text-emerald-700" : "text-red-700")}>
                        {stepB.status === "ok" ? "✓" : "✗"} {stepB.latency_ms.toLocaleString()}ms
                      </span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">
                    {delta !== null ? (
                      <span className={delta < 0 ? "text-emerald-600" : delta > 0 ? "text-red-600" : "text-muted-foreground"}>
                        {delta > 0 ? "+" : ""}{delta.toLocaleString()}ms
                      </span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t bg-zinc-50 font-semibold">
              <td className="px-3 py-1.5">Total latency</td>
              <td className="px-3 py-1.5 text-center font-mono">{totalA.toLocaleString()}ms</td>
              <td className="px-3 py-1.5 text-center font-mono">{totalB.toLocaleString()}ms</td>
              <td className="px-3 py-1.5 text-right font-mono">
                <span className={totalDelta < 0 ? "text-emerald-600" : totalDelta > 0 ? "text-red-600" : "text-muted-foreground"}>
                  {totalDelta > 0 ? "+" : ""}{totalDelta.toLocaleString()}ms
                </span>
              </td>
            </tr>
            {(qualityA !== undefined || qualityB !== undefined) && (
              <tr className="border-t bg-zinc-50 font-semibold">
                <td className="px-3 py-1.5">Quality score</td>
                <td className="px-3 py-1.5 text-center">
                  {qualityA !== undefined ? (
                    <span className={qualityA >= 80 ? "text-emerald-600" : qualityA >= 60 ? "text-amber-600" : "text-red-600"}>
                      {qualityA}%
                    </span>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-3 py-1.5 text-center">
                  {qualityB !== undefined ? (
                    <span className={qualityB >= 80 ? "text-emerald-600" : qualityB >= 60 ? "text-amber-600" : "text-red-600"}>
                      {qualityB}%
                    </span>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-3 py-1.5 text-right font-mono">
                  {qualityA !== undefined && qualityB !== undefined ? (
                    <span className={qualityB > qualityA ? "text-emerald-600" : qualityB < qualityA ? "text-red-600" : "text-muted-foreground"}>
                      {qualityB > qualityA ? "+" : ""}{qualityB - qualityA}%
                    </span>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
              </tr>
            )}
            {(generateA?.result || generateB?.result) && (
              <tr className="border-t bg-zinc-50 text-[11px] text-muted-foreground">
                <td className="px-3 py-1.5">Recipe (ingredients · steps)</td>
                <td className="px-3 py-1.5 text-center font-mono">
                  {generateA?.result
                    ? `${generateA.result["ingredient_count"] ?? "?"} · ${generateA.result["step_count"] ?? "?"}`
                    : "—"}
                </td>
                <td className="px-3 py-1.5 text-center font-mono">
                  {generateB?.result
                    ? `${generateB.result["ingredient_count"] ?? "?"} · ${generateB.result["step_count"] ?? "?"}`
                    : "—"}
                </td>
                <td />
              </tr>
            )}
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

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

  const run = async (variant: "A" | "B"): Promise<void> => {
    const setRunning = variant === "A" ? setRunningA : setRunningB;
    const setResult = variant === "A" ? setResultA : setResultB;
    const overrides = variant === "A" ? overridesA : overridesB;

    setRunning(true);
    setResult(null);

    const response = await fetch("/api/admin/simulations/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scenario: "default_api_ux",
        model_overrides: buildOverridePayload(overrides)
      })
    });

    const payload = (await response.json().catch(() => null)) as SimResult | null;
    setRunning(false);

    if (!response.ok || !payload) {
      toast.error(payload?.error ?? "Simulation failed");
      setResult(payload ?? null);
      return;
    }

    if (!payload.ok) {
      toast.error(payload.error ?? "Simulation failed");
      setResult(payload);
      return;
    }

    toast.success(`Run ${variant} complete · ${payload.request_id}`);
    setResult(payload);
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base">API UX Simulation — A/B Comparison</CardTitle>
        <CardDescription>
          Run two independent passes against live{" "}
          <code className="rounded bg-muted px-1 text-xs">/v1</code>.
          Override model per scope to benchmark latency and quality — or leave blank to use active DB routes.
        </CardDescription>
      </CardHeader>

      <Separator />

      <CardContent className="pt-4 space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          <RunLane
            label="A"
            overrides={overridesA}
            registryModels={registryModels}
            onOverridesChange={setOverridesA}
            running={runningA}
            result={resultA}
            onRun={() => void run("A")}
          />
          <RunLane
            label="B"
            overrides={overridesB}
            registryModels={registryModels}
            onOverridesChange={setOverridesB}
            running={runningB}
            result={resultB}
            onRun={() => void run("B")}
          />
        </div>

        {resultA && resultB && (
          <>
            <Separator />
            <ComparisonTable a={resultA} b={resultB} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
