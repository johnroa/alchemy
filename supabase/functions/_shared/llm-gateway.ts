import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "./errors.ts";
import type { GatewayConfig, GatewayScope, JsonValue, RecipePayload } from "./types.ts";

type GatewayInput = {
  userPrompt: string;
  context: Record<string, JsonValue>;
};

type ClassificationResult = {
  label: string;
  reason?: string;
  isAllowed?: boolean;
};

type CategoryInference = {
  category: string;
  confidence: number;
};

const getActiveConfig = async (client: SupabaseClient, scope: GatewayScope): Promise<GatewayConfig> => {
  const [{ data: prompt, error: promptError }, { data: rule, error: ruleError }, { data: route, error: routeError }] =
    await Promise.all([
      client
        .from("llm_prompts")
        .select("template")
        .eq("scope", scope)
        .eq("is_active", true)
        .maybeSingle(),
      client
        .from("llm_rules")
        .select("rule")
        .eq("scope", scope)
        .eq("is_active", true)
        .maybeSingle(),
      client
        .from("llm_model_routes")
        .select("provider,model,config")
        .eq("scope", scope)
        .eq("is_active", true)
        .maybeSingle()
    ]);

  if (promptError || !prompt?.template) {
    throw new ApiError(500, "gateway_prompt_missing", `No active prompt configured for scope: ${scope}`);
  }

  if (ruleError || !rule?.rule) {
    throw new ApiError(500, "gateway_rule_missing", `No active rule configured for scope: ${scope}`);
  }

  if (routeError || !route) {
    throw new ApiError(500, "gateway_route_missing", `No active model route configured for scope: ${scope}`);
  }

  if (!route.provider || !route.model) {
    throw new ApiError(500, "gateway_route_invalid", `Active model route for ${scope} does not contain a model`);
  }

  return {
    promptTemplate: prompt.template,
    rule: rule.rule as Record<string, JsonValue>,
    provider: route.provider,
    model: route.model,
    modelConfig: (route.config as Record<string, JsonValue>) ?? {}
  };
};

const callProvider = async <T>(params: {
  provider: string;
  model: string;
  modelConfig: Record<string, JsonValue>;
  systemPrompt: string;
  userInput: Record<string, JsonValue>;
}): Promise<T> => {
  if (params.provider !== "openai") {
    throw new ApiError(500, "llm_provider_not_supported", `Provider adapter not configured: ${params.provider}`);
  }

  const endpoint =
    (typeof params.modelConfig.endpoint === "string" && params.modelConfig.endpoint) ||
    Deno.env.get("OPENAI_RESPONSES_ENDPOINT") ||
    "https://api.openai.com/v1/responses";
  const apiKeyEnv =
    (typeof params.modelConfig.api_key_env === "string" && params.modelConfig.api_key_env) || "OPENAI_API_KEY";
  const apiKey = Deno.env.get(apiKeyEnv);

  if (!apiKey) {
    throw new ApiError(500, "llm_provider_key_missing", `Missing provider API key env: ${apiKeyEnv}`);
  }

  const requestConfig: Record<string, JsonValue> = { ...params.modelConfig };
  delete requestConfig.endpoint;
  delete requestConfig.api_key_env;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: params.model,
      ...requestConfig,
      input: [
        { role: "system", content: [{ type: "input_text", text: params.systemPrompt }] },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify(params.userInput)
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_object"
        }
      }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new ApiError(502, "llm_provider_error", "LLM provider returned an error", body.slice(0, 1000));
  }

  const payload = (await response.json()) as {
    output_text?: string;
  };

  if (!payload.output_text) {
    throw new ApiError(502, "llm_empty_output", "LLM provider returned an empty output payload");
  }

  try {
    return JSON.parse(payload.output_text) as T;
  } catch {
    throw new ApiError(502, "llm_invalid_json", "LLM output is not valid JSON");
  }
};

const callImageProvider = async (params: {
  provider: string;
  model: string;
  modelConfig: Record<string, JsonValue>;
  prompt: string;
}): Promise<string> => {
  if (params.provider !== "openai") {
    throw new ApiError(500, "image_provider_not_supported", `Image provider adapter not configured: ${params.provider}`);
  }

  const endpoint =
    (typeof params.modelConfig.image_endpoint === "string" && params.modelConfig.image_endpoint) ||
    Deno.env.get("OPENAI_IMAGES_ENDPOINT") ||
    "https://api.openai.com/v1/images/generations";
  const apiKeyEnv =
    (typeof params.modelConfig.api_key_env === "string" && params.modelConfig.api_key_env) || "OPENAI_API_KEY";
  const apiKey = Deno.env.get(apiKeyEnv);

  if (!apiKey) {
    throw new ApiError(500, "image_provider_key_missing", `Missing provider API key env: ${apiKeyEnv}`);
  }

  const size = typeof params.modelConfig.size === "string" ? params.modelConfig.size : "1536x1024";
  const quality = typeof params.modelConfig.quality === "string" ? params.modelConfig.quality : "high";

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: params.model,
      prompt: params.prompt,
      size,
      quality,
      response_format: "url"
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new ApiError(502, "image_provider_error", "Image provider returned an error", body.slice(0, 1000));
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

  throw new ApiError(502, "image_empty_output", "Image provider returned no image output");
};

