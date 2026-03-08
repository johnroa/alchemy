/**
 * llm-gateway/memory.ts
 *
 * Memory-domain LLM gateway methods: extraction, selection,
 * summarization, and conflict resolution. These use the older
 * getActiveConfig + callProvider pattern (not executeScope)
 * because the memory scopes predate the unified executor.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../errors.ts";
import { executeEmbeddingScope } from "../llm-executor.ts";
import type { JsonValue, MemoryRecord } from "../types.ts";
import type {
  ConflictResolution,
  MemoryCandidate,
  RecipeSearchEmbedding,
  MemorySelection,
  MemorySummary,
  TokenAccum,
} from "./types.ts";
import { addTokens, callProvider, getActiveConfig, logLlmEvent } from "./config.ts";

export async function embedMemoryRetrievalQuery(params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  inputText: string;
}): Promise<RecipeSearchEmbedding> {
  const startedAt = Date.now();
  try {
    const { vector, dimensions, inputTokens, config } = await executeEmbeddingScope({
      client: params.client,
      scope: "memory_retrieval_embed",
      inputText: params.inputText,
    });
    const inputCostUsd = inputTokens > 0
      ? (inputTokens / 1_000_000) * config.inputCostPer1m
      : 0;

    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "memory_retrieval_embed",
      Date.now() - startedAt,
      "ok",
      {
        task: "memory_retrieval_embedding_v1",
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
      "memory_retrieval_embed",
      Date.now() - startedAt,
      "error",
      {
        task: "memory_retrieval_embedding_v1",
        error_code: errorCode,
      },
    );
    throw error;
  }
}

export async function extractMemories(params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  context: Record<string, JsonValue>;
}): Promise<MemoryCandidate[]> {
  const startedAt = Date.now();
  const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };
  const config = await getActiveConfig(params.client, "memory_extract");

  const { result: output, inputTokens, outputTokens } = await callProvider<
    { memories: MemoryCandidate[] }
  >({
    provider: config.provider,
    model: config.model,
    modelConfig: config.modelConfig,
    systemPrompt: config.promptTemplate,
    userInput: {
      rule: config.rule,
      context: params.context,
    },
  });
  addTokens(accum, inputTokens, outputTokens, config);

  const records = (output.memories ?? [])
    .filter((item) =>
      typeof item.memory_type === "string" &&
      item.memory_type.trim().length > 0
    )
    .map((item) => ({
      memory_type: item.memory_type.trim(),
      memory_kind: typeof item.memory_kind === "string"
        ? item.memory_kind
        : "preference",
      memory_content: item.memory_content,
      confidence: Number.isFinite(Number(item.confidence))
        ? Math.max(0, Math.min(1, Number(item.confidence)))
        : 0.5,
      salience: Number.isFinite(Number(item.salience))
        ? Math.max(0, Math.min(1, Number(item.salience)))
        : 0.5,
      source: typeof item.source === "string" && item.source.trim().length > 0
        ? item.source.trim()
        : "llm_extract",
    }));

  await logLlmEvent(
    params.client,
    params.userId,
    params.requestId,
    "memory_extract",
    Date.now() - startedAt,
    "ok",
    {
      extracted_count: records.length,
    },
    accum,
  );

  return records;
}

export async function selectMemories(params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  prompt: string;
  context: Record<string, JsonValue>;
  memories: MemoryRecord[];
}): Promise<MemorySelection> {
  const startedAt = Date.now();
  const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };
  const config = await getActiveConfig(params.client, "memory_select");

  const { result: output, inputTokens, outputTokens } = await callProvider<
    MemorySelection
  >({
    provider: config.provider,
    model: config.model,
    modelConfig: config.modelConfig,
    systemPrompt: config.promptTemplate,
    userInput: {
      rule: config.rule,
      prompt: params.prompt,
      context: params.context,
      memories: params.memories,
    },
  });
  addTokens(accum, inputTokens, outputTokens, config);

  const selected = Array.isArray(output.selected_memory_ids)
    ? output.selected_memory_ids.filter((value): value is string =>
      typeof value === "string"
    )
    : [];

  await logLlmEvent(
    params.client,
    params.userId,
    params.requestId,
    "memory_select",
    Date.now() - startedAt,
    "ok",
    {
      selected_count: selected.length,
    },
    accum,
  );

  return {
    selected_memory_ids: selected,
    rationale: output.rationale,
  };
}

export async function summarizeMemories(params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  memories: MemoryRecord[];
  context: Record<string, JsonValue>;
}): Promise<MemorySummary> {
  const startedAt = Date.now();
  const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };
  const config = await getActiveConfig(params.client, "memory_summarize");

  const { result: output, inputTokens, outputTokens } = await callProvider<
    MemorySummary
  >({
    provider: config.provider,
    model: config.model,
    modelConfig: config.modelConfig,
    systemPrompt: config.promptTemplate,
    userInput: {
      rule: config.rule,
      memories: params.memories,
      context: params.context,
    },
  });
  addTokens(accum, inputTokens, outputTokens, config);

  await logLlmEvent(
    params.client,
    params.userId,
    params.requestId,
    "memory_summarize",
    Date.now() - startedAt,
    "ok",
    undefined,
    accum,
  );

  return {
    summary: output.summary ?? {},
    token_estimate: Number.isFinite(Number(output.token_estimate))
      ? Number(output.token_estimate)
      : 0,
  };
}

export async function resolveMemoryConflicts(params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  existingMemories: MemoryRecord[];
  candidates: MemoryCandidate[];
}): Promise<ConflictResolution> {
  const startedAt = Date.now();
  const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };
  const config = await getActiveConfig(
    params.client,
    "memory_conflict_resolve",
  );

  const { result: output, inputTokens, outputTokens } = await callProvider<
    ConflictResolution
  >({
    provider: config.provider,
    model: config.model,
    modelConfig: config.modelConfig,
    systemPrompt: config.promptTemplate,
    userInput: {
      rule: config.rule,
      existing_memories: params.existingMemories,
      candidate_memories: params.candidates,
    },
  });
  addTokens(accum, inputTokens, outputTokens, config);

  await logLlmEvent(
    params.client,
    params.userId,
    params.requestId,
    "memory_conflict_resolve",
    Date.now() - startedAt,
    "ok",
    {
      actions_count: Array.isArray(output.actions)
        ? output.actions.length
        : 0,
    },
    accum,
  );

  return {
    actions: Array.isArray(output.actions) ? output.actions : [],
  };
}
