/**
 * llm-gateway/types.ts
 *
 * Shared type definitions for the LLM gateway layer. All structured
 * result shapes returned by normalizers, scope executors, and gateway
 * entry-points are defined here to keep the rest of the module tree
 * import-clean and avoid circular dependencies.
 */

import type { JsonValue, RecipePayload, AssistantReply } from "../types.ts";

export type GatewayInput = {
  userPrompt: string;
  context: Record<string, JsonValue>;
};

export type ClassificationResult = {
  label: string;
  reason?: string;
  isAllowed?: boolean;
};

export type CategoryInference = {
  category: string;
  confidence: number;
};

export type IngredientAliasNormalization = {
  alias_key: string;
  canonical_name: string;
  confidence: number;
};

export type IngredientPhraseSplit = {
  source_name: string;
  items: Array<{
    name: string;
    confidence: number;
  }>;
};

export type IngredientLineMention = {
  name: string;
  role: "primary" | "optional" | "alternative" | "garnish" | "unspecified";
  alternative_group_key: string | null;
  confidence: number;
};

export type IngredientLineQualifier = {
  term_type:
    | "preparation"
    | "state"
    | "quality"
    | "size"
    | "purpose"
    | "temperature"
    | "treatment";
  term_key: string;
  label: string;
  relation_type:
    | "prepared_as"
    | "has_state"
    | "has_quality"
    | "has_size"
    | "has_purpose"
    | "has_temperature"
    | "has_treatment";
  target: "line" | number;
  confidence: number;
};

export type IngredientLineParse = {
  source_name: string;
  line_confidence: number;
  mentions: IngredientLineMention[];
  qualifiers: IngredientLineQualifier[];
};

export type OntologySuggestion = {
  term_type: string;
  term_key: string;
  label: string;
  relation_type: string;
  confidence: number;
};

export type IngredientSemanticEnrichment = {
  canonical_name: string;
  confidence: number;
  metadata: Record<string, JsonValue>;
  ontology_terms: OntologySuggestion[];
};

export type RecipeSemanticEnrichment = {
  confidence: number;
  metadata: Record<string, JsonValue>;
};

export type RecipeSearchEmbedding = {
  vector: number[];
  dimensions: number;
  provider: string;
  model: string;
};

export type RecipeSearchInterpretationEnvelope = {
  normalized_query?: unknown;
  applied_context?: unknown;
  hard_filters?: unknown;
  soft_targets?: unknown;
  exclusions?: unknown;
  sort_bias?: unknown;
  query_style?: unknown;
};

export type RecipeSearchRerankEnvelope = {
  ordered_recipe_ids?: unknown;
  rationale_tags_by_recipe?: unknown;
};

export type ExploreForYouProfileEnvelope = {
  retrieval_text?: unknown;
  profile_summary?: unknown;
  focus_axes?: unknown;
  novelty_axes?: unknown;
  avoid_axes?: unknown;
  anchor_recipes?: unknown;
};

export type ExploreForYouRankEnvelope = {
  ordered_recipe_ids?: unknown;
  rationale_tags_by_recipe?: unknown;
};

export type DemandFacetExtraction = {
  facet: string;
  normalized_value: string;
  raw_value?: string | null;
  polarity?: "positive" | "negative" | "neutral";
  confidence?: number | null;
  rank?: number | null;
  metadata?: Record<string, JsonValue>;
};

export type DemandObservationExtraction = {
  summary?: string | null;
  why_now?: string | null;
  privacy_tier?: "derived" | "redacted_snippet" | null;
  admin_snippet_redacted?: string | null;
  facts?: DemandFacetExtraction[] | null;
};

export type DemandEntityLinkSelection = {
  fact_index: number;
  entity_id: string | null;
  confidence?: number | null;
};

export type DemandEntityLinkResult = {
  items?: DemandEntityLinkSelection[] | null;
};

export type DemandOutcomeSummary = {
  summary?: string | null;
  admin_snippet_redacted?: string | null;
};

export type IngredientSemanticRelation = {
  from_canonical_name: string;
  to_canonical_name: string;
  relation_type: string;
  confidence: number;
  rationale?: string;
};

export type MemoryCandidate = {
  memory_type: string;
  memory_kind?: string;
  memory_content: JsonValue;
  confidence?: number;
  salience?: number;
  source?: string;
};

export type MemorySelection = {
  selected_memory_ids: string[];
  rationale?: string;
};

export type MemorySummary = {
  summary: Record<string, JsonValue>;
  token_estimate?: number;
};

import type { ModelOverrideMap as ExecutorModelOverrideMap } from "../llm-executor.ts";

export type ModelOverrideMap = ExecutorModelOverrideMap;

/**
 * A single ingredient substitution made during personalization.
 * Captures what was swapped, the replacement, the driving constraint,
 * and a human-readable reason. Stored in provenance and aggregated
 * into graph edges by the batch substitution aggregator (Phase 8).
 */
export type SubstitutionDiff = {
  original: string;
  replacement: string;
  constraint: string;
  reason: string;
};

/** Output from llmGateway.personalizeRecipe — the materialised variant. */
export type PersonalizeRecipeResult = {
  recipe: RecipePayload;
  adaptationSummary: string;
  appliedAdaptations: JsonValue[];
  tagDiff: { added: string[]; removed: string[] };
  /**
   * Structured substitution diffs — each entry describes an ingredient
   * swap made during personalization. Used by the graph feedback loop
   * to aggregate proven substitution patterns into knowledge graph edges.
   */
  substitutionDiffs: SubstitutionDiff[];
  /**
   * Conflicts detected when reapplying manual edits during constraint-driven
   * re-personalization. Each entry describes a manual edit that contradicts
   * the current constraint set (e.g., "use butter" conflicts with dairy-free).
   * When non-empty, the variant should be marked `needs_review`.
   */
  conflicts: string[];
};

export type CanonicalizeRecipeResult = {
  recipe: RecipePayload;
  rationale: string | null;
};

export type CanonicalRecipeReviewResult = {
  approved: boolean;
  rationale: string | null;
  leakageDetected: boolean;
  semanticDriftDetected: boolean;
};

export type RecipeCanonMatchEnvelope = {
  decision?: unknown;
  matched_recipe_id?: unknown;
  matched_recipe_version_id?: unknown;
  rationale?: unknown;
  confidence?: unknown;
};

export type TokenAccum = { input: number; output: number; costUsd: number };

export type ImageQualityWinner = "A" | "B" | "tie";

export type ImageQualityEvaluationResult = {
  winner: ImageQualityWinner;
  rationale: string;
  confidence: number | null;
};

export type ImageReuseDecision = "reuse" | "generate_new";

export type ImageReuseEvaluationResult = {
  decision: ImageReuseDecision;
  selectedCandidateId: string | null;
  rationale: string;
  confidence: number | null;
};

export type ConflictResolution = {
  actions: Array<{
    action: "keep" | "supersede" | "delete" | "merge";
    memory_id?: string;
    supersedes_memory_id?: string;
    merged_content?: JsonValue;
    reason?: string;
  }>;
};

export type ChatConversationScope =
  | "chat_ideation"
  | "chat_generation"
  | "chat_iteration";