const classifyScope = async (
  client: SupabaseClient,
  input: GatewayInput
): Promise<ClassificationResult> => {
  const config = await getActiveConfig(client, "classify");
  const result = await callProvider<ClassificationResult>({
    provider: config.provider,
    model: config.model,
    modelConfig: config.modelConfig,
    systemPrompt: config.promptTemplate,
    userInput: {
      rule: config.rule,
      user_prompt: input.userPrompt,
      context: input.context
    }
  });

  if (!result.label) {
    throw new ApiError(422, "classification_failed", "Classification returned no label");
  }

  const acceptLabelsValue = config.rule.accept_labels;
  if (!Array.isArray(acceptLabelsValue)) {
    throw new ApiError(500, "classification_rule_invalid", "classify rule must define accept_labels[]");
  }

  const acceptLabels = acceptLabelsValue.filter((value): value is string => typeof value === "string");
  if (acceptLabels.length === 0) {
    throw new ApiError(500, "classification_rule_invalid", "classify accept_labels[] cannot be empty");
  }

  return {
    ...result,
    isAllowed: acceptLabels.includes(result.label)
  };
};

const generateRecipePayload = async (
  client: SupabaseClient,
  scope: Extract<GatewayScope, "generate" | "tweak">,
  input: GatewayInput
): Promise<RecipePayload> => {
  const config = await getActiveConfig(client, scope);

  const result = await callProvider<RecipePayload>({
    provider: config.provider,
    model: config.model,
    modelConfig: config.modelConfig,
    systemPrompt: config.promptTemplate,
    userInput: {
      rule: config.rule,
      prompt: input.userPrompt,
      context: input.context
    }
  });

  if (!result.title || !Array.isArray(result.ingredients) || !Array.isArray(result.steps)) {
    throw new ApiError(422, "recipe_schema_invalid", "Generated recipe did not match required schema");
  }

  return result;
};

const logLlmEvent = async (
  client: SupabaseClient,
  userId: string,
  requestId: string,
  scope: GatewayScope,
  latencyMs: number,
  safetyState: string
): Promise<void> => {
  const { error } = await client.from("events").insert({
    user_id: userId,
    event_type: "llm_call",
    request_id: requestId,
    latency_ms: latencyMs,
    safety_state: safetyState,
    event_payload: { scope }
  });

  if (error) {
    console.error("event_log_failed", error);
  }
};

export const llmGateway = {
  async generateRecipe(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    prompt: string;
    context: Record<string, JsonValue>;
  }): Promise<RecipePayload> {
    const startedAt = Date.now();

    const classification = await classifyScope(params.client, {
      userPrompt: params.prompt,
      context: params.context
    });

    if (!classification.isAllowed) {
      await logLlmEvent(params.client, params.userId, params.requestId, "generate", Date.now() - startedAt, "out_of_scope");
      throw new ApiError(422, "request_out_of_scope", classification.reason ?? "Request is outside active cooking scope");
    }

    const recipe = await generateRecipePayload(params.client, "generate", {
      userPrompt: params.prompt,
      context: params.context
    });

    await logLlmEvent(params.client, params.userId, params.requestId, "generate", Date.now() - startedAt, "ok");
    return recipe;
  },

  async tweakRecipe(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    prompt: string;
    context: Record<string, JsonValue>;
  }): Promise<RecipePayload> {
    const startedAt = Date.now();

    const classification = await classifyScope(params.client, {
      userPrompt: params.prompt,
      context: params.context
    });

    if (!classification.isAllowed) {
      await logLlmEvent(params.client, params.userId, params.requestId, "tweak", Date.now() - startedAt, "out_of_scope");
      throw new ApiError(422, "request_out_of_scope", classification.reason ?? "Request is outside active cooking scope");
    }

    const recipe = await generateRecipePayload(params.client, "tweak", {
      userPrompt: params.prompt,
      context: params.context
    });

    await logLlmEvent(params.client, params.userId, params.requestId, "tweak", Date.now() - startedAt, "ok");
    return recipe;
  },

  async inferCategories(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    recipe: RecipePayload;
    context: Record<string, JsonValue>;
  }): Promise<CategoryInference[]> {
    const startedAt = Date.now();
    const config = await getActiveConfig(params.client, "classify");

    const output = await callProvider<{ categories: CategoryInference[] }>({
      provider: config.provider,
      model: config.model,
      modelConfig: config.modelConfig,
      systemPrompt: config.promptTemplate,
      userInput: {
        rule: config.rule,
        recipe: params.recipe,
        context: params.context
      }
    });

    const categories = (output.categories ?? [])
      .filter((entry) => typeof entry.category === "string" && entry.category.trim().length > 0)
      .map((entry) => {
        const numeric = Number(entry.confidence);
        return {
          category: entry.category.trim(),
          confidence: Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0.5
        };
      });

    await logLlmEvent(params.client, params.userId, params.requestId, "classify", Date.now() - startedAt, "ok");
    return categories;
  },

  async generateRecipeImage(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    recipe: RecipePayload;
    context: Record<string, JsonValue>;
  }): Promise<string> {
    const startedAt = Date.now();
    const config = await getActiveConfig(params.client, "image");

    const imagePrompt = `${config.promptTemplate}\n\n${JSON.stringify({
      rule: config.rule,
      recipe: params.recipe,
      context: params.context
    })}`;

    const imageUrl = await callImageProvider({
      provider: config.provider,
      model: config.model,
      modelConfig: config.modelConfig,
      prompt: imagePrompt
    });

    await logLlmEvent(params.client, params.userId, params.requestId, "image", Date.now() - startedAt, "ok");
    return imageUrl;
  }
};
