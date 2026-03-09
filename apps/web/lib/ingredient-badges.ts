import type { components } from "@alchemy/contracts";
import {
  resolveIngredientIconKey,
  type IngredientIconKey
} from "@alchemy/shared/ingredient-icon-key";

export type IngredientBadge = {
  key: IngredientIconKey;
  label: string;
  token: string;
};

const BADGE_COPY: Record<IngredientIconKey, Omit<IngredientBadge, "key">> = {
  seafood: { label: "Seafood", token: "SEA" },
  shellfish: { label: "Shellfish", token: "SHL" },
  poultry: { label: "Poultry", token: "BRD" },
  meat: { label: "Meat", token: "MET" },
  egg: { label: "Eggs", token: "EGG" },
  dairy: { label: "Dairy", token: "DRY" },
  oil: { label: "Cooking fats", token: "OIL" },
  sweetener: { label: "Sweet notes", token: "SWT" },
  spice: { label: "Spice cabinet", token: "SPC" },
  herb: { label: "Fresh herbs", token: "HRB" },
  sauce: { label: "Sauces", token: "SCE" },
  grain: { label: "Grains", token: "GRN" },
  legume: { label: "Legumes", token: "LEG" },
  nut: { label: "Nuts", token: "NUT" },
  fruit_apple: { label: "Orchard fruit", token: "APP" },
  fruit_citrus: { label: "Citrus", token: "CIT" },
  fruit_berry: { label: "Berries", token: "BER" },
  fruit_grape: { label: "Grapes", token: "GRP" },
  fruit_tropical: { label: "Tropical fruit", token: "TRP" },
  vegetable_leafy: { label: "Leafy greens", token: "LFG" },
  vegetable_root: { label: "Root vegetables", token: "ROT" },
  vegetable_allium: { label: "Alliums", token: "ALL" },
  vegetable_cruciferous: { label: "Crucifers", token: "CRC" },
  vegetable: { label: "Vegetables", token: "VEG" },
  salad: { label: "Salad energy", token: "SLD" },
  soup: { label: "Soup comfort", token: "SUP" },
  sandwich: { label: "Handheld", token: "SND" },
  pizza: { label: "Pizza night", token: "PZA" },
  dessert: { label: "Dessert", token: "DST" },
  frozen_dessert: { label: "Frozen dessert", token: "FRZ" },
  beverage_coffee: { label: "Coffee", token: "COF" },
  beverage_alcohol: { label: "Drinks", token: "BAR" },
  beverage_soft: { label: "Refreshers", token: "DRK" },
  vegan: { label: "Plant-based", token: "VGN" },
  frozen: { label: "Freezer-friendly", token: "ICE" },
  baking: { label: "Baking staples", token: "BAK" },
  generic: { label: "Pantry-friendly", token: "GEN" }
};

export const buildIngredientBadges = (
  ingredients: components["schemas"]["Ingredient"][],
  limit = 6
): IngredientBadge[] => {
  const seen = new Set<IngredientIconKey>();
  const badges: IngredientBadge[] = [];

  for (const ingredient of ingredients) {
    const key = resolveIngredientIconKey({
      canonicalName: ingredient.name,
      normalizedKey: ingredient.name
    });

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    badges.push({
      key,
      ...BADGE_COPY[key]
    });

    if (badges.length >= limit) {
      break;
    }
  }

  return badges;
};
