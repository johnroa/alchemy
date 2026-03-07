export type CachedBearerToken = {
  accessToken: string;
  expiresAt: number;
};

export type CachedBearerTokenFetcher = () => Promise<CachedBearerToken>;

const TOKEN_REUSE_BUFFER_MS = 30_000;

const isTokenFresh = (token: CachedBearerToken | null, now: number): token is CachedBearerToken =>
  token !== null && token.expiresAt - TOKEN_REUSE_BUFFER_MS > now;

/**
 * Deduplicates concurrent token fetches and reuses still-fresh bearer tokens
 * so callers do not mint overlapping passwordless sessions for the same user.
 */
export const createCachedBearerTokenProvider = (
  fetchToken: CachedBearerTokenFetcher,
): (() => Promise<string>) => {
  let cachedToken: CachedBearerToken | null = null;
  let inflightToken: Promise<CachedBearerToken> | null = null;

  return async (): Promise<string> => {
    const now = Date.now();
    if (isTokenFresh(cachedToken, now)) {
      return cachedToken.accessToken;
    }

    if (inflightToken) {
      return (await inflightToken).accessToken;
    }

    inflightToken = fetchToken()
      .then((token) => {
        cachedToken = token;
        return token;
      })
      .finally(() => {
        inflightToken = null;
      });

    return (await inflightToken).accessToken;
  };
};
