import {
  buildImageRequestDescriptor,
  buildImageReuseSearchText,
  shouldResetReusedReadyImageRequest,
} from "./image-pipeline/types.ts";
import type { RecipePayload } from "../_shared/types.ts";

const buildRecipePayload = (
  overrides: Omit<Partial<RecipePayload>, "title" | "ingredients" | "steps"> & Pick<RecipePayload, "title" | "ingredients" | "steps">,
): RecipePayload => ({
  servings: 2,
  ...overrides,
});

Deno.test("buildImageReuseSearchText excludes pairings and optional notes from reuse identity", () => {
  const searchText = buildImageReuseSearchText(buildRecipePayload({
    title: "Classic Buttered Toast",
    summary: "Golden toast with soft butter.",
    description:
      "A simple yet comforting breakfast staple, this buttered toast is crisp and golden, the sort of thing that feels impossibly generous for how little it asks of you.",
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
  }));

  if (searchText.includes("Scrambled eggs")) {
    throw new Error("expected pairings to be excluded from image reuse search text");
  }

  if (searchText.includes("jam") || searchText.includes("honey")) {
    throw new Error("expected optional notes to be excluded from image reuse search text");
  }
  if (searchText.includes("comforting breakfast staple")) {
    throw new Error("expected long description to be excluded from image reuse search text");
  }

  for (const expected of [
    "Classic Buttered Toast",
    "Golden toast with soft butter.",
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
  const descriptor = await buildImageRequestDescriptor(buildRecipePayload({
    title: "Elevated Scrambled Eggs",
    summary: "Silky eggs with creme fraiche and chives.",
    description:
      "Soft curds and creme fraiche give these eggs the kind of plush, slow luxury that makes even a quiet breakfast feel faintly Parisian.",
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
  }));

  if (descriptor.normalizedSearchText.includes("Buttered toast")) {
    throw new Error("expected descriptor search text to exclude pairings");
  }
  if (descriptor.normalizedSearchText.includes("quiet breakfast feel faintly Parisian")) {
    throw new Error("expected descriptor search text to exclude long description");
  }

  for (const expected of [
    "Elevated Scrambled Eggs",
    "Silky eggs with creme fraiche and chives.",
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

Deno.test("buildImageRequestDescriptor reuses content/image fingerprints across title-only edits", async () => {
  const original = await buildImageRequestDescriptor(buildRecipePayload({
    title: "Elevated Scrambled Eggs",
    summary: "Silky eggs with creme fraiche and chives.",
    ingredients: [
      { name: "large eggs", amount: 6, unit: "piece" },
      { name: "creme fraiche", amount: 2, unit: "tbsp" },
      { name: "fresh chives", amount: 1, unit: "tbsp" },
    ],
    steps: [
      { index: 1, instruction: "Whisk and slowly cook the eggs until glossy." },
    ],
  }));

  const renamed = await buildImageRequestDescriptor(buildRecipePayload({
    title: "Sunday Scrambled Eggs",
    summary: "A different summary that should not affect exact identity.",
    description: "Copy drift should not force a new image request for the same recipe.",
    ingredients: [
      { name: "large eggs", amount: 6, unit: "piece" },
      { name: "creme fraiche", amount: 2, unit: "tbsp" },
      { name: "fresh chives", amount: 1, unit: "tbsp" },
    ],
    steps: [
      { index: 1, instruction: "Whisk and slowly cook the eggs until glossy." },
    ],
  }));

  if (original.fingerprint !== renamed.fingerprint) {
    throw new Error("expected content fingerprint to stay stable across title-only edits");
  }
  if (original.imageFingerprint !== renamed.imageFingerprint) {
    throw new Error("expected image fingerprint to stay stable across title-only edits");
  }
});

Deno.test("shouldResetReusedReadyImageRequest only resets stale reused requests", async () => {
  const descriptor = await buildImageRequestDescriptor(buildRecipePayload({
    title: "Elevated Scrambled Eggs",
    summary: "Silky eggs with creme fraiche and chives.",
    description:
      "Soft curds and creme fraiche give these eggs the kind of plush, slow luxury that makes even a quiet breakfast feel faintly Parisian.",
    ingredients: [
      { name: "large eggs", amount: 6, unit: "piece" },
      { name: "creme fraiche", amount: 2, unit: "tbsp" },
      { name: "fresh chives", amount: 1, unit: "tbsp" },
    ],
    steps: [
      { index: 1, instruction: "Whisk and slowly cook the eggs until glossy." },
    ],
  }));

  const staleReusedRequest = {
    id: "request-1",
    recipe_fingerprint: descriptor.fingerprint,
    image_fingerprint: descriptor.imageFingerprint,
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
    matched_recipe_id: null,
    matched_recipe_version_id: null,
    resolution_reason: "exact_reuse",
    judge_invoked: false,
    judge_candidate_count: 0,
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
