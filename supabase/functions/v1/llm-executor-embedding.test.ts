import { ApiError } from "../_shared/errors.ts";
import { executeEmbeddingWithConfig } from "../_shared/llm-executor.ts";

const OPENAI_API_KEY = "test-openai-key";

Deno.test("executeEmbeddingWithConfig routes OpenAI embeddings and normalizes the vector", async () => {
  const previousFetch = globalThis.fetch;
  Deno.env.set("OPENAI_API_KEY", OPENAI_API_KEY);

  try {
    globalThis.fetch = ((
      _input: Request | URL | string,
      init?: RequestInit,
    ) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        model?: string;
        input?: string;
        dimensions?: number;
      };

      if (body.model !== "text-embedding-3-small") {
        throw new Error("expected text-embedding-3-small model");
      }
      if (body.input !== "seared duck breast") {
        throw new Error("expected search text input");
      }
      if (body.dimensions !== 3) {
        throw new Error("expected dimensions override");
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ embedding: [3, 4, 0] }],
            usage: { prompt_tokens: 9 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }) as typeof fetch;

    const result = await executeEmbeddingWithConfig({
      provider: "openai",
      model: "text-embedding-3-small",
      modelConfig: {
        dimensions: 3,
        normalize: "unit",
      },
      inputText: "seared duck breast",
    });

    if (result.dimensions !== 3) {
      throw new Error(`unexpected dimensions: ${result.dimensions}`);
    }
    if (result.inputTokens !== 9) {
      throw new Error(`unexpected token count: ${result.inputTokens}`);
    }
    if (Math.abs(result.vector[0] - 0.6) > 1e-6) {
      throw new Error(`expected normalized x component, got ${result.vector[0]}`);
    }
    if (Math.abs(result.vector[1] - 0.8) > 1e-6) {
      throw new Error(`expected normalized y component, got ${result.vector[1]}`);
    }
  } finally {
    globalThis.fetch = previousFetch;
    Deno.env.delete("OPENAI_API_KEY");
  }
});

Deno.test("executeEmbeddingWithConfig rejects embedding dimension mismatches", async () => {
  const previousFetch = globalThis.fetch;
  Deno.env.set("OPENAI_API_KEY", OPENAI_API_KEY);

  try {
    globalThis.fetch = (() => {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ embedding: [0.1, 0.2] }],
            usage: { prompt_tokens: 4 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }) as typeof fetch;

    let thrown: unknown = null;
    try {
      await executeEmbeddingWithConfig({
        provider: "openai",
        model: "text-embedding-3-small",
        modelConfig: {
          dimensions: 3,
        },
        inputText: "light savory dishes",
      });
    } catch (error) {
      thrown = error;
    }

    if (!(thrown instanceof ApiError)) {
      throw new Error("expected ApiError");
    }
    if (thrown.code !== "embedding_dimension_mismatch") {
      throw new Error(`unexpected error code: ${thrown.code}`);
    }
  } finally {
    globalThis.fetch = previousFetch;
    Deno.env.delete("OPENAI_API_KEY");
  }
});
