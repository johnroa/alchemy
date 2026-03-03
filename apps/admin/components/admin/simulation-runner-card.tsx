"use client";

import { useState } from "react";
import { CheckCircle2, Play, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

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
          <span className="flex-none font-mono text-muted-foreground">{step.latency_ms.toLocaleString()}ms</span>
        </div>
      ))}
    </div>
  );
}

function RunLane({
  label,
  running,
  result,
  onRun
}: {
  label: string;
  running: boolean;
  result: SimResult | null;
  onRun: () => void;
}): React.JSX.Element {
  const totalMs = result?.steps?.reduce((sum, s) => sum + s.latency_ms, 0) ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Badge variant="outline" className="font-mono text-xs">
          {label}
        </Badge>
        <Button size="sm" variant="outline" onClick={onRun} disabled={running} className="h-7 gap-1.5 text-xs">
          <Play className="h-3 w-3" />
          {running ? "Running…" : `Run ${label}`}
        </Button>
      </div>

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

function ComparisonTable({ a, b }: { a: SimResult; b: SimResult }): React.JSX.Element {
  const stepNames = Array.from(
    new Set([...(a.steps ?? []).map((s) => s.name), ...(b.steps ?? []).map((s) => s.name)])
  );
  const aByName = new Map((a.steps ?? []).map((s) => [s.name, s]));
  const bByName = new Map((b.steps ?? []).map((s) => [s.name, s]));

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Step Comparison</p>
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
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {stepB ? (
                      <span className={cn("font-mono", stepB.status === "ok" ? "text-emerald-700" : "text-red-700")}>
                        {stepB.status === "ok" ? "✓" : "✗"} {stepB.latency_ms.toLocaleString()}ms
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">
                    {delta !== null ? (
                      <span className={delta < 0 ? "text-emerald-600" : delta > 0 ? "text-red-600" : "text-muted-foreground"}>
                        {delta > 0 ? "+" : ""}{delta.toLocaleString()}ms
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
            <tr className="border-t bg-zinc-50">
              <td className="px-3 py-1.5 font-medium">Total</td>
              <td className="px-3 py-1.5 text-center font-mono font-medium">
                {(a.steps ?? []).reduce((s, r) => s + r.latency_ms, 0).toLocaleString()}ms
              </td>
              <td className="px-3 py-1.5 text-center font-mono font-medium">
                {(b.steps ?? []).reduce((s, r) => s + r.latency_ms, 0).toLocaleString()}ms
              </td>
              <td className="px-3 py-1.5 text-right font-mono font-medium">
                {(() => {
                  const totalA = (a.steps ?? []).reduce((s, r) => s + r.latency_ms, 0);
                  const totalB = (b.steps ?? []).reduce((s, r) => s + r.latency_ms, 0);
                  const d = totalB - totalA;
                  return (
                    <span className={d < 0 ? "text-emerald-600" : d > 0 ? "text-red-600" : "text-muted-foreground"}>
                      {d > 0 ? "+" : ""}{d.toLocaleString()}ms
                    </span>
                  );
                })()}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

export function SimulationRunnerCard(): React.JSX.Element {
  const [runningA, setRunningA] = useState(false);
  const [runningB, setRunningB] = useState(false);
  const [resultA, setResultA] = useState<SimResult | null>(null);
  const [resultB, setResultB] = useState<SimResult | null>(null);

  const run = async (variant: "A" | "B"): Promise<void> => {
    const setRunning = variant === "A" ? setRunningA : setRunningB;
    const setResult = variant === "A" ? setResultA : setResultB;

    setRunning(true);
    setResult(null);

    const response = await fetch("/api/admin/simulations/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario: "default_api_ux" })
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
          <code className="rounded bg-muted px-1 text-xs">/v1</code> to compare step performance across
          model route changes. Change model routes between runs to measure impact.
        </CardDescription>
      </CardHeader>

      <Separator />

      <CardContent className="pt-4 space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          <RunLane label="A" running={runningA} result={resultA} onRun={() => void run("A")} />
          <RunLane label="B" running={runningB} result={resultB} onRun={() => void run("B")} />
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
