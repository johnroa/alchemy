import {
  buildOntologyCanonicalizationCatalog,
  canonicalizeOntologyTerm,
} from "./ontology-canonicalization.ts";

const assertEqual = (actual: unknown, expected: unknown, message: string): void => {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}\nexpected: ${expectedJson}\nreceived: ${actualJson}`);
  }
};

Deno.test("canonicalizes diet variants to canonical diet tags", () => {
  const catalog = buildOntologyCanonicalizationCatalog({
    terms: [
      { term_type: "diet", term_key: "vegan", label: "Vegan", usage_count: 12 },
      { term_type: "diet", term_key: "vegetarian", label: "Vegetarian", usage_count: 10 },
      { term_type: "diet", term_key: "vegan_friendly", label: "Vegan-friendly", usage_count: 1 },
    ],
    dietTags: ["vegan", "vegetarian", "gluten_free"],
  });

  const canonical = canonicalizeOntologyTerm({
    term: {
      term_type: "diet",
      term_key: "vegan_compatible",
      label: "Vegan compatible",
      relation_type: "compatible_with_diet",
    },
    catalog,
  });

  assertEqual(
    canonical,
    {
      term_type: "diet",
      term_key: "vegan",
      label: "Vegan",
    },
    "diet variants should resolve to the canonical diet tag",
  );
});

Deno.test("canonicalizes plural surface forms to preferred singular term", () => {
  const catalog = buildOntologyCanonicalizationCatalog({
    terms: [
      { term_type: "category", term_key: "fruit", label: "Fruit", usage_count: 9 },
      { term_type: "category", term_key: "fruits", label: "Fruits", usage_count: 2 },
      { term_type: "food_group", term_key: "citrus_fruit", label: "Citrus Fruit", usage_count: 7 },
      { term_type: "food_group", term_key: "citrus_fruits", label: "Citrus Fruits", usage_count: 3 },
    ],
  });

  const pluralCategory = canonicalizeOntologyTerm({
    term: {
      term_type: "category",
      term_key: "fruits",
      label: "Fruits",
      relation_type: "classified_as",
    },
    catalog,
  });

  const pluralFoodGroup = canonicalizeOntologyTerm({
    term: {
      term_type: "food_group",
      term_key: "citrus_fruits",
      label: "Citrus Fruits",
      relation_type: "classified_as",
    },
    catalog,
  });

  assertEqual(
    pluralCategory,
    {
      term_type: "category",
      term_key: "fruit",
      label: "Fruit",
    },
    "plural category key should collapse to singular canonical key",
  );

  assertEqual(
    pluralFoodGroup,
    {
      term_type: "food_group",
      term_key: "citrus_fruit",
      label: "Citrus Fruit",
    },
    "plural compound key should collapse to singular canonical key",
  );
});

Deno.test("keeps exact key when no better canonical match exists", () => {
  const catalog = buildOntologyCanonicalizationCatalog({
    terms: [
      { term_type: "category", term_key: "citrus", label: "Citrus", usage_count: 8 },
    ],
  });

  const canonical = canonicalizeOntologyTerm({
    term: {
      term_type: "category",
      term_key: "citrus",
      label: "Citrus",
      relation_type: "classified_as",
    },
    catalog,
  });

  assertEqual(
    canonical,
    {
      term_type: "category",
      term_key: "citrus",
      label: "Citrus",
    },
    "exact canonical key should be preserved",
  );
});
