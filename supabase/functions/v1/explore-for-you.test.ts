import {
  attemptHotPathRerank,
  buildPresetAugmentedRetrievalText,
  dedupeCardsByContentSignature,
} from "./search/for-you.ts";
import type { RecipePreview } from "./recipe-preview.ts";

const buildCard = (overrides: Partial<RecipePreview> = {}): RecipePreview => ({
  id: crypto.randomUUID(),
  title: "Cauliflower Pizza Crust",
  summary: "Low-carb, gluten-free cauliflower pizza crust.",
  image_url: "https://cdn.cookwithalchemy.com/cauliflower-pizza.png",
  image_status: "ready",
  category: "Auto Organized",
  visibility: "public",
  updated_at: "2026-03-07T00:00:00.000Z",
  quick_stats: {
    time_minutes: 40,
    difficulty: "easy",
    health_score: 78,
    items: 6,
  },
  ...overrides,
});

Deno.test("dedupeCardsByContentSignature removes materially identical recipe cards", () => {
  const cards = [
    buildCard({ id: "recipe-1" }),
    buildCard({ id: "recipe-2" }),
    buildCard({
      id: "recipe-3",
      title: "Spicy Pan-Seared Tofu with Asparagus",
      summary: "Crispy tofu in a zesty chili-garlic sauce with asparagus.",
      image_url: "https://cdn.cookwithalchemy.com/tofu-asparagus.png",
    }),
  ];

  const deduped = dedupeCardsByContentSignature(cards);

  if (deduped.length !== 2) {
    throw new Error(`expected 2 cards after dedupe, received ${deduped.length}`);
  }
  if (deduped[0]?.id !== "recipe-1") {
    throw new Error("expected dedupe to preserve the first matching card");
  }
  if (deduped[1]?.id !== "recipe-3") {
    throw new Error("expected distinct content to remain in the feed");
  }
});

Deno.test("dedupeCardsByContentSignature keeps same-titled recipes when content differs", () => {
  const cards = [
    buildCard({ id: "recipe-1" }),
    buildCard({
      id: "recipe-2",
      summary: "Cauliflower crust with rosemary and parmesan.",
    }),
    buildCard({
      id: "recipe-3",
      image_url: "https://cdn.cookwithalchemy.com/cauliflower-pizza-2.png",
    }),
  ];

  const deduped = dedupeCardsByContentSignature(cards);

  if (deduped.length !== 3) {
    throw new Error(`expected all cards to remain, received ${deduped.length}`);
  }
});

Deno.test("buildPresetAugmentedRetrievalText keeps the base retrieval text when no preset is provided", () => {
  const base = "Lean toward weeknight vegetarian dinners with bright acidity.";
  const result = buildPresetAugmentedRetrievalText({
    baseRetrievalText: base,
    presetId: null,
  });

  if (result != base) {
    throw new Error("expected retrieval text to stay unchanged without a preset");
  }
});

Deno.test("buildPresetAugmentedRetrievalText appends the Explore preset without needing a second LLM pass", () => {
  const result = buildPresetAugmentedRetrievalText({
    baseRetrievalText: "Favor high-protein dinners with a short cleanup path.",
    presetId: "Quick & Easy",
  });

  if (!result.includes("Favor high-protein dinners with a short cleanup path.")) {
    throw new Error("expected the base retrieval text to remain intact");
  }
  if (!result.includes("Explore focus: Quick & Easy.")) {
    throw new Error("expected the preset to be appended to the retrieval text");
  }
});

Deno.test("attemptHotPathRerank returns timeout when rerank misses the hot-path budget", async () => {
  const rerankTask = new Promise((resolve) => setTimeout(() => resolve("late"), 25));
  const outcome = await attemptHotPathRerank({
    rerankTask,
    timeoutMs: 5,
  });

  if (outcome.kind !== "timeout") {
    throw new Error(`expected timeout outcome, received ${outcome.kind}`);
  }

  await rerankTask;
});

Deno.test("attemptHotPathRerank surfaces rerank errors without hanging the feed", async () => {
  const outcome = await attemptHotPathRerank({
    rerankTask: Promise.reject(new Error("rerank failed")),
    timeoutMs: 20,
  });

  if (outcome.kind !== "error") {
    throw new Error(`expected error outcome, received ${outcome.kind}`);
  }
});
