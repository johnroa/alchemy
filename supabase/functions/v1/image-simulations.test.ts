import { ApiError } from "../_shared/errors.ts";
import { llmGateway } from "../_shared/llm-gateway.ts";
import {
  buildImageSimulationContext,
  buildImageSimulationRecipe,
  runImageSimulationCompare,
} from "./image-simulations.ts";

Deno.test("buildImageSimulationRecipe produces a minimal plated recipe payload", () => {
  const recipe = buildImageSimulationRecipe({
    id: "test-dish",
    title: "Test Dish",
    description: "A bright plated dinner",
    hero_ingredients: ["salmon", "rice", "broccolini"],
    visual_brief: "Restaurant plating with soft daylight",
  });

  if (recipe.title !== "Test Dish") {
    throw new Error("expected recipe title");
  }
  if (recipe.steps.length !== 2) {
    throw new Error("expected two image simulation steps");
  }
});

Deno.test("buildImageSimulationContext preserves scenario metadata", () => {
  const context = buildImageSimulationContext({
    id: "test-dish",
    title: "Test Dish",
    description: "A bright plated dinner",
    hero_ingredients: ["salmon", "rice", "broccolini"],
    visual_brief: "Restaurant plating with soft daylight",
  });

  const simulation = context.image_simulation;
  if (!simulation || typeof simulation !== "object" || Array.isArray(simulation)) {
    throw new Error("expected image_simulation context");
  }
});

Deno.test("runImageSimulationCompare returns judge output when both lanes succeed", async () => {
  const originalGenerateDetailed = llmGateway.generateRecipeImageDetailed;
  const originalEvaluatePair = llmGateway.evaluateImageQualityPair;
  const seenOverrides: Array<Record<string, unknown> | undefined> = [];

  try {
    llmGateway.generateRecipeImageDetailed = ((params) => {
      seenOverrides.push(params.modelConfigOverride);
      const lane = String(params.eventPayload?.simulation_lane ?? "A");
      return Promise.resolve({
        imageUrl: `data:image/png;base64,${lane}`,
        provider: lane === "A" ? "openai" : "google",
        model: lane === "A" ? "gpt-image-1.5" : "gemini-2.5-flash-image",
        latencyMs: lane === "A" ? 1200 : 900,
        costUsd: lane === "A" ? 0.25 : 0.039,
        prompt: "prompt",
        config: {
          promptTemplate: "prompt",
          rule: {},
          provider: "openai",
          model: "gpt-image-1.5",
          modelConfig: {},
          inputCostPer1m: 5,
          outputCostPer1m: 0,
          billingMode: "image",
          billingMetadata: {
            pricing_type: "flat_image",
            cost_per_image_usd: 0.25,
          },
        },
      });
    }) as typeof llmGateway.generateRecipeImageDetailed;

    llmGateway.evaluateImageQualityPair = (() => {
      return Promise.resolve({
        winner: "B",
        rationale: "Cleaner plating and texture",
        confidence: 0.82,
        provider: "openai",
        model: "gpt-4.1-mini",
        latencyMs: 640,
      });
    }) as typeof llmGateway.evaluateImageQualityPair;

    const response = await runImageSimulationCompare({
      client: {} as never,
      userId: "user-1",
      requestId: "req-1",
      body: {
        scenario_id: "charred-miso-salmon-bowl",
      },
    });

    if (!response.completed) {
      throw new Error("expected completed compare response");
    }
    if (response.judge.status !== "ok" || response.judge.winner !== "B") {
      throw new Error("expected judge winner");
    }
    for (const override of seenOverrides) {
      if (!override || override.size !== "1024x1024" || override.quality !== "medium") {
        throw new Error("expected image simulation model config override");
      }
    }
  } finally {
    llmGateway.generateRecipeImageDetailed = originalGenerateDetailed;
    llmGateway.evaluateImageQualityPair = originalEvaluatePair;
  }
});

Deno.test("runImageSimulationCompare skips judge when one lane fails", async () => {
  const originalGenerateDetailed = llmGateway.generateRecipeImageDetailed;
  const originalEvaluatePair = llmGateway.evaluateImageQualityPair;
  let judgeCalled = false;

  try {
    llmGateway.generateRecipeImageDetailed = ((params) => {
      const lane = String(params.eventPayload?.simulation_lane ?? "A");
      if (lane === "B") {
        return Promise.reject(
          new ApiError(500, "image_billing_mode_invalid", "bad billing"),
        );
      }

      return Promise.resolve({
        imageUrl: "data:image/png;base64,A",
        provider: "openai",
        model: "gpt-image-1.5",
        latencyMs: 1100,
        costUsd: 0.25,
        prompt: "prompt",
        config: {
          promptTemplate: "prompt",
          rule: {},
          provider: "openai",
          model: "gpt-image-1.5",
          modelConfig: {},
          inputCostPer1m: 5,
          outputCostPer1m: 0,
          billingMode: "image",
          billingMetadata: {
            pricing_type: "flat_image",
            cost_per_image_usd: 0.25,
          },
        },
      });
    }) as typeof llmGateway.generateRecipeImageDetailed;

    llmGateway.evaluateImageQualityPair = (() => {
      judgeCalled = true;
      return Promise.resolve({
        winner: "A",
        rationale: "Unused",
        confidence: 1,
        provider: "openai",
        model: "gpt-4.1-mini",
        latencyMs: 1,
      });
    }) as typeof llmGateway.evaluateImageQualityPair;

    const response = await runImageSimulationCompare({
      client: {} as never,
      userId: "user-1",
      requestId: "req-2",
      body: {
        scenario_id: "charred-miso-salmon-bowl",
      },
    });

    if (response.completed) {
      throw new Error("expected incomplete compare response");
    }
    if (response.judge.status !== "skipped") {
      throw new Error("expected skipped judge");
    }
    if (judgeCalled) {
      throw new Error("judge should not run when a lane fails");
    }
  } finally {
    llmGateway.generateRecipeImageDetailed = originalGenerateDetailed;
    llmGateway.evaluateImageQualityPair = originalEvaluatePair;
  }
});
