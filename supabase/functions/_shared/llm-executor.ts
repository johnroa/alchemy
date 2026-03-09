import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "./errors.ts";
import {
  type GatewayScope,
  getLlmScopeDefinition,
  type LlmRetryPolicy,
} from "./llm-scope-registry.ts";
import { callAnthropicJson } from "./llm-adapters/anthropic.ts";
import {
  callGoogleImage,
  callGoogleJson,
  callGoogleVisionJson,
} from "./llm-adapters/google.ts";
import {
  callOpenAiEmbedding,
  callOpenAiImage,
  callOpenAiJson,
  callOpenAiVisionJson,
  type EmbeddingProviderResult,
} from "./llm-adapters/openai.ts";
import type { GatewayConfig, JsonValue } from "./types.ts";

export type ModelOverrideMap = Record<
  string,
  { provider: string; model: string }
>;

export type ProviderResult<T> = {
  result: T;
  inputTokens: number;
  outputTokens: number;
};

export type EmbeddingResult = {
  vector: number[];
  dimensions: number;
  inputTokens: number;
};

export type VisionInputImage = {
  label: string;
  imageUrl: string;
};

export type StructuredOutputDefinition = {
  name: string;
  description?: string;
  schema: Record<string, JsonValue>;
  strict?: boolean;
};

const toRecord = (value: unknown): Record<string, JsonValue> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, JsonValue>;
};

const isRetryableErrorCode = (
  error: unknown,
  retryPolicy: LlmRetryPolicy,
): boolean => {
  const code = error instanceof ApiError ? error.code : null;
  if (!code) {
    return false;
  }
  return retryPolicy.retryable_codes.includes(code);
};

export const getActiveConfig = async (
  client: SupabaseClient,
  scope: GatewayScope,
  modelOverride?: { provider: string; model: string },
): Promise<GatewayConfig> => {
  const scopeDefinition = getLlmScopeDefinition(scope);
  const [
    { data: prompt, error: promptError },
    { data: rule, error: ruleError },
  ] = await Promise.all([
    client.from("llm_prompts").select("template").eq("scope", scope).eq(
      "is_active",
      true,
    ).maybeSingle(),
    client.from("llm_rules").select("rule").eq("scope", scope).eq(
      "is_active",
      true,
    ).maybeSingle(),
  ]);

  const promptTemplate = typeof prompt?.template === "string"
    ? prompt.template
    : null;
  const promptRequired = scopeDefinition.mode !== "embedding";

  if (
    promptError || !prompt ||
    (promptRequired && (!promptTemplate || promptTemplate.length === 0)) ||
    (!promptRequired && promptTemplate === null)
  ) {
    throw new ApiError(
      500,
      "gateway_prompt_missing",
      `No active prompt configured for scope: ${scope}`,
    );
  }

  if (ruleError || !rule?.rule) {
    throw new ApiError(
      500,
      "gateway_rule_missing",
      `No active rule configured for scope: ${scope}`,
    );
  }

  let provider: string;
  let model: string;
  let modelConfig: Record<string, JsonValue>;
  const { data: route, error: routeError } = await client
    .from("llm_model_routes")
    .select("provider,model,config")
    .eq("scope", scope)
    .eq("is_active", true)
    .maybeSingle();

  if (routeError || !route) {
    throw new ApiError(
      500,
      "gateway_route_missing",
      `No active model route configured for scope: ${scope}`,
    );
  }

  provider = modelOverride?.provider ?? route.provider;
  model = modelOverride?.model ?? route.model;
  modelConfig = (route.config as Record<string, JsonValue>) ?? {};

  if (!provider || !model) {
    throw new ApiError(
      500,
      "gateway_route_invalid",
      `Active model route for ${scope} does not contain a model`,
    );
  }

  const { data: reg } = await client
    .from("llm_model_registry")
    .select(
      "input_cost_per_1m_tokens,output_cost_per_1m_tokens,billing_mode,billing_metadata",
    )
    .eq("provider", provider)
    .eq("model", model)
    .maybeSingle();

  return {
    promptTemplate: promptTemplate ?? "",
    rule: rule.rule as Record<string, JsonValue>,
    provider,
    model,
    modelConfig,
    inputCostPer1m: Number(reg?.input_cost_per_1m_tokens ?? 0),
    outputCostPer1m: Number(reg?.output_cost_per_1m_tokens ?? 0),
    billingMode: reg?.billing_mode === "image" ? "image" : "token",
    billingMetadata: toRecord(reg?.billing_metadata),
  };
};

