/**
 * llm-gateway/greeting.ts
 *
 * Greeting generation for the Generate Recipe screen.
 * Non-critical, lightweight creative call — failures always
 * return a safe fallback string and never throw.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../errors.ts";
import { executeScope } from "../llm-executor.ts";
import type { TokenAccum } from "./types.ts";
import { addTokens, logLlmEvent } from "./config.ts";

/**
 * Generate a short, personalized greeting for the Generate Recipe screen.
 * This is a non-critical, lightweight creative call — failures always return
 * a safe fallback string and never throw.
 */
export async function generateGreeting(params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  userName: string | null;
  timeOfDay: string;
  lastRecipeTitle: string | null;
}): Promise<{ text: string }> {
  const FALLBACK_TEXT = "Hey Chef! What are we cooking?";
  const startedAt = Date.now();
  const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };

  try {
    const { result, inputTokens, outputTokens, config } = await executeScope<
      { text?: unknown }
    >({
      client: params.client,
      scope: "chat_greeting",
      userInput: {
        task: "generate_greeting",
        user_name: params.userName,
        time_of_day: params.timeOfDay,
        last_recipe_title: params.lastRecipeTitle,
      },
    });
    addTokens(accum, inputTokens, outputTokens, config);

    const text = typeof result.text === "string" && result.text.trim().length > 0
      ? result.text.trim()
      : FALLBACK_TEXT;

    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "chat_greeting",
      Date.now() - startedAt,
      "ok",
      {
        task: "generate_greeting",
        has_user_name: params.userName !== null,
        has_last_recipe: params.lastRecipeTitle !== null,
      },
      accum,
    );

    return { text };
  } catch (error) {
    const errorCode = error instanceof ApiError
      ? error.code
      : "unknown_error";
    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "chat_greeting",
      Date.now() - startedAt,
      "error",
      {
        task: "generate_greeting",
        error_code: errorCode,
      },
      accum,
    );
    return { text: FALLBACK_TEXT };
  }
}
