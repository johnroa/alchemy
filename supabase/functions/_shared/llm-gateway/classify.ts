/**
 * llm-gateway/classify.ts
 *
 * Classification and category inference LLM gateway methods.
 * classifyScope is the safety-gate classifier used before recipe
 * generation; inferCategories assigns recipe categories via the
 * classify scope's getActiveConfig + callProvider path.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../errors.ts";
import { executeScope } from "../llm-executor.ts";
import type { JsonValue, RecipePayload } from "../types.ts";
import type {
  CategoryInference,
  ClassificationResult,
  GatewayInput,
  ModelOverrideMap,
  TokenAccum,
} from "./types.ts";
import { addTokens, callProvider, getActiveConfig, logLlmEvent } from "./config.ts";

/**
 * Safety-gate classifier: determines whether a user prompt is within
 * the recipe domain. Uses the "classify" scope with accept_labels[]
 * from the rule to decide whether the request is allowed.
 */
export async function classifyScope(
  client: SupabaseClient,
  input: GatewayInput,
  overrides?: ModelOverrideMap,
  accum?: TokenAccum,
): Promise<ClassificationResult> {
  const { result, inputTokens, outputTokens, config } = await executeScope<
    ClassificationResult
  >({
    client,
    scope: "classify",
    modelOverride: overrides?.["classify"],
    userInput: {
      task: "classify_request",
      user_prompt: input.userPrompt,
      context: input.context,
    },
  });

  if (accum) {
    accum.input += inputTokens;
    accum.output += outputTokens;
    accum.costUsd += (inputTokens * config.inputCostPer1m +
      outputTokens * config.outputCostPer1m) / 1_000_000;
  }

  if (!result.label) {
    throw new ApiError(
      422,
      "classification_failed",
      "Classification returned no label",
    );
  }

  const acceptLabelsValue = config.rule.accept_labels;
  if (!Array.isArray(acceptLabelsValue)) {
    throw new ApiError(
      500,
      "classification_rule_invalid",
      "classify rule must define accept_labels[]",
    );
  }

  const acceptLabels = acceptLabelsValue.filter((value): value is string =>
    typeof value === "string"
  );
  if (acceptLabels.length === 0) {
    throw new ApiError(
      500,
      "classification_rule_invalid",
      "classify accept_labels[] cannot be empty",
    );
  }

  return {
    ...result,
    isAllowed: acceptLabels.includes(result.label),
  };
}

export async function inferCategories(params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  recipe: RecipePayload;
  context: Record<string, JsonValue>;
}): Promise<CategoryInference[]> {
  const startedAt = Date.now();
  const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };
  try {
    const config = await getActiveConfig(params.client, "classify");

    const { result: output, inputTokens, outputTokens } = await callProvider<
      { categories: CategoryInference[] }
    >({
      provider: config.provider,
      model: config.model,
      modelConfig: config.modelConfig,
      systemPrompt: config.promptTemplate,
      userInput: {
        task: "infer_categories",
        rule: config.rule,
        recipe: params.recipe as unknown as JsonValue,
        context: params.context,
      },
    });
    addTokens(accum, inputTokens, outputTokens, config);

    const categories = (output.categories ?? [])
      .filter((entry) =>
        typeof entry.category === "string" && entry.category.trim().length > 0
      )
      .map((entry) => {
        const numeric = Number(entry.confidence);
        return {
          category: entry.category.trim(),
          confidence: Number.isFinite(numeric)
            ? Math.max(0, Math.min(1, numeric))
            : 0.5,
        };
      });

    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "classify",
      Date.now() - startedAt,
      "ok",
      undefined,
      accum,
    );
    return categories;
  } catch (error) {
    const errorCode = error instanceof ApiError
      ? error.code
      : "unknown_error";
    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "classify",
      Date.now() - startedAt,
      "error",
      {
        error_code: errorCode,
      },
      accum,
    );
    throw error;
  }
}
