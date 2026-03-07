import { ApiError } from "../../../_shared/errors.ts";
import type {
  ImportedRecipeDocument,
  ImportRequest,
  ImportSourceKind,
} from "../../../_shared/types.ts";

const KNOWN_RECIPE_DOMAINS = new Set([
  "allrecipes.com",
  "bbcgoodfood.com",
  "bonappetit.com",
  "budgetbytes.com",
  "cooking.nytimes.com",
  "delish.com",
  "eatingwell.com",
  "epicurious.com",
  "food.com",
  "food52.com",
  "foodandwine.com",
  "foodnetwork.com",
  "jamieoliver.com",
  "kingarthurbaking.com",
  "loveandlemons.com",
  "minimalistbaker.com",
  "natashaskitchen.com",
  "onceuponachef.com",
  "pinchofyum.com",
  "recipetineats.com",
  "seriouseats.com",
  "simplyrecipes.com",
  "skinnytaste.com",
  "smittenkitchen.com",
  "tasteofhome.com",
  "tasty.co",
  "thekitchn.com",
  "themediterraneandish.com",
  "thepioneerwoman.com",
  "thewoksoflife.com",
  "twopeasandtheirpod.com",
  "wellplated.com",
  "whatsgabycooking.com",
]);

const RECIPE_PATH_KEYWORDS = new Set([
  "recipe",
  "recipes",
  "meal",
  "meals",
  "dish",
  "dishes",
  "cook",
  "cooking",
  "bake",
  "baking",
  "dessert",
  "dinner",
  "breakfast",
  "lunch",
]);

const FOOD_VOCABULARY = new Set([
  "chicken",
  "beef",
  "pork",
  "fish",
  "salmon",
  "shrimp",
  "tofu",
  "egg",
  "eggs",
  "pasta",
  "pizza",
  "soup",
  "salad",
  "cake",
  "cookie",
  "bread",
  "rice",
  "quinoa",
  "potato",
  "carrot",
  "broccoli",
  "cauliflower",
  "garlic",
  "lemon",
  "butter",
  "cheese",
  "parmesan",
  "taco",
  "burger",
  "sandwich",
  "curry",
  "stew",
  "roast",
  "grilled",
  "baked",
  "fried",
  "spicy",
  "easy",
  "healthy",
  "gluten-free",
  "glutenfree",
  "vegan",
  "vegetarian",
  "recipe",
]);

function normalizeHost(host: string): string {
  return host.startsWith("www.") ? host.slice(4) : host;
}

function lastMeaningfulSlug(segments: string[]): string | null {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index].trim().toLowerCase();
    if (segment.length < 4) continue;
    if (/^\d+$/.test(segment)) continue;
    if (["amp", "print", "video", "index", "page"].includes(segment)) continue;
    return segment;
  }
  return null;
}

export function isLikelyRecipeUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return false;
  }

  const host = normalizeHost(parsed.hostname.toLowerCase());
  const path = parsed.pathname.toLowerCase();
  const pathSegments = path.split("/").filter(Boolean);
  const isHomepage = path === "/" || path.length === 0;

  let score = 0;

  if (KNOWN_RECIPE_DOMAINS.has(host)) {
    score += 40;
  }

  if (pathSegments.some((segment) => RECIPE_PATH_KEYWORDS.has(segment))) {
    score += 35;
  }

  const slug = lastMeaningfulSlug(pathSegments);
  if (slug) {
    const slugWords = slug.split(/[-_]/g);
    const hits = slugWords.filter((word) => FOOD_VOCABULARY.has(word)).length;
    score += Math.min(hits * 10, 40);
  }

  return isHomepage ? score >= 80 : score >= 50;
}

function normalizeImportedLines(values: string[] | undefined): string[] {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => value.trim().replace(/\s+/g, " "))
        .filter((value) => value.length > 0),
    ),
  );
}

