import { applyIngredientDietCompatibilityGuard } from "./ingredient-enrichment-guards.ts";
import type { JsonValue } from "../_shared/types.ts";

const assertEqual = (
  actual: unknown,
  expected: unknown,
  message: string,
): void => {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(
      `${message}\nexpected: ${expectedJson}\nreceived: ${actualJson}`,
    );
  }
};

Deno.test("removes pescatarian/vegetarian/vegan from chicken breast", () => {
  const metadata: Record<string, JsonValue> = {
    food_group: "Poultry",
    ingredient_family: ["Chicken"],
    diet_compatibility: ["Omnivore", "Pescatarian", "Vegetarian", "Vegan"],
  };

  const result = applyIngredientDietCompatibilityGuard({
    canonicalName: "Chicken Breast",
    metadata,
    ontologyTermKeys: ["food_group:poultry"],
  });

  assertEqual(
    result.metadata.diet_compatibility,
    ["Omnivore"],
    "chicken should not remain pescatarian/vegetarian/vegan",
  );
  assertEqual(
    result.removedDietTags.sort((left, right) => left.localeCompare(right)),
    ["Pescatarian", "Vegan", "Vegetarian"].sort((left, right) =>
      left.localeCompare(right)
    ),
    "expected incompatible diet tags to be removed",
  );
});

Deno.test("keeps pescatarian for seafood and removes vegetarian", () => {
  const metadata: Record<string, JsonValue> = {
    food_group: "Seafood",
    diet_compatibility: ["Omnivore", "Pescatarian", "Vegetarian", "Vegan"],
  };

  const result = applyIngredientDietCompatibilityGuard({
    canonicalName: "Atlantic Salmon",
    metadata,
    ontologyTermKeys: ["food_group:seafood"],
  });

  assertEqual(
    result.metadata.diet_compatibility,
    ["Omnivore", "Pescatarian"],
    "seafood should stay pescatarian but not vegetarian/vegan",
  );
});

Deno.test("removes vegan for dairy ingredients", () => {
  const metadata: Record<string, JsonValue> = {
    food_group: "Dairy",
    diet_compatibility: ["Vegetarian", "Pescatarian", "Vegan"],
  };

  const result = applyIngredientDietCompatibilityGuard({
    canonicalName: "Whole Milk",
    metadata,
    ontologyTermKeys: ["food_group:dairy"],
  });

  assertEqual(
    result.metadata.diet_compatibility,
    ["Vegetarian", "Pescatarian"],
    "dairy should not remain vegan",
  );
});

Deno.test("preserves plant ingredient compatibility", () => {
  const metadata: Record<string, JsonValue> = {
    food_group: "Legume",
    ingredient_family: ["Soy"],
    diet_compatibility: ["Vegan", "Vegetarian", "Pescatarian", "Omnivore"],
  };

  const result = applyIngredientDietCompatibilityGuard({
    canonicalName: "Firm Tofu",
    metadata,
    ontologyTermKeys: ["food_group:legume"],
  });

  assertEqual(
    result.metadata.diet_compatibility,
    ["Vegan", "Vegetarian", "Pescatarian", "Omnivore"],
    "plant ingredients should keep compatible diet tags",
  );
  assertEqual(result.removedDietTags, [], "no tags should be removed");
});
