import type { LlmScopeDefinition } from "./llm-scope-types.ts";

const STRICT_JSON_RETRYABLE_CODES = [
  "llm_invalid_json",
  "llm_json_truncated",
  "llm_empty_output",
  "chat_schema_invalid",
  "recipe_schema_invalid",
] as const;

// Retained only while recipe generation fallback still routes through the
// pre-chat-loop contract. Remove after the last `generate` callsite is deleted.
export const LEGACY_LLM_SCOPE_REGISTRY = {
  generate: {
    output_contract: "recipe_envelope_v1",
    mode: "legacy",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: STRICT_JSON_RETRYABLE_CODES,
    },
    fallback_policy: "deterministic_only",
    telemetry_tags: { task: "generate_legacy", criticality: "medium" },
  },
} as const satisfies Record<string, LlmScopeDefinition>;
