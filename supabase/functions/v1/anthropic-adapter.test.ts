import { callAnthropicJson } from "../_shared/llm-adapters/anthropic.ts";

const ANTHROPIC_API_KEY = "test-anthropic-key";

Deno.test("callAnthropicJson uses tool input_schema for structured outputs", async () => {
  const previousFetch = globalThis.fetch;
  Deno.env.set("ANTHROPIC_API_KEY", ANTHROPIC_API_KEY);

  try {
    globalThis.fetch = ((
      _input: Request | URL | string,
      init?: RequestInit,
    ) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        tools?: Array<{
          name?: string;
          input_schema?: Record<string, unknown>;
        }>;
        tool_choice?: {
          type?: string;
          name?: string;
        };
      };

      if (body.tools?.[0]?.name !== "chat_response") {
        throw new Error("expected structured output tool");
      }
      if (
        body.tool_choice?.type !== "tool" ||
        body.tool_choice?.name !== "chat_response"
      ) {
        throw new Error("expected forced tool choice");
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            content: [{
              type: "tool_use",
              name: "chat_response",
              input: {
                assistant_reply: { text: "Hello there" },
                response_context: { intent: "in_scope_ideation" },
                trigger_recipe: false,
              },
            }],
            usage: {
              input_tokens: 9,
              output_tokens: 4,
            },
            stop_reason: "tool_use",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }) as typeof fetch;

    const result = await callAnthropicJson<{
      assistant_reply: { text: string };
    }>({
      model: "claude-haiku-4-5",
      modelConfig: {},
      systemPrompt: "Return structured output",
      userInput: { task: "chat_conversation" },
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

    if (result.result.assistant_reply.text !== "Hello there") {
      throw new Error("expected structured tool output");
    }
    if (result.inputTokens !== 9 || result.outputTokens !== 4) {
      throw new Error("unexpected token accounting");
    }
  } finally {
    globalThis.fetch = previousFetch;
    Deno.env.delete("ANTHROPIC_API_KEY");
  }
});
