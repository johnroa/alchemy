import { ApiError } from "../errors.ts";
import {
  parseJsonFromText,
  parseResponseOutputJson,
  parseResponseOutputText,
  normalizeTextValue,
  truncateErrorDetailText,
} from "../llm-parsers.ts";
import type { JsonValue } from "../types.ts";

type ProviderResult<T> = {
  result: T;
  inputTokens: number;
  outputTokens: number;
};

export const normalizeOpenAiModelConfig = (params: {
  model: string;
  modelConfig: Record<string, JsonValue>;
}): Record<string, JsonValue> => {
  const normalized = { ...params.modelConfig };
  const model = params.model.toLowerCase();

  if (
    model.startsWith("gpt-5") || model.startsWith("o1") ||
    model.startsWith("o3") || model.startsWith("o4")
  ) {
    delete normalized.temperature;
    delete normalized.top_p;
    delete normalized.frequency_penalty;
    delete normalized.presence_penalty;
  }

  return normalized;
};

const buildOpenAiRequestBody = (params: {
  apiMode: "responses" | "chat_completions";
  model: string;
  systemPrompt: string;
  userInput: Record<string, JsonValue>;
  config: Record<string, JsonValue>;
}): Record<string, JsonValue> => {
  if (params.apiMode === "chat_completions") {
    return {
      model: params.model,
      ...params.config,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: params.systemPrompt,
        },
        {
          role: "user",
          content: JSON.stringify(params.userInput),
        },
      ],
    };
  }

  return {
    model: params.model,
    ...params.config,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: params.systemPrompt }],
      },
      {
        role: "user",
        content: [{
          type: "input_text",
          text: JSON.stringify(params.userInput),
        }],
      },
    ],
    text: { format: { type: "json_object" } },
  };
};

