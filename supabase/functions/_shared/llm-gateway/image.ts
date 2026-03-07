/**
 * llm-gateway/image.ts
 *
 * Image-domain LLM gateway methods: recipe image generation,
 * image quality pair evaluation, and image reuse evaluation.
 * Generation uses the image provider pipeline; evaluations use
 * the vision scope executor for multi-image comparison.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../errors.ts";
import { executeVisionScope } from "../llm-executor.ts";
import type { GatewayConfig, JsonValue, RecipePayload } from "../types.ts";
import type {
  ImageQualityEvaluationResult,
  ImageQualityWinner,
  ImageReuseDecision,
  ImageReuseEvaluationResult,
  TokenAccum,
} from "./types.ts";
import {
  addTokens,
  buildRecipeImagePrompt,
  callImageProvider,
  estimateImageGenerationCostUsd,
  getActiveConfig,
  logLlmEvent,
} from "./config.ts";
import {
  normalizeImageQualityEvaluation,
  normalizeImageReuseEvaluation,
} from "./normalizers.ts";

export async function generateRecipeImage(params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  recipe: RecipePayload;
  context: Record<string, JsonValue>;
  modelOverride?: { provider: string; model: string };
  modelConfigOverride?: Record<string, JsonValue>;
  eventPayload?: Record<string, JsonValue>;
}): Promise<string> {
  const detailed = await generateRecipeImageDetailed(params);
  return detailed.imageUrl;
}

export async function generateRecipeImageDetailed(params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  recipe: RecipePayload;
  context: Record<string, JsonValue>;
  modelOverride?: { provider: string; model: string };
  modelConfigOverride?: Record<string, JsonValue>;
  eventPayload?: Record<string, JsonValue>;
}): Promise<{
  imageUrl: string;
  provider: string;
  model: string;
  latencyMs: number;
  costUsd: number;
  prompt: string;
  config: GatewayConfig;
}> {
  const startedAt = Date.now();
  let config: GatewayConfig | null = null;
  try {
    config = await getActiveConfig(params.client, "image", params.modelOverride);
    const runtimeModelConfig = {
      ...config.modelConfig,
      ...(params.modelConfigOverride ?? {}),
    };
    const runtimeConfig: GatewayConfig = {
      ...config,
      modelConfig: runtimeModelConfig,
    };
    const imagePrompt = buildRecipeImagePrompt({
      config: runtimeConfig,
      recipe: params.recipe,
      context: params.context,
    });
    const costUsd = estimateImageGenerationCostUsd(runtimeConfig);

    const imageUrl = await callImageProvider({
      provider: runtimeConfig.provider,
      model: runtimeConfig.model,
      modelConfig: runtimeConfig.modelConfig,
      prompt: imagePrompt,
    });

    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "image",
      Date.now() - startedAt,
      "ok",
      {
        provider: runtimeConfig.provider,
        model: runtimeConfig.model,
        billing_mode: runtimeConfig.billingMode,
        ...(params.eventPayload ?? {}),
      },
      undefined,
      costUsd,
    );

    return {
      imageUrl,
      provider: runtimeConfig.provider,
      model: runtimeConfig.model,
      latencyMs: Date.now() - startedAt,
      costUsd,
      prompt: imagePrompt,
      config: runtimeConfig,
    };
  } catch (error) {
    const errorCode = error instanceof ApiError
      ? error.code
      : "unknown_error";
    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "image",
      Date.now() - startedAt,
      "error",
      {
        provider: config?.provider ?? null,
        model: config?.model ?? null,
        error_code: errorCode,
        error_details: error instanceof ApiError
          ? error.details ?? null
          : null,
        ...(params.eventPayload ?? {}),
      },
    );
    throw error;
  }
}

export async function evaluateImageQualityPair(params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  scenario: {
    id: string;
    title: string;
    description: string;
    heroIngredients: string[];
    visualBrief: string;
  };
  laneA: { imageUrl: string; provider: string; model: string };
  laneB: { imageUrl: string; provider: string; model: string };
}): Promise<{
  winner: ImageQualityWinner;
  rationale: string;
  confidence: number | null;
  provider: string;
  model: string;
  latencyMs: number;
}> {
  const startedAt = Date.now();
  const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };
  let config: GatewayConfig | null = null;

  try {
    const {
      result,
      inputTokens,
      outputTokens,
      config: resolvedConfig,
    } = await executeVisionScope<ImageQualityEvaluationResult>({
      client: params.client,
      scope: "image_quality_eval",
      userInput: {
        scenario: {
          id: params.scenario.id,
          title: params.scenario.title,
          description: params.scenario.description,
          hero_ingredients: params.scenario.heroIngredients,
          visual_brief: params.scenario.visualBrief,
        },
        comparison_focus: "visual_quality_only",
        lane_a: {
          label: "A",
          provider: params.laneA.provider,
          model: params.laneA.model,
        },
        lane_b: {
          label: "B",
          provider: params.laneB.provider,
          model: params.laneB.model,
        },
      },
      images: [
        { label: "A", imageUrl: params.laneA.imageUrl },
        { label: "B", imageUrl: params.laneB.imageUrl },
      ],
    });
    config = resolvedConfig;
    addTokens(accum, inputTokens, outputTokens, resolvedConfig);

    const evaluation = normalizeImageQualityEvaluation(result);
    if (!evaluation) {
      throw new ApiError(
        422,
        "image_quality_eval_invalid",
        "Image quality evaluation did not match required schema",
      );
    }

    const latencyMs = Date.now() - startedAt;
    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "image_quality_eval",
      latencyMs,
      "ok",
      {
        provider: resolvedConfig.provider,
        model: resolvedConfig.model,
        scenario_id: params.scenario.id,
        lane_a_model: `${params.laneA.provider}/${params.laneA.model}`,
        lane_b_model: `${params.laneB.provider}/${params.laneB.model}`,
        winner: evaluation.winner,
      },
      accum,
    );

    return {
      ...evaluation,
      provider: resolvedConfig.provider,
      model: resolvedConfig.model,
      latencyMs,
    };
  } catch (error) {
    const errorCode = error instanceof ApiError
      ? error.code
      : "unknown_error";
    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "image_quality_eval",
      Date.now() - startedAt,
      "error",
      {
        provider: config?.provider ?? null,
        model: config?.model ?? null,
        scenario_id: params.scenario.id,
        error_code: errorCode,
      },
      accum,
    );
    throw error;
  }
}

export async function evaluateRecipeImageReuse(params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  targetRecipe: RecipePayload;
  targetTitle: string;
  targetSearchText: string;
  candidates: Array<{
    id: string;
    title: string;
    imageUrl: string;
    recipeId?: string | null;
    recipeVersionId?: string | null;
  }>;
  modelOverrides?: { provider: string; model: string };
}): Promise<{
  decision: ImageReuseDecision;
  selectedCandidateId: string | null;
  rationale: string;
  confidence: number | null;
  provider: string;
  model: string;
  latencyMs: number;
}> {
  const startedAt = Date.now();
  const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };
  let config: GatewayConfig | null = null;

  try {
    const {
      result,
      inputTokens,
      outputTokens,
      config: resolvedConfig,
    } = await executeVisionScope<{
      decision?: unknown;
      selected_candidate_id?: unknown;
      rationale?: unknown;
      confidence?: unknown;
    }>({
      client: params.client,
      scope: "image_reuse_eval",
      userInput: {
        target_recipe: params.targetRecipe as unknown as JsonValue,
        target_title: params.targetTitle,
        target_search_text: params.targetSearchText,
        candidates: params.candidates.map((candidate) => ({
          id: candidate.id,
          title: candidate.title,
          recipe_id: candidate.recipeId ?? null,
          recipe_version_id: candidate.recipeVersionId ?? null,
        })),
      },
      images: params.candidates.map((candidate) => ({
        label: candidate.id,
        imageUrl: candidate.imageUrl,
      })),
      modelOverride: params.modelOverrides,
    });
    config = resolvedConfig;
    addTokens(accum, inputTokens, outputTokens, resolvedConfig);

    const evaluation = normalizeImageReuseEvaluation(
      result,
      new Set(params.candidates.map((candidate) => candidate.id)),
    );
    if (!evaluation) {
      throw new ApiError(
        422,
        "image_reuse_eval_invalid",
        "Image reuse evaluation did not match required schema",
      );
    }

    const latencyMs = Date.now() - startedAt;
    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "image_reuse_eval",
      latencyMs,
      "ok",
      {
        provider: resolvedConfig.provider,
        model: resolvedConfig.model,
        decision: evaluation.decision,
        selected_candidate_id: evaluation.selectedCandidateId,
        candidate_count: params.candidates.length,
      },
      accum,
    );

    return {
      ...evaluation,
      provider: resolvedConfig.provider,
      model: resolvedConfig.model,
      latencyMs,
    };
  } catch (error) {
    const errorCode = error instanceof ApiError
      ? error.code
      : "unknown_error";
    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "image_reuse_eval",
      Date.now() - startedAt,
      "error",
      {
        provider: config?.provider ?? null,
        model: config?.model ?? null,
        error_code: errorCode,
        candidate_count: params.candidates.length,
      },
      accum,
    );
    throw error;
  }
}
