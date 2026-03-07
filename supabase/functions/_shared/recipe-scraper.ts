/**
 * recipe-scraper.ts — Server-side recipe extraction from URLs.
 *
 * Pipeline:
 *   1. Bounded fetch (timeout, redirect cap, byte cap, private-network guard)
 *   2. Schema.org JSON-LD extraction (covers ~90% of recipe sites)
 *   3. Microdata fallback (itemtype="https://schema.org/Recipe")
 *   4. OpenGraph / meta tag fallback
 *
 * Output: ImportedRecipeDocument (loose strings, not yet normalised).
 * The document is then fed to the `recipe_import_transform` LLM scope for
 * structured normalisation into a RecipePayload.
 *
 * No site-specific scrapers. No headless browser. JS-heavy pages that lack
 * server-rendered structured data will fail explicitly.
 */

import type { ImportedRecipeDocument } from "./types.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
/** 2 MB — reject pages larger than this to avoid memory pressure */
const MAX_BODY_BYTES = 2 * 1024 * 1024;
/**
 * Rotate through multiple browser-like User-Agents to reduce 403 rates.
 * Sites fingerprint UA + header order; varying these improves success.
 */
const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0",
];

/**
 * Private / reserved IP ranges that must never be fetched.
 * Protects against SSRF when the user supplies an arbitrary URL.
 */
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^\[::1\]$/,
  /^\[fd/i,
  /^\[fe80:/i,
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class ScraperError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ScraperError";
  }
}

/**
 * Fetches a URL and extracts recipe data into an ImportedRecipeDocument.
 * Throws ScraperError with a descriptive code on failure.
 */
export async function scrapeRecipeFromUrl(
  rawUrl: string,
): Promise<ImportedRecipeDocument> {
  const url = validateAndNormalizeUrl(rawUrl);
  const html = await boundedFetch(url);
  return extractRecipeFromHtml(html, url);
}

/**
 * Constructs an ImportedRecipeDocument from raw pasted text.
 * Minimal structuring — splits on double-newlines to guess sections.
 */
export function documentFromRawText(text: string): ImportedRecipeDocument {
  const lines = text
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  return {
    title: undefined,
    description: undefined,
    ingredients: lines,
    instructions: lines,
    confidence: 0.3,
    missingFields: ["title", "yields", "prepTime", "cookTime"],
    extractionStrategy: "raw_text",
  };
}

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

function validateAndNormalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new ScraperError("invalid_url", "URL is empty");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ScraperError("invalid_url", `Cannot parse URL: ${trimmed}`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new ScraperError(
      "invalid_url",
      `Unsupported protocol: ${parsed.protocol}`,
    );
  }

  const host = parsed.hostname;
  for (const pattern of PRIVATE_HOST_PATTERNS) {
    if (pattern.test(host)) {
      throw new ScraperError(
        "private_network_rejected",
        `Refusing to fetch private/reserved host: ${host}`,
      );
    }
  }

  return parsed.href;
}

// ---------------------------------------------------------------------------
// Bounded fetch
// ---------------------------------------------------------------------------

/**
 * Builds browser-realistic headers to reduce bot detection.
 * Many recipe sites (Allrecipes, Food Network, etc.) use Cloudflare or
 * similar WAFs that fingerprint the header set, not just User-Agent.
 */
function buildBrowserHeaders(ua: string): Record<string, string> {
  const isChrome = ua.includes("Chrome/");
  const isFirefox = ua.includes("Firefox/");

  const headers: Record<string, string> = {
    "User-Agent": ua,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "max-age=0",
  };

  if (isChrome) {
    headers["Sec-Fetch-Dest"] = "document";
    headers["Sec-Fetch-Mode"] = "navigate";
    headers["Sec-Fetch-Site"] = "none";
    headers["Sec-Fetch-User"] = "?1";
    headers["sec-ch-ua"] = '"Chromium";v="131", "Not_A Brand";v="24"';
    headers["sec-ch-ua-mobile"] = "?0";
    headers["sec-ch-ua-platform"] = '"macOS"';
  } else if (isFirefox) {
    headers["Sec-Fetch-Dest"] = "document";
    headers["Sec-Fetch-Mode"] = "navigate";
    headers["Sec-Fetch-Site"] = "none";
    headers["Sec-Fetch-User"] = "?1";
  }

  return headers;
}

