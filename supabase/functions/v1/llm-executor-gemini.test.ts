import { ApiError } from "../_shared/errors.ts";
import {
  executeImageWithConfig,
  executeWithConfig,
} from "../_shared/llm-executor.ts";

const TEST_API_KEY = "test-gemini-key";

Deno.test("executeWithConfig routes google provider through Gemini text adapter", async () => {
  const previousFetch = globalThis.fetch;
  Deno.env.set("GEMINI_API_KEY", TEST_API_KEY);

  try {
    globalThis.fetch = (() => {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "{\"provider\":\"google\"}" }],
                },
              },
            ],
            usageMetadata: {
              promptTokenCount: 7,
              candidatesTokenCount: 3,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }) as typeof fetch;

    const result = await executeWithConfig<{ provider: string }>({
      provider: "google",
      model: "gemini-2.5-flash",
      modelConfig: {},
      systemPrompt: "Return JSON only",
      userInput: { scope: "test" },
    });

    if (result.result.provider !== "google") {
      throw new Error("expected google provider response");
    }
    if (result.inputTokens !== 7 || result.outputTokens !== 3) {
      throw new Error("unexpected token accounting");
    }
  } finally {
    globalThis.fetch = previousFetch;
    Deno.env.delete("GEMINI_API_KEY");
  }
});

Deno.test("executeImageWithConfig routes google provider through Gemini image adapter", async () => {
  const previousFetch = globalThis.fetch;
  Deno.env.set("GEMINI_API_KEY", TEST_API_KEY);

  try {
    globalThis.fetch = (() => {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: "image/png",
                        data: "xyz987",
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }) as typeof fetch;

    const imageUrl = await executeImageWithConfig({
      provider: "google",
      model: "gemini-2.5-flash-image",
      modelConfig: {},
      prompt: "Generate an image",
    });

    if (imageUrl !== "data:image/png;base64,xyz987") {
      throw new Error(`unexpected image url: ${imageUrl}`);
    }
  } finally {
    globalThis.fetch = previousFetch;
    Deno.env.delete("GEMINI_API_KEY");
  }
});

Deno.test("executeWithConfig keeps unsupported-provider error behavior", async () => {
  let thrown: unknown = null;
  try {
    await executeWithConfig({
      provider: "bogus-provider",
      model: "model",
      modelConfig: {},
      systemPrompt: "sys",
      userInput: { input: true },
    });
  } catch (error) {
    thrown = error;
  }

  if (!(thrown instanceof ApiError)) {
    throw new Error("expected ApiError");
  }
  if (thrown.code !== "llm_provider_not_supported") {
    throw new Error(`unexpected error code: ${thrown.code}`);
  }
});

Deno.test("executeImageWithConfig keeps unsupported-provider error behavior", async () => {
  let thrown: unknown = null;
  try {
    await executeImageWithConfig({
      provider: "bogus-provider",
      model: "model",
      modelConfig: {},
      prompt: "image prompt",
    });
  } catch (error) {
    thrown = error;
  }

  if (!(thrown instanceof ApiError)) {
    throw new Error("expected ApiError");
  }
  if (thrown.code !== "image_provider_not_supported") {
    throw new Error(`unexpected error code: ${thrown.code}`);
  }
});
