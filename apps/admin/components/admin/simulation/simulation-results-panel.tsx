"use client";

import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CandidateSnapshot, SimResult, SimStep, SimTraceEvent } from "./types";
import {
  candidateSnapshotsEqual,
  formatSeconds,
  formatTime,
  getCandidateFromStep,
  getPromptFromStep,
  getStepTimingFromStep,
  getTokenUsageFromStep,
} from "./types";

// ---------------------------------------------------------------------------
// CandidateSnapshotPanel — renders a single candidate recipe snapshot
// with component-level ingredient and step breakdowns.
// ---------------------------------------------------------------------------

export function CandidateSnapshotPanel({
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
            <div key={`${component.component_id || component.title}-${index}`} className="rounded border bg-zinc-50 p-2">
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

// ---------------------------------------------------------------------------
// RecipeQualityPanel — shows generation/tweak prompts and candidate snapshots
// for a single simulation run.
// ---------------------------------------------------------------------------

export function RecipeQualityPanel({ result }: { result: SimResult | null }): React.JSX.Element {
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

// ---------------------------------------------------------------------------
// StepList — real-time step timeline with status icons, token counts,
// and per-step timing breakdown (LLM / server / API / usage-query).
// ---------------------------------------------------------------------------

export function StepList({ steps }: { steps: SimStep[] }): React.JSX.Element {
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
              "flex flex-wrap items-center gap-2 rounded border px-2.5 py-1.5 text-xs",
              step.status === "ok"
                ? "border-emerald-200 bg-emerald-50"
                : step.status === "failed"
                  ? "border-red-200 bg-red-50"
                  : "border-amber-200 bg-amber-50"
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

            {step.error && <span className="w-full truncate text-red-600 sm:max-w-[180px]">{step.error}</span>}

            <span className="flex-none font-mono text-muted-foreground">
              {hasLlmTokens ? `${tokenTotal.toLocaleString()} tok` : "— tok"}
            </span>
            {timing && (timing.llm_ms > 0 || timing.api_ms > 0 || timing.usage_query_ms > 0 || timing.server_ms > 0) && (
              <span className="flex-none font-mono text-[10px] text-muted-foreground">
                llm {formatSeconds(timing.llm_ms)} · srv {formatSeconds(timing.server_ms)} · api{" "}
                {formatSeconds(timing.api_ms)} · uq {formatSeconds(timing.usage_query_ms)}
              </span>
            )}
            <span className="flex-none font-mono text-muted-foreground">
              {step.status === "running" ? "..." : formatSeconds(step.latency_ms)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TraceTimeline — scrollable raw trace event log with JSON payloads.
// ---------------------------------------------------------------------------

export function TraceTimeline({ trace }: { trace: SimTraceEvent[] }): React.JSX.Element {
  if (trace.length === 0) {
    return (
      <div className="rounded border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
        Trace will stream here in real time.
      </div>
    );
  }

  return (
    <div className="max-h-80 space-y-2 overflow-y-auto rounded border bg-zinc-50 p-2">
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
              <span className="font-mono text-[10px] text-muted-foreground">{formatSeconds(event.latency_ms)}</span>
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
