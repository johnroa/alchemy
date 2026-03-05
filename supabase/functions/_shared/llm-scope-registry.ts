export type LlmScopeMode =
  | "ideation"
  | "generation"
  | "iteration"
  | "classification"
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

const STRICT_JSON_RETRYABLE_CODES = [
  "llm_invalid_json",
  "llm_json_truncated",
  "llm_empty_output",
  "chat_schema_invalid",
  "recipe_schema_invalid",
] as const;

const STANDARD_RETRYABLE_CODES = [
  "llm_provider_timeout",
  "llm_provider_error",
] as const;

export const LLM_SCOPE_REGISTRY = {
  chat: {
    output_contract: "chat_legacy_v1",
    mode: "legacy",
    retry_policy: {
      max_attempts: 1,
      retryable_codes: [],
    },
    fallback_policy: "none",
    telemetry_tags: { task: "chat_legacy", criticality: "low" },
  },
  chat_greeting: {
    output_contract: "chat_greeting_v1",
    mode: "ideation",
    retry_policy: {
      max_attempts: 1,
      retryable_codes: [],
    },
    fallback_policy: "none",
    telemetry_tags: { task: "chat_greeting", criticality: "low" },
  },
  chat_ideation: {
    output_contract: "chat_ideation_v1",
    mode: "ideation",
    retry_policy: {
      max_attempts: 1,
      retryable_codes: [],
    },
    fallback_policy: "none",
    telemetry_tags: { task: "chat_ideation", criticality: "high" },
  },
  chat_generation: {
    output_contract: "chat_generation_v1",
    mode: "generation",
    retry_policy: {
      max_attempts: 1,
      retryable_codes: [],
    },
    fallback_policy: "none",
    telemetry_tags: { task: "chat_generation", criticality: "high" },
  },
  chat_iteration: {
    output_contract: "chat_iteration_v1",
    mode: "iteration",
    retry_policy: {
      max_attempts: 1,
      retryable_codes: [],
    },
    fallback_policy: "none",
    telemetry_tags: { task: "chat_iteration", criticality: "high" },
  },
  generate: {
    output_contract: "recipe_envelope_v1",
    mode: "legacy",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: STRICT_JSON_RETRYABLE_CODES,
    },
    fallback_policy: "deterministic_only",
    telemetry_tags: { task: "generate", criticality: "medium" },
  },
  tweak: {
    output_contract: "recipe_tweak_legacy_v1",
    mode: "legacy",
    retry_policy: {
      max_attempts: 1,
      retryable_codes: [],
    },
    fallback_policy: "none",
    telemetry_tags: { task: "tweak_legacy", criticality: "low" },
  },
  classify: {
    output_contract: "classification_v1",
    mode: "classification",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: STANDARD_RETRYABLE_CODES,
    },
    fallback_policy: "deterministic_only",
    telemetry_tags: { task: "classify", criticality: "medium" },
  },
  ingredient_alias_normalize: {
    output_contract: "ingredient_alias_normalize_v1",
    mode: "classification",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: [...STRICT_JSON_RETRYABLE_CODES, ...STANDARD_RETRYABLE_CODES],
    },
    fallback_policy: "deterministic_only",
    telemetry_tags: { task: "ingredient_alias_normalize", criticality: "medium" },
  },
  ingredient_phrase_split: {
    output_contract: "ingredient_phrase_split_v1",
    mode: "classification",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: [...STRICT_JSON_RETRYABLE_CODES, ...STANDARD_RETRYABLE_CODES],
    },
    fallback_policy: "deterministic_only",
    telemetry_tags: { task: "ingredient_phrase_split", criticality: "medium" },
  },
  ingredient_enrich: {
    output_contract: "ingredient_enrich_v1",
    mode: "classification",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: [...STRICT_JSON_RETRYABLE_CODES, ...STANDARD_RETRYABLE_CODES],
    },
    fallback_policy: "deterministic_only",
    telemetry_tags: { task: "ingredient_enrich", criticality: "medium" },
  },
  recipe_metadata_enrich: {
    output_contract: "recipe_metadata_enrich_v1",
    mode: "classification",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: [...STRICT_JSON_RETRYABLE_CODES, ...STANDARD_RETRYABLE_CODES],
    },
    fallback_policy: "deterministic_only",
    telemetry_tags: { task: "recipe_metadata_enrich", criticality: "medium" },
  },
  ingredient_relation_infer: {
    output_contract: "ingredient_relation_infer_v1",
    mode: "classification",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: [...STRICT_JSON_RETRYABLE_CODES, ...STANDARD_RETRYABLE_CODES],
    },
    fallback_policy: "deterministic_only",
    telemetry_tags: { task: "ingredient_relation_infer", criticality: "medium" },
  },
  preference_normalize: {
    output_contract: "preference_normalize_v1",
    mode: "classification",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: [...STRICT_JSON_RETRYABLE_CODES, ...STANDARD_RETRYABLE_CODES],
    },
    fallback_policy: "deterministic_only",
    telemetry_tags: { task: "preference_normalize", criticality: "medium" },
  },
  equipment_filter: {
    output_contract: "equipment_filter_v1",
    mode: "classification",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: [...STRICT_JSON_RETRYABLE_CODES, ...STANDARD_RETRYABLE_CODES],
    },
    fallback_policy: "deterministic_only",
    telemetry_tags: { task: "equipment_filter", criticality: "medium" },
  },
  onboarding: {
    output_contract: "onboarding_assistant_v1",
    mode: "onboarding",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: STRICT_JSON_RETRYABLE_CODES,
    },
    fallback_policy: "none",
    telemetry_tags: { task: "onboarding", criticality: "high" },
  },
  image: {
    output_contract: "image_generation_v1",
    mode: "image",
    retry_policy: {
      max_attempts: 1,
      retryable_codes: [],
    },
    fallback_policy: "none",
    telemetry_tags: { task: "image", criticality: "medium" },
  },
  memory_extract: {
    output_contract: "memory_extract_v1",
    mode: "memory",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: [...STRICT_JSON_RETRYABLE_CODES, ...STANDARD_RETRYABLE_CODES],
    },
    fallback_policy: "deterministic_only",
    telemetry_tags: { task: "memory_extract", criticality: "medium" },
  },
  memory_select: {
    output_contract: "memory_select_v1",
    mode: "memory",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: [...STRICT_JSON_RETRYABLE_CODES, ...STANDARD_RETRYABLE_CODES],
    },
    fallback_policy: "deterministic_only",
    telemetry_tags: { task: "memory_select", criticality: "medium" },
  },
  memory_summarize: {
    output_contract: "memory_summarize_v1",
    mode: "memory",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: [...STRICT_JSON_RETRYABLE_CODES, ...STANDARD_RETRYABLE_CODES],
    },
    fallback_policy: "deterministic_only",
    telemetry_tags: { task: "memory_summarize", criticality: "medium" },
  },
  memory_conflict_resolve: {
    output_contract: "memory_conflict_resolve_v1",
    mode: "memory",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: [...STRICT_JSON_RETRYABLE_CODES, ...STANDARD_RETRYABLE_CODES],
    },
    fallback_policy: "deterministic_only",
    telemetry_tags: { task: "memory_conflict_resolve", criticality: "medium" },
  },
} as const satisfies Record<string, LlmScopeDefinition>;

export type GatewayScope = keyof typeof LLM_SCOPE_REGISTRY;

export const isGatewayScope = (value: string): value is GatewayScope => {
  return Object.prototype.hasOwnProperty.call(LLM_SCOPE_REGISTRY, value);
};

export const getLlmScopeDefinition = (
  scope: GatewayScope,
): LlmScopeDefinition => {
  return LLM_SCOPE_REGISTRY[scope];
};