export function validateImportRequest(body: ImportRequest): void {
  if (!body || typeof body !== "object" || !("kind" in body)) {
    throw new ApiError(400, "invalid_import_request", "Request must include 'kind'");
  }

  switch (body.kind) {
    case "url": {
      const url = (body as { url?: string }).url?.trim();
      if (!url) {
        throw new ApiError(400, "invalid_import_url", "URL is required for kind 'url'");
      }
      if (!isLikelyRecipeUrl(url)) {
        throw new ApiError(
          400,
          "not_recipe_url",
          "That URL does not look like a recipe page. Paste a direct recipe link.",
        );
      }
      break;
    }
    case "text": {
      const text = (body as { text?: string }).text?.trim();
      if (!text) {
        throw new ApiError(400, "invalid_import_text", "Text is required for kind 'text'");
      }
      if (text.length > 50_000) {
        throw new ApiError(400, "import_text_too_long", "Text exceeds 50,000 character limit");
      }
      break;
    }
    case "photo": {
      const ref = (body as { photo_asset_ref?: string }).photo_asset_ref?.trim();
      if (!ref) {
        throw new ApiError(
          400,
          "invalid_import_photo",
          "photo_asset_ref is required for kind 'photo'",
        );
      }
      break;
    }
    default:
      throw new ApiError(
        400,
        "invalid_import_kind",
        `Unknown import kind: ${(body as Record<string, unknown>).kind}`,
      );
  }
}

export function assertImportedDocumentLooksRecipeLike(
  document: ImportedRecipeDocument,
  kind: ImportSourceKind,
): void {
  const ingredients = normalizeImportedLines(document.ingredients);
  const instructions = normalizeImportedLines(document.instructions);

  // URL imports must be decisively recipe-like before we hand them to the LLM.
  // This prevents arbitrary pages from becoming hallucinated placeholder recipes.
  if (kind === "url") {
    const hasStructuredBody = ingredients.length >= 2 && instructions.length >= 2;
    const hasStrongExtraction = document.extractionStrategy === "json_ld" ||
      document.extractionStrategy === "microdata";
    const hasReasonableTitle = (document.title?.trim().length ?? 0) >= 4;

    if (!hasStructuredBody || (!hasStrongExtraction && !hasReasonableTitle)) {
      throw new ApiError(
        400,
        "not_recipe_url",
        "That URL doesn't appear to point to a recipe page.",
      );
    }
  }

  // Photo/text imports can be more free-form, but still need enough structure
  // that the transform step is grounded in recipe content rather than noise.
  if ((kind === "photo" || kind === "text") &&
    ingredients.length < 2 &&
    instructions.length < 2) {
    throw new ApiError(
      400,
      "not_recipe_content",
      "We couldn't detect a recipe in that content. Try a clearer recipe source.",
    );
  }
}

/**
 * Computes a deterministic per-source fingerprint for dedup.
 * - URL: normalised URL (lowercase host, stripped tracking params)
 * - Text: first 500 chars lowercased + length
 * - Photo: storage ref as-is (already unique)
 */
export function computeFingerprint(body: ImportRequest): string {
  switch (body.kind) {
    case "url": {
      try {
        const u = new URL(body.url.trim());
        // Strip common tracking params for better dedup
        u.searchParams.delete("utm_source");
        u.searchParams.delete("utm_medium");
        u.searchParams.delete("utm_campaign");
        u.searchParams.delete("utm_content");
        u.searchParams.delete("utm_term");
        u.searchParams.delete("fbclid");
        u.searchParams.delete("gclid");
        u.searchParams.sort();
        return `url:${u.hostname.toLowerCase()}${u.pathname}${u.search}`;
      } catch {
        return `url:${body.url.trim().toLowerCase()}`;
      }
    }
    case "text": {
      const normalised = body.text.trim().toLowerCase().slice(0, 500);
      return `text:${normalised.length}:${normalised}`;
    }
    case "photo":
      return `photo:${body.photo_asset_ref.trim()}`;
  }
}
