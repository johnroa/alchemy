import { describe, expect, it } from "vitest";
import { buildRecipeDescriptors, buildRecipeStats } from "@/lib/recipe-view";

describe("buildRecipeStats", () => {
  it("formats recipe time and difficulty into share-page friendly stats", () => {
    const stats = buildRecipeStats({
      id: "recipe-1",
      title: "Sheet Pan Salmon",
      servings: 4,
      ingredients: [
        { name: "salmon", amount: 4, unit: "fillets" },
        { name: "broccolini", amount: 1, unit: "bunch" }
      ],
      steps: [{ index: 1, instruction: "Roast everything." }],
      visibility: "public",
      updated_at: "2026-03-09T00:00:00.000Z",
      metadata: {
        time_minutes: 35,
        difficulty: "easy"
      }
    });

    expect(stats).toEqual([
      { label: "Servings", value: "4" },
      { label: "Time", value: "35 min" },
      { label: "Difficulty", value: "Easy" },
      { label: "Ingredients", value: "2" }
    ]);
  });
});

describe("buildRecipeDescriptors", () => {
  it("collapses duplicate metadata tags into a short descriptor rail", () => {
    const descriptors = buildRecipeDescriptors({
      cuisine_tags: ["Italian", "Italian"],
      diet_tags: ["High Protein"],
      techniques: ["Roasting"]
    });

    expect(descriptors).toEqual(["Italian", "High Protein", "Roasting"]);
  });
});
