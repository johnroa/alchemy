import type { components } from "@alchemy/contracts";

export type RecipeStat = {
  label: string;
  value: string;
};

type Recipe = components["schemas"]["Recipe"];
type RecipeMetadata = components["schemas"]["RecipeMetadata"];

const toDisplayList = (values: string[] | undefined): string[] =>
  [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];

const formatMinutes = (minutes: number | undefined): string | null => {
  if (!minutes || minutes <= 0) {
    return null;
  }

  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder > 0 ? `${hours} hr ${remainder} min` : `${hours} hr`;
};

const formatDifficulty = (difficulty: RecipeMetadata["difficulty"]): string | null => {
  if (!difficulty) {
    return null;
  }

  return difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
};

export const buildRecipeStats = (recipe: Recipe): RecipeStat[] => {
  const quickStats = recipe.metadata?.quick_stats;
  const time = formatMinutes(quickStats?.time_minutes ?? recipe.metadata?.time_minutes);
  const difficulty = formatDifficulty(quickStats?.difficulty ?? recipe.metadata?.difficulty);

  return [
    { label: "Servings", value: String(recipe.servings) },
    ...(time ? [{ label: "Time", value: time }] : []),
    ...(difficulty ? [{ label: "Difficulty", value: difficulty }] : []),
    { label: "Ingredients", value: String(recipe.ingredients.length) }
  ];
};

export const buildRecipeDescriptors = (metadata: RecipeMetadata | undefined): string[] =>
  [
    ...toDisplayList(metadata?.cuisine_tags),
    ...toDisplayList(metadata?.diet_tags),
    ...toDisplayList(metadata?.occasion_tags),
    ...toDisplayList(metadata?.techniques),
    ...toDisplayList(metadata?.health_flags),
    ...toDisplayList(metadata?.equipment),
    ...toDisplayList(metadata?.pairing_rationale),
    ...toDisplayList(metadata?.serving_notes)
  ].slice(0, 8);
