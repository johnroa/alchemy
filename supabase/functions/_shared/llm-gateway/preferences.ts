/**
 * llm-gateway/preferences.ts
 *
 * Preference-domain LLM gateway methods: preference list
 * normalization and equipment preference filtering. Both
 * use executeScope for scope-driven LLM calls with dedup
 * and graceful degradation on failure.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../errors.ts";
import { executeScope } from "../llm-executor.ts";
import type { TokenAccum } from "./types.ts";
import { addTokens, logLlmEvent } from "./config.ts";

export async function normalizePreferenceList(params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  field: string;
  entries: string[];
}): Promise<string[]> {
  const cleanedEntries = params.entries
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (cleanedEntries.length === 0) {
    return [];
  }

  const startedAt = Date.now();
  const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };
  try {
    const { result, inputTokens, outputTokens, config } = await executeScope<
      { items?: unknown }
    >({
      client: params.client,
      scope: "preference_normalize",
      userInput: {
        task: "normalize_preference_list",
        field: params.field,
        entries: cleanedEntries,
      },
    });
    addTokens(accum, inputTokens, outputTokens, config);

    const rawItems = result.items;
    const normalized = Array.isArray(rawItems)
      ? rawItems
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
      : [];

    const seen = new Set<string>();
    const unique: string[] = [];
    for (const item of normalized) {
      const key = item.toLocaleLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      unique.push(item);
    }

    const safeOutput = (unique.length > 0 ? unique : cleanedEntries).slice(
      0,
      32,
    );
    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "preference_normalize",
      Date.now() - startedAt,
      "ok",
      {
        task: "normalize_preference_list",
        field: params.field,
        input_count: cleanedEntries.length,
        output_count: safeOutput.length,
      },
      accum,
    );
    return safeOutput;
  } catch (error) {
    const errorCode = error instanceof ApiError
      ? error.code
      : "unknown_error";
    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "preference_normalize",
      Date.now() - startedAt,
      "error",
      {
        task: "normalize_preference_list",
        field: params.field,
        error_code: errorCode,
      },
      accum,
    );
    return cleanedEntries.slice(0, 32);
  }
}

export async function filterEquipmentPreferenceUpdates(params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  latestUserMessage: string;
  userMessages: string[];
  candidateEquipment: string[];
}): Promise<string[]> {
  const cleanedCandidates = params.candidateEquipment
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (cleanedCandidates.length === 0) {
    return [];
  }

  const seenCandidates = new Set<string>();
  const uniqueCandidates: string[] = [];
  for (const candidate of cleanedCandidates) {
    const key = candidate.toLocaleLowerCase();
    if (seenCandidates.has(key)) {
      continue;
    }
    seenCandidates.add(key);
    uniqueCandidates.push(candidate);
  }

  const cleanedMessages = [params.latestUserMessage, ...params.userMessages]
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .slice(0, 20);

  const startedAt = Date.now();
  const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };
  try {
    const { result, inputTokens, outputTokens, config } = await executeScope<
      { items?: unknown }
    >({
      client: params.client,
      scope: "equipment_filter",
      userInput: {
        task: "filter_equipment_preference_updates",
        latest_user_message: params.latestUserMessage,
        user_messages: cleanedMessages,
        candidate_equipment: uniqueCandidates,
      },
    });
    addTokens(accum, inputTokens, outputTokens, config);

    const rawItems = result.items;
    const normalized = Array.isArray(rawItems)
      ? rawItems
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
      : [];

    const seen = new Set<string>();
    const unique: string[] = [];
    for (const item of normalized) {
      const key = item.toLocaleLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      unique.push(item);
    }

    const safeOutput = unique.slice(0, 32);
    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "equipment_filter",
      Date.now() - startedAt,
      "ok",
      {
        task: "filter_equipment_preference_updates",
        candidate_count: uniqueCandidates.length,
        output_count: safeOutput.length,
      },
      accum,
    );

    return safeOutput;
  } catch (error) {
    const errorCode = error instanceof ApiError
      ? error.code
      : "unknown_error";
    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "equipment_filter",
      Date.now() - startedAt,
      "error",
      {
        task: "filter_equipment_preference_updates",
        error_code: errorCode,
      },
      accum,
    );
    return [];
  }
}
