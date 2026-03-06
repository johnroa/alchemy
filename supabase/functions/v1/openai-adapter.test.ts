import { callOpenAiImage } from "../_shared/llm-adapters/openai.ts";

const OPENAI_API_KEY = "test-openai-key";

const getRequestUrl = (input: Request | URL | string): string => {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
};

Deno.test("callOpenAiImage omits response_format for GPT image models and returns data URL", async () => {
  const previousFetch = globalThis.fetch;
  Deno.env.set("OPENAI_API_KEY", OPENAI_API_KEY);

  try {
    globalThis.fetch = ((
      input: Request | URL | string,
      init?: RequestInit,
    ) => {
      const url = getRequestUrl(input);
      if (url !== "https://api.openai.com/v1/images/generations") {
        throw new Error(`unexpected URL: ${url}`);
      }

      const headers = new Headers(init?.headers);
      if (headers.get("authorization") !== `Bearer ${OPENAI_API_KEY}`) {
        throw new Error("expected authorization header");
      }

      const body = JSON.parse(String(init?.body ?? "{}")) as {
        model?: string;
        size?: string;
        quality?: string;
        response_format?: string;
      };

      if (body.model !== "gpt-image-1") {
        throw new Error("expected gpt-image-1 model");
      }
      if (body.size !== "1536x1024") {
        throw new Error("expected default size");
      }
      if (body.quality !== "high") {
        throw new Error("expected default quality");
      }
      if ("response_format" in body) {
        throw new Error("did not expect response_format for GPT image models");
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ b64_json: "AAA=" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }) as typeof fetch;

    const imageUrl = await callOpenAiImage({
      model: "gpt-image-1",
      modelConfig: {},
      prompt: "A plated dish",
    });

    if (imageUrl !== "data:image/png;base64,AAA=") {
      throw new Error(`unexpected image URL: ${imageUrl}`);
    }
  } finally {
    globalThis.fetch = previousFetch;
    Deno.env.delete("OPENAI_API_KEY");
  }
});
