import { describe, expect, it } from "vitest";
import { buildIngredientBadges } from "@/lib/ingredient-badges";

describe("buildIngredientBadges", () => {
  it("dedupes repeated semantic groups and preserves recognisable badges", () => {
    const badges = buildIngredientBadges([
      { name: "lemons", amount: 2, unit: "whole" },
      { name: "lemon zest", amount: 1, unit: "tbsp" },
      { name: "garlic", amount: 3, unit: "cloves" },
      { name: "olive oil", amount: 2, unit: "tbsp" }
    ]);

    expect(badges.map((badge) => badge.key)).toEqual([
      "fruit_citrus",
      "vegetable_allium",
      "oil"
    ]);
    expect(badges[0]?.token).toBe("CIT");
  });
});
