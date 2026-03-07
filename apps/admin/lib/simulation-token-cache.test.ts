import { describe, expect, it } from "vitest";
import { createCachedBearerTokenProvider } from "./simulation-token-cache";

describe("createCachedBearerTokenProvider", () => {
  it("reuses a fresh token", async () => {
    let calls = 0;
    const getToken = createCachedBearerTokenProvider(async () => ({
      accessToken: `token-${++calls}`,
      expiresAt: Date.now() + (5 * 60 * 1000),
    }));

    const first = await getToken();
    const second = await getToken();

    expect(first).toBe("token-1");
    expect(second).toBe("token-1");
    expect(calls).toBe(1);
  });

  it("dedupes concurrent callers", async () => {
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

    expect(first).toBe("shared-token");
    expect(second).toBe("shared-token");
    expect(calls).toBe(1);
  });

  it("refreshes tokens nearing expiry", async () => {
    let calls = 0;
    const getToken = createCachedBearerTokenProvider(async () => {
      calls += 1;
      return calls === 1
        ? { accessToken: "stale-token", expiresAt: Date.now() + 1_000 }
        : { accessToken: "fresh-token", expiresAt: Date.now() + (5 * 60 * 1000) };
    });

    const first = await getToken();
    const second = await getToken();

    expect(first).toBe("stale-token");
    expect(second).toBe("fresh-token");
    expect(calls).toBe(2);
  });
});
