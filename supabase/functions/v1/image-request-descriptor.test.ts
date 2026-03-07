import {
  buildImageRequestDescriptor,
  buildImageReuseSearchText,
  shouldResetReusedReadyImageRequest,
} from "./image-pipeline/types.ts";

Deno.test("buildImageReuseSearchText excludes pairings and optional notes from reuse identity", () => {
  const searchText = buildImageReuseSearchText({
    title: "Classic Buttered Toast",
    description:
      "A simple yet comforting breakfast staple, this buttered toast is crisp and golden.",
    notes: "Try adding jam or honey for a tasty twist.",
    pairings: ["Freshly brewed coffee", "Orange juice", "Scrambled eggs"],
    ingredients: [
      { name: "bread", amount: 1, unit: "slice" },
      { name: "butter", amount: 1, unit: "tbsp" },
    ],
    steps: [
      { index: 1, instruction: "Toast the bread until golden brown." },
      { index: 2, instruction: "Spread with softened butter and serve." },
    ],
    metadata: {
      cuisine_tags: ["American"],
      techniques: ["toasting", "spreading"],
      serving_notes: ["Serve warm on a small plate."],
    },
  });

  if (searchText.includes("Scrambled eggs")) {
    throw new Error("expected pairings to be excluded from image reuse search text");
  }

  if (searchText.includes("jam") || searchText.includes("honey")) {
    throw new Error("expected optional notes to be excluded from image reuse search text");
  }

  for (const expected of [
    "Classic Buttered Toast",
    "bread",
    "butter",
    "American",
    "toasting",
    "Serve warm on a small plate.",
  ]) {
    if (!searchText.includes(expected)) {
      throw new Error(`expected search text to include ${expected}`);
    }
  }
});

Deno.test("buildImageRequestDescriptor uses image reuse search text instead of discovery search text", async () => {
  const descriptor = await buildImageRequestDescriptor({
    title: "Elevated Scrambled Eggs",
    description: "Silky, buttery French-style eggs with creme fraiche and chives.",
    pairings: ["Buttered toast"],
    ingredients: [
      { name: "large eggs", amount: 6, unit: "piece" },
      { name: "creme fraiche", amount: 2, unit: "tbsp" },
      { name: "fresh chives", amount: 1, unit: "tbsp" },
    ],
    steps: [
      { index: 1, instruction: "Whisk and slowly cook the eggs until glossy." },
    ],
    metadata: {
      cuisine_tags: ["French"],
      techniques: ["slow cooking"],
    },
  });

  if (descriptor.normalizedSearchText.includes("Buttered toast")) {
    throw new Error("expected descriptor search text to exclude pairings");
  }

  for (const expected of [
    "Elevated Scrambled Eggs",
    "large eggs",
    "creme fraiche",
    "fresh chives",
    "French",
    "slow cooking",
  ]) {
    if (!descriptor.normalizedSearchText.includes(expected)) {
      throw new Error(`expected descriptor search text to include ${expected}`);
    }
  }
});

Deno.test("shouldResetReusedReadyImageRequest only resets stale reused requests", async () => {
  const descriptor = await buildImageRequestDescriptor({
    title: "Elevated Scrambled Eggs",
    description: "Silky, buttery French-style eggs with creme fraiche and chives.",
    ingredients: [
      { name: "large eggs", amount: 6, unit: "piece" },
      { name: "creme fraiche", amount: 2, unit: "tbsp" },
      { name: "fresh chives", amount: 1, unit: "tbsp" },
    ],
    steps: [
      { index: 1, instruction: "Whisk and slowly cook the eggs until glossy." },
    ],
  });

  const staleReusedRequest = {
    id: "request-1",
    recipe_fingerprint: descriptor.fingerprint,
    normalized_title: descriptor.normalizedTitle,
    normalized_search_text: `${descriptor.normalizedSearchText}\nButtered toast`,
    recipe_payload: descriptor.recipePayload,
    embedding: null,
    asset_id: "asset-1",
    status: "ready" as const,
    resolution_source: "reused" as const,
    reuse_evaluation: {},
    attempt: 1,
    max_attempts: 5,
    last_error: null,
  };

  if (!shouldResetReusedReadyImageRequest(staleReusedRequest, descriptor)) {
    throw new Error("expected stale reused request to reset");
  }

  if (
    shouldResetReusedReadyImageRequest(
      { ...staleReusedRequest, resolution_source: "generated" },
      descriptor,
    )
  ) {
    throw new Error("did not expect generated request to reset");
  }

  if (
    shouldResetReusedReadyImageRequest(
      { ...staleReusedRequest, normalized_search_text: descriptor.normalizedSearchText },
      descriptor,
    )
  ) {
    throw new Error("did not expect already-matching request to reset");
  }
});
