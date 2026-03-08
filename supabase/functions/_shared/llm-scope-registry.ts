import { LEGACY_LLM_SCOPE_REGISTRY } from "./llm-legacy-scopes.ts";
export type {
  LlmFallbackPolicy,
  LlmRetryPolicy,
  LlmScopeDefinition,
  LlmScopeMode,
} from "./llm-scope-types.ts";
import type { LlmScopeDefinition } from "./llm-scope-types.ts";

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
    fallback_policy: "none",
    telemetry_tags: { task: "ingredient_alias_normalize", criticality: "medium" },
  },
  ingredient_phrase_split: {
    output_contract: "ingredient_phrase_split_v1",
    mode: "classification",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: [...STRICT_JSON_RETRYABLE_CODES, ...STANDARD_RETRYABLE_CODES],
    },
    fallback_policy: "none",
    telemetry_tags: { task: "ingredient_phrase_split", criticality: "medium" },
  },
  ingredient_line_parse: {
    output_contract: "ingredient_line_parse_v1",
    mode: "classification",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: [...STRICT_JSON_RETRYABLE_CODES, ...STANDARD_RETRYABLE_CODES],
    },
    fallback_policy: "none",
    telemetry_tags: { task: "ingredient_line_parse", criticality: "medium" },
  },
  ingredient_enrich: {
    output_contract: "ingredient_enrich_v1",
    mode: "classification",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: [...STRICT_JSON_RETRYABLE_CODES, ...STANDARD_RETRYABLE_CODES],
    },
    fallback_policy: "none",
    telemetry_tags: { task: "ingredient_enrich", criticality: "medium" },
  },
  recipe_metadata_enrich: {
    output_contract: "recipe_metadata_enrich_v1",
    mode: "classification",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: [...STRICT_JSON_RETRYABLE_CODES, ...STANDARD_RETRYABLE_CODES],
    },
    fallback_policy: "none",
    telemetry_tags: { task: "recipe_metadata_enrich", criticality: "medium" },
  },
  recipe_search_embed: {
    output_contract: "recipe_search_embedding_v1",
    mode: "embedding",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: STANDARD_RETRYABLE_CODES,
    },
    fallback_policy: "none",
    telemetry_tags: { task: "recipe_search_embed", criticality: "medium" },
  },
  memory_retrieval_embed: {
    output_contract: "memory_retrieval_embedding_v1",
    mode: "embedding",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: STANDARD_RETRYABLE_CODES,
    },
    fallback_policy: "none",
    telemetry_tags: { task: "memory_retrieval_embed", criticality: "medium" },
  },
  recipe_search_interpret: {
    output_contract: "recipe_search_interpret_v1",
    mode: "classification",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: [...STRICT_JSON_RETRYABLE_CODES, ...STANDARD_RETRYABLE_CODES],
    },
    fallback_policy: "none",
    telemetry_tags: { task: "recipe_search_interpret", criticality: "medium" },
  },
  recipe_search_rerank: {
    output_contract: "recipe_search_rerank_v1",
    mode: "classification",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: [...STRICT_JSON_RETRYABLE_CODES, ...STANDARD_RETRYABLE_CODES],
    },
    fallback_policy: "none",
    telemetry_tags: { task: "recipe_search_rerank", criticality: "medium" },
  },
  explore_for_you_profile: {
    output_contract: "explore_for_you_profile_v1",
    mode: "classification",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: [...STRICT_JSON_RETRYABLE_CODES, ...STANDARD_RETRYABLE_CODES],
    },
    fallback_policy: "none",
    telemetry_tags: { task: "explore_for_you_profile", criticality: "high" },
  },
  explore_for_you_rank: {
    output_contract: "explore_for_you_rank_v1",
    mode: "classification",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: [...STRICT_JSON_RETRYABLE_CODES, ...STANDARD_RETRYABLE_CODES],
    },
    fallback_policy: "none",
    telemetry_tags: { task: "explore_for_you_rank", criticality: "high" },
  },
  ingredient_relation_infer: {
    output_contract: "ingredient_relation_infer_v1",
    mode: "classification",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: [...STRICT_JSON_RETRYABLE_CODES, ...STANDARD_RETRYABLE_CODES],
    },
    fallback_policy: "none",
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
  image_quality_eval: {
    output_contract: "image_quality_eval_v1",
    mode: "classification",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: [...STRICT_JSON_RETRYABLE_CODES, ...STANDARD_RETRYABLE_CODES],
    },
    fallback_policy: "none",
    telemetry_tags: { task: "image_quality_eval", criticality: "medium" },
  },
  image_reuse_eval: {
    output_contract: "image_reuse_eval_v1",
    mode: "classification",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: [...STRICT_JSON_RETRYABLE_CODES, ...STANDARD_RETRYABLE_CODES],
    },
    fallback_policy: "none",
    telemetry_tags: { task: "image_reuse_eval", criticality: "medium" },
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
  demand_extract_observation: {
    output_contract: "demand_extract_observation_v1",
    mode: "classification",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: [...STRICT_JSON_RETRYABLE_CODES, ...STANDARD_RETRYABLE_CODES],
    },
    fallback_policy: "none",
    telemetry_tags: { task: "demand_extract_observation", criticality: "high" },
  },
  demand_extract_iteration_delta: {
    output_contract: "demand_extract_iteration_delta_v1",
    mode: "classification",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: [...STRICT_JSON_RETRYABLE_CODES, ...STANDARD_RETRYABLE_CODES],
    },
    fallback_policy: "none",
    telemetry_tags: { task: "demand_extract_iteration_delta", criticality: "high" },
  },
  demand_link_entities: {
    output_contract: "demand_link_entities_v1",
    mode: "classification",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: [...STRICT_JSON_RETRYABLE_CODES, ...STANDARD_RETRYABLE_CODES],
    },
    fallback_policy: "deterministic_only",
    telemetry_tags: { task: "demand_link_entities", criticality: "medium" },
  },
  demand_summarize_outcome_reason: {
    output_contract: "demand_summarize_outcome_reason_v1",
    mode: "classification",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: [...STRICT_JSON_RETRYABLE_CODES, ...STANDARD_RETRYABLE_CODES],
    },
    fallback_policy: "deterministic_only",
    telemetry_tags: { task: "demand_summarize_outcome_reason", criticality: "medium" },
  },

  /**
   * recipe_canonicalize: derives the canonical (public, immutable) base recipe
   * from a personalized chat candidate. Strips stable user-specific adaptations
   * (equipment temp adjustments, dietary substitutions) while preserving dish
   * identity (title, core technique, flavour profile). Runs as the first phase
   * of the two-phase commit on chat save.
   *
   * Input: personalized recipe payload + user preference context
   * Output: canonical recipe payload (same schema as recipe_versions.payload)
   */
  recipe_canonicalize: {
    output_contract: "recipe_canonicalize_v1",
    mode: "generation",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: [...STRICT_JSON_RETRYABLE_CODES, ...STANDARD_RETRYABLE_CODES],
    },
    fallback_policy: "none",
    telemetry_tags: { task: "recipe_canonicalize", criticality: "high" },
  },

  /**
   * recipe_personalize: materialises a user's private variant from a canonical
   * recipe base + the user's active constraint/preference profile + any explicit
   * chat edits. Runs as the second phase of two-phase commit, and also for
   * on-save auto-personalisation and stale variant refresh.
   *
   * Input: canonical payload, user preferences, optional manual edit diff
   * Output: personalised recipe payload + structured tag diff + provenance record
   */
  recipe_personalize: {
    output_contract: "recipe_personalize_v1",
    mode: "generation",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: [...STRICT_JSON_RETRYABLE_CODES, ...STANDARD_RETRYABLE_CODES],
    },
    fallback_policy: "none",
    telemetry_tags: { task: "recipe_personalize", criticality: "high" },
  },

  /**
   * recipe_import_transform: converts an ImportedRecipeDocument (raw extracted
   * recipe data from URL scraping, OCR, or pasted text) into a structured
   * RecipePayload + AssistantReply.
   *
   * The prompt treats the source as factual reference only and rewrites into
   * Alchemy wording — never reproducing source phrasing verbatim (copyright).
   * Also enriches metadata (cuisine, difficulty, diet_tags, timing).
   *
   * Input: ImportedRecipeDocument JSON
   * Output: { recipe: RecipePayload, assistant_reply: AssistantReply, response_context }
   */
  recipe_import_transform: {
    output_contract: "recipe_import_transform_v1",
    mode: "generation",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: [...STRICT_JSON_RETRYABLE_CODES, ...STANDARD_RETRYABLE_CODES],
    },
    fallback_policy: "none",
    telemetry_tags: { task: "recipe_import_transform", criticality: "high" },
  },

  /**
   * recipe_import_vision_extract: extracts recipe data from a cookbook-page
   * photo or handwritten recipe image using a vision-capable model.
   *
   * Input: image (base64 or storage URL)
   * Output: ImportedRecipeDocument JSON (which then flows through
   *         recipe_import_transform for normalisation)
   *
   * Two-step flow (extract → transform) is preferred over single-step because
   * the intermediate document enables confidence scoring, missing-field
   * detection, and consistent normalisation across all source kinds.
   */
  recipe_import_vision_extract: {
    output_contract: "recipe_import_vision_extract_v1",
    mode: "generation",
    retry_policy: {
      max_attempts: 2,
      retryable_codes: [...STRICT_JSON_RETRYABLE_CODES, ...STANDARD_RETRYABLE_CODES],
    },
    fallback_policy: "none",
    telemetry_tags: { task: "recipe_import_vision_extract", criticality: "high" },
  },

  ...LEGACY_LLM_SCOPE_REGISTRY,
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
