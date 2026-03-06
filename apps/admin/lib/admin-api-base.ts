const DEFAULT_API_BASE = "https://api.cookwithalchemy.com/v1";

/**
 * Normalizes the admin worker's upstream API base so every proxy route resolves
 * paths the same way, regardless of whether the env var is configured with a
 * bare hostname, origin, or full /v1 suffix.
 */
export const normalizeApiBase = (raw: string | undefined): string => {
  const value = (raw ?? DEFAULT_API_BASE).trim();
  if (!value) {
    return DEFAULT_API_BASE;
  }

  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const withoutTrailing = withProtocol.replace(/\/+$/, "");
  return withoutTrailing.endsWith("/v1") ? withoutTrailing : `${withoutTrailing}/v1`;
};
