import { ApiError } from "../errors.ts";
import { parseJsonFromText, truncateErrorDetailText } from "../llm-parsers.ts";
import type { JsonValue } from "../types.ts";

type ProviderResult<T> = {
  result: T;
  inputTokens: number;
  outputTokens: number;
};

type GoogleUsageMetadata = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  prompt_token_count?: number;
  candidates_token_count?: number;
};

type GoogleInlineData = {
  data?: string;
  mimeType?: string;
  mime_type?: string;
};

type GoogleResponsePart = {
  text?: string;
  inlineData?: GoogleInlineData;
  inline_data?: GoogleInlineData;
};

type GoogleCandidate = {
  content?: {
    parts?: GoogleResponsePart[];
  };
  finishReason?: string;
  finish_reason?: string;
};

type GoogleGenerateContentPayload = {
  candidates?: GoogleCandidate[];
  usageMetadata?: GoogleUsageMetadata;
  usage_metadata?: GoogleUsageMetadata;
};

const DEFAULT_GOOGLE_GENERATE_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent";

const resolveGoogleEndpoint = (params: {
  model: string;
  endpointOverride?: string;
}): string => {
  const endpoint = params.endpointOverride?.trim().length
    ? params.endpointOverride.trim()
    : DEFAULT_GOOGLE_GENERATE_ENDPOINT;

  if (endpoint.includes("{model}")) {
    return endpoint.replaceAll("{model}", params.model);
  }

  if (params.endpointOverride?.trim().length) {
    return endpoint;
  }

  return endpoint;
};

const toFiniteNumber = (value: unknown): number | null => {
  if (value === null || typeof value === "undefined") {
    return null;
  }
  if (typeof value === "string" && value.trim().length === 0) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const resolveApiKey = (modelConfig: Record<string, JsonValue>): {
  apiKey: string;
  apiKeyEnv: string;
} => {
  const apiKeyEnv = (typeof modelConfig.api_key_env === "string" &&
    modelConfig.api_key_env) || "GEMINI_API_KEY";
  const apiKey = Deno.env.get(apiKeyEnv);

  if (!apiKey) {
    throw new ApiError(
      500,
      "llm_provider_key_missing",
      `Missing provider API key env: ${apiKeyEnv}`,
    );
  }

  return { apiKey, apiKeyEnv };
};

const resolveImageApiKey = (modelConfig: Record<string, JsonValue>): {
  apiKey: string;
  apiKeyEnv: string;
} => {
  const apiKeyEnv = (typeof modelConfig.api_key_env === "string" &&
    modelConfig.api_key_env) || "GEMINI_API_KEY";
  const apiKey = Deno.env.get(apiKeyEnv);

  if (!apiKey) {
    throw new ApiError(
      500,
      "image_provider_key_missing",
      `Missing provider API key env: ${apiKeyEnv}`,
    );
  }

  return { apiKey, apiKeyEnv };
};

const getUsageTokens = (
  payload: GoogleGenerateContentPayload,
): { inputTokens: number; outputTokens: number } => {
  const usage = payload.usageMetadata ?? payload.usage_metadata;
  const input = usage?.promptTokenCount ?? usage?.prompt_token_count ?? 0;
  const output = usage?.candidatesTokenCount ?? usage?.candidates_token_count ??
    0;
  const inputTokens = Number.isFinite(Number(input)) ? Number(input) : 0;
  const outputTokens = Number.isFinite(Number(output)) ? Number(output) : 0;
  return { inputTokens, outputTokens };
};

const extractCandidateText = (payload: GoogleGenerateContentPayload): string | null => {
  for (const candidate of payload.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (typeof part.text === "string" && part.text.trim().length > 0) {
        return part.text;
      }
    }
  }
  return null;
};

const extractFinishReason = (
  payload: GoogleGenerateContentPayload,
): string | null => {
  for (const candidate of payload.candidates ?? []) {
    if (
      typeof candidate.finishReason === "string" &&
      candidate.finishReason.trim().length > 0
    ) {
      return candidate.finishReason;
    }
    if (
      typeof candidate.finish_reason === "string" &&
      candidate.finish_reason.trim().length > 0
    ) {
      return candidate.finish_reason;
    }
  }
  return null;
};

const extractImageData = (
  payload: GoogleGenerateContentPayload,
): { mimeType: string; data: string } | null => {
  for (const candidate of payload.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const inlineData = part.inlineData ?? part.inline_data;
      if (!inlineData) {
        continue;
      }

      const data = typeof inlineData.data === "string"
        ? inlineData.data.trim()
        : "";
      if (!data) {
        continue;
      }

      const mimeTypeCandidate = typeof inlineData.mimeType === "string"
        ? inlineData.mimeType
        : typeof inlineData.mime_type === "string"
        ? inlineData.mime_type
        : "image/png";
      const mimeType = mimeTypeCandidate.startsWith("image/")
        ? mimeTypeCandidate
        : "image/png";

      return { mimeType, data };
    }
  }

  return null;
};

