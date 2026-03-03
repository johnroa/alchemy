import type { JsonValue } from "../_shared/types.ts";

export type PreferenceContextPatch = Partial<{
  free_form: string | null;
  dietary_preferences: string[];
  dietary_restrictions: string[];
  skill_level: string;
  equipment: string[];
  cuisines: string[];
  aversions: string[];
  cooking_for: string | null;
  max_difficulty: number;
  presentation_preferences: Record<string, JsonValue>;
}>;

const rawTextPresentationPreferenceKeys = [
  "raw_dietary_preferences",
  "raw_dietary_restrictions",
  "raw_special_equipment",
  "raw_cuisines",
  "raw_disliked_ingredients",
] as const;

export const sanitizeModelPreferencePatch = (
  patch: PreferenceContextPatch,
): PreferenceContextPatch => {
  const { free_form: _ignoredFreeFormUpdate, ...safePatch } = patch;
  const presentation = safePatch.presentation_preferences;
  if (!presentation) {
    return safePatch;
  }

  const sanitizedPresentation = { ...presentation };
  for (const key of rawTextPresentationPreferenceKeys) {
    delete sanitizedPresentation[key];
  }

  safePatch.presentation_preferences = sanitizedPresentation;
  return safePatch;
};
