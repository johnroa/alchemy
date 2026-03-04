import type { JsonValue } from "../_shared/types.ts";

const meatKeywords = [
  "poultry",
  "chicken",
  "turkey",
  "duck",
  "goose",
  "beef",
  "pork",
  "lamb",
  "mutton",
  "veal",
  "goat",
  "venison",
  "rabbit",
  "bison",
  "ham",
  "bacon",
  "sausage",
  "pepperoni",
  "salami",
  "prosciutto",
  "offal",
  "organ meat",
  "red meat",
  "meat",
];

const seafoodKeywords = [
  "seafood",
  "fish",
  "salmon",
  "tuna",
  "cod",
  "tilapia",
  "trout",
  "halibut",
  "mackerel",
  "sardine",
  "anchovy",
  "shellfish",
  "shrimp",
  "prawn",
  "crab",
  "lobster",
  "mussel",
  "clam",
  "oyster",
  "scallop",
  "octopus",
  "squid",
];

const dairyKeywords = [
  "dairy",
  "milk",
  "cheese",
  "yogurt",
  "yoghurt",
  "butter",
  "cream",
  "whey",
  "casein",
  "ghee",
];

const eggKeywords = [
  "egg",
  "eggs",
  "egg white",
  "egg yolk",
  "albumen",
];

const otherAnimalKeywords = [
  "honey",
  "gelatin",
  "gelatine",
  "collagen",
  "lard",
  "tallow",
  "animal fat",
  "animal-derived",
];

const plantBasedOverrideKeywords = [
  "vegan",
  "vegetarian",
  "plant based",
  "plant-based",
  "meatless",
  "imitation",
  "substitute",
  "mock",
];

const normalizeText = (value: string): string =>
  value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const listifyText = (value: unknown): string[] => {
  if (typeof value === "string") {
    const normalized = normalizeText(value);
    return normalized.length > 0 ? [normalized] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => normalizeText(item))
    .filter((item) => item.length > 0);
};

const listifyDietTags = (value: JsonValue | undefined): string[] => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

const hasAnyKeyword = (
  haystack: string,
  keywords: readonly string[],
): boolean => keywords.some((keyword) => haystack.includes(keyword));

const normalizeDietTag = (value: string): string =>
  value.toLocaleLowerCase().replace(/[\s_-]+/g, "");

const isPescatarianTag = (value: string): boolean => {
  const normalized = normalizeDietTag(value);
  return normalized === "pescatarian" || normalized === "pescetarian";
};

const isVegetarianTag = (value: string): boolean =>
  normalizeDietTag(value) === "vegetarian";

const isVeganTag = (value: string): boolean =>
  normalizeDietTag(value) === "vegan";

export const applyIngredientDietCompatibilityGuard = (params: {
  canonicalName: string;
  metadata: Record<string, JsonValue>;
  ontologyTermKeys?: string[];
}): {
  metadata: Record<string, JsonValue>;
  removedDietTags: string[];
} => {
  const dietCompatibility = listifyDietTags(params.metadata.diet_compatibility);
  if (dietCompatibility.length === 0) {
    return { metadata: params.metadata, removedDietTags: [] };
  }

  const metadataSignals = [
    ...listifyText(params.metadata.food_group),
    ...listifyText(params.metadata.ingredient_family),
    ...listifyText(params.metadata.functional_classes),
    ...listifyText(params.metadata.allergen_profile),
    ...(params.ontologyTermKeys ?? []).map((item) => normalizeText(item)),
  ];

  const canonicalName = normalizeText(params.canonicalName);
  const metadataSignalText = metadataSignals.join(" | ");
  const fullSignalText = [canonicalName, metadataSignalText]
    .filter((item) => item.length > 0)
    .join(" | ");

  const hasPlantBasedOverride = hasAnyKeyword(
    fullSignalText,
    plantBasedOverrideKeywords,
  );
  const nonSeafoodMeat = hasAnyKeyword(metadataSignalText, meatKeywords) ||
    (!hasPlantBasedOverride && hasAnyKeyword(canonicalName, meatKeywords));
  const seafood = hasAnyKeyword(metadataSignalText, seafoodKeywords) ||
    (!hasPlantBasedOverride && hasAnyKeyword(canonicalName, seafoodKeywords));
  const dairy = hasAnyKeyword(fullSignalText, dairyKeywords);
  const eggs = hasAnyKeyword(fullSignalText, eggKeywords);
  const otherAnimalDerived = hasAnyKeyword(fullSignalText, otherAnimalKeywords);

  const removedDietTags: string[] = [];
  const filteredDietCompatibility: string[] = [];
  const seen = new Set<string>();

  for (const tag of dietCompatibility) {
    const normalized = normalizeDietTag(tag);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);

    if (isPescatarianTag(tag) && nonSeafoodMeat) {
      removedDietTags.push(tag);
      continue;
    }

    if (isVegetarianTag(tag) && (nonSeafoodMeat || seafood)) {
      removedDietTags.push(tag);
      continue;
    }

    if (
      isVeganTag(tag) &&
      (nonSeafoodMeat || seafood || dairy || eggs || otherAnimalDerived)
    ) {
      removedDietTags.push(tag);
      continue;
    }

    filteredDietCompatibility.push(tag);
  }

  if (removedDietTags.length === 0) {
    return { metadata: params.metadata, removedDietTags: [] };
  }

  return {
    metadata: {
      ...params.metadata,
      diet_compatibility: filteredDietCompatibility,
    },
    removedDietTags,
  };
};
