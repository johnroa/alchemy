export const RECIPE_RENDER_VERBOSITIES = ["concise", "balanced", "detailed"] as const;
export type RecipeRenderVerbosity = (typeof RECIPE_RENDER_VERBOSITIES)[number];

export const RECIPE_RENDER_UNITS = ["imperial", "metric"] as const;
export type RecipeRenderUnits = (typeof RECIPE_RENDER_UNITS)[number];

export const RECIPE_RENDER_GROUP_BY = ["component", "category", "flat"] as const;
export type RecipeRenderGroupBy = (typeof RECIPE_RENDER_GROUP_BY)[number];

export const RECIPE_RENDER_TEMPERATURE_UNITS = ["fahrenheit", "celsius"] as const;
export type RecipeRenderTemperatureUnit = (typeof RECIPE_RENDER_TEMPERATURE_UNITS)[number];

export type RecipeRenderIngredient = {
  name: string;
  amount: string | number | null;
  unit: string | null;
  display_amount: string | null;
  preparation: string | null;
  category: string | null;
  component: string | null;
};

export type RecipeRenderIngredientGroup = {
  key: string;
  label: string;
  ingredients: RecipeRenderIngredient[];
};

export type RecipeRenderStep = {
  index: number;
  instruction: string;
  title: string | null;
  notes: string | null;
};

export type RecipeRenderPreview = {
  id: string;
  title: string;
  summary: string;
  description: string | null;
  servings: number | null;
  ingredients: RecipeRenderIngredient[];
  ingredient_groups: RecipeRenderIngredientGroup[];
  steps: RecipeRenderStep[];
  notes: string | null;
  pairings: string[];
  image_url: string | null;
  image_status: string;
};

export type RecipeRenderSource =
  | {
    kind: "canonical";
    label: string;
  }
  | {
    kind: "cookbook_entry";
    label: string;
    cookbook_entry_id: string;
    canonical_recipe_id: string | null;
    canonical_status: string | null;
    source_kind: string | null;
    canonical_failure_reason: string | null;
    source_chat_id: string | null;
    user_email: string | null;
    variant_id: string | null;
    variant_status: string | null;
    derivation_kind: string | null;
    adaptation_summary: string;
    personalized_at: string | null;
  };

export type RecipeRenderInspectorResponse = {
  source: RecipeRenderSource;
  options: {
    units: RecipeRenderUnits;
    group_by: RecipeRenderGroupBy;
    inline_measurements: boolean;
    temperature_unit: RecipeRenderTemperatureUnit;
  };
  previews: Record<RecipeRenderVerbosity, RecipeRenderPreview>;
};