export const callOpenAiJson = async <T>(params: {
  model: string;
  modelConfig: Record<string, JsonValue>;
  systemPrompt: string;
  userInput: Record<string, JsonValue>;
}): Promise<ProviderResult<T>> => {
  const modelConfig = normalizeOpenAiModelConfig({
    model: params.model,
    modelConfig: params.modelConfig,
  });

  const apiMode = typeof modelConfig.api_mode === "string" &&
      modelConfig.api_mode.trim() === "chat_completions"
    ? "chat_completions"
    : "responses";
  const endpoint = apiMode === "chat_completions"
    ? ((typeof modelConfig.chat_completions_endpoint === "string" &&
      modelConfig.chat_completions_endpoint) ||
      Deno.env.get("OPENAI_CHAT_COMPLETIONS_ENDPOINT") ||
      "https://api.openai.com/v1/chat/completions")
    : ((typeof modelConfig.endpoint === "string" &&
      modelConfig.endpoint) ||
      Deno.env.get("OPENAI_RESPONSES_ENDPOINT") ||
      "https://api.openai.com/v1/responses");
  const apiKeyEnv = (typeof modelConfig.api_key_env === "string" &&
    modelConfig.api_key_env) || "OPENAI_API_KEY";
  const apiKey = Deno.env.get(apiKeyEnv);

  if (!apiKey) {
    throw new ApiError(
      500,
      "llm_provider_key_missing",
      `Missing provider API key env: ${apiKeyEnv}`,
    );
  }

  const timeoutCandidate = Number(modelConfig.timeout_ms);
  const timeoutMs = Number.isFinite(timeoutCandidate)
    ? Math.max(5_000, Math.min(120_000, timeoutCandidate))
    : 45_000;

  const requestConfig: Record<string, JsonValue> = {};
  const maxOutputTokens = Number(
    modelConfig.max_output_tokens ?? modelConfig.max_tokens,
  );
  const temperature = Number(modelConfig.temperature);
  const topP = Number(modelConfig.top_p);
  const frequencyPenalty = Number(modelConfig.frequency_penalty);
  const presencePenalty = Number(modelConfig.presence_penalty);
  const reasoning = modelConfig.reasoning;

  if (Number.isFinite(maxOutputTokens) && maxOutputTokens > 0) {
    if (apiMode === "chat_completions") {
      requestConfig.max_tokens = Math.trunc(maxOutputTokens);
    } else {
      requestConfig.max_output_tokens = Math.trunc(maxOutputTokens);
    }
  }
  if (Number.isFinite(temperature)) {
    requestConfig.temperature = temperature;
  }
  if (Number.isFinite(topP)) {
    requestConfig.top_p = topP;
  }
  if (Number.isFinite(frequencyPenalty)) {
    requestConfig.frequency_penalty = frequencyPenalty;
  }
  if (Number.isFinite(presencePenalty)) {
    requestConfig.presence_penalty = presencePenalty;
  }
  if (
    reasoning && typeof reasoning === "object" && !Array.isArray(reasoning) &&
    apiMode === "responses"
  ) {
    requestConfig.reasoning = reasoning;
  }

  let payload: unknown = null;
  let lastErrorBody = "";
  const adaptiveConfig: Record<string, JsonValue> = { ...requestConfig };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify(buildOpenAiRequestBody({
          apiMode,
          model: params.model,
          systemPrompt: params.systemPrompt,
          userInput: params.userInput,
          config: adaptiveConfig,
        })),
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

    if (response.ok) {
      payload = (await response.json()) as unknown;
      break;
    }

    const body = await response.text();
    lastErrorBody = body;
    const unsupportedMatch = body.match(
      /(?:Unsupported|Unknown)\s+parameter:\s*['"]([^'"]+)['"]/i,
    );
    if (!unsupportedMatch) {
      throw new ApiError(
        502,
        "llm_provider_error",
        "LLM provider returned an error",
        body.slice(0, 1000),
      );
    }

    const unsupportedParam = unsupportedMatch[1];
    const removableKeys = new Set<string>([unsupportedParam]);
    if (unsupportedParam === "max_tokens") {
      removableKeys.add("max_output_tokens");
    }
    if (unsupportedParam === "max_output_tokens") {
      removableKeys.add("max_tokens");
    }
    if (unsupportedParam === "response_format" || unsupportedParam === "text") {
      break;
    }

    let removed = false;
    for (const key of removableKeys) {
      if (Object.prototype.hasOwnProperty.call(adaptiveConfig, key)) {
        delete adaptiveConfig[key];
        removed = true;
      }
    }
    if (!removed) {
      throw new ApiError(
        502,
        "llm_provider_error",
        "LLM provider returned an error",
        body.slice(0, 1000),
      );
    }
  }

  if (!payload) {
    throw new ApiError(
      502,
      "llm_provider_error",
      "LLM provider returned an error",
      lastErrorBody.slice(0, 1000),
    );
  }

  if (apiMode === "chat_completions") {
    const completionPayload = payload as {
      choices?: Array<{ message?: { content?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const outputText = completionPayload.choices?.[0]?.message?.content ?? "";
    if (!outputText) {
      throw new ApiError(
        502,
        "llm_empty_output",
        "LLM provider returned an empty output payload",
      );
    }
    const parsed = parseJsonFromText(outputText);
    if (!parsed) {
      throw new ApiError(
        502,
        "llm_invalid_json",
        "LLM output is not valid JSON",
        truncateErrorDetailText(outputText),
      );
    }
    return {
      result: parsed as T,
      inputTokens: completionPayload.usage?.prompt_tokens ?? 0,
      outputTokens: completionPayload.usage?.completion_tokens ?? 0,
    };
  }

  const usageRaw = (payload as Record<string, unknown> | null)?.usage as
    | { input_tokens?: number; output_tokens?: number }
    | undefined;
  const inputTokens = usageRaw?.input_tokens ?? 0;
  const outputTokens = usageRaw?.output_tokens ?? 0;

  const outputJson = parseResponseOutputJson(payload);
  if (outputJson) {
    return { result: outputJson as T, inputTokens, outputTokens };
  }

  const outputText = parseResponseOutputText(payload);

  if (!outputText) {
    const payloadRecord = payload && typeof payload === "object" &&
        !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
    const status = payloadRecord
      ? normalizeTextValue(payloadRecord.status)
      : null;
    const incompleteRaw = payloadRecord?.incomplete_details ??
      payloadRecord?.error ??
      null;
    const incompleteDetails = normalizeTextValue(incompleteRaw) ??
      (incompleteRaw ? JSON.stringify(incompleteRaw).slice(0, 1000) : null);

    throw new ApiError(
      502,
      "llm_empty_output",
      "LLM provider returned an empty output payload",
      {
        status: status ?? null,
        incomplete_details: incompleteDetails,
        payload_shape: payload && typeof payload === "object"
          ? Object.keys(payload as Record<string, unknown>)
          : "unknown",
      },
    );
  }

  const parsed = parseJsonFromText(outputText);
  if (parsed) {
    return { result: parsed as T, inputTokens, outputTokens };
  }

  throw new ApiError(
    502,
    "llm_invalid_json",
    "LLM output is not valid JSON",
    truncateErrorDetailText(outputText),
  );
};

export const callOpenAiImage = async (params: {
  model: string;
  modelConfig: Record<string, JsonValue>;
  prompt: string;
}): Promise<string> => {
  const endpoint = (typeof params.modelConfig.image_endpoint === "string" &&
    params.modelConfig.image_endpoint) ||
    Deno.env.get("OPENAI_IMAGES_ENDPOINT") ||
    "https://api.openai.com/v1/images/generations";
  const apiKeyEnv = (typeof params.modelConfig.api_key_env === "string" &&
    params.modelConfig.api_key_env) || "OPENAI_API_KEY";
  const apiKey = Deno.env.get(apiKeyEnv);

  if (!apiKey) {
    throw new ApiError(
      500,
      "image_provider_key_missing",
      `Missing provider API key env: ${apiKeyEnv}`,
    );
  }

  const size = typeof params.modelConfig.size === "string"
    ? params.modelConfig.size
    : "1536x1024";
  const quality = typeof params.modelConfig.quality === "string"
    ? params.modelConfig.quality
    : "high";
  const timeoutCandidate = Number(params.modelConfig.timeout_ms);
  const timeoutMs = Number.isFinite(timeoutCandidate)
    ? Math.max(5_000, Math.min(180_000, timeoutCandidate))
    : 40_000;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: params.model,
        prompt: params.prompt,
        size,
        quality,
        response_format: "url",
      }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new ApiError(
        504,
        "image_provider_timeout",
        "Image provider timed out",
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
      "image_provider_error",
      "Image provider returned an error",
      body.slice(0, 1000),
    );
  }

  const payload = (await response.json()) as {
    data?: Array<{ url?: string; b64_json?: string }>;
  };

  const image = payload.data?.[0];
  if (image?.url) {
    return image.url;
  }

  if (image?.b64_json) {
    return `data:image/png;base64,${image.b64_json}`;
  }

  throw new ApiError(
    502,
    "image_empty_output",
    "Image provider returned no image output",
  );
};
