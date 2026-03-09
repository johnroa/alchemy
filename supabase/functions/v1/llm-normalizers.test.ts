import { normalizeRecipeShape } from "../_shared/llm-gateway/normalizers.ts";

Deno.test("normalizeRecipeShape preserves ingredient category and component metadata", () => {
  const normalized = normalizeRecipeShape({
    title: "Layered Pasta",
    summary: "Fast pasta with a sauce and crunchy topping.",
    description: "A quick weeknight pasta.",
    servings: 2,
    ingredients: [
      {
        name: "Rigatoni",
        amount: 12,
        unit: "oz",
        category: "Pantry",
        component: "Pasta",
      },
      {
        name: "Breadcrumbs",
        quantity: "1/2 cup",
        category: "Pantry",
        component: "Topping",
      },
    ],
    steps: [
      { index: 1, instruction: "Boil the pasta." },
    ],
    metadata: {
      difficulty: "easy",
      health_score: 72,
      time_minutes: 20,
      items: 2,
      timing: {
        total_minutes: 20,
      },
      quick_stats: {
        total_time_minutes: 20,
        difficulty: "easy",
        health_score: 72,
        ingredient_count: 2,
      },
    },
  });

  if (!normalized) {
    throw new Error("expected recipe payload to normalize");
  }

  if (normalized.ingredients[0]?.category !== "Pantry") {
    throw new Error("expected first ingredient category to be preserved");
  }

  if (normalized.ingredients[0]?.component !== "Pasta") {
    throw new Error("expected first ingredient component to be preserved");
  }

  if (normalized.ingredients[1]?.component !== "Topping") {
    throw new Error("expected second ingredient component to be preserved");
  }
});

Deno.test("normalizeRecipeShape preserves structured instruction views", () => {
  const normalized = normalizeRecipeShape({
    title: "Roasted Carrots",
    servings: 2,
    ingredients: [
      { name: "Carrots", amount: 1, unit: "lb" },
    ],
    steps: [
      {
        index: 1,
        instruction: "Roast the carrots.",
        instruction_views: {
          concise: [
            { type: "text", value: "Roast at " },
            { type: "temperature", value: 425, unit: "fahrenheit" },
            { type: "text", value: "." },
          ],
          balanced: [
            { type: "text", value: "Roast at " },
            { type: "temperature", value: 425, unit: "fahrenheit" },
            { type: "text", value: " until tender." },
          ],
        },
      },
    ],
    metadata: {
      difficulty: "easy",
      health_score: 80,
      time_minutes: 30,
      items: 1,
      timing: {
        total_minutes: 30,
      },
      quick_stats: {
        total_time_minutes: 30,
        difficulty: "easy",
        health_score: 80,
        ingredient_count: 1,
      },
    },
  });

  if (!normalized) {
    throw new Error("expected recipe payload to normalize");
  }

  const concise = normalized.steps[0]?.instruction_views?.concise;
  if (!Array.isArray(concise) || concise[1]?.type !== "temperature") {
    throw new Error("expected structured instruction views to survive normalization");
  }
});
