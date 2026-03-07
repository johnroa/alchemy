/**
 * LLM event logging.
 *
 * Fire-and-forget insert into the `events` table for every LLM gateway
 * call. Records scope, latency, safety classification, token counts,
 * and estimated cost. Failures are logged to stderr but never bubble
 * up — callers should not await this in the critical path if latency
 * matters.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { GatewayScope, JsonValue } from "../types.ts";
import type { TokenAccum } from "./types.ts";

export const logLlmEvent = async (
  client: SupabaseClient,
  userId: string,
  requestId: string,
  scope: GatewayScope,
  latencyMs: number,
  safetyState: string,
  payload?: Record<string, JsonValue>,
  tokens?: TokenAccum,
  costUsdOverride?: number | null,
): Promise<void> => {
  const { error } = await client.from("events").insert({
    user_id: userId,
    event_type: "llm_call",
    request_id: requestId,
    latency_ms: latencyMs,
    safety_state: safetyState,
    token_input: tokens?.input ?? null,
    token_output: tokens?.output ?? null,
    token_total: tokens ? tokens.input + tokens.output : null,
    cost_usd: typeof costUsdOverride === "number"
      ? costUsdOverride
      : tokens?.costUsd ?? null,
    event_payload: { scope, ...(payload ?? {}) },
  });

  if (error) {
    console.error("event_log_failed", error);
  }
};
