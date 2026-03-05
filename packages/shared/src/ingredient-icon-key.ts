export type IngredientIconKey =
  | "seafood"
  | "shellfish"
  | "poultry"
  | "meat"
  | "egg"
  | "dairy"
  | "oil"
  | "sweetener"
  | "spice"
  | "herb"
  | "sauce"
  | "grain"
  | "legume"
  | "nut"
  | "fruit_apple"
  | "fruit_citrus"
  | "fruit_berry"
  | "fruit_grape"
  | "fruit_tropical"
  | "vegetable_leafy"
  | "vegetable_root"
  | "vegetable_allium"
  | "vegetable_cruciferous"
  | "vegetable"
  | "salad"
  | "soup"
  | "sandwich"
  | "pizza"
  | "dessert"
  | "frozen_dessert"
  | "beverage_coffee"
  | "beverage_alcohol"
  | "beverage_soft"
  | "vegan"
  | "frozen"
  | "baking"
  | "generic";

export type IngredientIconInput = {
  canonicalName?: string | null;
  normalizedKey?: string | null;
  metadata?: Record<string, unknown> | null;
};

type Rule = {
  key: IngredientIconKey;
  terms: readonly string[];
};

const toText = (value: unknown): string => {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => toText(item)).filter(Boolean).join(" ");
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .map((item) => toText(item))
      .filter(Boolean)
      .join(" ");
  }
  return "";
};

const containsAny = (haystack: string, terms: readonly string[]): boolean =>
  terms.some((term) => haystack.includes(term));

