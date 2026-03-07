export type LlmRoute = {
  id: string;
  scope: string;
  route_name: string;
  provider: string;
  model: string;
  config: Record<string, unknown>;
  is_active: boolean;
};

export type Prompt = {
  id: string;
  scope: string;
  version: number;
  name: string;
  template: string;
  is_active: boolean;
};

export type Rule = {
  id: string;
  scope: string;
  version: number;
  name: string;
  rule: Record<string, unknown>;
  is_active: boolean;
};

export type RegistryModel = {
  id: string;
  provider: string;
  model: string;
  display_name: string;
  input_cost_per_1m_tokens: number;
  output_cost_per_1m_tokens: number;
  billing_mode: "token" | "image";
  billing_metadata: Record<string, unknown>;
  context_window_tokens: number | null;
  max_output_tokens: number | null;
  is_available: boolean;
  notes: string | null;
};

export type LlmPanelMode = "routing" | "prompts" | "rules" | "models";

export const ALL_SCOPES = [
  "chat_ideation",
  "chat_generation",
  "chat_iteration",
  "generate",
  "classify",
  "ingredient_alias_normalize",
  "ingredient_phrase_split",
  "ingredient_enrich",
  "recipe_metadata_enrich",
  "ingredient_relation_infer",
  "preference_normalize",
  "equipment_filter",
  "onboarding",
  "image",
  "image_quality_eval",
  "memory_extract",
  "memory_select",
  "memory_summarize",
  "memory_conflict_resolve"
] as const;

export type Scope = (typeof ALL_SCOPES)[number];
