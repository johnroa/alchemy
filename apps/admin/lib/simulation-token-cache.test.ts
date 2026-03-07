/// <reference lib="deno.ns" />
import { createCachedBearerTokenProvider } from "./simulation-token-cache.ts";

Deno.test("createCachedBearerTokenProvider reuses a fresh token", async () => {
  let calls = 0;
  const getToken = createCachedBearerTokenProvider(async () => ({
    accessToken: `token-${++calls}`,
    expiresAt: Date.now() + (5 * 60 * 1000),
  }));

  const first = await getToken();
  const second = await getToken();

  if (first !== "token-1" || second !== "token-1") {
    throw new Error(`expected cached token reuse, got ${first} and ${second}`);
  }

  if (calls !== 1) {
    throw new Error(`expected one fetch, got ${calls}`);
  }
});

Deno.test("createCachedBearerTokenProvider dedupes concurrent callers", async () => {
  let calls = 0;
  let release: (() => void) | null = null;
  const waitForRelease = new Promise<void>((resolve) => {
    release = resolve;
  });

  const getToken = createCachedBearerTokenProvider(async () => {
    calls += 1;
    await waitForRelease;
    return {
      accessToken: "shared-token",
      expiresAt: Date.now() + (5 * 60 * 1000),
    };
  });

  const firstPromise = getToken();
  const secondPromise = getToken();
  release?.();

  const [first, second] = await Promise.all([firstPromise, secondPromise]);

  if (first !== "shared-token" || second !== "shared-token") {
    throw new Error(`expected shared token for concurrent callers, got ${first} and ${second}`);
  }

  if (calls !== 1) {
    throw new Error(`expected one inflight fetch, got ${calls}`);
  }
});

Deno.test("createCachedBearerTokenProvider refreshes tokens nearing expiry", async () => {
  let calls = 0;
  const getToken = createCachedBearerTokenProvider(async () => {
    calls += 1;
    return calls === 1
      ? { accessToken: "stale-token", expiresAt: Date.now() + 1_000 }
      : { accessToken: "fresh-token", expiresAt: Date.now() + (5 * 60 * 1000) };
  });

  const first = await getToken();
  const second = await getToken();

  if (first !== "stale-token" || second !== "fresh-token") {
    throw new Error(`expected refresh after near-expiry token, got ${first} and ${second}`);
  }

  if (calls !== 2) {
    throw new Error(`expected refresh fetch, got ${calls}`);
  }
});
