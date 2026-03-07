"use client";

import { useEffect, useState } from "react";
import { Loader2, Scale, Timer, Trophy } from "lucide-react";
import { toast } from "sonner";
import type { ImageSimulationScenario } from "@alchemy/shared/image-simulation-catalog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { formatCost, formatMs } from "@/lib/format";

export type ImageSimulationRegistryModel = {
  id: string;
  provider: string;
  model: string;
  display_name: string;
  billing_mode: "token" | "image";
};

type ImageSimulationLaneStatus = "pending" | "ok" | "failed";

type ImageSimulationLaneResult = {
  status: ImageSimulationLaneStatus;
  provider: string | null;
  model: string | null;
  image_url: string | null;
  latency_ms: number | null;
  cost_usd: number | null;
  error: string | null;
};

type ImageSimulationJudgeStatus = "pending" | "ok" | "skipped" | "failed";

type ImageSimulationJudgeResult = {
  status: ImageSimulationJudgeStatus;
  provider: string | null;
  model: string | null;
  latency_ms: number | null;
  winner: "A" | "B" | "tie" | null;
  rationale: string | null;
  confidence: number | null;
  error: string | null;
};

type ImageSimulationCompareResponse = {
  request_id: string;
  scenario: ImageSimulationScenario;
  lane_a: ImageSimulationLaneResult;
  lane_b: ImageSimulationLaneResult;
  judge: ImageSimulationJudgeResult;
  completed: boolean;
};

type ImageSimulationCompareStreamEvent =
  | {
    type: "compare_started";
    request_id: string;
    scenario: ImageSimulationScenario;
    lane_a: { provider: string | null; model: string | null };
    lane_b: { provider: string | null; model: string | null };
    at: string;
  }
  | {
    type: "lane_completed";
    request_id: string;
    lane: "A" | "B";
    result: ImageSimulationLaneResult;
    at: string;
  }
  | {
    type: "judge_completed";
    request_id: string;
    result: ImageSimulationJudgeResult;
    at: string;
  }
  | {
    type: "result";
    payload: ImageSimulationCompareResponse;
  };

type ManualPick = "A" | "B" | "tie" | null;

const modelValue = (model: { provider: string; model: string }): string =>
  `${model.provider}::${model.model}`;

const formatLatency = (value: number | null): string => formatMs(value);

const extractModel = (
  models: ImageSimulationRegistryModel[],
  value: string,
): ImageSimulationRegistryModel | null => {
  return models.find((model) => modelValue(model) === value) ?? null;
};

const buildPendingLane = (model: ImageSimulationRegistryModel | null): ImageSimulationLaneResult => ({
  status: "pending",
  provider: model?.provider ?? null,
  model: model?.model ?? null,
  image_url: null,
  latency_ms: null,
  cost_usd: null,
  error: null,
});

const buildPendingResult = (
  scenario: ImageSimulationScenario,
  laneAModel: ImageSimulationRegistryModel | null,
  laneBModel: ImageSimulationRegistryModel | null,
): ImageSimulationCompareResponse => ({
  request_id: "",
  scenario,
  lane_a: buildPendingLane(laneAModel),
  lane_b: buildPendingLane(laneBModel),
  judge: {
    status: "pending",
    provider: null,
    model: null,
    latency_ms: null,
    winner: null,
    rationale: null,
    confidence: null,
    error: null,
  },
  completed: false,
});

const applyCompareStreamEvent = (
  current: ImageSimulationCompareResponse,
  event: ImageSimulationCompareStreamEvent,
): ImageSimulationCompareResponse => {
  switch (event.type) {
    case "compare_started":
      return {
        ...current,
        request_id: event.request_id,
        scenario: event.scenario,
        lane_a: {
          ...current.lane_a,
          provider: event.lane_a.provider,
          model: event.lane_a.model,
        },
        lane_b: {
          ...current.lane_b,
          provider: event.lane_b.provider,
          model: event.lane_b.model,
        },
      };
    case "lane_completed":
      return event.lane === "A"
        ? { ...current, lane_a: event.result }
        : { ...current, lane_b: event.result };
    case "judge_completed":
      return {
        ...current,
        judge: event.result,
      };
    case "result":
      return event.payload;
    default:
      return current;
  }
};

