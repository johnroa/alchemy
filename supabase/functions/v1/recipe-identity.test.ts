import { buildRecipeIdentityDescriptor } from "./lib/recipe-identity.ts";
import type { RecipePayload } from "../_shared/types.ts";

const baseRecipe = (): RecipePayload => ({
  title: "Smoky Tomato Pasta",
  summary: "Weeknight pasta with blistered tomatoes and basil.",
  description: "A fast pasta built around sweet tomatoes, olive oil, and basil.",
  servings: 4,
  ingredients: [
    { name: "spaghetti", amount: 12, unit: "oz" },
    { name: "cherry tomatoes", amount: 16, unit: "oz" },
    { name: "garlic", amount: 3, unit: "cloves" },
    { name: "basil", amount: 0.5, unit: "cup" },
  ],
  steps: [
    { index: 1, instruction: "Boil the pasta until al dente." },
    { index: 2, instruction: "Blister tomatoes with garlic, then toss with pasta and basil." },
  ],
  notes: "Finish with olive oil.",
  pairings: ["Green salad"],
  metadata: {
    vibe: "bright",
    cuisine_tags: ["Italian"],
    techniques: ["boiling", "blistering"],
    serving_notes: ["Serve in shallow bowls."],
  },
});

Deno.test("recipe identity ignores title, summary, description, pairings, and metadata drift for fingerprints", async () => {
  const original = await buildRecipeIdentityDescriptor({
    recipe: baseRecipe(),
  });
  const variant = await buildRecipeIdentityDescriptor({
    recipe: {
      ...baseRecipe(),
      title: "Midnight Tomato Spaghetti",
      summary: "Silky spaghetti with sweet tomatoes.",
      description: "A softer, moodier description that should not affect identity.",
      pairings: ["Garlic bread", "Bitter greens"],
      metadata: {
        ...baseRecipe().metadata,
        vibe: "moody",
        cuisine_tags: ["Italian", "Weeknight"],
        serving_notes: ["Twirl into warm bowls."],
      },
    },
  });

  if (original.contentFingerprint !== variant.contentFingerprint) {
    throw new Error("expected content fingerprint to ignore non-substantive recipe copy changes");
  }
  if (original.imageFingerprint !== variant.imageFingerprint) {
    throw new Error("expected image fingerprint to ignore nonvisual metadata and copy changes");
  }
});

Deno.test("recipe identity treats notes as content-bearing but not image-bearing", async () => {
  const original = await buildRecipeIdentityDescriptor({
    recipe: baseRecipe(),
  });
  const noteEdited = await buildRecipeIdentityDescriptor({
    recipe: {
      ...baseRecipe(),
      notes: "Finish with olive oil and a squeeze of lemon.",
    },
  });

  if (original.contentFingerprint === noteEdited.contentFingerprint) {
    throw new Error("expected content fingerprint to change when cooking notes change");
  }
  if (original.imageFingerprint !== noteEdited.imageFingerprint) {
    throw new Error("expected image fingerprint to ignore nonvisual cooking note changes");
  }
});

Deno.test("recipe identity changes when ingredients or steps materially change", async () => {
  const original = await buildRecipeIdentityDescriptor({
    recipe: baseRecipe(),
  });
  const changed = await buildRecipeIdentityDescriptor({
    recipe: {
      ...baseRecipe(),
      ingredients: [
        ...baseRecipe().ingredients,
        { name: "burrata", amount: 8, unit: "oz" },
      ],
      steps: [
        ...baseRecipe().steps,
        { index: 3, instruction: "Tear over burrata and finish with chile flakes." },
      ],
    },
  });

  if (original.contentFingerprint === changed.contentFingerprint) {
    throw new Error("expected content fingerprint to change when ingredients change");
  }
  if (original.imageFingerprint === changed.imageFingerprint) {
    throw new Error("expected image fingerprint to change when the visible dish changes");
  }
});
