import { ApiError } from "../_shared/errors.ts";
import { executeVisionWithConfig } from "../_shared/llm-executor.ts";

const OPENAI_API_KEY = "test-openai-key";
const GEMINI_API_KEY = "test-gemini-key";

Deno.test("executeVisionWithConfig routes OpenAI multimodal JSON with input_image content", async () => {
  const previousFetch = globalThis.fetch;
  Deno.env.set("OPENAI_API_KEY", OPENAI_API_KEY);

  try {
    globalThis.fetch = ((
      _input: Request | URL | string,
      init?: RequestInit,
    ) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        input?: Array<{ content?: Array<{ type?: string; image_url?: string }> }>;
        text?: { format?: { type?: string } };
      };

      const userContent = body.input?.[1]?.content ?? [];
      const imageParts = userContent.filter((item) => item.type === "input_image");
      if (imageParts.length !== 2) {
        throw new Error("expected two input_image parts");
      }
      if (body.text?.format?.type !== "json_object") {
        throw new Error("expected JSON object response format");
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            output: [
              {
                content: [
                  {
                    type: "output_text",
                    text: "{\"winner\":\"A\",\"rationale\":\"Sharper plating\",\"confidence\":0.91}",
                  },
                ],
              },
            ],
            usage: {
              input_tokens: 12,
              output_tokens: 9,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }) as typeof fetch;

    const result = await executeVisionWithConfig<{
      winner: string;
      rationale: string;
      confidence: number;
    }>({
      provider: "openai",
      model: "gpt-4.1-mini",
      modelConfig: {},
      systemPrompt: "Judge the images",
      userInput: { scenario: "test" },
      images: [
        { label: "A", imageUrl: "data:image/png;base64,AAA=" },
        { label: "B", imageUrl: "data:image/png;base64,BBB=" },
      ],
    });

    if (result.result.winner !== "A") {
      throw new Error("expected parsed winner");
    }
    if (result.inputTokens !== 12 || result.outputTokens !== 9) {
      throw new Error("unexpected token usage");
    }
  } finally {
    globalThis.fetch = previousFetch;
    Deno.env.delete("OPENAI_API_KEY");
  }
});

Deno.test("executeVisionWithConfig routes Gemini multimodal JSON with inline image data", async () => {
  const previousFetch = globalThis.fetch;
  Deno.env.set("GEMINI_API_KEY", GEMINI_API_KEY);

  try {
    globalThis.fetch = ((
      _input: Request | URL | string,
      init?: RequestInit,
    ) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        contents?: Array<{ parts?: Array<{ inlineData?: { data?: string } }> }>;
      };
      const parts = body.contents?.[0]?.parts ?? [];
      const inlineParts = parts.filter((part) => part.inlineData?.data);
      if (inlineParts.length !== 2) {
        throw new Error("expected two inline image parts");
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "{\"winner\":\"tie\",\"rationale\":\"Very close\",\"confidence\":0.5}" }],
                },
              },
            ],
            usageMetadata: {
              promptTokenCount: 8,
              candidatesTokenCount: 5,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }) as typeof fetch;

    const result = await executeVisionWithConfig<{
      winner: string;
      rationale: string;
      confidence: number;
    }>({
      provider: "google",
      model: "gemini-2.5-flash",
      modelConfig: {},
      systemPrompt: "Judge the images",
      userInput: { scenario: "test" },
      images: [
        { label: "A", imageUrl: "data:image/png;base64,AAA=" },
        { label: "B", imageUrl: "data:image/png;base64,BBB=" },
      ],
    });

    if (result.result.winner !== "tie") {
      throw new Error("expected tie winner");
    }
    if (result.inputTokens !== 8 || result.outputTokens !== 5) {
      throw new Error("unexpected token usage");
    }
  } finally {
    globalThis.fetch = previousFetch;
    Deno.env.delete("GEMINI_API_KEY");
  }
});

Deno.test("executeVisionWithConfig keeps unsupported-provider behavior", async () => {
  let thrown: unknown = null;
  try {
    await executeVisionWithConfig({
      provider: "bogus-provider",
      model: "model",
      modelConfig: {},
      systemPrompt: "sys",
      userInput: { input: true },
      images: [{ label: "A", imageUrl: "data:image/png;base64,AAA=" }],
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