const RULES: readonly Rule[] = [
  {
    key: "shellfish",
    terms: ["shellfish", "shrimp", "prawn", "crab", "lobster", "mussel", "oyster", "clam", "scallop"]
  },
  {
    key: "seafood",
    terms: [
      "seafood",
      "fish",
      "salmon",
      "tuna",
      "anchovy",
      "sardine",
      "cod",
      "tilapia",
      "halibut"
    ]
  },
  {
    key: "poultry",
    terms: ["poultry", "chicken", "turkey", "duck", "quail", "hen"]
  },
  {
    key: "meat",
    terms: ["meat", "beef", "pork", "lamb", "veal", "bacon", "ham", "sausage", "steak", "mutton"]
  },
  {
    key: "egg",
    terms: ["egg", "eggs", "yolk", "albumen"]
  },
  {
    key: "dairy",
    terms: ["dairy", "milk", "cheese", "butter", "cream", "yogurt", "yoghurt", "ghee", "whey", "casein"]
  },
  {
    key: "oil",
    terms: ["oil", "fat", "olive oil", "canola", "sesame oil", "avocado oil", "coconut oil", "lard", "tallow"]
  },
  {
    key: "sweetener",
    terms: ["sweetener", "sugar", "honey", "syrup", "molasses", "stevia", "agave", "maple", "fructose", "sucrose"]
  },
  {
    key: "spice",
    terms: [
      "spice",
      "seasoning",
      "salt",
      "chili",
      "chilli",
      "black pepper",
      "white pepper",
      "peppercorn",
      "pepper flakes",
      "paprika",
      "cumin",
      "turmeric",
      "cayenne",
      "masala",
      "cinnamon",
      "nutmeg",
      "clove"
    ]
  },
  {
    key: "herb",
    terms: ["herb", "basil", "parsley", "cilantro", "dill", "rosemary", "thyme", "oregano", "mint", "sage", "chive"]
  },
  {
    key: "sauce",
    terms: ["sauce", "condiment", "dressing", "marinade", "vinaigrette", "mustard", "ketchup", "mayonnaise", "aioli", "pesto", "paste"]
  },
  {
    key: "grain",
    terms: ["grain", "wheat", "flour", "rice", "oat", "barley", "quinoa", "pasta", "noodle", "bread", "cornmeal", "cereal"]
  },
  {
    key: "legume",
    terms: ["legume", "bean", "lentil", "chickpea", "garbanzo", "pea", "peas", "soy", "tofu", "edamame"]
  },
  {
    key: "nut",
    terms: ["nut", "almond", "walnut", "pecan", "cashew", "pistachio", "hazelnut", "macadamia", "peanut"]
  },
  {
    key: "salad",
    terms: ["salad", "greens", "mixed greens"]
  },
  {
    key: "soup",
    terms: ["soup", "stew", "broth bowl"]
  },
  {
    key: "sandwich",
    terms: ["sandwich", "burger", "wrap", "sub", "panini", "toast"]
  },
  {
    key: "pizza",
    terms: ["pizza", "flatbread"]
  },
  {
    key: "frozen_dessert",
    terms: ["ice cream", "gelato", "sorbet", "frozen yogurt"]
  },
  {
    key: "dessert",
    terms: ["dessert", "cake", "pastry", "brownie", "cookie", "sweet dish"]
  },
  {
    key: "beverage_coffee",
    terms: ["coffee", "espresso", "latte", "cappuccino"]
  },
  {
    key: "beverage_alcohol",
    terms: ["wine", "beer", "ale", "lager", "stout", "cocktail", "whiskey", "vodka", "rum", "tequila"]
  },
  {
    key: "beverage_soft",
    terms: ["beverage", "drink", "tea", "juice", "soda", "soft drink", "smoothie"]
  },
  {
    key: "fruit_apple",
    terms: ["apple", "pear"]
  },
  {
    key: "fruit_citrus",
    terms: ["citrus", "orange", "lemon", "lime", "grapefruit", "mandarin"]
  },
  {
    key: "fruit_berry",
    terms: ["berry", "berries", "strawberry", "blueberry", "raspberry", "blackberry", "cherry"]
  },
  {
    key: "fruit_grape",
    terms: ["grape", "raisin"]
  },
  {
    key: "fruit_tropical",
    terms: ["banana", "mango", "pineapple", "papaya", "coconut", "kiwi", "melon"]
  },
  {
    key: "vegetable_leafy",
    terms: ["lettuce", "spinach", "kale", "arugula", "chard", "romaine", "greens"]
  },
  {
    key: "vegetable_root",
    terms: ["carrot", "beet", "radish", "turnip", "potato", "sweet potato", "yam", "parsnip"]
  },
  {
    key: "vegetable_allium",
    terms: ["onion", "garlic", "shallot", "leek", "scallion", "green onion", "chive"]
  },
  {
    key: "vegetable_cruciferous",
    terms: ["broccoli", "cauliflower", "cabbage", "brussels sprout", "bok choy"]
  },
  {
    key: "vegetable",
    terms: [
      "vegetable",
      "cucumber",
      "zucchini",
      "celery",
      "asparagus",
      "pepper",
      "bell pepper"
    ]
  },
  {
    key: "vegan",
    terms: ["vegan", "plant-based", "plant based"]
  },
  {
    key: "frozen",
    terms: ["frozen", "ice", "chilled"]
  },
  {
    key: "baking",
    terms: ["baking", "batter", "dough", "yeast", "leaven", "pastry", "dessert", "baking powder", "baking soda"]
  }
] as const;

const METADATA_PRIORITY_FIELDS = [
  "food_group",
  "ingredient_family",
  "functional_classes",
  "function_classes",
  "dish_type",
  "course",
  "diet_compatibility",
  "category",
  "taxonomy"
] as const;

const asNormalizedText = (value: string): string =>
  value
    .toLocaleLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const resolveIngredientIconKey = ({
  canonicalName,
  normalizedKey,
  metadata
}: IngredientIconInput): IngredientIconKey => {
  const metadataText = metadata
    ? METADATA_PRIORITY_FIELDS.map((field) => toText(metadata[field])).join(" ")
    : "";
  const identityText = [canonicalName ?? "", normalizedKey ?? ""].join(" ");
  const fullText = [metadataText, identityText, toText(metadata)].join(" ");

  const normalizedMetadataText = asNormalizedText(metadataText);
  const normalizedFullText = asNormalizedText(fullText);

  for (const rule of RULES) {
    if (containsAny(normalizedMetadataText, rule.terms)) {
      return rule.key;
    }
  }

  for (const rule of RULES) {
    if (containsAny(normalizedFullText, rule.terms)) {
      return rule.key;
    }
  }

  return "generic";
};
