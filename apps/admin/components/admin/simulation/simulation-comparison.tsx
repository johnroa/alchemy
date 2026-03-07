"use client";

import { useMemo } from "react";
import type { SimResult } from "./types";
import { formatSeconds, formatSignedSeconds, getRunTokenTotals, getTokenUsageFromStep } from "./types";

/**
 * Side-by-side A/B comparison table showing per-step latency and token
 * deltas between two simulation runs. Positive deltas (B slower/more
 * tokens than A) are red; negative deltas (B faster/fewer) are green.
 */
export function ComparisonTable({ a, b }: { a: SimResult; b: SimResult }): React.JSX.Element {
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
              <th className="px-3 py-2 text-center font-medium text-muted-foreground">Run A (s)</th>
              <th className="px-3 py-2 text-center font-medium text-muted-foreground">Run B (s)</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Δ (s)</th>
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
                    {stepA ? formatSeconds(stepA.latency_ms) : "-"}
                  </td>
                  <td className="px-3 py-1.5 text-center font-mono">
                    {stepB ? formatSeconds(stepB.latency_ms) : "-"}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">
                    {delta !== null ? (
                      <span className={delta < 0 ? "text-emerald-600" : delta > 0 ? "text-red-600" : "text-muted-foreground"}>
                        {formatSignedSeconds(delta)}
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
              <td className="px-3 py-1.5 text-center font-mono">{formatSeconds(totalA)}</td>
              <td className="px-3 py-1.5 text-center font-mono">{formatSeconds(totalB)}</td>
              <td className="px-3 py-1.5 text-right font-mono">
                <span className={totalDelta < 0 ? "text-emerald-600" : totalDelta > 0 ? "text-red-600" : "text-muted-foreground"}>
                  {formatSignedSeconds(totalDelta)}
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
