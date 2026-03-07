/**
 * Recipe generation envelope composition.
 *
 * Contains the core recipe-generation pipeline: single-shot generation,
 * schema repair (up to two retries), assistant reply synthesis, and
 * cross-envelope recovery. All LLM calls go through `callProvider` from
 * the config module which delegates to the executor + adapter layer.
 *
 * Exports `addTokens` as a shared utility — other domain modules
 * (chat, onboarding) import it to accumulate token/cost accounting.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../errors.ts";
import type {
  AssistantReply,
  GatewayConfig,
  GatewayScope,
  JsonValue,
  RecipeAssistantEnvelope,
  RecipePayload,
} from "../types.ts";
import type { GatewayInput, ModelOverrideMap, TokenAccum } from "./types.ts";
import { callProvider, cleanLegacyModelConfig, getActiveConfig } from "./config.ts";
import {
  normalizeAssistantReply,
  normalizeChatEnvelope,
  normalizeRecipeEnvelope,
  normalizeRecipeShape,
} from "./normalizers.ts";

const deriveAssistantReplyFromRecipe = (
  recipe: RecipePayload,
): AssistantReply | null => {
  const textCandidates = [recipe.notes, recipe.description, recipe.title]
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    );

  if (textCandidates.length === 0) {
    return null;
  }

  return {
    text: textCandidates[0].trim(),
  };
};

export const composeAssistantReply = async (params: {
  config: GatewayConfig;
  prompt: string;
  context: Record<string, JsonValue>;
  recipe: RecipePayload;
  accum?: TokenAccum;
}): Promise<AssistantReply | null> => {
  const { result: synthesized, inputTokens, outputTokens } = await callProvider<
    Record<string, JsonValue>
  >({
    provider: params.config.provider,
    model: params.config.model,
    modelConfig: params.config.modelConfig,
    systemPrompt: params.config.promptTemplate,
    userInput: {
      task: "compose_assistant_reply",
      rule: params.config.rule,
      prompt: params.prompt,
      context: params.context,
      recipe: params.recipe as unknown as JsonValue,
    },
  });

  if (params.accum) {
    params.accum.input += inputTokens;
    params.accum.output += outputTokens;
    params.accum.costUsd += (inputTokens * params.config.inputCostPer1m +
      outputTokens * params.config.outputCostPer1m) / 1_000_000;
  }

  return normalizeAssistantReply(synthesized.assistant_reply ?? synthesized);
};

/**
 * Accumulates token counts and cost into a running total.
 * Shared across recipe, chat, and onboarding generation paths.
 */
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

/**
 * Full recipe-generation pipeline for the "generate" scope.
 *
 * Flow: single-shot LLM call → normalize envelope → (if bare recipe)
 * synthesize assistant reply → (if still invalid) repair call → (if
 * still invalid) strict normalization call → (last resort) recover
 * recipe from chat-shaped envelope. Throws ApiError 422 if all
 * attempts fail.
 *
 * Token accounting is accumulated into `accum` across all retries.
 */
