/**
 * llm-gateway/search.ts
 *
 * Recipe search LLM gateway methods: embedding generation,
 * search interpretation, and result reranking. Each function
 * wraps an executor call with event logging.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../errors.ts";
import { executeEmbeddingScope, executeScope } from "../llm-executor.ts";
import type { JsonValue } from "../types.ts";
import type {
  ModelOverrideMap,
  RecipeSearchEmbedding,
  RecipeSearchInterpretationEnvelope,
  RecipeSearchRerankEnvelope,
  TokenAccum,
} from "./types.ts";
import { addTokens, logLlmEvent } from "./config.ts";

export async function embedRecipeSearchQuery(params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  inputText: string;
  modelOverrides?: ModelOverrideMap;
}): Promise<RecipeSearchEmbedding> {
  const startedAt = Date.now();
  try {
    const { vector, dimensions, inputTokens, config } = await executeEmbeddingScope({
      client: params.client,
      scope: "recipe_search_embed",
      inputText: params.inputText,
      modelOverride: params.modelOverrides?.recipe_search_embed,
    });
    const inputCostUsd = inputTokens > 0
      ? (inputTokens / 1_000_000) * config.inputCostPer1m
      : 0;

    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "recipe_search_embed",
      Date.now() - startedAt,
      "ok",
      {
        task: "recipe_search_embedding_v1",
        dimensions,
      },
      {
        input: inputTokens,
        output: 0,
        costUsd: inputCostUsd,
      },
    );

    return {
      vector,
      dimensions,
      provider: config.provider,
      model: config.model,
    };
  } catch (error) {
    const errorCode = error instanceof ApiError
      ? error.code
      : "unknown_error";
    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "recipe_search_embed",
      Date.now() - startedAt,
      "error",
      {
        task: "recipe_search_embedding_v1",
        error_code: errorCode,
      },
    );
    throw error;
  }
}

export async function interpretRecipeSearch(params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  context: Record<string, JsonValue>;
  modelOverrides?: ModelOverrideMap;
}): Promise<RecipeSearchInterpretationEnvelope> {
  const startedAt = Date.now();
  const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };

  try {
    const { result, inputTokens, outputTokens, config } = await executeScope<
      RecipeSearchInterpretationEnvelope
    >({
      client: params.client,
      scope: "recipe_search_interpret",
      userInput: params.context,
      modelOverride: params.modelOverrides?.recipe_search_interpret,
    });
    addTokens(accum, inputTokens, outputTokens, config);

    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "recipe_search_interpret",
      Date.now() - startedAt,
      "ok",
      { task: "recipe_search_interpret_v1" },
      accum,
    );

    return result;
  } catch (error) {
    const errorCode = error instanceof ApiError
      ? error.code
      : "unknown_error";
    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "recipe_search_interpret",
      Date.now() - startedAt,
      "error",
      {
        task: "recipe_search_interpret_v1",
        error_code: errorCode,
      },
      accum,
    );
    throw error;
  }
}

export async function rerankRecipeSearch(params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  context: Record<string, JsonValue>;
  timeoutMs: number;
  modelOverrides?: ModelOverrideMap;
}): Promise<RecipeSearchRerankEnvelope> {
  const startedAt = Date.now();
  const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };

  try {
    const { result, inputTokens, outputTokens, config } = await executeScope<
      RecipeSearchRerankEnvelope
    >({
      client: params.client,
      scope: "recipe_search_rerank",
      userInput: params.context,
      modelOverride: params.modelOverrides?.recipe_search_rerank,
      modelConfigOverride: {
        timeout_ms: params.timeoutMs,
      },
    });
    addTokens(accum, inputTokens, outputTokens, config);

    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "recipe_search_rerank",
      Date.now() - startedAt,
      "ok",
      {
        task: "recipe_search_rerank_v1",
        candidate_count: Array.isArray(params.context.candidates)
          ? params.context.candidates.length
          : null,
      },
      accum,
    );

    return result;
  } catch (error) {
    const errorCode = error instanceof ApiError
      ? error.code
      : "unknown_error";
    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "recipe_search_rerank",
      Date.now() - startedAt,
      "error",
      {
        task: "recipe_search_rerank_v1",
        error_code: errorCode,
      },
      accum,
    );
    throw error;
  }
}
