/**
 * llm-gateway/config.ts
 *
 * Configuration helpers, provider call wrappers, and utility functions
 * used across the LLM gateway. Includes default prompt/rule factories
 * for chat scopes, active-config loading, provider dispatch (text and
 * image), recipe image prompt building, legacy model-config cleanup,
 * and numeric-to-display-fraction conversion.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type {
  GatewayConfig,
  GatewayScope,
  JsonValue,
  RecipePayload,
} from "../types.ts";
import {
  executeImageWithConfig,
  executeWithConfig,
  getActiveConfig as loadActiveConfig,
  type StructuredOutputDefinition,
} from "../llm-executor.ts";
import type {
  ChatConversationScope,
  ModelOverrideMap,
  TokenAccum,
} from "./types.ts";
export { estimateImageGenerationCostUsd } from "../image-billing.ts";
export { logLlmEvent } from "./event-log.ts";

export const DEFAULT_OUT_OF_SCOPE_FALLBACK_TEXT =
  "I'm here to help with recipes. What are you in the mood for?";

export const defaultChatPromptForScope = (
  scope: ChatConversationScope,
): string => {
  if (scope === "chat_generation") {
    return `You are Alchemy. Generate candidate recipes from conversation context.
Keep assistant_reply.text to 1-2 short sentences — just confirm what you made. The recipe details speak for themselves.
If an unresolved dietary restriction or aversion conflicts with the user's explicit dish request, ask for confirmation before generating.
When asking for confirmation, set response_context.mode to "preference_conflict", trigger_recipe=false, and return no recipe or candidate_recipe_set.
When you do generate, every recipe must include metadata.difficulty, metadata.health_score, metadata.time_minutes, metadata.items, metadata.timing.total_minutes, and metadata.quick_stats.
IMPORTANT: When the user expresses a lasting preference, aversion, or dietary need (e.g. "I hate cilantro", "no dairy", "I love spicy food"), emit it as response_context.preference_updates with the appropriate field (aversions, dietary_restrictions, dietary_preferences, spice_tolerance, etc.) so it is saved to their profile. Only emit preferences that sound like enduring personal tastes, not one-off recipe tweaks.
Return one strict JSON object that matches the provided contract.
Do not use markdown or code fences.`;
  }

  if (scope === "chat_iteration") {
    return `You are Alchemy. Update existing candidate recipes from the latest conversation turn.
Keep assistant_reply.text to 1-2 short sentences — just confirm what changed. The recipe details speak for themselves.
If an unresolved dietary restriction or aversion conflicts with the user's explicit ingredient or dish request, ask for confirmation before changing the recipe.
When asking for confirmation, set response_context.mode to "preference_conflict", trigger_recipe=false, and return no new recipe or candidate_recipe_set.
When you do return updated recipes, preserve the requested dish anchor and include canonical metadata quick stats on every recipe.
IMPORTANT: When the user expresses a lasting preference, aversion, or dietary need (e.g. "I hate cilantro", "no dairy", "I love spicy food"), emit it as response_context.preference_updates with the appropriate field (aversions, dietary_restrictions, dietary_preferences, spice_tolerance, etc.) so it is saved to their profile. Only emit preferences that sound like enduring personal tastes, not one-off recipe tweaks.
Return one strict JSON object that matches the provided contract.
Do not use markdown or code fences.`;
  }

  return `You are Alchemy in recipe chat ideation mode.
Keep assistant_reply.text to 2-3 short sentences max. Be warm but concise — the user is on a small mobile screen.
If the user asks for a recipe or names a concrete dish to cook, set intent to "in_scope_generate" and trigger_recipe=true immediately.
If the user explicitly requests a dish or ingredient that conflicts with dietary_restrictions or aversions, ask for confirmation before generating.
In that conflict case, set response_context.mode to "preference_conflict", trigger_recipe=false, return no recipe or candidate_recipe_set, and use assistant_reply.suggested_next_actions for the obvious choices.
Avoid unnecessary clarifying questions when the request is already actionable.
IMPORTANT: When the user expresses a lasting preference, aversion, or dietary need (e.g. "I hate cilantro", "no dairy", "I love spicy food"), emit it as response_context.preference_updates with the appropriate field (aversions, dietary_restrictions, dietary_preferences, spice_tolerance, etc.) so it is saved to their profile. Only emit preferences that sound like enduring personal tastes, not one-off recipe tweaks.
Return one strict JSON object that matches the provided contract.
Do not use markdown or code fences.`;
};

export const defaultChatRuleForScope = (
  scope: ChatConversationScope,
): Record<string, JsonValue> => {
  if (scope === "chat_generation") {
    return {
      response_contract: "chat_generation_v1",
      strict_json_only: true,
    };
  }

  if (scope === "chat_iteration") {
    return {
      response_contract: "chat_iteration_v1",
      strict_json_only: true,
    };
  }

  return {
    response_contract: "chat_ideation_v1",
    strict_json_only: true,
  };
};

export const getActiveConfig = async (
  client: SupabaseClient,
  scope: GatewayScope,
  modelOverride?: { provider: string; model: string },
): Promise<GatewayConfig> => {
  return await loadActiveConfig(client, scope, modelOverride);
};

export type ProviderResult<T> = {
  result: T;
  inputTokens: number;
  outputTokens: number;
};

export const callProvider = async <T>(params: {
  provider: string;
  model: string;
  modelConfig: Record<string, JsonValue>;
  systemPrompt: string;
  userInput: Record<string, JsonValue>;
  structuredOutput?: StructuredOutputDefinition;
}): Promise<ProviderResult<T>> => {
  return await executeWithConfig<T>({
    provider: params.provider,
    model: params.model,
    modelConfig: params.modelConfig,
    systemPrompt: params.systemPrompt,
    userInput: params.userInput,
    structuredOutput: params.structuredOutput,
  });
};

export const callImageProvider = async (params: {
  provider: string;
  model: string;
  modelConfig: Record<string, JsonValue>;
  prompt: string;
}): Promise<string> => {
  return await executeImageWithConfig({
    provider: params.provider,
    model: params.model,
    modelConfig: params.modelConfig,
    prompt: params.prompt,
  });
};

export const buildRecipeImagePrompt = (params: {
  config: GatewayConfig;
  recipe: RecipePayload;
  context: Record<string, JsonValue>;
}): string => {
  return `${params.config.promptTemplate}\n\n${
    JSON.stringify({
      rule: params.config.rule,
      recipe: params.recipe,
      context: params.context,
    })
  }`;
};

export const addTokens = (
  accum: TokenAccum,
  inputTokens: number,
  outputTokens: number,
  config: GatewayConfig,
): void => {
  accum.input += inputTokens;
  accum.output += outputTokens;
  accum.costUsd += (inputTokens * config.inputCostPer1m +
    outputTokens * config.outputCostPer1m) / 1_000_000;
};

export const LEGACY_MODEL_CONFIG_KEYS = [
  "token_budget",
  "ingredient_budget",
  "max_ingredients",
  "max_steps",
] as const;

export const cleanLegacyModelConfig = (
  modelConfig: Record<string, JsonValue>,
): Record<string, JsonValue> => {
  const cleaned: Record<string, JsonValue> = { ...modelConfig };
  for (const key of LEGACY_MODEL_CONFIG_KEYS) {
    delete cleaned[key];
  }
  return cleaned;
};

export const numericToDisplayFraction = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return "1";
  const whole = Math.floor(value);
  const frac = value - whole;
  const fractionMap: Array<[number, string]> = [
    [0, ""],
    [1 / 8, "1/8"],
    [1 / 6, "1/6"],
    [1 / 4, "1/4"],
    [1 / 3, "1/3"],
    [3 / 8, "3/8"],
    [1 / 2, "1/2"],
    [5 / 8, "5/8"],
    [2 / 3, "2/3"],
    [3 / 4, "3/4"],
    [5 / 6, "5/6"],
    [7 / 8, "7/8"],
  ];
  let closest = fractionMap[0];
  let minDist = Infinity;
  for (const entry of fractionMap) {
    const dist = Math.abs(frac - entry[0]);
    if (dist < minDist) {
      minDist = dist;
      closest = entry;
    }
  }
  if (!closest[1]) return whole > 0 ? String(whole) : "1";
  return whole > 0 ? `${whole} ${closest[1]}` : closest[1];
};