export const generateRecipePayload = async (
  client: SupabaseClient,
  scope: Extract<GatewayScope, "generate">,
  input: GatewayInput,
  overrides?: ModelOverrideMap,
  accum?: TokenAccum,
): Promise<RecipeAssistantEnvelope> => {
  const config = await getActiveConfig(client, scope, overrides?.[scope]);
  const runtimePromptTemplate = config.promptTemplate?.trim().length
    ? config.promptTemplate
    : `You are Alchemy. Generate complete, cookable recipes from user intent and context.
Return strict JSON only.`;
  const runtimeRule = config.rule &&
      typeof config.rule === "object" &&
      !Array.isArray(config.rule)
    ? config.rule
    : {};
  const runtimeConstraints = `Runtime requirements:
- Output one strict JSON object only.
- Do not emit markdown or code fences.
- Required top-level keys: assistant_reply, recipe, response_context.
- assistant_reply.text must be plain assistant text (never JSON).
- recipe must be complete and practical (ingredients + steps required).
- recipe.metadata must include difficulty, health_score, time_minutes, items, timing.total_minutes, and quick_stats.
- recipe.metadata.quick_stats must include time_minutes, difficulty, health_score, and items.
- difficulty must be exactly one of: easy, medium, complex.
- health_score must be an integer from 1 to 100.
- Do not enforce artificial ingredient, step, or token budgets.`;
  const runtimeSystemPrompt = `${runtimePromptTemplate}\n\n${runtimeConstraints}`;
  const recipeContract = {
    format: "json_object",
    required_keys: ["assistant_reply", "recipe", "response_context"],
    optional_keys: ["response_context"],
  };
  const runtimeModelConfig = cleanLegacyModelConfig(config.modelConfig);
  if (!Number.isFinite(Number(runtimeModelConfig.temperature))) {
    runtimeModelConfig.temperature = 0.35;
  }

  const { result, inputTokens, outputTokens } = await callProvider<
    Record<string, JsonValue>
  >({
    provider: config.provider,
    model: config.model,
    modelConfig: runtimeModelConfig,
    systemPrompt: runtimeSystemPrompt,
    userInput: {
      task: "generate_recipe",
      rule: runtimeRule,
      contract: recipeContract,
      prompt: input.userPrompt,
      context: input.context,
    },
  });
  if (accum) addTokens(accum, inputTokens, outputTokens, config);

  const envelope = normalizeRecipeEnvelope(result);
  if (envelope) {
    return envelope;
  }

  const directRecipe = normalizeRecipeShape(result);
  if (directRecipe) {
    const synthesizedReply = await composeAssistantReply({
      config,
      prompt: input.userPrompt,
      context: input.context,
      recipe: directRecipe,
      accum,
    });

    if (!synthesizedReply) {
      const derivedReply = deriveAssistantReplyFromRecipe(directRecipe);
      if (!derivedReply) {
        throw new ApiError(
          422,
          "assistant_reply_missing",
          "LLM did not provide assistant reply content",
        );
      }

      return {
        recipe: directRecipe,
        assistant_reply: derivedReply,
      };
    }

    return {
      recipe: directRecipe,
      assistant_reply: synthesizedReply,
    };
  }

  const { result: repaired, inputTokens: ri, outputTokens: ro } =
    await callProvider<Record<string, JsonValue>>({
      provider: config.provider,
      model: config.model,
      modelConfig: runtimeModelConfig,
      systemPrompt: runtimeSystemPrompt,
      userInput: {
        task: "repair_recipe_schema",
        rule: runtimeRule,
        contract: recipeContract,
        prompt: input.userPrompt,
        context: input.context,
        invalid_payload: result,
      },
    });
  if (accum) addTokens(accum, ri, ro, config);

  const repairedEnvelope = normalizeRecipeEnvelope(repaired);
  if (repairedEnvelope) {
    return repairedEnvelope;
  }

  const repairedRecipe = normalizeRecipeShape(repaired);
  if (repairedRecipe) {
    const synthesizedReply = await composeAssistantReply({
      config,
      prompt: input.userPrompt,
      context: input.context,
      recipe: repairedRecipe,
      accum,
    });

    if (!synthesizedReply) {
      const derivedReply = deriveAssistantReplyFromRecipe(repairedRecipe);
      if (!derivedReply) {
        throw new ApiError(
          422,
          "assistant_reply_missing",
          "LLM did not provide assistant reply content",
        );
      }

      return {
        recipe: repairedRecipe,
        assistant_reply: derivedReply,
      };
    }

    return {
      recipe: repairedRecipe,
      assistant_reply: synthesizedReply,
    };
  }

  const { result: strictRepaired, inputTokens: si, outputTokens: so } =
    await callProvider<Record<string, JsonValue>>({
      provider: config.provider,
      model: config.model,
      modelConfig: runtimeModelConfig,
      systemPrompt:
        `${runtimeSystemPrompt}\n\nYou are in strict schema normalization mode. Return one valid JSON object with keys assistant_reply, recipe, and response_context. Do not include markdown or prose.`,
      userInput: {
        task: "normalize_recipe_envelope",
        rule: runtimeRule,
        contract: recipeContract,
        prompt: input.userPrompt,
        context: input.context,
        invalid_payload: repaired,
      },
    });
  if (accum) addTokens(accum, si, so, config);

  const strictEnvelope = normalizeRecipeEnvelope(strictRepaired);
  if (strictEnvelope) {
    return strictEnvelope;
  }

  const strictRecipe = normalizeRecipeShape(strictRepaired);
  if (strictRecipe) {
    const synthesizedReply = await composeAssistantReply({
      config,
      prompt: input.userPrompt,
      context: input.context,
      recipe: strictRecipe,
      accum,
    });

    if (!synthesizedReply) {
      const derivedReply = deriveAssistantReplyFromRecipe(strictRecipe);
      if (!derivedReply) {
        throw new ApiError(
          422,
          "assistant_reply_missing",
          "LLM did not provide assistant reply content",
        );
      }

      return {
        recipe: strictRecipe,
        assistant_reply: derivedReply,
      };
    }

    return {
      recipe: strictRecipe,
      assistant_reply: synthesizedReply,
    };
  }

  const recoveredFromChatEnvelope = normalizeChatEnvelope(strictRepaired) ??
    normalizeChatEnvelope(repaired) ??
    normalizeChatEnvelope(result);
  if (recoveredFromChatEnvelope?.assistant_reply) {
    const recoveredRecipe = recoveredFromChatEnvelope.recipe ??
      recoveredFromChatEnvelope.candidate_recipe_set?.components.find((
        component,
      ) => component.role === "main")?.recipe ??
      recoveredFromChatEnvelope.candidate_recipe_set?.components[0]?.recipe;
    if (recoveredRecipe) {
      return {
        recipe: recoveredRecipe,
        assistant_reply: recoveredFromChatEnvelope.assistant_reply,
        response_context: {
          mode: "generation",
          intent: "in_scope_generate",
        },
      };
    }
  }

  throw new ApiError(
    422,
    "recipe_schema_invalid",
    "Generated recipe did not match required envelope schema",
  );
};
