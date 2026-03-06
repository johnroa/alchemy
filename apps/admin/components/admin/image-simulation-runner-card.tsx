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

type RegistryModel = {
  id: string;
  provider: string;
  model: string;
  display_name: string;
  billing_mode: "token" | "image";
};

type ImageSimulationLaneResult = {
  status: "ok" | "failed";
  provider: string | null;
  model: string | null;
  image_url: string | null;
  latency_ms: number | null;
  cost_usd: number | null;
  error: string | null;
};

type ImageSimulationJudgeResult = {
  status: "ok" | "skipped" | "failed";
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

type ManualPick = "A" | "B" | "tie" | null;

const modelValue = (model: { provider: string; model: string }): string =>
  `${model.provider}::${model.model}`;

const formatLatency = (value: number | null): string =>
  value === null ? "n/a" : `${(value / 1000).toFixed(2)}s`;

const formatCost = (value: number | null): string =>
  value === null ? "n/a" : `$${value.toFixed(3)}`;

const extractModel = (
  models: RegistryModel[],
  value: string,
): RegistryModel | null => {
  return models.find((model) => modelValue(model) === value) ?? null;
};

export function ImageSimulationRunnerCard(props: {
  scenarios: readonly ImageSimulationScenario[];
  registryModels: RegistryModel[];
  activeImageRoute: { provider: string; model: string } | null;
  activeJudgeRoute: { provider: string; model: string } | null;
}): React.JSX.Element {
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
    try {
      const response = await fetch("/api/admin/simulation-image/compare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenario_id: scenario.id,
          lane_a_override: { provider: laneAModel.provider, model: laneAModel.model },
          lane_b_override: { provider: laneBModel.provider, model: laneBModel.model },
        }),
      });

      const payload = (await response.json().catch(() => null)) as ImageSimulationCompareResponse | { error?: string } | null;
      if (!response.ok || !payload || !("request_id" in payload)) {
        const message = payload && "error" in payload && payload.error ? payload.error : "Compare request failed";
        throw new Error(message);
      }

      setResult(payload);
      toast.success(payload.completed ? "Image simulation completed" : "Image simulation finished with lane failures");
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
                  <Badge variant={result.judge.status === "ok" ? "default" : "outline"}>
                    {result.judge.status}
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
                  {result.judge.rationale ?? result.judge.error ?? "Judge unavailable for this run."}
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
    <Card className={lane.status === "ok" ? undefined : "border-red-200"}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm">Lane {label}</CardTitle>
            <CardDescription>
              {lane.provider && lane.model ? `${lane.provider}/${lane.model}` : "Model unavailable"}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={lane.status === "ok" ? "default" : "destructive"}>{lane.status}</Badge>
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
            {lane.error ?? "No image generated"}
          </div>
        )}
        {lane.error ? (
          <p className="text-sm text-red-600">{lane.error}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