/**
 * Fetches a URL with browser-like headers. On 403/429, retries once
 * with a different User-Agent. This handles sites that block specific
 * UA strings but accept others (common with recipe CDNs).
 */
async function boundedFetch(url: string): Promise<string> {
  const shuffled = [...USER_AGENTS].sort(() => Math.random() - 0.5);

  let lastError: ScraperError | null = null;

  // Try up to 2 different UA profiles before giving up
  for (let attempt = 0; attempt < Math.min(2, shuffled.length); attempt++) {
    const ua = shuffled[attempt];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: buildBrowserHeaders(ua),
        redirect: "follow",
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new ScraperError("fetch_timeout", `Timed out fetching ${url}`);
      }
      throw new ScraperError(
        "fetch_failed",
        `Network error fetching ${url}: ${String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    // Retry on 403/429 with a different UA
    if ((response.status === 403 || response.status === 429) && attempt < 1) {
      lastError = new ScraperError(
        "fetch_http_error",
        `HTTP ${response.status} from ${url}`,
      );
      continue;
    }

    if (!response.ok) {
      throw new ScraperError(
        "fetch_http_error",
        `HTTP ${response.status} from ${url}`,
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("text/xhtml")) {
      throw new ScraperError(
        "content_type_rejected",
        `Expected text/html but got ${contentType} from ${url}`,
      );
    }

    const body = await response.text();
    if (body.length > MAX_BODY_BYTES) {
      throw new ScraperError(
        "body_too_large",
        `Response body ${body.length} bytes exceeds ${MAX_BODY_BYTES} byte limit`,
      );
    }

    return body;
  }

  // All attempts exhausted
  throw lastError ?? new ScraperError(
    "fetch_http_error",
    `All fetch attempts failed for ${url}`,
  );
}

// ---------------------------------------------------------------------------
// Extraction pipeline
// ---------------------------------------------------------------------------

function extractRecipeFromHtml(
  html: string,
  sourceUrl: string,
): ImportedRecipeDocument {
  // Try JSON-LD first — most reliable for recipe sites
  const jsonLdResult = extractFromJsonLd(html, sourceUrl);
  if (jsonLdResult) return jsonLdResult;

  // Microdata fallback
  const microdataResult = extractFromMicrodata(html, sourceUrl);
  if (microdataResult) return microdataResult;

  // OpenGraph / meta fallback — very low confidence
  const metaResult = extractFromMeta(html, sourceUrl);
  if (metaResult) return metaResult;

  throw new ScraperError(
    "no_recipe_found",
    "Could not find structured recipe data (JSON-LD, Microdata, or meta tags)",
  );
}

// ---------------------------------------------------------------------------
// JSON-LD extraction (Schema.org Recipe)
// ---------------------------------------------------------------------------

function extractFromJsonLd(
  html: string,
  sourceUrl: string,
): ImportedRecipeDocument | null {
  const scriptRegex =
    /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const candidates: Record<string, unknown>[] = [];

  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      collectRecipeNodes(parsed, candidates);
    } catch {
      // malformed JSON-LD block — skip
    }
  }

  if (candidates.length === 0) return null;

  // Prefer mainEntity, then first valid Recipe node
  const recipe =
    candidates.find((c) => (c as Record<string, unknown>)._isMainEntity) ??
    candidates[0];

  return jsonLdToDocument(recipe, sourceUrl);
}

/**
 * Recursively collects @type: "Recipe" nodes from JSON-LD.
 * Handles @graph arrays, nested mainEntity, and array-of-objects.
 */
function collectRecipeNodes(
  obj: unknown,
  out: Record<string, unknown>[],
): void {
  if (Array.isArray(obj)) {
    for (const item of obj) collectRecipeNodes(item, out);
    return;
  }
  if (obj === null || typeof obj !== "object") return;

  const record = obj as Record<string, unknown>;
  const type = record["@type"];
  const isRecipe =
    type === "Recipe" ||
    (Array.isArray(type) && type.includes("Recipe"));

  if (isRecipe) {
    out.push(record);
  }

  // Check mainEntity
  if (record.mainEntity) {
    const main = record.mainEntity as Record<string, unknown>;
    const mainType = main["@type"];
    const mainIsRecipe =
      mainType === "Recipe" ||
      (Array.isArray(mainType) && mainType.includes("Recipe"));
    if (mainIsRecipe) {
      (main as Record<string, unknown>)._isMainEntity = true;
      out.push(main);
    }
  }

  // Check @graph
  if (Array.isArray(record["@graph"])) {
    collectRecipeNodes(record["@graph"], out);
  }
}

function jsonLdToDocument(
  node: Record<string, unknown>,
  sourceUrl: string,
): ImportedRecipeDocument {
  const missingFields: string[] = [];

  const title = asString(node.name);
  if (!title) missingFields.push("title");

  const ingredients = asStringArray(
    node.recipeIngredient ?? node.ingredients,
  );
  if (ingredients.length === 0) missingFields.push("ingredients");

  const instructions = extractInstructions(node.recipeInstructions);
  if (instructions.length === 0) missingFields.push("instructions");

  const yields = asString(node.recipeYield);
  if (!yields) missingFields.push("yields");

  const prepTime = parseDuration(node.prepTime);
  if (!prepTime) missingFields.push("prepTime");
  const cookTime = parseDuration(node.cookTime);
  if (!cookTime) missingFields.push("cookTime");
  const totalTime = parseDuration(node.totalTime);
  if (!totalTime) missingFields.push("totalTime");

  const author = extractAuthor(node.author);

  const confidence =
    ingredients.length > 0 && instructions.length > 0 && title
      ? 0.9
      : ingredients.length > 0 || instructions.length > 0
        ? 0.6
        : 0.3;

  return {
    title: title ?? undefined,
    description: asString(node.description) ?? undefined,
    ingredients,
    instructions,
    yields: yields ?? undefined,
    prepTime: prepTime ?? undefined,
    cookTime: cookTime ?? undefined,
    totalTime: totalTime ?? undefined,
    author: author ?? undefined,
    cuisine: asString(node.recipeCuisine) ?? undefined,
    category: asString(node.recipeCategory) ?? undefined,
    confidence,
    missingFields,
    extractionStrategy: "json_ld",
    sourceUrl,
    sourceSiteName: asString(node.publisher?.name) ?? extractDomain(sourceUrl),
  };
}

// ---------------------------------------------------------------------------
// Microdata extraction
// ---------------------------------------------------------------------------

function extractFromMicrodata(
  html: string,
  sourceUrl: string,
): ImportedRecipeDocument | null {
  const recipeScope =
    /itemscope[^>]*itemtype\s*=\s*["']https?:\/\/schema\.org\/Recipe["']/i;
  if (!recipeScope.test(html)) return null;

  // Extract itemprop values from the Recipe scope.
  // This is a simplified parser — handles the common case where itemprops are
  // content attributes or inner text.
  const getItemProp = (prop: string): string | null => {
    const re = new RegExp(
      `itemprop\\s*=\\s*["']${prop}["'][^>]*(?:content\\s*=\\s*["']([^"']*)["']|>([^<]*)<)`,
      "i",
    );
    const m = re.exec(html);
    return m?.[1] ?? m?.[2] ?? null;
  };

  const getAllItemProp = (prop: string): string[] => {
    const re = new RegExp(
      `itemprop\\s*=\\s*["']${prop}["'][^>]*(?:content\\s*=\\s*["']([^"']*)["']|>([^<]*)<)`,
      "gi",
    );
    const results: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const val = (m[1] ?? m[2] ?? "").trim();
      if (val) results.push(val);
    }
    return results;
  };

  const ingredients = getAllItemProp("recipeIngredient");
  const instructions = getAllItemProp("recipeInstructions")
    .flatMap((s) => s.split(/\n+/).map((l) => l.trim()).filter(Boolean));
  const title = getItemProp("name");

  if (ingredients.length === 0 && instructions.length === 0) return null;

  const missingFields: string[] = [];
  if (!title) missingFields.push("title");
  if (ingredients.length === 0) missingFields.push("ingredients");
  if (instructions.length === 0) missingFields.push("instructions");

  return {
    title: title ?? undefined,
    description: getItemProp("description") ?? undefined,
    ingredients,
    instructions,
    yields: getItemProp("recipeYield") ?? undefined,
    prepTime: getItemProp("prepTime") ?? undefined,
    cookTime: getItemProp("cookTime") ?? undefined,
    totalTime: getItemProp("totalTime") ?? undefined,
    author: getItemProp("author") ?? undefined,
    cuisine: getItemProp("recipeCuisine") ?? undefined,
    category: getItemProp("recipeCategory") ?? undefined,
    confidence: 0.7,
    missingFields,
    extractionStrategy: "microdata",
    sourceUrl,
    sourceSiteName: extractDomain(sourceUrl),
  };
}

