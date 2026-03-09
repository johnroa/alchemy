import {
  callOpenAiImage,
  callOpenAiJson,
} from "../_shared/llm-adapters/openai.ts";

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

Deno.test("callOpenAiJson uses native json_schema structured outputs for chat completions", async () => {
  const previousFetch = globalThis.fetch;
  Deno.env.set("OPENAI_API_KEY", OPENAI_API_KEY);

  try {
    globalThis.fetch = ((
      input: Request | URL | string,
      init?: RequestInit,
    ) => {
      const url = getRequestUrl(input);
      if (url !== "https://api.openai.com/v1/chat/completions") {
        throw new Error(`unexpected URL: ${url}`);
      }

      const body = JSON.parse(String(init?.body ?? "{}")) as {
        response_format?: {
          type?: string;
          json_schema?: {
            name?: string;
            strict?: boolean;
            schema?: Record<string, unknown>;
          };
        };
      };

      if (body.response_format?.type !== "json_schema") {
        throw new Error("expected json_schema response format");
      }
      if (body.response_format?.json_schema?.name !== "chat_response") {
        throw new Error("expected schema name");
      }
      if (body.response_format?.json_schema?.strict !== true) {
        throw new Error("expected strict structured output");
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{
              message: {
                parsed: {
                  assistant_reply: { text: "Hello" },
                  response_context: { intent: "in_scope_ideation" },
                  trigger_recipe: false,
                },
              },
            }],
            usage: {
              prompt_tokens: 11,
              completion_tokens: 5,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }) as typeof fetch;

    const result = await callOpenAiJson<{
      assistant_reply: { text: string };
    }>({
      model: "gpt-4.1-mini",
      modelConfig: {
        api_mode: "chat_completions",
      },
      systemPrompt: "Return structured output",
      userInput: {
        task: "chat_conversation",
      },
      structuredOutput: {
        name: "chat_response",
        schema: {
          type: "object",
          properties: {
            assistant_reply: {
              type: "object",
              properties: {
                text: { type: "string" },
              },
            },
          },
        },
        strict: true,
      },
    });

    if (result.result.assistant_reply.text !== "Hello") {
      throw new Error("expected parsed structured output");
    }
    if (result.inputTokens !== 11 || result.outputTokens !== 5) {
      throw new Error("unexpected token accounting");
    }
  } finally {
    globalThis.fetch = previousFetch;
    Deno.env.delete("OPENAI_API_KEY");
  }
});
