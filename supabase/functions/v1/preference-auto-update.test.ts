import { sanitizeModelPreferencePatch } from "./preference-auto-update.ts";

Deno.test("sanitizeModelPreferencePatch strips raw presentation keys but keeps inferred structured fields", () => {
  const sanitized = sanitizeModelPreferencePatch({
    free_form: "I cook for family",
    equipment: ["wire rack", "9x13-inch baking dish"],
    dietary_preferences: ["vegetarian"],
    presentation_preferences: {
      recipe_units: "metric",
      raw_special_equipment: "wire rack",
    },
  });

  if ("free_form" in sanitized) {
    throw new Error(
      "expected free_form to be removed from assistant auto-updates",
    );
  }

  if (sanitized.equipment?.[0] !== "wire rack") {
    throw new Error("expected structured equipment inference to be preserved");
  }

  if (sanitized.dietary_preferences?.[0] !== "vegetarian") {
    throw new Error("expected non-blocked preference fields to be preserved");
  }

  if ("raw_special_equipment" in (sanitized.presentation_preferences ?? {})) {
    throw new Error(
      "expected raw assistant text presentation keys to be removed",
    );
  }

  if (sanitized.presentation_preferences?.["recipe_units"] !== "metric") {
    throw new Error("expected presentation_preferences to be preserved");
  }
});
