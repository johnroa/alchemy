import type { JsonValue } from "../types.ts";

export type RecipeDifficulty = "easy" | "medium" | "complex";

export type RecipeQuickStats = {
  time_minutes: number;
  difficulty: RecipeDifficulty;
  health_score: number;
  items: number;
};

export type RecipeMetadataNormalizationIssue =
  | "difficulty_missing"
  | "health_score_missing"
  | "time_minutes_missing";

export type RecipeMetadataNormalizationResult = {
  metadata: Record<string, JsonValue>;
  issues: RecipeMetadataNormalizationIssue[];
};

export const RECIPE_STRING_FIELDS = [
  "vibe",
  "spice_level",
  "skill_level",
  "course_type",
] as const;

export const RECIPE_STRING_ARRAY_FIELDS = [
  "flavor_profile",
  "allergens",
  "allergen_flags",
  "diet_tags",
  "health_flags",
  "cuisine_tags",
  "occasion_tags",
  "cuisine",
  "seasonality",
  "techniques",
  "equipment",
  "pairing_rationale",
  "serving_notes",
] as const;

export const NUTRITION_FIELDS = [
  "calories",
  "protein_g",
  "carbs_g",
  "fat_g",
  "fiber_g",
  "sugar_g",
  "sodium_mg",
] as const;

export const FLAVOR_AXES_FIELDS = [
  "sweet",
  "salty",
  "sour",
  "bitter",
  "umami",
  "fatty",
] as const;
