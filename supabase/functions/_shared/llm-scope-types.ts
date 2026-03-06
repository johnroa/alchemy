export type LlmScopeMode =
  | "ideation"
  | "generation"
  | "iteration"
  | "classification"
  | "embedding"
  | "image"
  | "memory"
  | "onboarding"
  | "legacy";

export type LlmFallbackPolicy = "none" | "deterministic_only";

export type LlmRetryPolicy = {
  max_attempts: number;
  retryable_codes: readonly string[];
};

export type LlmScopeDefinition = {
  output_contract: string;
  mode: LlmScopeMode;
  retry_policy: LlmRetryPolicy;
  fallback_policy: LlmFallbackPolicy;
  telemetry_tags: {
    task: string;
    criticality: "low" | "medium" | "high";
  };
};
