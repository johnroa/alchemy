import { applySemanticDietIncompatibilityRules } from "./semantic-diet-compatibility.ts";
import type { JsonValue } from "../_shared/types.ts";

const assertEqual = (actual: unknown, expected: unknown, message: string): void => {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}\nexpected: ${expectedJson}\nreceived: ${actualJson}`);
  }
};

const rules = [
  { source_term_type: "food_group", source_term_key: "poultry", blocked_diet_tag: "pescatarian", reason: "Poultry is not pescatarian", is_active: true },
  { source_term_type: "food_group", source_term_key: "poultry", blocked_diet_tag: "vegetarian", reason: "Poultry is not vegetarian", is_active: true },
  { source_term_type: "food_group", source_term_key: "poultry", blocked_diet_tag: "vegan", reason: "Poultry is not vegan", is_active: true },
  { source_term_type: "food_group", source_term_key: "seafood", blocked_diet_tag: "vegetarian", reason: "Seafood is not vegetarian", is_active: true },
  { source_term_type: "food_group", source_term_key: "seafood", blocked_diet_tag: "vegan", reason: "Seafood is not vegan", is_active: true },
  { source_term_type: "food_group", source_term_key: "dairy", blocked_diet_tag: "vegan", reason: "Dairy is not vegan", is_active: true },
];

Deno.test("removes incompatible diet tags from poultry metadata", () => {
  const metadata: Record<string, JsonValue> = {
    food_group: "Poultry",
    diet_compatibility: ["Omnivore", "Pescatarian", "Vegetarian", "Vegan"],
  };

  const result = applySemanticDietIncompatibilityRules({
    metadata,
    rules,
    ontologyTerms: [{ term_type: "food_group", term_key: "poultry" }],
  });

  assertEqual(result.metadata.diet_compatibility, ["Omnivore"], "poultry should not keep pescatarian/vegetarian/vegan");
  assertEqual(
    result.removedDietTags.sort((a, b) => a.localeCompare(b)),
    ["Pescatarian", "Vegetarian", "Vegan"].sort((a, b) => a.localeCompare(b)),
    "expected poultry incompatibilities to be removed",
  );
});

Deno.test("keeps pescatarian when only seafood rules apply", () => {
  const metadata: Record<string, JsonValue> = {
    food_group: "Seafood",
    diet_compatibility: ["Omnivore", "Pescatarian", "Vegetarian", "Vegan"],
  };

  const result = applySemanticDietIncompatibilityRules({
    metadata,
    rules,
    ontologyTerms: [{ term_type: "food_group", term_key: "seafood" }],
  });

  assertEqual(result.metadata.diet_compatibility, ["Omnivore", "Pescatarian"], "seafood should keep pescatarian only");
});

Deno.test("uses ontology terms when food_group metadata is missing", () => {
  const metadata: Record<string, JsonValue> = {
    diet_compatibility: ["Vegan", "Vegetarian", "Pescatarian"],
  };

  const result = applySemanticDietIncompatibilityRules({
    metadata,
    rules,
    ontologyTerms: [{ term_type: "food_group", term_key: "dairy" }],
  });

  assertEqual(result.metadata.diet_compatibility, ["Vegetarian", "Pescatarian"], "dairy ontology signal should drop vegan");
});

Deno.test("normalizes diacritic variants in ontology diet signals", () => {
  const metadata: Record<string, JsonValue> = {
    diet_compatibility: ["Vegan", "Vegetarian"],
  };

  const result = applySemanticDietIncompatibilityRules({
    metadata,
    rules,
    ontologyTerms: [{ term_type: "food_group", term_key: "dáiry" }],
  });

  assertEqual(
    result.metadata.diet_compatibility,
    ["Vegetarian"],
    "diacritic variants should still match semantic diet incompatibility rules",
  );
});
