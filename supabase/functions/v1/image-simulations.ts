import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  getImageSimulationScenarioById,
  type ImageSimulationScenario,
} from "../../../packages/shared/src/image-simulation-catalog.ts";
import { ApiError } from "../_shared/errors.ts";
import { llmGateway } from "../_shared/llm-gateway.ts";
import type { JsonValue, RecipePayload } from "../_shared/types.ts";

const IMAGE_SIMULATION_MODEL_CONFIG_OVERRIDE: Record<string, JsonValue> = {
  size: "1024x1024",
  quality: "medium",
};

export type ImageSimulationModelOverride = {
  provider: string;
  model: string;
};

export type ImageSimulationCompareRequest = {
  scenario_id: string;
  lane_a_override?: ImageSimulationModelOverride;
  lane_b_override?: ImageSimulationModelOverride;
};

export type ImageSimulationLaneResult = {
  status: "ok" | "failed";
  provider: string | null;
  model: string | null;
  image_url: string | null;
  latency_ms: number | null;
  cost_usd: number | null;
  error: string | null;
};

export type ImageSimulationJudgeResult = {
  status: "ok" | "skipped" | "failed";
  provider: string | null;
  model: string | null;
  latency_ms: number | null;
  winner: "A" | "B" | "tie" | null;
  rationale: string | null;
  confidence: number | null;
  error: string | null;
};

export type ImageSimulationCompareResponse = {
  request_id: string;
  scenario: ImageSimulationScenario;
  lane_a: ImageSimulationLaneResult;
  lane_b: ImageSimulationLaneResult;
  judge: ImageSimulationJudgeResult;
  completed: boolean;
};

export type ImageSimulationCompareStreamEvent =
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

const normalizeModelOverride = (
  value: ImageSimulationModelOverride | undefined,
): ImageSimulationModelOverride | undefined => {
  if (!value) {
    return undefined;
  }

  const provider = value.provider.trim();
  const model = value.model.trim();
  if (!provider || !model) {
    throw new ApiError(
      400,
      "invalid_image_simulation_override",
      "Model overrides require both provider and model",
    );
  }

  return { provider, model };
};

export const buildImageSimulationRecipe = (
  scenario: ImageSimulationScenario,
): RecipePayload => {
  const ingredients = scenario.hero_ingredients.map((name, index) => ({
    name,
    amount: index === 0 ? 1 : 2,
    unit: "item",
    category: index === 0 ? "hero" : "supporting",
  }));

  return {
    title: scenario.title,
    description: scenario.description,
    servings: 4,
    ingredients,
    steps: [
      {
        index: 1,
        instruction:
          `Prepare the dish components so the finished ${scenario.title.toLowerCase()} looks cohesive, vivid, and realistic.`,
        notes:
          `Prioritize appetizing texture for ${scenario.hero_ingredients.join(", ")} and avoid cluttered plating.`,
      },
      {
        index: 2,
        instruction:
          "Plate one finished serving with restaurant-level presentation and natural garnish placement.",
        notes: scenario.visual_brief,
      },
    ],
    notes: scenario.visual_brief,
    metadata: {
      vibe: "editorial_food_photography",
      occasion_tags: ["image_simulation"],
      serving_notes: [scenario.visual_brief],
    },
  };
};