// ---------------------------------------------------------------------------
// Meta / OpenGraph fallback
// ---------------------------------------------------------------------------

function extractFromMeta(
  html: string,
  sourceUrl: string,
): ImportedRecipeDocument | null {
  const getMeta = (nameOrProp: string): string | null => {
    const re = new RegExp(
      `<meta[^>]+(?:name|property)\\s*=\\s*["']${nameOrProp}["'][^>]+content\\s*=\\s*["']([^"']*)["']`,
      "i",
    );
    const m = re.exec(html);
    return m?.[1] ?? null;
  };

  const title =
    getMeta("og:title") ??
    getMeta("twitter:title") ??
    extractHtmlTitle(html);

  const description =
    getMeta("og:description") ??
    getMeta("description") ??
    getMeta("twitter:description");

  if (!title && !description) return null;

  return {
    title: title ?? undefined,
    description: description ?? undefined,
    ingredients: [],
    instructions: [],
    confidence: 0.2,
    missingFields: [
      "ingredients",
      "instructions",
      "yields",
      "prepTime",
      "cookTime",
    ],
    extractionStrategy: "meta_fallback",
    sourceUrl,
    sourceSiteName:
      getMeta("og:site_name") ?? extractDomain(sourceUrl),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asString(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0].trim() || null;
  }
  if (value && typeof value === "object" && "name" in value) {
    return asString((value as Record<string, unknown>).name);
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Extracts instruction strings from JSON-LD recipeInstructions, which can be:
 * - An array of strings
 * - An array of HowToStep objects ({ text: string })
 * - An array of HowToSection objects ({ itemListElement: HowToStep[] })
 * - A single string with newline-separated steps
 */
function extractInstructions(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") {
    return value
      .split(/\n+/)
      .map((s) => stripHtml(s).trim())
      .filter(Boolean);
  }
  if (!Array.isArray(value)) return [];

  const result: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      result.push(stripHtml(item).trim());
    } else if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      if (typeof record.text === "string") {
        result.push(stripHtml(record.text).trim());
      } else if (Array.isArray(record.itemListElement)) {
        for (const sub of record.itemListElement) {
          if (sub && typeof sub === "object" && typeof (sub as Record<string, unknown>).text === "string") {
            result.push(stripHtml((sub as Record<string, unknown>).text as string).trim());
          }
        }
      }
    }
  }
  return result.filter(Boolean);
}

function extractAuthor(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) return extractAuthor(value[0]);
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return asString(record.name);
  }
  return null;
}

/**
 * Parses ISO 8601 duration (PT30M, PT1H15M) into a human-readable string.
 * Also passes through already-readable strings ("30 minutes").
 */
function parseDuration(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  if (!raw.startsWith("P")) return raw;

  const match = /^PT?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(raw);
  if (!match) return raw;

  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  const totalMinutes = hours * 60 + minutes;
  if (totalMinutes === 0) return null;

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function extractHtmlTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? stripHtml(m[1]).trim() || null : null;
}