export const executeWithConfig = async <T>(params: {
  provider: string;
  model: string;
  modelConfig: Record<string, JsonValue>;
  systemPrompt: string;
  userInput: Record<string, JsonValue>;
  structuredOutput?: StructuredOutputDefinition;
}): Promise<ProviderResult<T>> => {
  if (params.provider === "anthropic") {
    return await callAnthropicJson<T>({
      model: params.model,
      modelConfig: params.modelConfig,
      systemPrompt: params.systemPrompt,
      userInput: params.userInput,
      structuredOutput: params.structuredOutput,
    });
  }

  if (params.provider === "openai") {
    return await callOpenAiJson<T>({
      model: params.model,
      modelConfig: params.modelConfig,
      systemPrompt: params.systemPrompt,
      userInput: params.userInput,
      structuredOutput: params.structuredOutput,
    });
  }

  if (params.provider === "google") {
    return await callGoogleJson<T>({
      model: params.model,
      modelConfig: params.modelConfig,
      systemPrompt: params.systemPrompt,
      userInput: params.userInput,
    });
  }

  throw new ApiError(
    500,
    "llm_provider_not_supported",
    `Provider adapter not configured: ${params.provider}`,
  );
};

export const executeScope = async <T>(params: {
  client: SupabaseClient;
  scope: GatewayScope;
  userInput: Record<string, JsonValue>;
  modelOverride?: { provider: string; model: string };
  systemPromptOverride?: string;
  modelConfigOverride?: Record<string, JsonValue>;
  retryPolicyOverride?: LlmRetryPolicy;
}): Promise<
  ProviderResult<T> & { config: GatewayConfig; attempts: number }