export const buildImageSimulationContext = (
  scenario: ImageSimulationScenario,
): Record<string, JsonValue> => {
  return {
    image_simulation: {
      scenario_id: scenario.id,
      title: scenario.title,
      description: scenario.description,
      hero_ingredients: scenario.hero_ingredients,
      visual_brief: scenario.visual_brief,
    },
    comparison_goal: "quality_speed_cost",
  };
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof ApiError) {
    return error.code;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const runLane = async (params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  recipe: RecipePayload;
  context: Record<string, JsonValue>;
  lane: "A" | "B";
  override?: ImageSimulationModelOverride;
  scenario: ImageSimulationScenario;
}): Promise<ImageSimulationLaneResult> => {
  try {
    const result = await llmGateway.generateRecipeImageDetailed({
      client: params.client,
      userId: params.userId,
      requestId: params.requestId,
      recipe: params.recipe,
      context: params.context,
      modelOverride: params.override,
      modelConfigOverride: IMAGE_SIMULATION_MODEL_CONFIG_OVERRIDE,
      eventPayload: {
        simulation_type: "image",
        simulation_lane: params.lane,
        scenario_id: params.scenario.id,
      },
    });

    return {
      status: "ok",
      provider: result.provider,
      model: result.model,
      image_url: result.imageUrl,
      latency_ms: result.latencyMs,
      cost_usd: result.costUsd,
      error: null,
    };
  } catch (error) {
    return {
      status: "failed",
      provider: params.override?.provider ?? null,
      model: params.override?.model ?? null,
      image_url: null,
      latency_ms: null,
      cost_usd: null,
      error: toErrorMessage(error),
    };
  }
};

const resolveCompareInputs = (body: ImageSimulationCompareRequest): {
  scenario: ImageSimulationScenario;
  laneAOverride: ImageSimulationModelOverride | undefined;
  laneBOverride: ImageSimulationModelOverride | undefined;
  recipe: RecipePayload;
  context: Record<string, JsonValue>;
} => {
  const scenarioId = typeof body.scenario_id === "string"
    ? body.scenario_id.trim()
    : "";
  if (!scenarioId) {
    throw new ApiError(
      400,
      "image_simulation_scenario_required",
      "scenario_id is required",
    );
  }

  const scenario = getImageSimulationScenarioById(scenarioId);
  if (!scenario) {
    throw new ApiError(
      404,
      "image_simulation_scenario_not_found",
      `Unknown image simulation scenario: ${scenarioId}`,
    );
  }

  const laneAOverride = normalizeModelOverride(body.lane_a_override);
  const laneBOverride = normalizeModelOverride(body.lane_b_override);
  const recipe = buildImageSimulationRecipe(scenario);
  const context = buildImageSimulationContext(scenario);

  return {
    scenario,
    laneAOverride,
    laneBOverride,
    recipe,
    context,
  };
};

const runJudge = async (params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  scenario: ImageSimulationScenario;
  laneA: ImageSimulationLaneResult;
  laneB: ImageSimulationLaneResult;
}): Promise<ImageSimulationJudgeResult> => {
  const completed = params.laneA.status === "ok" &&
    params.laneB.status === "ok" &&
    !!params.laneA.image_url &&
    !!params.laneB.image_url;

  if (!completed) {
    return {
      status: "skipped",
      provider: null,
      model: null,
      latency_ms: null,
      winner: null,
      rationale: null,
      confidence: null,
      error: "judge_skipped_due_to_lane_failure",
    };
  }

  try {
    const result = await llmGateway.evaluateImageQualityPair({
      client: params.client,
      userId: params.userId,
      requestId: params.requestId,
      scenario: {
        id: params.scenario.id,
        title: params.scenario.title,
        description: params.scenario.description,
        heroIngredients: [...params.scenario.hero_ingredients],
        visualBrief: params.scenario.visual_brief,
      },
      laneA: {
        imageUrl: params.laneA.image_url ?? "",
        provider: params.laneA.provider ?? "unknown",
        model: params.laneA.model ?? "unknown",
      },
      laneB: {
        imageUrl: params.laneB.image_url ?? "",
        provider: params.laneB.provider ?? "unknown",
        model: params.laneB.model ?? "unknown",
      },
    });

    return {
      status: "ok",
      provider: result.provider,
      model: result.model,
      latency_ms: result.latencyMs,
      winner: result.winner,
      rationale: result.rationale,
      confidence: result.confidence,
      error: null,
    };
  } catch (error) {
    return {
      status: "failed",
      provider: null,
      model: null,
      latency_ms: null,
      winner: null,
      rationale: null,
      confidence: null,
      error: toErrorMessage(error),
    };
  }
};