const buildTextGenerationConfig = (
  modelConfig: Record<string, JsonValue>,
): Record<string, JsonValue> => {
  const generationConfig: Record<string, JsonValue> = {
    responseMimeType: "application/json",
  };

  const temperature = toFiniteNumber(modelConfig.temperature);
  const topP = toFiniteNumber(modelConfig.top_p);
  const topK = toFiniteNumber(modelConfig.top_k);
  const maxOutputTokens = toFiniteNumber(modelConfig.max_output_tokens);

  if (temperature !== null) {
    generationConfig.temperature = temperature;
  }
  if (topP !== null) {
    generationConfig.topP = topP;
  }
  if (topK !== null) {
    generationConfig.topK = Math.trunc(topK);
  }
  if (maxOutputTokens !== null && maxOutputTokens > 0) {
    generationConfig.maxOutputTokens = Math.trunc(maxOutputTokens);
  }

  return generationConfig;
};

const buildImageGenerationConfig = (
  modelConfig: Record<string, JsonValue>,
): Record<string, JsonValue> => {
  const generationConfig: Record<string, JsonValue> = {
    responseModalities: ["IMAGE"],
  };

  const temperature = toFiniteNumber(modelConfig.temperature);
  const topP = toFiniteNumber(modelConfig.top_p);
  const topK = toFiniteNumber(modelConfig.top_k);
  const maxOutputTokens = toFiniteNumber(modelConfig.max_output_tokens);

  if (temperature !== null) {
    generationConfig.temperature = temperature;
  }
  if (topP !== null) {
    generationConfig.topP = topP;
  }
  if (topK !== null) {
    generationConfig.topK = Math.trunc(topK);
  }
  if (maxOutputTokens !== null && maxOutputTokens > 0) {
    generationConfig.maxOutputTokens = Math.trunc(maxOutputTokens);
  }

  return generationConfig;
};

export const callGoogleJson = async <T>(params: {
  model: string;
  modelConfig: Record<string, JsonValue>;
  systemPrompt: string;
  userInput: Record<string, JsonValue>;
}): Promise<ProviderResult<T>> => {
  const endpoint = resolveGoogleEndpoint({
    model: params.model,
    endpointOverride: typeof params.modelConfig.endpoint === "string"
      ? params.modelConfig.endpoint
      : undefined,
  });
  const { apiKey } = resolveApiKey(params.modelConfig);

  const timeoutCandidate = Number(params.modelConfig.timeout_ms);
  const timeoutMs = Number.isFinite(timeoutCandidate)
    ? Math.max(5_000, Math.min(120_000, timeoutCandidate))
    : 45_000;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: params.systemPrompt }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: JSON.stringify(params.userInput) }],
          },
        ],
        generationConfig: buildTextGenerationConfig(params.modelConfig),
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

  const payload = (await response.json()) as GoogleGenerateContentPayload;
  const outputText = extractCandidateText(payload);

  if (!outputText) {
    throw new ApiError(
      502,
      "llm_empty_output",
      "LLM provider returned an empty output payload",
    );
  }

  const parsed = parseJsonFromText(outputText);
  if (!parsed) {
    const finishReason = extractFinishReason(payload);
    if (
      typeof finishReason === "string" &&
      finishReason.toUpperCase().includes("MAX_TOKENS")
    ) {
      throw new ApiError(
        502,
        "llm_json_truncated",
        "Gemini output was truncated before JSON completed",
        truncateErrorDetailText(outputText),
      );
    }

    throw new ApiError(
      502,
      "llm_invalid_json",
      "Gemini output is not valid JSON",
      truncateErrorDetailText(outputText),
    );
  }

  const { inputTokens, outputTokens } = getUsageTokens(payload);
  return {
    result: parsed as T,
    inputTokens,
    outputTokens,
  };
};

export const callGoogleImage = async (params: {
  model: string;
  modelConfig: Record<string, JsonValue>;
  prompt: string;
}): Promise<string> => {
  const endpointOverride = typeof params.modelConfig.image_endpoint === "string"
    ? params.modelConfig.image_endpoint
    : typeof params.modelConfig.endpoint === "string"
    ? params.modelConfig.endpoint
    : undefined;
  const endpoint = resolveGoogleEndpoint({
    model: params.model,
    endpointOverride,
  });
  const { apiKey } = resolveImageApiKey(params.modelConfig);

  const timeoutCandidate = Number(params.modelConfig.timeout_ms);
  const timeoutMs = Number.isFinite(timeoutCandidate)
    ? Math.max(5_000, Math.min(180_000, timeoutCandidate))
    : 40_000;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: params.prompt }],
          },
        ],
        generationConfig: buildImageGenerationConfig(params.modelConfig),
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

  const payload = (await response.json()) as GoogleGenerateContentPayload;
  const imageData = extractImageData(payload);

  if (!imageData) {
    throw new ApiError(
      502,
      "image_empty_output",
      "Image provider returned no image output",
    );
  }

  return `data:${imageData.mimeType};base64,${imageData.data}`;
};