export type ImageSimulationRunnerCardProps = {
  scenarios: readonly ImageSimulationScenario[];
  registryModels: ImageSimulationRegistryModel[];
  activeImageRoute: { provider: string; model: string } | null;
  activeJudgeRoute: { provider: string; model: string } | null;
};

export function ImageSimulationRunnerCard(props: ImageSimulationRunnerCardProps): React.JSX.Element {
  const initialScenarioId = props.scenarios[0]?.id ?? "";
  const activeModelValue = props.activeImageRoute
    ? modelValue(props.activeImageRoute)
    : (props.registryModels[0] ? modelValue(props.registryModels[0]) : "");
  const fallbackBModel = props.registryModels.find((model) => modelValue(model) !== activeModelValue) ?? props.registryModels[0] ?? null;

  const [selectedScenarioId, setSelectedScenarioId] = useState(initialScenarioId);
  const [laneAValue, setLaneAValue] = useState(activeModelValue);
  const [laneBValue, setLaneBValue] = useState(fallbackBModel ? modelValue(fallbackBModel) : activeModelValue);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ImageSimulationCompareResponse | null>(null);
  const [manualPick, setManualPick] = useState<ManualPick>(null);

  useEffect(() => {
    if (!laneAValue && activeModelValue) {
      setLaneAValue(activeModelValue);
    }
    if (!laneBValue && fallbackBModel) {
      setLaneBValue(modelValue(fallbackBModel));
    }
  }, [activeModelValue, fallbackBModel, laneAValue, laneBValue]);

  const scenario = props.scenarios.find((item) => item.id === selectedScenarioId) ?? props.scenarios[0] ?? null;

  const runCompare = async (): Promise<void> => {
    const laneAModel = extractModel(props.registryModels, laneAValue);
    const laneBModel = extractModel(props.registryModels, laneBValue);
    if (!scenario || !laneAModel || !laneBModel) {
      toast.error("Select a scenario and two image models");
      return;
    }

    setRunning(true);
    setManualPick(null);
    setResult(buildPendingResult(scenario, laneAModel, laneBModel));
    try {
      const response = await fetch("/api/admin/simulation-image/compare?stream=1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenario_id: scenario.id,
          lane_a_override: { provider: laneAModel.provider, model: laneAModel.model },
          lane_b_override: { provider: laneBModel.provider, model: laneBModel.model },
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Compare request failed");
      }

      if (!response.body) {
        throw new Error("Streaming response body missing");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalPayload: ImageSimulationCompareResponse | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }
          const event = JSON.parse(trimmed) as ImageSimulationCompareStreamEvent;
          if (event.type === "result") {
            finalPayload = event.payload;
          }
          setResult((current) => {
            return applyCompareStreamEvent(
              current ?? buildPendingResult(scenario, laneAModel, laneBModel),
              event,
            );
          });
        }
      }

      const trailing = buffer.trim();
      if (trailing) {
        const event = JSON.parse(trailing) as ImageSimulationCompareStreamEvent;
        if (event.type === "result") {
          finalPayload = event.payload;
        }
        setResult((current) => {
          return applyCompareStreamEvent(
            current ?? buildPendingResult(scenario, laneAModel, laneBModel),
            event,
          );
        });
      }

      if (!finalPayload) {
        throw new Error("Image simulation stream ended before final result");
      }

      toast.success(finalPayload.completed ? "Image simulation completed" : "Image simulation finished with lane failures");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Image simulation failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Scale className="h-4 w-4 text-muted-foreground" />
          Image Simulation Compare
        </CardTitle>
        <CardDescription>
          Pick a pre-made recipe title scenario and compare two image models for quality, speed, and estimated cost.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr_1fr_auto]">
          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Scenario</p>
            <Select value={selectedScenarioId} onValueChange={setSelectedScenarioId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select scenario" />
              </SelectTrigger>
              <SelectContent>
                {props.scenarios.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {scenario ? (
              <div className="rounded-md border bg-zinc-50 p-3 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">{scenario.title}</p>
                <p className="mt-1">{scenario.description}</p>
                <p className="mt-2 text-xs">
                  Hero ingredients: {scenario.hero_ingredients.join(", ")}
                </p>
              </div>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Lane A</p>
            <Select value={laneAValue} onValueChange={setLaneAValue}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Choose model" />
              </SelectTrigger>
              <SelectContent>
                {props.registryModels.map((model) => (
                  <SelectItem key={modelValue(model)} value={modelValue(model)}>
                    {model.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Lane B</p>
            <Select value={laneBValue} onValueChange={setLaneBValue}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Choose model" />
              </SelectTrigger>
              <SelectContent>
                {props.registryModels.map((model) => (
                  <SelectItem key={modelValue(model)} value={modelValue(model)}>
                    {model.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button className="w-full gap-2 xl:w-auto" disabled={running} onClick={() => void runCompare()}>
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scale className="h-4 w-4" />}
              {running ? "Comparing" : "Run Compare"}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">2 lanes</Badge>
          <Badge variant="outline">Server-side judge</Badge>
          {props.activeJudgeRoute ? (
            <Badge variant="secondary">
              Judge: {props.activeJudgeRoute.provider}/{props.activeJudgeRoute.model}
            </Badge>
          ) : null}
        </div>

        {result ? (
          <>
            <Separator />
            <div className="grid gap-4 xl:grid-cols-2">
              <LaneResultCard label="A" lane={result.lane_a} />
              <LaneResultCard label="B" lane={result.lane_b} />
            </div>

            <Card className="border-dashed">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Trophy className="h-4 w-4 text-muted-foreground" />
                  Pairwise AI Judge
                </CardTitle>
                <CardDescription>
                  Visual quality only. Speed and cost stay in the lane metrics.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={result.judge.status === "ok" ? "default" : result.judge.status === "failed" ? "destructive" : "outline"}>
                    {result.judge.status === "pending" ? "waiting" : result.judge.status}
                  </Badge>
                  {result.judge.winner ? (
                    <Badge variant="secondary">Winner: {result.judge.winner}</Badge>
                  ) : null}
                  {result.judge.latency_ms !== null ? (
                    <Badge variant="outline">Judge latency: {formatLatency(result.judge.latency_ms)}</Badge>
                  ) : null}
                  {result.judge.confidence !== null ? (
                    <Badge variant="outline">Confidence: {(result.judge.confidence * 100).toFixed(0)}%</Badge>
                  ) : null}
                </div>
                <p className="text-sm text-muted-foreground">
                  {result.judge.status === "pending"
                    ? "Waiting for both lanes to finish before judging."
                    : result.judge.rationale ?? result.judge.error ?? "Judge unavailable for this run."}
                </p>
              </CardContent>
            </Card>

            <Card className="border-dashed">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Manual Review</CardTitle>
                <CardDescription>
                  In-session only. This does not persist anywhere.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2 pt-0">
                {(["A", "B", "tie"] as const).map((value) => (
                  <Button
                    key={value}
                    type="button"
                    variant={manualPick === value ? "default" : "outline"}
                    size="sm"
                    onClick={() => setManualPick(value)}
                  >
                    {value === "tie" ? "Tie" : `Pick ${value}`}
                  </Button>
                ))}
              </CardContent>
            </Card>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function LaneResultCard({
  label,
  lane,
}: {
  label: "A" | "B";
  lane: ImageSimulationLaneResult;
}): React.JSX.Element {
  return (
    <Card className={lane.status === "failed" ? "border-red-200" : undefined}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm">Lane {label}</CardTitle>
            <CardDescription>
              {lane.provider && lane.model ? `${lane.provider}/${lane.model}` : "Model unavailable"}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={lane.status === "ok" ? "default" : lane.status === "failed" ? "destructive" : "outline"}>
              {lane.status === "pending" ? "rendering" : lane.status}
            </Badge>
            <Badge variant="outline">{formatLatency(lane.latency_ms)}</Badge>
            <Badge variant="outline">{formatCost(lane.cost_usd)}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {lane.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={lane.image_url}
            alt={`Lane ${label} simulation output`}
            className="aspect-[4/3] w-full rounded-lg border object-cover"
          />
        ) : (
          <div className="flex aspect-[4/3] items-center justify-center rounded-lg border border-dashed bg-zinc-50 text-sm text-muted-foreground">
            {lane.status === "pending" ? "Rendering image..." : lane.error ?? "No image generated"}
          </div>
        )}
        {lane.error ? (
          <p className="text-sm text-red-600">{lane.error}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
