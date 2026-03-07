import type { GatewayScope as GatewayScopeType } from "./llm-scope-registry.ts";
export type { GatewayScope } from "./llm-scope-registry.ts";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ErrorEnvelope = {
  code: string;
  message: string;
  details?: JsonValue;
  request_id: string;
};

export type AssistantReply = {
  text: string;
  tone?: string;
  emoji?: string[];
  suggested_next_actions?: string[];
  focus_summary?: string;
};

export type OnboardingState = {
  completed: boolean;
  progress: number;
  missing_topics: string[];
  state: Record<string, JsonValue>;
};

export type OnboardingAssistantEnvelope = {
  assistant_reply: AssistantReply;
  onboarding_state: OnboardingState;
  preference_updates?: Record<string, JsonValue>;
};

export type IngredientMetadataV2 = {
  metadata_schema_version?: number;
  food_group?: string;
  ingredient_family?: string[];
  functional_classes?: string[];
  diet_compatibility?: string[];
  allergen_profile?: string[];
  flavor_notes?: string[];
  aroma_notes?: string[];
  heat_level?: string;
  texture_effect?: string[];
  processing_level?: string;
  storage_sensitivity?: string[];
  additive_classes?: string[];
  ontology_ids?: {
    internal_term_keys?: string[];
    foodon?: string[];
    langual?: string[];
    wikidata?: string[];
  };
  [key: string]: JsonValue | undefined;
};

export type RecipeMetadataV2 = {
  metadata_schema_version?: number;
  vibe?: string;
  flavor_profile?: string[];
  flavor_axes?: {
    sweet?: number;
    salty?: number;
    sour?: number;
    bitter?: number;
    umami?: number;
    fatty?: number;
  };
  spice_level?: string;
  nutrition?: {
    calories?: number;
    protein_g?: number;
    carbs_g?: number;
    fat_g?: number;
    fiber_g?: number;
    sugar_g?: number;
    sodium_mg?: number;
  };
  difficulty?: "easy" | "medium" | "complex";
  skill_level?: string;
  complexity_score?: number;
  health_score?: number;
  time_minutes?: number;
  items?: number;
  quick_stats?: {
    time_minutes: number;
    difficulty: "easy" | "medium" | "complex";
    health_score: number;
    items: number;
  };
  allergens?: string[];
  allergen_flags?: string[];
  diet_tags?: string[];
  health_flags?: string[];
  substitutions?: Array<{
    from: string;
    to: string;
    note?: string;
  }>;
  timing?: {
    prep_minutes?: number;
    cook_minutes?: number;
    total_minutes?: number;
  };
  cuisine_tags?: string[];
  occasion_tags?: string[];
  cuisine?: string[];
  course_type?: string;
  seasonality?: string[];
  techniques?: string[];
  equipment?: string[];
  pairing_rationale?: string[];
  serving_notes?: string[];
  storage_reheat_profile?: {
    storage?: string[];
    reheat?: string[];
  };
  practical?: {
    cost_tier?: string;
    meal_prep_friendly?: boolean;
  };
  [key: string]: JsonValue | undefined;
};

export type RecipeMetadata = RecipeMetadataV2;

export type PreferenceConflictStatus =
  | "pending_confirmation"
  | "adapt"
  | "override"
  | "cleared";

export type PreferenceConflictContext = {
  status?: PreferenceConflictStatus;
  conflicting_preferences?: string[];
  conflicting_aversions?: string[];
  requested_terms?: string[];
};

export type AssistantResponseContext = {
  mode?: string;
  intent?: "in_scope_ideation" | "in_scope_generate" | "out_of_scope";
  changed_sections?: string[];
  personalization_notes?: string[];
  preference_updates?: Record<string, JsonValue>;
  preference_conflict?: PreferenceConflictContext;
};

