import { ApiError } from "../errors.ts";
import type { StructuredOutputDefinition } from "../llm-executor.ts";
import { parseJsonFromText, truncateErrorDetailText } from "../llm-parsers.ts";
import type { JsonValue } from "../types.ts";

type ProviderResult<T> = {
  result: T;
  inputTokens: number;
  outputTokens: number;
};

export const callAnthropicJson = async <T>(params: {
  model: string;
  modelConfig: Record<string, JsonValue>;
  systemPrompt: string;
  userInput: Record<string, JsonValue>;
  structuredOutput?: StructuredOutputDefinition;
}): Promise<ProviderResult<T>> => {
  const endpoint = (typeof params.modelConfig.endpoint === "string" &&
    params.modelConfig.endpoint) ||
    "https://api.anthropic.com/v1/messages";
  const apiKeyEnv = (typeof params.modelConfig.api_key_env === "string" &&
    params.modelConfig.api_key_env) || "ANTHROPIC_API_KEY";
  const apiKey = Deno.env.get(apiKeyEnv);

  if (!apiKey) {
    throw new ApiError(
      500,
      "llm_provider_key_missing",
      `Missing provider API key env: ${apiKeyEnv}`,
    );
  }

  const timeoutCandidate = Number(params.modelConfig.timeout_ms);
  const timeoutMs = Number.isFinite(timeoutCandidate)
    ? Math.max(5_000, Math.min(120_000, timeoutCandidate))
    : 45_000;

  const maxTokens = typeof params.modelConfig.max_tokens === "number"
    ? params.modelConfig.max_tokens
    : typeof params.modelConfig.max_output_tokens === "number"
    ? params.modelConfig.max_output_tokens
    : 8096;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: params.model,
        max_tokens: maxTokens,
        system: params.systemPrompt,
        ...(params.structuredOutput
          ? {
            tools: [{
              name: params.structuredOutput.name,
              description: params.structuredOutput.description ??
                "Return the requested structured response.",
              input_schema: params.structuredOutput.schema,
            }],
            tool_choice: {
              type: "tool",
              name: params.structuredOutput.name,
            },
          }
          : {}),
        messages: [
          {
            role: "user",
            content: [{
              type: "text",
              text: JSON.stringify(params.userInput),
            }],
          },
        ],
      }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new ApiError(
        504,
        "llm_provider_timeout",
        "LLM provider timed out",
        {
          endpoint,
          model: params.model,
          timeout_ms: timeoutMs,
        },
      );
    }
    throw error;
  }

  if (!response.ok) {
    const body = await response.text();
    throw new ApiError(
      502,
      "llm_provider_error",
      "LLM provider returned an error",
      body.slice(0, 1000),
    );
  }

  const payload = (await response.json()) as {
    content?: Array<{
      type: string;
      name?: string;
      text?: string;
      input?: unknown;
    }>;
    usage?: { input_tokens?: number; output_tokens?: number };
    stop_reason?: string;
  };
  const toolInput = params.structuredOutput
    ? payload.content?.find((item) =>
      item.type === "tool_use" &&
      item.name === params.structuredOutput?.name
    )?.input
    : null;

  if (
    toolInput &&
    typeof toolInput === "object" &&
    !Array.isArray(toolInput)
  ) {
    return {
      result: toolInput as T,
      inputTokens: payload.usage?.input_tokens ?? 0,
      outputTokens: payload.usage?.output_tokens ?? 0,
    };
  }

  const text = payload?.content?.find((item) => item.type === "text")?.text ??
    null;

  if (!text) {
    throw new ApiError(
      502,
      "llm_empty_output",
      "Anthropic returned an empty output payload",
    );
  }

  const parsed = parseJsonFromText(text);
  if (parsed) {
    return {
      result: parsed as T,
      inputTokens: payload.usage?.input_tokens ?? 0,
      outputTokens: payload.usage?.output_tokens ?? 0,
    };
  }

  const stopReason = typeof payload.stop_reason === "string"
    ? payload.stop_reason
    : "";
  if (stopReason === "max_tokens") {
    throw new ApiError(
      502,
      "llm_json_truncated",
      "Anthropic output was truncated before JSON completed",
      truncateErrorDetailText(text),
    );
  }

  throw new ApiError(
    502,
    "llm_invalid_json",
    "Anthropic output is not valid JSON",
    truncateErrorDetailText(text),
  );
};
