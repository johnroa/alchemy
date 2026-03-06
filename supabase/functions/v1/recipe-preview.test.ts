import {
  buildHighestConfidenceCategoryMap,
  buildRecipePreview,
  canonicalizeRecipePayloadMetadata,
  normalizeRecipePreview,
  resolveCookbookPreviewCategory,
  resolveSearchPreviewCategory,
} from "./recipe-preview.ts";

Deno.test("buildRecipePreview emits canonical quick stats from normalized metadata", () => {
  const canonicalMetadata = canonicalizeRecipePayloadMetadata({
    metadata: {
      time_minutes: 42,
      difficulty: "medium",
      health_score: 82,
    },
    ingredients: [
      { name: "Tomato", amount: 2, unit: "pieces" },
      { name: "Basil", amount: 8, unit: "leaves" },
      { name: "Olive Oil", amount: 2, unit: "tbsp" },
    ],
    steps: [{ index: 1, instruction: "Simmer gently." }],
  });

  const preview = buildRecipePreview({
    id: "11111111-1111-1111-1111-111111111111",
    title: "Tomato Basil Soup",
    quick_stats: canonicalMetadata?.quick_stats,
    time_minutes: canonicalMetadata?.time_minutes,
    difficulty: canonicalMetadata?.difficulty,
    health_score: canonicalMetadata?.health_score,
    items: canonicalMetadata?.items,
  });

  if (!preview.quick_stats) {
    throw new Error("expected canonical quick stats");
  }
  if (preview.quick_stats.time_minutes !== 42) {
    throw new Error("expected canonical time_minutes");
  }
  if (preview.quick_stats.difficulty !== "medium") {
    throw new Error("expected canonical difficulty");
  }
  if (preview.quick_stats.health_score !== 82) {
    throw new Error("expected canonical health_score");
  }
  if (preview.quick_stats.items !== 3) {
    throw new Error("expected items to derive from ingredient count");
  }
});

Deno.test("buildHighestConfidenceCategoryMap is deterministic", () => {
  const result = buildHighestConfidenceCategoryMap([
    {
      recipe_id: "recipe-a",
      category: "Pasta",
      confidence: 0.75,
    },
    {
      recipe_id: "recipe-a",
      category: "Dinner",
      confidence: 0.91,
    },
    {
      recipe_id: "recipe-b",
      category: "Brunch",
      confidence: 0.8,
    },
    {
      recipe_id: "recipe-b",
      category: "Breakfast",
      confidence: 0.8,
    },
  ]);

  if (result.get("recipe-a") !== "Dinner") {
    throw new Error("expected highest-confidence category to win");
  }
  if (result.get("recipe-b") !== "Breakfast") {
    throw new Error("expected alphabetical tie-break for equal confidence");
  }
});

Deno.test("normalizeRecipePreview backfills quick stats from legacy search fields", () => {
  const preview = normalizeRecipePreview({
    id: "22222222-2222-2222-2222-222222222222",
    title: "Legacy Preview",
    summary: "Older session payload",
    image_status: "ready",
    time_minutes: 15,
    difficulty: "easy",
    health_score: 90,
    ingredient_count: 5,
  });

  if (!preview?.quick_stats) {
    throw new Error("expected quick stats to backfill from legacy fields");
  }
  if (preview.quick_stats.items !== 5) {
    throw new Error("expected legacy ingredient_count to map to items");
  }
  if (preview.category !== "Auto Organized") {
    throw new Error("expected fallback preview category");
  }
  if (preview.visibility !== "public") {
    throw new Error("expected fallback visibility");
  }
});

Deno.test("cookbook category precedence differs from search/explore category selection", () => {
  const cookbookCategory = resolveCookbookPreviewCategory("Favorites", "Dinner");
  const searchCategory = resolveSearchPreviewCategory("Dinner");

  if (cookbookCategory !== "Favorites") {
    throw new Error("expected cookbook to prefer the user override");
  }
  if (searchCategory !== "Dinner") {
    throw new Error("expected search/explore to use the auto category");
  }
});