export type RecipePayload = {
  title: string;
  summary?: string;
  description?: string;
  servings: number;
  ingredients: Array<{
    name: string;
    amount: number;
    unit: string;
    display_amount?: string;
    preparation?: string;
    category?: string;
  }>;
  steps: Array<{
    index: number;
    instruction: string;
    timer_seconds?: number;
    notes?: string;
    inline_measurements?: Array<{
      ingredient: string;
      amount: number;
      unit: string;
    }>;
  }>;
  notes?: string;
  pairings?: string[];
  emoji?: string[];
  metadata?: RecipeMetadata;
  attachments?: Array<{
    title: string;
    relation_type: string;
    recipe: Omit<RecipePayload, "attachments">;
  }>;
};

export type RecipeAssistantEnvelope = {
  recipe: RecipePayload;
  assistant_reply: AssistantReply;
  response_context?: AssistantResponseContext;
};

export type ChatAssistantEnvelope = {
  assistant_reply: AssistantReply;
  recipe?: RecipePayload;
  trigger_recipe?: boolean;
  candidate_recipe_set?: CandidateRecipeSet;
  response_context?: AssistantResponseContext;
};

export type ChatLoopState = "ideation" | "candidate_presented" | "iterating";

export type CandidateRecipeRole = "main" | "side" | "appetizer" | "dessert" | "drink";

export type CandidateRecipeImageStatus =
  | "pending"
  | "processing"
  | "ready"
  | "failed";

export type CandidateRecipeComponent = {
  component_id: string;
  role: CandidateRecipeRole;
  title: string;
  image_url: string | null;
  image_status: CandidateRecipeImageStatus;
  recipe: RecipePayload;
};

export type CandidateRecipeSet = {
  candidate_id: string;
  revision: number;
  active_component_id: string;
  components: CandidateRecipeComponent[];
};

/**
 * Intermediate representation between raw recipe extraction and LLM
 * normalisation. All import sources (URL scraping, vision OCR, pasted text)
 * produce this contract before it enters the `recipe_import_transform` scope.
 *
 * Fields are intentionally loose strings — the transform LLM is responsible
 * for parsing them into structured `RecipePayload` fields.
 */
export type ImportedRecipeDocument = {
  title?: string;
  description?: string;
  /** Raw ingredient strings, e.g. "1 cup flour, sifted" */
  ingredients: string[];
  /** Raw step/instruction strings before numbering or timer detection */
  instructions: string[];
  /** e.g. "4 servings", "6 portions" */
  yields?: string;
  /** ISO 8601 duration or raw string like "20 minutes" */
  prepTime?: string;
  cookTime?: string;
  totalTime?: string;
  author?: string;
  cuisine?: string;
  category?: string;
  /** 0–1 float indicating how complete/reliable the extraction is */
  confidence: number;
  /** Field names that could not be extracted from the source */
  missingFields: string[];
  /** Which extraction path produced this document */
  extractionStrategy:
    | "json_ld"
    | "microdata"
    | "opengraph"
    | "meta_fallback"
    | "vision"
    | "raw_text";
  sourceUrl?: string;
  sourceSiteName?: string;
};

/**
 * Envelope returned by the `recipe_import_transform` LLM scope.
 * Combines the normalised recipe with an assistant reply acknowledging the
 * import and a response context for downstream chat flow integration.
 */
export type ImportTransformEnvelope = {
  recipe: RecipePayload;
  assistant_reply: AssistantReply;
  response_context?: AssistantResponseContext;
};

/** Discriminated union for POST /chat/import request body. */
export type ImportRequest =
  | { kind: "url"; url: string; origin?: string }
  | { kind: "text"; text: string; origin?: string }
  | { kind: "photo"; photo_asset_ref: string; origin?: string };

export type ImportSourceKind = "url" | "text" | "photo";

export type GatewayConfig = {
  promptTemplate: string;
  rule: Record<string, JsonValue>;
  provider: string;
  model: string;
  modelConfig: Record<string, JsonValue>;
  inputCostPer1m: number;
  outputCostPer1m: number;
  billingMode: "token" | "image";
  billingMetadata: Record<string, JsonValue>;
};

export type MemoryRecord = {
  id: string;
  memory_type: string;
  memory_kind: string;
  memory_content: JsonValue;
  confidence: number;
  salience: number;
  status: string;
  source?: string;
  created_at?: string;
  updated_at?: string;
};