> => {
  const config = await getActiveConfig(
    params.client,
    params.scope,
    params.modelOverride,
  );
  const definition = getLlmScopeDefinition(params.scope);
  const retryPolicy = params.retryPolicyOverride ?? definition.retry_policy;

  let attempts = 0;
  let lastError: unknown = null;

  while (attempts < retryPolicy.max_attempts) {
    attempts += 1;
    try {
      const payload: Record<string, JsonValue> = Object.prototype.hasOwnProperty
          .call(params.userInput, "rule")
        ? params.userInput
        : { rule: config.rule, ...params.userInput };
      const result = await executeWithConfig<T>({
        provider: config.provider,
        model: config.model,
        modelConfig: {
          ...config.modelConfig,
          ...(params.modelConfigOverride ?? {}),
        },
        systemPrompt: params.systemPromptOverride ?? config.promptTemplate,
        userInput: payload,
      });

      return {
        ...result,
        config,
        attempts,
      };
    } catch (error) {
      lastError = error;
      if (!isRetryableErrorCode(error, retryPolicy)) {
        throw error;
      }
      if (attempts >= retryPolicy.max_attempts) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new ApiError(502, "llm_execution_failed", "LLM scope execution failed");
};

export const executeVisionWithConfig = async <T>(params: {
  provider: string;
  model: string;
  modelConfig: Record<string, JsonValue>;
  systemPrompt: string;
  userInput: Record<string, JsonValue>;
  images: VisionInputImage[];
}): Promise<ProviderResult<T>> => {
  if (params.provider === "openai") {
    return await callOpenAiVisionJson<T>({
      model: params.model,
      modelConfig: params.modelConfig,
      systemPrompt: params.systemPrompt,
      userInput: params.userInput,
      images: params.images,
    });
  }

  if (params.provider === "google") {
    return await callGoogleVisionJson<T>({
      model: params.model,
      modelConfig: params.modelConfig,
      systemPrompt: params.systemPrompt,
      userInput: params.userInput,
      images: params.images,
    });
  }

  throw new ApiError(
    500,
    "llm_provider_not_supported",
    `Provider adapter not configured for multimodal JSON: ${params.provider}`,
  );
};

export const executeEmbeddingWithConfig = async (params: {
  provider: string;
  model: string;
  modelConfig: Record<string, JsonValue>;
  inputText: string;
}): Promise<EmbeddingResult> => {
  let result: EmbeddingProviderResult;

  if (params.provider === "openai") {
    result = await callOpenAiEmbedding({
      model: params.model,
      modelConfig: params.modelConfig,
      inputText: params.inputText,
    });
  } else {
    throw new ApiError(
      500,
      "llm_provider_not_supported",
      `Provider adapter not configured for embeddings: ${params.provider}`,
    );
  }

  const expectedDimensions = Number(params.modelConfig.dimensions);
  if (
    Number.isInteger(expectedDimensions) && expectedDimensions > 0 &&
    result.dimensions !== expectedDimensions
  ) {
    throw new ApiError(
      502,
      "embedding_dimension_mismatch",
      "Embedding provider returned an unexpected vector size",
      {
        expected_dimensions: expectedDimensions,
        actual_dimensions: result.dimensions,
        model: params.model,
      },
    );
  }

  const shouldNormalize = params.modelConfig.normalize === "unit";
  if (!shouldNormalize) {
    return result;
  }

  const magnitude = Math.sqrt(
    result.vector.reduce((sum, value) => sum + (value * value), 0),
  );
  if (!Number.isFinite(magnitude) || magnitude <= 0) {
    throw new ApiError(
      502,
      "embedding_vector_invalid",
      "Embedding vector magnitude is invalid",
    );
  }

  return {
    ...result,
    vector: result.vector.map((value) => value / magnitude),
  };
};

export const executeVisionScope = async <T>(params: {
  client: SupabaseClient;
  scope: GatewayScope;
  userInput: Record<string, JsonValue>;
  images: VisionInputImage[];
  modelOverride?: { provider: string; model: string };
  systemPromptOverride?: string;
  modelConfigOverride?: Record<string, JsonValue>;
  retryPolicyOverride?: LlmRetryPolicy;
}): Promise<
  ProviderResult<T> & { config: GatewayConfig; attempts: number }
> => {
  const config = await getActiveConfig(
    params.client,
    params.scope,
    params.modelOverride,
  );
  const definition = getLlmScopeDefinition(params.scope);
  const retryPolicy = params.retryPolicyOverride ?? definition.retry_policy;

  let attempts = 0;
  let lastError: unknown = null;

  while (attempts < retryPolicy.max_attempts) {
    attempts += 1;
    try {
      const payload: Record<string, JsonValue> = Object.prototype.hasOwnProperty
          .call(params.userInput, "rule")
        ? params.userInput
        : { rule: config.rule, ...params.userInput };
      const result = await executeVisionWithConfig<T>({
        provider: config.provider,
        model: config.model,
        modelConfig: {
          ...config.modelConfig,
          ...(params.modelConfigOverride ?? {}),
        },
        systemPrompt: params.systemPromptOverride ?? config.promptTemplate,
        userInput: payload,
        images: params.images,
      });

      return {
        ...result,
        config,
        attempts,
      };
    } catch (error) {
      lastError = error;
      if (!isRetryableErrorCode(error, retryPolicy)) {
        throw error;
      }
      if (attempts >= retryPolicy.max_attempts) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new ApiError(
    502,
    "llm_execution_failed",
    "LLM multimodal scope execution failed",
  );
};

export const executeEmbeddingScope = async (params: {
  client: SupabaseClient;
  scope: GatewayScope;
  inputText: string;
  modelOverride?: { provider: string; model: string };
  modelConfigOverride?: Record<string, JsonValue>;
  retryPolicyOverride?: LlmRetryPolicy;
}): Promise<EmbeddingResult & { config: GatewayConfig; attempts: number }> => {
  const config = await getActiveConfig(
    params.client,
    params.scope,
    params.modelOverride,
  );
  const definition = getLlmScopeDefinition(params.scope);
  const retryPolicy = params.retryPolicyOverride ?? definition.retry_policy;

  let attempts = 0;
  let lastError: unknown = null;

  while (attempts < retryPolicy.max_attempts) {
    attempts += 1;
    try {
      const result = await executeEmbeddingWithConfig({
        provider: config.provider,
        model: config.model,
        modelConfig: {
          ...config.modelConfig,
          ...(config.rule ?? {}),
          ...(params.modelConfigOverride ?? {}),
        },
        inputText: params.inputText,
      });

      return {
        ...result,
        config,
        attempts,
      };
    } catch (error) {
      lastError = error;
      if (!isRetryableErrorCode(error, retryPolicy)) {
        throw error;
      }
      if (attempts >= retryPolicy.max_attempts) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new ApiError(
    502,
    "llm_execution_failed",
    "LLM embedding scope execution failed",
  );
};

export const executeImageScope = async (params: {
  client: SupabaseClient;
  prompt: string;
  modelOverride?: { provider: string; model: string };
}): Promise<{ imageUrl: string; config: GatewayConfig }> => {
  const config = await getActiveConfig(
    params.client,
    "image",
    params.modelOverride,
  );
  let imageUrl: string;
  if (config.provider === "openai") {
    imageUrl = await callOpenAiImage({
      model: config.model,
      modelConfig: config.modelConfig,
      prompt: params.prompt,
    });
  } else if (config.provider === "google") {
    imageUrl = await callGoogleImage({
      model: config.model,
      modelConfig: config.modelConfig,
      prompt: params.prompt,
    });
  } else {
    throw new ApiError(
      500,
      "image_provider_not_supported",
      `Image provider adapter not configured: ${config.provider}`,
    );
  }

  return { imageUrl, config };
};

export const executeImageWithConfig = async (params: {
  provider: string;
  model: string;
  modelConfig: Record<string, JsonValue>;
  prompt: string;
}): Promise<string> => {
  if (params.provider === "openai") {
    return await callOpenAiImage({
      model: params.model,
      modelConfig: params.modelConfig,
      prompt: params.prompt,
    });
  }

  if (params.provider === "google") {
    return await callGoogleImage({
      model: params.model,
      modelConfig: params.modelConfig,
      prompt: params.prompt,
    });
  }

  throw new ApiError(
    500,
    "image_provider_not_supported",
    `Image provider adapter not configured: ${params.provider}`,
  );
};