export const runImageSimulationCompare = async (params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  body: ImageSimulationCompareRequest;
}): Promise<ImageSimulationCompareResponse> => {
  const {
    scenario,
    laneAOverride,
    laneBOverride,
    recipe,
    context,
  } = resolveCompareInputs(params.body);

  const [laneA, laneB] = await Promise.all([
    runLane({
      client: params.client,
      userId: params.userId,
      requestId: params.requestId,
      recipe,
      context,
      lane: "A",
      override: laneAOverride,
      scenario,
    }),
    runLane({
      client: params.client,
      userId: params.userId,
      requestId: params.requestId,
      recipe,
      context,
      lane: "B",
      override: laneBOverride,
      scenario,
    }),
  ]);

  const judge = await runJudge({
    client: params.client,
    userId: params.userId,
    requestId: params.requestId,
    scenario,
    laneA,
    laneB,
  });
  const completed = laneA.status === "ok" && laneB.status === "ok";

  return {
    request_id: params.requestId,
    scenario,
    lane_a: laneA,
    lane_b: laneB,
    judge,
    completed,
  };
};

export const streamImageSimulationCompare = (params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  body: ImageSimulationCompareRequest;
}): Response => {
  const {
    scenario,
    laneAOverride,
    laneBOverride,
    recipe,
    context,
  } = resolveCompareInputs(params.body);

  const encoder = new TextEncoder();
  const streamPair = new TransformStream<Uint8Array, Uint8Array>();
  const writer = streamPair.writable.getWriter();
  let writeQueue = Promise.resolve();

  const writeEvent = (event: ImageSimulationCompareStreamEvent): Promise<void> => {
    const line = `${JSON.stringify(event)}\n`;
    writeQueue = writeQueue.then(() => writer.write(encoder.encode(line)));
    return writeQueue;
  };

  void (async () => {
    try {
      await writeEvent({
        type: "compare_started",
        request_id: params.requestId,
        scenario,
        lane_a: {
          provider: laneAOverride?.provider ?? null,
          model: laneAOverride?.model ?? null,
        },
        lane_b: {
          provider: laneBOverride?.provider ?? null,
          model: laneBOverride?.model ?? null,
        },
        at: new Date().toISOString(),
      });

      const laneAPromise = runLane({
        client: params.client,
        userId: params.userId,
        requestId: params.requestId,
        recipe,
        context,
        lane: "A",
        override: laneAOverride,
        scenario,
      }).then(async (result) => {
        await writeEvent({
          type: "lane_completed",
          request_id: params.requestId,
          lane: "A",
          result,
          at: new Date().toISOString(),
        });
        return result;
      });

      const laneBPromise = runLane({
        client: params.client,
        userId: params.userId,
        requestId: params.requestId,
        recipe,
        context,
        lane: "B",
        override: laneBOverride,
        scenario,
      }).then(async (result) => {
        await writeEvent({
          type: "lane_completed",
          request_id: params.requestId,
          lane: "B",
          result,
          at: new Date().toISOString(),
        });
        return result;
      });

      const [laneA, laneB] = await Promise.all([laneAPromise, laneBPromise]);
      const judge = await runJudge({
        client: params.client,
        userId: params.userId,
        requestId: params.requestId,
        scenario,
        laneA,
        laneB,
      });

      await writeEvent({
        type: "judge_completed",
        request_id: params.requestId,
        result: judge,
        at: new Date().toISOString(),
      });

      await writeEvent({
        type: "result",
        payload: {
          request_id: params.requestId,
          scenario,
          lane_a: laneA,
          lane_b: laneB,
          judge,
          completed: laneA.status === "ok" && laneB.status === "ok",
        },
      });
    } finally {
      await writeQueue;
      await writer.close();
    }
  })();

  return new Response(streamPair.readable, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
};
