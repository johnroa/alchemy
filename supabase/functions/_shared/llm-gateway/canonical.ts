import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../errors.ts";
import { executeScope } from "../llm-executor.ts";
import type { JsonValue, RecipePayload } from "../types.ts";
import { normalizeRecipeShape } from "./normalizers.ts";
import type {
  CanonicalizeRecipeResult,
  ModelOverrideMap,
  RecipeCanonMatchEnvelope,
  TokenAccum,
} from "./types.ts";
import { addTokens, logLlmEvent } from "./config.ts";

export async function canonicalizeRecipe(params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  recipe: RecipePayload;
  preferences: Record<string, JsonValue>;
  modelOverrides?: ModelOverrideMap;
}): Promise<CanonicalizeRecipeResult> {
  const startedAt = Date.now();
  const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };

  try {
    const { result, inputTokens, outputTokens, config } = await executeScope<{
      recipe?: unknown;
      rationale?: unknown;
    }>({
      client: params.client,
      scope: "recipe_canonicalize",
      userInput: {
        task: "recipe_canonicalize",
        candidate_recipe: params.recipe as unknown as JsonValue,
        user_preferences: params.preferences,
      },
      modelOverride: params.modelOverrides?.recipe_canonicalize,
    });
    addTokens(accum, inputTokens, outputTokens, config);

    const recipe = normalizeRecipeShape(result.recipe);
    if (!recipe) {
      throw new ApiError(
        500,
        "recipe_canonicalize_invalid",
        "LLM did not return a valid canonical recipe payload",
      );
    }

    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "recipe_canonicalize",
      Date.now() - startedAt,
      "ok",
      {
        rationale_present: typeof result.rationale === "string",
      },
      accum,
    );

    return {
      recipe,
      rationale: typeof result.rationale === "string" ? result.rationale : null,
    };
  } catch (error) {
    const errorCode = error instanceof ApiError ? error.code : "unknown_error";
    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "recipe_canonicalize",
      Date.now() - startedAt,
      "error",
      { error_code: errorCode },
      accum,
    );
    throw error;
  }
}

export async function executeRecipeCanonMatch(params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  targetRecipe: RecipePayload;
  targetDescriptor: Record<string, JsonValue>;
  candidates: Record<string, JsonValue>[];
  modelOverrides?: ModelOverrideMap;
}): Promise<{
  result: RecipeCanonMatchEnvelope;
  config: { provider: string; model: string };
}> {
  const startedAt = Date.now();
  const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };

  try {
    const { result, inputTokens, outputTokens, config } = await executeScope<
      RecipeCanonMatchEnvelope
    >({
      client: params.client,
      scope: "recipe_canon_match",
      userInput: {
        task: "recipe_canon_match",
        target_recipe: params.targetRecipe as unknown as JsonValue,
        target_descriptor: params.targetDescriptor,
        candidates: params.candidates as unknown as JsonValue,
      },
      modelOverride: params.modelOverrides?.recipe_canon_match,
    });
    addTokens(accum, inputTokens, outputTokens, config);

    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "recipe_canon_match",
      Date.now() - startedAt,
      "ok",
      {
        candidate_count: params.candidates.length,
        decision: typeof result.decision === "string" ? result.decision : null,
      },
      accum,
    );

    return {
      result,
      config: {
        provider: config.provider,
        model: config.model,
      },
    };
  } catch (error) {
    const errorCode = error instanceof ApiError ? error.code : "unknown_error";
    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "recipe_canon_match",
      Date.now() - startedAt,
      "error",
      {
        candidate_count: params.candidates.length,
        error_code: errorCode,
      },
      accum,
    );
    throw error;
  }
}
