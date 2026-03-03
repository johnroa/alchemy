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

export type RecipeMetadata = {
  vibe?: string;
  flavor_profile?: string[];
  nutrition?: {
    calories?: number;
    protein_g?: number;
    carbs_g?: number;
    fat_g?: number;
    fiber_g?: number;
    sugar_g?: number;
    sodium_mg?: number;
  };
  difficulty?: string;
  allergens?: string[];
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
  pairing_rationale?: string[];
  serving_notes?: string[];
  [key: string]: JsonValue | undefined;
};

export type RecipePayload = {
  title: string;
  description?: string;
  servings: number;
  ingredients: Array<{
    name: string;
    amount: number;
    unit: string;
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
  response_context?: {
    mode?: string;
    changed_sections?: string[];
    personalization_notes?: string[];
    preference_updates?: Record<string, JsonValue>;
  };
};

export type DraftAssistantEnvelope = {
  assistant_reply: AssistantReply;
  recipe?: RecipePayload;
  response_context?: {
    mode?: string;
    changed_sections?: string[];
    personalization_notes?: string[];
    preference_updates?: Record<string, JsonValue>;
  };
};

export type GatewayScope =
  | "generate"
  | "tweak"
  | "classify"
  | "onboarding"
  | "image"
  | "memory_extract"
  | "memory_select"
  | "memory_summarize"
  | "memory_conflict_resolve";

export type GatewayConfig = {
  promptTemplate: string;
  rule: Record<string, JsonValue>;
  provider: string;
  model: string;
  modelConfig: Record<string, JsonValue>;
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
