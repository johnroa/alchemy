import {
  buildRecipeSearchDocument,
  decodeSearchCursor,
  encodeSearchCursor,
} from "./recipe-search.ts";

Deno.test("buildRecipeSearchDocument keeps missing images truthful", () => {
  const document = buildRecipeSearchDocument({
    recipeId: "11111111-1111-1111-1111-111111111111",
    recipeVersionId: "22222222-2222-2222-2222-222222222222",
    category: "Dinner",
    visibility: "public",
    updatedAt: "2026-03-06T12:00:00.000Z",
    imageUrl: null,
    imageStatus: "pending",
    canonicalIngredientIds: [
      "33333333-3333-3333-3333-333333333333",
      "44444444-4444-4444-4444-444444444444",
    ],
    canonicalIngredientNames: ["Duck Breast", "Cherry"],
    ontologyTermKeys: ["poultry", "stone-fruit"],
    payload: {
      title: "Seared Duck Breast",
      description: "Crisp skin with cherry gastrique",
      servings: 2,
      ingredients: [
        { name: "Duck Breast", amount: 2, unit: "pieces" },
        { name: "Cherry", amount: 1, unit: "cup" },
      ],
      steps: [{ index: 1, instruction: "Render the duck skin." }],
      pairings: ["Frisee salad"],
      metadata: {
        time_minutes: 35,
        difficulty: "medium",
        health_score: 72,
        cuisine_tags: ["French"],
        diet_tags: ["high-protein"],
        occasion_tags: ["date night"],
        techniques: ["searing"],
        flavor_profile: ["savory", "rich"],
        vibe: "elegant",
      },
    },
  });

  if (document.explore_eligible) {
    throw new Error("expected missing images to stay ineligible for explore");
  }
  if (document.image_url !== null) {
    throw new Error("expected image_url to remain null");
  }
  if (document.image_status !== "pending") {
    throw new Error("expected missing image to stay pending");
  }
  if (document.category !== "Dinner") {
    throw new Error("expected indexed category on the search document");
  }
  if (document.recipe_updated_at !== "2026-03-06T12:00:00.000Z") {
    throw new Error("expected recipe updated_at on the search document");
  }
  if (document.time_minutes !== 35 || document.health_score !== 72) {
    throw new Error("expected quick stats to flow into the search document");
  }
  if (document.ingredient_count !== 2) {
    throw new Error("expected ingredient count to flow into the search document");
  }
  if (!document.search_text.includes("Seared Duck Breast")) {
    throw new Error("expected title inside search text");
  }
  if (!document.search_text.includes("Duck Breast")) {
    throw new Error("expected ingredient names inside search text");
  }
  if (!document.search_text.includes("poultry")) {
    throw new Error("expected ontology terms inside search text");
  }
});

Deno.test("search cursors round-trip for all-feed and session pagination", () => {
  const allCursor = encodeSearchCursor({
    v: 1,
    kind: "all",
    search_id: "55555555-5555-5555-5555-555555555555",
    last_indexed_at: "2026-03-06T12:00:00.000Z",
    last_recipe_id: "66666666-6666-6666-6666-666666666666",
  });
  const decodedAll = decodeSearchCursor(allCursor);
  if (!decodedAll || decodedAll.kind !== "all") {
    throw new Error("expected all cursor to round-trip");
  }
  if (decodedAll.last_recipe_id !== "66666666-6666-6666-6666-666666666666") {
    throw new Error("expected all cursor recipe id to survive round-trip");
  }

  const sessionCursor = encodeSearchCursor({
    v: 1,
    kind: "session",
    search_id: "77777777-7777-7777-7777-777777777777",
    offset: 20,
  });
  const decodedSession = decodeSearchCursor(sessionCursor);
  if (!decodedSession || decodedSession.kind !== "session") {
    throw new Error("expected session cursor to round-trip");
  }
  if (decodedSession.offset !== 20) {
    throw new Error("expected session cursor offset to survive round-trip");
  }
});
