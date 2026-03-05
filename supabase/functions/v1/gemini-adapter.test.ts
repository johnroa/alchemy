import { ApiError } from "../_shared/errors.ts";
import {
  callGoogleImage,
  callGoogleJson,
} from "../_shared/llm-adapters/google.ts";

const TEST_API_KEY = "test-gemini-key";

const getRequestUrl = (input: Request | URL | string): string => {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
};

Deno.test("callGoogleJson returns parsed JSON and token usage", async () => {
  const previousFetch = globalThis.fetch;
  Deno.env.set("GEMINI_API_KEY", TEST_API_KEY);

  try {
    globalThis.fetch = ((
      input: Request | URL | string,
      init?: RequestInit,
    ) => {
      const url = getRequestUrl(input);
      if (
        url !==
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
      ) {
        throw new Error(`unexpected URL: ${url}`);
      }

      const headers = new Headers(init?.headers);
      if (headers.get("x-goog-api-key") !== TEST_API_KEY) {
        throw new Error("expected x-goog-api-key header");
      }

      const bodyText = typeof init?.body === "string" ? init.body : "";
      if (!bodyText) {
        throw new Error("expected request body");
      }

      const payload = JSON.parse(bodyText) as {
        generationConfig?: {
          responseMimeType?: string;
          temperature?: number;
          topP?: number;
          topK?: number;
          maxOutputTokens?: number;
        };
      };
      const generationConfig = payload.generationConfig;
      if (!generationConfig) {
        throw new Error("expected generationConfig");
      }
      if (generationConfig.responseMimeType !== "application/json") {
        throw new Error("expected JSON response mime type");
      }
      if (generationConfig.temperature !== 0.2) {
        throw new Error("expected mapped temperature");
      }
      if (generationConfig.topP !== 0.95) {
        throw new Error("expected mapped topP");
      }
      if (generationConfig.topK !== 32) {
        throw new Error("expected mapped topK");
      }
      if (generationConfig.maxOutputTokens !== 2048) {
        throw new Error("expected mapped maxOutputTokens");
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "{\"ok\":true}" }],
                },
              },
            ],
            usageMetadata: {
              promptTokenCount: 111,
              candidatesTokenCount: 29,
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );
    }) as typeof fetch;

    const result = await callGoogleJson<{ ok: boolean }>({
      model: "gemini-2.5-flash",
      modelConfig: {
        temperature: 0.2,
        top_p: 0.95,
        top_k: 32,
        max_output_tokens: 2048,
      },
      systemPrompt: "Return JSON only",
      userInput: { request: "health-check" },
    });

    if (!result.result.ok) {
      throw new Error("expected parsed JSON result");
    }
    if (result.inputTokens !== 111) {
      throw new Error(`unexpected input token count: ${String(result.inputTokens)}`);
    }
    if (result.outputTokens !== 29) {
      throw new Error(
        `unexpected output token count: ${String(result.outputTokens)}`,
      );
    }
  } finally {
    globalThis.fetch = previousFetch;
    Deno.env.delete("GEMINI_API_KEY");
  }
});

Deno.test("callGoogleJson maps timeout to llm_provider_timeout", async () => {
  const previousFetch = globalThis.fetch;
  Deno.env.set("GEMINI_API_KEY", TEST_API_KEY);

  try {
    globalThis.fetch = (() => {
      throw new DOMException("timed out", "TimeoutError");
    }) as typeof fetch;

    let thrown: unknown = null;
    try {
      await callGoogleJson({
        model: "gemini-2.5-flash",
        modelConfig: {},
        systemPrompt: "sys",
        userInput: { value: "x" },
      });
    } catch (error) {
      thrown = error;
    }

    if (!(thrown instanceof ApiError)) {
      throw new Error("expected ApiError");
    }
    if (thrown.code !== "llm_provider_timeout") {
      throw new Error(`unexpected error code: ${thrown.code}`);
    }
    if (thrown.status !== 504) {
      throw new Error(`unexpected status: ${String(thrown.status)}`);
    }
  } finally {
    globalThis.fetch = previousFetch;
    Deno.env.delete("GEMINI_API_KEY");
  }
});

Deno.test("callGoogleJson maps invalid JSON output to llm_invalid_json", async () => {
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
                  parts: [{ text: "not-json" }],
                },
                finishReason: "STOP",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }) as typeof fetch;

    let thrown: unknown = null;
    try {
      await callGoogleJson({
        model: "gemini-2.5-flash",
        modelConfig: {},
        systemPrompt: "sys",
        userInput: { value: "x" },
      });
    } catch (error) {
      thrown = error;
    }

    if (!(thrown instanceof ApiError)) {
      throw new Error("expected ApiError");
    }
    if (thrown.code !== "llm_invalid_json") {
      throw new Error(`unexpected error code: ${thrown.code}`);
    }
  } finally {
    globalThis.fetch = previousFetch;
    Deno.env.delete("GEMINI_API_KEY");
  }
});

Deno.test("callGoogleJson maps token limit truncation to llm_json_truncated", async () => {
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
                  parts: [{ text: "{\"incomplete\": true" }],
                },
                finishReason: "MAX_TOKENS",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }) as typeof fetch;

    let thrown: unknown = null;
    try {
      await callGoogleJson({
        model: "gemini-2.5-flash",
        modelConfig: {},
        systemPrompt: "sys",
        userInput: { value: "x" },
      });
    } catch (error) {
      thrown = error;
    }

    if (!(thrown instanceof ApiError)) {
      throw new Error("expected ApiError");
    }
    if (thrown.code !== "llm_json_truncated") {
      throw new Error(`unexpected error code: ${thrown.code}`);
    }
  } finally {
    globalThis.fetch = previousFetch;
    Deno.env.delete("GEMINI_API_KEY");
  }
});

Deno.test("callGoogleImage returns data URL from inline image bytes", async () => {
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
                      inline_data: {
                        mime_type: "image/jpeg",
                        data: "abc123",
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

    const imageUrl = await callGoogleImage({
      model: "gemini-2.5-flash-image",
      modelConfig: {},
      prompt: "Generate a plated pasta photo",
    });

    if (imageUrl !== "data:image/jpeg;base64,abc123") {
      throw new Error(`unexpected image url: ${imageUrl}`);
    }
  } finally {
    globalThis.fetch = previousFetch;
    Deno.env.delete("GEMINI_API_KEY");
  }
});

Deno.test("callGoogleImage maps empty image outputs to image_empty_output", async () => {
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
                  parts: [{ text: "no image" }],
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }) as typeof fetch;

    let thrown: unknown = null;
    try {
      await callGoogleImage({
        model: "gemini-2.5-flash-image",
        modelConfig: {},
        prompt: "Generate image",
      });
    } catch (error) {
      thrown = error;
    }

    if (!(thrown instanceof ApiError)) {
      throw new Error("expected ApiError");
    }
    if (thrown.code !== "image_empty_output") {
      throw new Error(`unexpected error code: ${thrown.code}`);
    }
  } finally {
    globalThis.fetch = previousFetch;
    Deno.env.delete("GEMINI_API_KEY");
  }
});
