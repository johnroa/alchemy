import {
  buildIngredientGroups,
  canonicalizeIngredients,
  deriveCanonicalIngredientIdentity,
  parseAmountValue,
  projectIngredientsForOutput,
  projectInlineMeasurements,
  resolvePresentationOptions
} from "./recipe-standardization.ts";
import type { RecipePayload } from "../_shared/types.ts";

Deno.test("parseAmountValue supports mixed fractions", () => {
  if (parseAmountValue("1 1/2") !== 1.5) {
    throw new Error("expected mixed fraction to parse");
  }

  if (parseAmountValue("3/4") !== 0.75) {
    throw new Error("expected fraction to parse");
  }

  if (parseAmountValue("abc") !== null) {
    throw new Error("expected invalid value to return null");
  }
});

Deno.test("canonicalizeIngredients marks unknown units as needs_retry", () => {
  const rows = canonicalizeIngredients([
    { name: "Olive Oil", amount: 2, unit: "tbsp" },
    { name: "Mystery Powder", amount: 3, unit: "scoops" }
  ] as RecipePayload["ingredients"]);

  if (rows[0]?.normalized_status !== "normalized") {
    throw new Error("expected known unit to normalize");
  }

  if (rows[0]?.normalized_unit !== "ml") {
    throw new Error("expected tbsp to convert to ml");
  }

  if (rows[1]?.normalized_status !== "needs_retry") {
    throw new Error("expected unknown unit to require retry");
  }
});

Deno.test("deriveCanonicalIngredientIdentity title-cases canonical keys", () => {
  const identity = deriveCanonicalIngredientIdentity("  black-pepper  ");

  if (identity.canonicalKey !== "black pepper") {
    throw new Error(`expected canonical key black pepper, received ${identity.canonicalKey}`);
  }

  if (identity.canonicalName !== "Black Pepper") {
    throw new Error(`expected canonical name Black Pepper, received ${identity.canonicalName}`);
  }
});

Deno.test("projectIngredientsForOutput converts SI to imperial", () => {
  const ingredients: RecipePayload["ingredients"] = [
    { name: "Flour", amount: 500, unit: "g" }
  ];

  const projected = projectIngredientsForOutput({
    sourceIngredients: ingredients,
    units: "imperial",
    canonicalRows: [
      {
        position: 0,
        ingredient_id: "ingredient-1",
        source_name: "Flour",
        source_amount: 500,
        source_unit: "g",
        normalized_amount_si: 500,
        normalized_unit: "g",
        unit_kind: "mass",
        normalized_status: "normalized",
        category: "Baking",
        component: "Dough"
      }
    ]
  });

  const first = projected[0];
  if (!first) {
    throw new Error("expected projected ingredient");
  }

  if (first.unit !== "lb") {
    throw new Error(`expected lb, received ${String(first.unit)}`);
  }

  if (Math.abs(first.amount - 1.1) > 0.01) {
    throw new Error(`unexpected converted amount: ${String(first.amount)}`);
  }
});

Deno.test("buildIngredientGroups groups by component", () => {
  const groups = buildIngredientGroups({
    groupBy: "component",
    ingredients: [
      { name: "Flour", amount: 1, unit: "cup", component: "Dough" },
      { name: "Tomatoes", amount: 3, unit: "unit", component: "Sauce" },
      { name: "Salt", amount: 1, unit: "tsp", component: "Dough" }
    ]
  });

  if (!groups || groups.length !== 2) {
    throw new Error("expected two component groups");
  }

  const dough = groups.find((group) => group.label === "Dough");
  if (!dough || dough.ingredients.length !== 2) {
    throw new Error("expected dough group to include two ingredients");
  }
});

Deno.test("projectInlineMeasurements appends inline measurement text", () => {
  const steps: RecipePayload["steps"] = [
    {
      index: 1,
      instruction: "Whisk together ingredients",
      inline_measurements: [{ ingredient: "Olive Oil", amount: 2, unit: "tbsp" }]
    }
  ];

  const projected = projectInlineMeasurements({
    steps,
    units: "metric",
    includeInlineMeasurements: true
  });

  const first = projected[0];
  if (!first) {
    throw new Error("expected projected step");
  }

  if (!first.instruction.includes("Olive Oil")) {
    throw new Error("expected ingredient label in instruction");
  }

  if (!first.instruction.includes("ml")) {
    throw new Error("expected converted metric unit in instruction");
  }
});

Deno.test("resolvePresentationOptions merges query and preferences", () => {
  const options = resolvePresentationOptions({
    query: new URLSearchParams("units=imperial&inline_measurements=true"),
    presentationPreferences: {
      recipe_units: "metric",
      recipe_group_by: "category",
      recipe_inline_measurements: false
    }
  });

  if (options.units !== "imperial") {
    throw new Error("expected query units override");
  }

  if (options.groupBy !== "category") {
    throw new Error("expected preference group_by fallback");
  }

  if (!options.inlineMeasurements) {
    throw new Error("expected inline measurements to be enabled");
  }
});
