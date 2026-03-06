import { ApiError } from "../_shared/errors.ts";
import {
  executeEmbeddingWithConfig,
  getActiveConfig,
} from "../_shared/llm-executor.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const OPENAI_API_KEY = "test-openai-key";

const buildConfigClient = (
  tables: Record<string, unknown>,
): SupabaseClient => {
  return {
    from(table: string) {
      return {
        select(_columns: string) {
          return this;
        },
        eq(_column: string, _value: unknown) {
          return this;
        },
        maybeSingle: async () => ({
          data: tables[table] ?? null,
          error: null,
        }),
      };
    },
  } as unknown as SupabaseClient;
};

Deno.test("getActiveConfig allows empty prompts for embedding scopes", async () => {
  const config = await getActiveConfig(
    buildConfigClient({
      llm_prompts: { template: "" },
      llm_rules: { rule: { response_contract: "recipe_search_embedding_v1" } },
      llm_model_routes: {
        provider: "openai",
        model: "text-embedding-3-small",
        config: { dimensions: 1536, normalize: "unit" },
      },
      llm_model_registry: {
        input_cost_per_1m_tokens: 0.02,
        output_cost_per_1m_tokens: 0,
        billing_mode: "token",
        billing_metadata: {},
      },
    }),
    "recipe_search_embed",
  );

  if (config.promptTemplate !== "") {
    throw new Error("expected embedding prompt to remain empty");
  }
});

Deno.test("getActiveConfig still rejects empty prompts for non-embedding scopes", async () => {
  let thrown: unknown = null;

  try {
    await getActiveConfig(
      buildConfigClient({
        llm_prompts: { template: "" },
        llm_rules: {
          rule: { response_contract: "recipe_search_interpret_v1" },
        },
        llm_model_routes: {
          provider: "openai",
          model: "gpt-5-mini",
          config: { temperature: 0.1 },
        },
        llm_model_registry: {
          input_cost_per_1m_tokens: 0.25,
          output_cost_per_1m_tokens: 2,
          billing_mode: "token",
          billing_metadata: {},
        },
      }),
      "recipe_search_interpret",
    );
  } catch (error) {
    thrown = error;
  }

  if (!(thrown instanceof ApiError)) {
    throw new Error("expected ApiError");
  }
  if (thrown.code !== "gateway_prompt_missing") {
    throw new Error(`unexpected error code: ${thrown.code}`);
  }
});

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
