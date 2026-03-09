/**
 * Chat conversation envelope generation.
 *
 * Handles the multi-scope chat pipeline (chat_generate, chat_iterate,
 * chat_ideation). Builds the runtime system prompt from DB-stored config,
 * executes the LLM call, normalizes the response into a ChatAssistantEnvelope,
 * validates scope-specific contract requirements, and performs one repair
 * attempt if the initial response fails validation.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../errors.ts";
import type {
  ChatAssistantEnvelope,
  JsonValue,
} from "../types.ts";
import type {
  ChatConversationScope,
  GatewayInput,
  ModelOverrideMap,
  TokenAccum,
} from "./types.ts";
import {
  callProvider,
  cleanLegacyModelConfig,
  defaultChatPromptForScope,
  defaultChatRuleForScope,
  getActiveConfig,
} from "./config.ts";
import { normalizeChatEnvelope } from "./normalizers.ts";
import { addTokens } from "./recipe.ts";

export const generateChatConversationPayload = async (
  client: SupabaseClient,
  scope: ChatConversationScope,
  input: GatewayInput,
  overrides?: ModelOverrideMap,
  accum?: TokenAccum,
): Promise<ChatAssistantEnvelope> => {
  const runtimeOverride = overrides?.[scope];
  const config = await getActiveConfig(client, scope, runtimeOverride);

  const runtimeModelConfig = cleanLegacyModelConfig(config.modelConfig);
  const runtimeProvider = config.provider;
  const runtimeModel = config.model;

  if (!Number.isFinite(Number(runtimeModelConfig.temperature))) {
    runtimeModelConfig.temperature = scope === "chat_ideation" ? 0.3 : 0.35;
  }

  const runtimeConstraints = `Runtime requirements:
- Output one strict JSON object only.
- Do not emit markdown or code fences.
- Match the provided contract keys and schema exactly.
- Keep assistant_reply.text concise: 2-3 short sentences max during ideation, 1-2 sentences when presenting a generated or updated recipe. Never ramble — the user reads on a small mobile screen.
- If you return a recipe or candidate_recipe_set, every recipe must include metadata.difficulty, metadata.health_score, metadata.time_minutes, metadata.items, metadata.timing.total_minutes, and metadata.quick_stats.
- If there is an unresolved conflict between an explicit dish request and dietary_restrictions or aversions, ask for confirmation instead of generating, set response_context.mode to "preference_conflict", and return no recipe or candidate_recipe_set.`;

  const runtimePromptTemplate = config.promptTemplate?.trim().length
    ? config.promptTemplate
    : defaultChatPromptForScope(scope);
  const runtimeRule = config.rule &&
      typeof config.rule === "object" &&
      !Array.isArray(config.rule)
    ? config.rule
    : defaultChatRuleForScope(scope);
  const runtimeSystemPrompt =
    `${runtimePromptTemplate}\n\n${runtimeConstraints}`;
  const contract = scope === "chat_ideation"
    ? {
      format: "json_object",
      required_keys: ["assistant_reply", "trigger_recipe", "response_context"],
      optional_keys: ["response_context", "candidate_recipe_set", "recipe"],
    }
    : {
      format: "json_object",
      required_keys: ["assistant_reply", "response_context"],
      optional_keys: ["candidate_recipe_set", "recipe", "trigger_recipe"],
    };

  const executeCall = async (
    extraSystemPrompt: string | null,
    callConfig: Record<string, JsonValue>,
    userInputOverride?: Record<string, JsonValue>,
  ): Promise<Record<string, JsonValue>> => {
    const response = await callProvider<Record<string, JsonValue>>({
      provider: runtimeProvider,
      model: runtimeModel,
      modelConfig: callConfig,
      systemPrompt: extraSystemPrompt
        ? `${runtimeSystemPrompt}\n\n${extraSystemPrompt}`
        : runtimeSystemPrompt,
      userInput: {
        task: "chat_conversation",
        rule: runtimeRule,
        contract,
        prompt: input.userPrompt,
        context: input.context,
        ...(userInputOverride ?? {}),
      },
    });
    if (accum) {
      addTokens(accum, response.inputTokens, response.outputTokens, config);
    }
    return response.result;
  };

  const validateEnvelopeForScope = (
    envelope: ChatAssistantEnvelope,
  ): ChatAssistantEnvelope => {
    const isPreferenceConflict = envelope.response_context?.mode ===
        "preference_conflict" ||
      envelope.response_context?.preference_conflict?.status ===
        "pending_confirmation";

    if (scope === "chat_ideation") {
      const intent = envelope.response_context?.intent;
      if (
        intent !== "in_scope_ideation" && intent !== "in_scope_generate" &&
        intent !== "out_of_scope"
      ) {
        throw new ApiError(
          422,
          "chat_schema_invalid",
          "Ideation response_context.intent is required",
        );
      }

      if (intent === "out_of_scope") {
        return {
          assistant_reply: envelope.assistant_reply,
          trigger_recipe: false,
          response_context: {
            ...(envelope.response_context ?? {}),
            intent: "out_of_scope",
            mode: "ideation",
          },
        };
      }

      if (isPreferenceConflict) {
        return {
          assistant_reply: envelope.assistant_reply,
          trigger_recipe: false,
          response_context: {
            ...(envelope.response_context ?? {}),
            mode: "preference_conflict",
            intent,
          },
        };
      }

      return {
        assistant_reply: envelope.assistant_reply,
        trigger_recipe: intent === "in_scope_generate"
          ? true
          : (envelope.trigger_recipe ?? false),
        candidate_recipe_set: envelope.candidate_recipe_set,
        recipe: envelope.recipe,
        response_context: {
          ...(envelope.response_context ?? {}),
          intent,
        },
      };
    }

    if (isPreferenceConflict) {
      return {
        assistant_reply: envelope.assistant_reply,
        trigger_recipe: false,
        response_context: {
          ...(envelope.response_context ?? {}),
          mode: "preference_conflict",
          intent: "in_scope_generate",
        },
      };
    }

    if (!envelope.candidate_recipe_set && !envelope.recipe) {
      throw new ApiError(
        422,
        "chat_schema_invalid",
        "Generation and iteration must return a candidate_recipe_set",
      );
    }

    return {
      ...envelope,
      response_context: {
        ...(envelope.response_context ?? {}),
        intent: "in_scope_generate",
      },
    };
  };

  const attemptRepair = async (
    invalidPayload: Record<string, JsonValue>,
    reason: string,
  ): Promise<ChatAssistantEnvelope | null> => {
    const repaired = await executeCall(
      `CRITICAL: Return ONLY one valid raw JSON object for the chat-loop contract.
- No markdown/code fences.
- Ensure assistant_reply.text is plain assistant text (never JSON).
- Ensure required keys are present for this scope.
- Preserve user intent and recipe details from invalid_payload.
repair_reason: ${reason}`,
      runtimeModelConfig,
      {
        task: "repair_chat_schema",
        scope,
        reason,
        rule: runtimeRule,
        contract,
        prompt: input.userPrompt,
        context: input.context,
        invalid_payload: invalidPayload,
      },
    );
    return normalizeChatEnvelope(repaired);
  };

  const rawResult = await executeCall(null, runtimeModelConfig);

  let repaired = false;
  let envelope = normalizeChatEnvelope(rawResult);
  if (!envelope) {
    envelope = await attemptRepair(
      rawResult,
      "chat_envelope_normalization_failed",
    );
    repaired = true;
  }

  if (!envelope) {
    throw new ApiError(
      422,
      "chat_schema_invalid",
      "Chat reply did not match required envelope schema",
    );
  }

  try {
    return validateEnvelopeForScope(envelope);
  } catch (error) {
    if (
      !repaired &&
      error instanceof ApiError &&
      error.code === "chat_schema_invalid"
    ) {
      const repairedEnvelope = await attemptRepair(rawResult, error.message);
      if (repairedEnvelope) {
        return validateEnvelopeForScope(repairedEnvelope);
      }
    }
    throw error;
  }
};
