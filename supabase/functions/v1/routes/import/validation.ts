import { ApiError } from "../../../_shared/errors.ts";
import type { ImportRequest } from "../../../_shared/types.ts";

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
