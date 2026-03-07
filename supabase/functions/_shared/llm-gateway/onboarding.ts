/**
 * Onboarding interview envelope generation.
 *
 * Drives the conversational onboarding flow where the LLM interviews
 * the user to collect dietary preferences, skill level, equipment, etc.
 * Returns an OnboardingAssistantEnvelope with the assistant reply,
 * onboarding state (progress, missing topics), and optional preference
 * updates to persist. Includes one repair attempt if the initial
 * response fails envelope normalization.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../errors.ts";
import type {
  JsonValue,
  OnboardingAssistantEnvelope,
} from "../types.ts";
import type { GatewayInput, TokenAccum } from "./types.ts";
import { callProvider, getActiveConfig } from "./config.ts";
import { normalizeOnboardingEnvelope } from "./normalizers.ts";
import { addTokens } from "./recipe.ts";

export const generateOnboardingInterviewEnvelope = async (
  client: SupabaseClient,
  input: GatewayInput,
  accum?: TokenAccum,
): Promise<OnboardingAssistantEnvelope> => {
  const config = await getActiveConfig(client, "onboarding");

  const { result, inputTokens, outputTokens } = await callProvider<
    Record<string, JsonValue>
  >({
    provider: config.provider,
    model: config.model,
    modelConfig: config.modelConfig,
    systemPrompt: config.promptTemplate,
    userInput: {
      task: "onboarding_interview",
      rule: config.rule,
      prompt: input.userPrompt,
      context: input.context,
    },
  });
  if (accum) addTokens(accum, inputTokens, outputTokens, config);

  const envelope = normalizeOnboardingEnvelope(result);
  if (envelope) {
    return envelope;
  }

  console.error("onboarding_envelope_normalization_failed", {
    result_keys: result && typeof result === "object"
      ? Object.keys(result)
      : typeof result,
    result_preview: JSON.stringify(result).slice(0, 800),
  });

  const { result: repaired, inputTokens: ri, outputTokens: ro } =
    await callProvider<Record<string, JsonValue>>({
      provider: config.provider,
      model: config.model,
      modelConfig: config.modelConfig,
      systemPrompt:
        `${config.promptTemplate}\n\nCRITICAL: You MUST return ONLY a raw JSON object. No markdown fences, no explanation, no text before or after the JSON. The JSON object MUST have these exact top-level keys: "assistant_reply" (object with required "text" string field), "onboarding_state" (object with "completed" boolean, "progress" number 0-1, "missing_topics" string array, "state" object), and optionally "preference_updates" (object).`,
      userInput: {
        task: "repair_onboarding_schema",
        rule: config.rule,
        prompt: input.userPrompt,
        context: input.context,
        invalid_payload: result,
      },
    });
  if (accum) addTokens(accum, ri, ro, config);

  const repairedEnvelope = normalizeOnboardingEnvelope(repaired);
  if (repairedEnvelope) {
    return repairedEnvelope;
  }

  console.error("onboarding_repair_also_failed", {
    repaired_keys: repaired && typeof repaired === "object"
      ? Object.keys(repaired)
      : typeof repaired,
    repaired_preview: JSON.stringify(repaired).slice(0, 800),
  });

  throw new ApiError(
    422,
    "onboarding_schema_invalid",
    "Generated onboarding reply did not match required schema",
  );
};
