import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export const logChatRouteTiming = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  route: string;
  contextLoadMs: number;
  memoryRetrievalMs: number;
  llmMs: number;
  recoveryPath?: string | null;
  cacheHit?: boolean;
  generationReusedContext?: boolean;
  totalServerMs: number;
}): Promise<void> => {
  const { error } = await params.serviceClient.from("events").insert({
    user_id: params.userId,
    event_type: "chat_route_timing",
    request_id: params.requestId,
    latency_ms: params.totalServerMs,
    safety_state: params.recoveryPath === "graceful_retry_copy"
      ? "degraded"
      : "ok",
    event_payload: {
      route: params.route,
      context_load_ms: params.contextLoadMs,
      memory_retrieval_ms: params.memoryRetrievalMs,
      llm_ms: params.llmMs,
      recovery_path: params.recoveryPath ?? null,
      cache_hit: Boolean(params.cacheHit),
      generation_reused_context: Boolean(params.generationReusedContext),
      total_server_ms: params.totalServerMs,
    },
  });

  if (error) {
    console.error("chat_route_timing_log_failed", error);
  }
};
