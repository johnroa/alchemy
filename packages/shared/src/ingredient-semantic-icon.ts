import type { IngredientIconInput } from "./ingredient-icon-key";
import { INGREDIENT_SEMANTIC_ICON_INDEX } from "./ingredient-semantic-icon-index";

const PRIORITY_FIELDS = [
  "food_group",
  "ingredient_family",
  "functional_classes",
  "function_classes",
  "category",
  "taxonomy",
  "flavor_profile",
  "diet_compatibility"
] as const;

const TOKEN_STOP_WORDS = new Set([
  "and",
  "or",
  "of",
  "the",
  "a",
  "an",
  "with",
  "without",
  "for",
  "in",
  "to",
  "fresh",
  "raw",
  "cooked",
  "chopped",
  "diced",
  "sliced",
  "ground",
  "powder",
  "powdered",
  "dry",
  "dried",
  "organic",
  "natural",
  "unsalted",
  "salted",
  "low",
  "high",
  "free"
]);

const DISCOURAGED_ICON_TOKENS = new Set([
  "man",
  "woman",
  "person",
  "farmer",
  "barista",
  "store",
  "convenience",
  "face",
  "dark",
  "light",
  "medium",
  "skin",
  "tone"
]);

const toText = (value: unknown): string => {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => toText(item)).join(" ");
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .map((item) => toText(item))
      .join(" ");
  }
  return "";
};

const normalizeToken = (value: string): string => {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized.length <= 2) return "";
  if (normalized.endsWith("ies")) return `${normalized.slice(0, -3)}y`;
  if (normalized.endsWith("es") && normalized.length > 4) return normalized.slice(0, -2);
  if (normalized.endsWith("s") && !normalized.endsWith("ss") && normalized.length > 3) {
    return normalized.slice(0, -1);
  }
  return normalized;
};

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .split(/[^a-z0-9]+/g)
    .map((token) => normalizeToken(token))
    .filter((token) => token.length > 0 && !TOKEN_STOP_WORDS.has(token));

const buildIngredientTokens = (input: IngredientIconInput): string[] => {
  const metadata = input.metadata ?? null;
  const priorityText = metadata
    ? PRIORITY_FIELDS.map((field) => toText(metadata[field])).join(" ")
    : "";

  const allText = [
    priorityText,
    input.canonicalName ?? "",
    input.normalizedKey ?? "",
    metadata ? toText(metadata) : ""
  ]
    .join(" ")
    .trim();

  const unique = new Set(tokenize(allText));
  return [...unique];
};

const hasFuzzyTokenMatch = (ingredientTokens: string[], iconToken: string): boolean =>
  ingredientTokens.some((token) => {
    if (token === iconToken) return true;
    if (token.length < 4 || iconToken.length < 4) return false;
    return token.includes(iconToken) || iconToken.includes(token);
  });

type BestMatch = {
  id: string;
  score: number;
};

const resolutionCache = new Map<string, string | null>();

export const resolveIngredientSemanticIconId = (input: IngredientIconInput): string | null => {
  const ingredientTokens = buildIngredientTokens(input);
  if (ingredientTokens.length === 0) return null;

  const cacheKey = ingredientTokens.join("|");
  const cached = resolutionCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const best = INGREDIENT_SEMANTIC_ICON_INDEX.reduce<BestMatch | null>((currentBest, entry) => {
    const iconTokens = entry.tokens
      .map((token) => normalizeToken(token))
      .filter((token) => token.length > 0);
    if (iconTokens.length === 0) return currentBest;

    let exactMatches = 0;
    let fuzzyMatches = 0;
    let score = 0;

    for (const iconToken of iconTokens) {
      if (ingredientTokens.includes(iconToken)) {
        exactMatches += 1;
        score += 5;
        continue;
      }

      if (hasFuzzyTokenMatch(ingredientTokens, iconToken)) {
        fuzzyMatches += 1;
        score += 1;
      }
    }

    if (exactMatches === 0 && fuzzyMatches === 0) return currentBest;
    if (exactMatches === iconTokens.length) score += 6;
    if (exactMatches >= 2) score += 4;
    if (iconTokens.some((token) => DISCOURAGED_ICON_TOKENS.has(token))) {
      score -= 4;
    }

    if (!currentBest || score > currentBest.score) {
      return {
        id: entry.id,
        score
      };
    }
    return currentBest;
  }, null);

  const resolved = best && best.score >= 6 ? best.id : null;
  resolutionCache.set(cacheKey, resolved);
  return resolved;
};

