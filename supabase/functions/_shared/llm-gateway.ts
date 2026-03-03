import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "./errors.ts";
import type {
  AssistantReply,
  DraftAssistantEnvelope,
  GatewayConfig,
  GatewayScope,
  JsonValue,
  MemoryRecord,
  OnboardingAssistantEnvelope,
  OnboardingState,
  RecipeAssistantEnvelope,
  RecipePayload
} from "./types.ts";

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

type MemoryCandidate = {
  memory_type: string;
  memory_kind?: string;
  memory_content: JsonValue;
  confidence?: number;
  salience?: number;
  source?: string;
};

type MemorySelection = {
  selected_memory_ids: string[];
  rationale?: string;
};

type MemorySummary = {
  summary: Record<string, JsonValue>;
  token_estimate?: number;
};

type ConflictResolution = {
  actions: Array<{
    action: "keep" | "supersede" | "delete" | "merge";
    memory_id?: string;
    supersedes_memory_id?: string;
    merged_content?: JsonValue;
    reason?: string;
  }>;
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

const normalizeTextValue = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const withValue = value as { value?: unknown };
    if (typeof withValue.value === "string" && withValue.value.trim().length > 0) {
      return withValue.value;
    }
  }

  return null;
};

const extractFirstJsonValue = (text: string): string | null => {
  let inString = false;
  let escaped = false;
  let depth = 0;
  let start = -1;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{" || char === "[") {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
      continue;
    }

    if (char === "}" || char === "]") {
      if (depth > 0) {
        depth -= 1;
      }

      if (depth === 0 && start >= 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
};

const parseJsonFromText = (raw: string): Record<string, JsonValue> | null => {
  const directAttempt = raw.trim();
  if (directAttempt.length === 0) {
    return null;
  }

  const attempts: string[] = [directAttempt];

  const fenced = directAttempt
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  if (fenced.length > 0 && fenced !== directAttempt) {
    attempts.push(fenced);
  }

  const extracted = extractFirstJsonValue(directAttempt);
  if (extracted && extracted !== directAttempt) {
    attempts.push(extracted);
  }

  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, JsonValue>;
      }
    } catch {
      // continue
    }
  }

  return null;
};

const parseResponseOutputJson = (payload: unknown): Record<string, JsonValue> | null => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const withOutputArray = payload as {
    output?: Array<{
      json?: unknown;
      parsed?: unknown;
      content?: Array<{ json?: unknown; parsed?: unknown }>;
    }>;
  };

  if (Array.isArray(withOutputArray.output)) {
    for (const outputItem of withOutputArray.output) {
      if (!outputItem || typeof outputItem !== "object") {
        continue;
      }

      if (outputItem.json && typeof outputItem.json === "object" && !Array.isArray(outputItem.json)) {
        return outputItem.json as Record<string, JsonValue>;
      }

      if (outputItem.parsed && typeof outputItem.parsed === "object" && !Array.isArray(outputItem.parsed)) {
        return outputItem.parsed as Record<string, JsonValue>;
      }

      if (Array.isArray(outputItem.content)) {
        for (const contentItem of outputItem.content) {
          if (!contentItem || typeof contentItem !== "object") {
            continue;
          }

          if (contentItem.json && typeof contentItem.json === "object" && !Array.isArray(contentItem.json)) {
            return contentItem.json as Record<string, JsonValue>;
          }

          if (contentItem.parsed && typeof contentItem.parsed === "object" && !Array.isArray(contentItem.parsed)) {
            return contentItem.parsed as Record<string, JsonValue>;
          }
        }
      }
    }
  }

  const withChoices = payload as {
    choices?: Array<{ message?: { content?: unknown; parsed?: unknown } }>;
  };

  const parsed = withChoices.choices?.[0]?.message?.parsed;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, JsonValue>;
  }

  const messageContent = withChoices.choices?.[0]?.message?.content;
  if (messageContent && typeof messageContent === "object" && !Array.isArray(messageContent)) {
    return messageContent as Record<string, JsonValue>;
  }

  return null;
};

const parseResponseOutputText = (payload: unknown): string | null => {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const withOutputText = payload as { output_text?: unknown };
  const topLevelOutputText = normalizeTextValue(withOutputText.output_text);
  if (topLevelOutputText) {
    return topLevelOutputText;
  }

  const withOutputArray = payload as {
    output?: Array<{
      content?: Array<{ type?: string; text?: unknown }>;
      type?: string;
      text?: unknown;
      output_text?: unknown;
    }>;
  };

  if (Array.isArray(withOutputArray.output)) {
    const parts: string[] = [];

    for (const outputItem of withOutputArray.output) {
      if (!outputItem || typeof outputItem !== "object") {
        continue;
      }

      if (Array.isArray(outputItem.content)) {
        for (const contentItem of outputItem.content) {
          if (!contentItem || typeof contentItem !== "object") {
            continue;
          }

          const contentText =
            normalizeTextValue(contentItem.text) ??
            normalizeTextValue((contentItem as { output_text?: unknown }).output_text);

          if (
            (contentItem.type === "output_text" || contentItem.type === "text" || typeof contentItem.type === "undefined") &&
            contentText
          ) {
            parts.push(contentText);
          }

          const contentJson = (contentItem as { json?: unknown }).json;
          if (contentJson && typeof contentJson === "object" && !Array.isArray(contentJson)) {
            parts.push(JSON.stringify(contentJson));
          }
        }
      } else {
        const outputText = normalizeTextValue(outputItem.text) ?? normalizeTextValue(outputItem.output_text);
        if (outputText) {
          parts.push(outputText);
        }
      }

      const outputJson = (outputItem as { json?: unknown }).json;
      if (outputJson && typeof outputJson === "object" && !Array.isArray(outputJson)) {
        parts.push(JSON.stringify(outputJson));
      }
    }

    if (parts.length > 0) {
      return parts.join("\n");
    }
  }

  const withChoices = payload as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };

  const choiceContent = withChoices.choices?.[0]?.message?.content;
  const normalizedChoiceContent = normalizeTextValue(choiceContent);
  if (normalizedChoiceContent) {
    return normalizedChoiceContent;
  }

  if (Array.isArray(choiceContent)) {
    const parts = choiceContent
      .map((part) =>
        normalizeTextValue((part as { text?: unknown }).text) ??
        normalizeTextValue(part)
      )
      .filter((part): part is string => Boolean(part));

    if (parts.length > 0) {
      return parts.join("\n");
    }
  }

  return null;
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
  const timeoutCandidate = Number(params.modelConfig.timeout_ms);
  const timeoutMs = Number.isFinite(timeoutCandidate)
    ? Math.max(5_000, Math.min(120_000, timeoutCandidate))
    : 45_000;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      signal: AbortSignal.timeout(timeoutMs),
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
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new ApiError(504, "llm_provider_timeout", "LLM provider timed out", {
        endpoint,
        model: params.model,
        timeout_ms: timeoutMs
      });
    }
    throw error;
  }

  if (!response.ok) {
    const body = await response.text();
    throw new ApiError(502, "llm_provider_error", "LLM provider returned an error", body.slice(0, 1000));
  }

  const payload = (await response.json()) as unknown;
  const outputJson = parseResponseOutputJson(payload);
  if (outputJson) {
    return outputJson as T;
  }

  const outputText = parseResponseOutputText(payload);

  if (!outputText) {
    throw new ApiError(502, "llm_empty_output", "LLM provider returned an empty output payload", {
      payload_shape: payload && typeof payload === "object" ? Object.keys(payload as Record<string, unknown>) : "unknown"
    });
  }

  const parsed = parseJsonFromText(outputText);
  if (parsed) {
    return parsed as T;
  }

  throw new ApiError(502, "llm_invalid_json", "LLM output is not valid JSON", outputText.slice(0, 1000));
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
        "content-type": "application/json"
      },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: params.model,
        prompt: params.prompt,
        size,
        quality,
        response_format: "url"
      })
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new ApiError(504, "image_provider_timeout", "Image provider timed out", {
        endpoint,
        model: params.model,
        timeout_ms: timeoutMs
      });
    }
    throw error;
  }

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
      task: "classify_request",
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

const normalizeRecipeShape = (candidate: unknown): RecipePayload | null => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const recipe = candidate as Partial<RecipePayload> & Record<string, unknown>;
  const ingredientsSource =
    recipe.ingredients ??
    recipe.ingredients_by_category ??
    recipe.ingredient_groups ??
    recipe.grouped_ingredients;
  const stepsSource = recipe.steps ?? recipe.instructions;

  const parseNumericAmount = (value: unknown): number | null => {
    if (Number.isFinite(Number(value))) {
      return Number(value);
    }

    if (typeof value !== "string") {
      return null;
    }

    const raw = value.trim();
    if (!raw) {
      return null;
    }

    const direct = Number(raw);
    if (Number.isFinite(direct)) {
      return direct;
    }

    const mixedFraction = raw.match(/^(\d+)\s+(\d+)\/(\d+)$/);
    if (mixedFraction) {
      const whole = Number(mixedFraction[1]);
      const numerator = Number(mixedFraction[2]);
      const denominator = Number(mixedFraction[3]);
      if (Number.isFinite(whole) && Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
        return whole + numerator / denominator;
      }
    }

    const fraction = raw.match(/^(\d+)\/(\d+)$/);
    if (fraction) {
      const numerator = Number(fraction[1]);
      const denominator = Number(fraction[2]);
      if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
        return numerator / denominator;
      }
    }

    const leadingNumeric = raw.match(/^(\d+(?:\.\d+)?)/);
    if (leadingNumeric) {
      const parsed = Number(leadingNumeric[1]);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return null;
  };

  const parseUnitFromQuantity = (quantityText: string): string => {
    const cleaned = quantityText.trim();
    if (!cleaned) {
      return "";
    }

    const withoutLeadingAmount = cleaned
      .replace(/^(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+)\s*/i, "")
      .trim();
    if (!withoutLeadingAmount) {
      return "";
    }

    const [firstToken] = withoutLeadingAmount.split(/\s+/);
    return firstToken?.trim() ?? "";
  };

  const normalizeIngredientsInput = (input: unknown): Array<Record<string, unknown> | string> => {
    if (Array.isArray(input)) {
      return input.filter(
        (item): item is Record<string, unknown> | string =>
          typeof item === "string" || (Boolean(item) && typeof item === "object" && !Array.isArray(item))
      );
    }

    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return [];
    }

    const grouped = input as Record<string, unknown>;
    const flattened: Array<Record<string, unknown>> = [];

    for (const [category, value] of Object.entries(grouped)) {
      if (Array.isArray(value)) {
        for (const row of value) {
          if (!row || typeof row !== "object" || Array.isArray(row)) {
            continue;
          }

          const withCategory = row as Record<string, unknown>;
          if (typeof withCategory.category !== "string" || withCategory.category.trim().length === 0) {
            flattened.push({ ...withCategory, category });
          } else {
            flattened.push(withCategory);
          }
        }
      }
    }

    return flattened;
  };

  const normalizeStepsInput = (input: unknown): Array<Record<string, unknown> | string> => {
    if (Array.isArray(input)) {
      return input.filter((item): item is Record<string, unknown> | string =>
        typeof item === "string" || (Boolean(item) && typeof item === "object" && !Array.isArray(item))
      );
    }

    if (input && typeof input === "object" && !Array.isArray(input)) {
      return Object.values(input).filter((item): item is Record<string, unknown> | string =>
        typeof item === "string" || (Boolean(item) && typeof item === "object" && !Array.isArray(item))
      );
    }

    return [];
  };

  if (
    typeof recipe.title !== "string" ||
    recipe.title.trim().length === 0 ||
    !Number.isFinite(Number(recipe.servings)) ||
    Number(recipe.servings) < 1 ||
    (!Array.isArray(ingredientsSource) && (!ingredientsSource || typeof ingredientsSource !== "object")) ||
    !Array.isArray(stepsSource)
  ) {
    return null;
  }

  const ingredients = normalizeIngredientsInput(ingredientsSource)
    .map((ingredient) => {
      if (typeof ingredient === "string") {
        const name = ingredient.trim();
        if (!name) {
          return null;
        }

        return {
          name,
          amount: 1,
          unit: "unit",
          preparation: undefined,
          category: undefined
        };
      }

      const nameCandidate =
        typeof ingredient.name === "string"
          ? ingredient.name
          : typeof ingredient.ingredient === "string"
            ? ingredient.ingredient
            : "";
      const name = nameCandidate.trim();
      const amountCandidate =
        ingredient.amount ??
        ingredient.quantity ??
        ingredient.qty ??
        ingredient.value;
      const amount = parseNumericAmount(amountCandidate);
      const unitCandidate =
        typeof ingredient.unit === "string"
          ? ingredient.unit
          : typeof ingredient.units === "string"
            ? ingredient.units
            : "";
      const unit = unitCandidate.trim();
      const quantityText = typeof ingredient.quantity === "string" ? ingredient.quantity.trim() : "";
      const fallbackAmount = parseNumericAmount(quantityText);
      const fallbackUnit = parseUnitFromQuantity(quantityText);

      if (!name) {
        return null;
      }

      return {
        name,
        amount: amount ?? fallbackAmount ?? 1,
        unit: unit || fallbackUnit || "unit",
        preparation:
          typeof ingredient.preparation === "string" && ingredient.preparation.trim().length > 0
            ? ingredient.preparation.trim()
            : undefined,
        category:
          typeof ingredient.category === "string" && ingredient.category.trim().length > 0
            ? ingredient.category.trim()
            : undefined
      };
    })
    .filter((ingredient): ingredient is RecipePayload["ingredients"][number] => ingredient !== null);

  const steps = normalizeStepsInput(stepsSource)
    .map((step, stepIndex) => {
      if (typeof step === "string") {
        const instruction = step.trim();
        if (!instruction) {
          return null;
        }

        return {
          index: stepIndex + 1,
          instruction
        };
      }

      const index = Number(step.index ?? step.step ?? step.step_number ?? (stepIndex + 1));
      const instructionCandidate =
        typeof step.instruction === "string"
          ? step.instruction
          : typeof step.text === "string"
            ? step.text
            : typeof step.description === "string"
              ? step.description
              : "";
      const instruction = instructionCandidate.trim();
      if (!Number.isFinite(index) || index < 1 || !instruction) {
        return null;
      }

      return {
        index,
        instruction,
        timer_seconds: Number.isFinite(Number(step.timer_seconds ?? step.timer)) ? Number(step.timer_seconds ?? step.timer) : undefined,
        notes: typeof step.notes === "string" && step.notes.trim().length > 0 ? step.notes.trim() : undefined,
        inline_measurements: Array.isArray(step.inline_measurements ?? step.inlineMeasurements)
          ? (step.inline_measurements ?? step.inlineMeasurements)
              .map((measurement) => {
                const ingredient = typeof measurement.ingredient === "string" ? measurement.ingredient.trim() : "";
                const amount = Number((measurement as Record<string, unknown>).amount);
                const unit = typeof measurement.unit === "string" ? measurement.unit.trim() : "";
                if (!ingredient || !Number.isFinite(amount) || !unit) {
                  return null;
                }
                return {
                  ingredient,
                  amount,
                  unit
                };
              })
              .filter(
                (measurement): measurement is NonNullable<RecipePayload["steps"][number]["inline_measurements"]>[number] =>
                  measurement !== null
              )
          : undefined
      };
    })
    .filter((step): step is RecipePayload["steps"][number] => step !== null);

  const normalizedSteps = [...steps]
    .sort((a, b) => a.index - b.index)
    .map((step, index) => ({
      ...step,
      index: index + 1
    }));

  if (ingredients.length === 0 || normalizedSteps.length === 0) {
    return null;
  }

  const attachments = Array.isArray(recipe.attachments)
    ? recipe.attachments
        .map((attachment) => {
          const title = typeof attachment.title === "string" ? attachment.title.trim() : "";
          const relationType = typeof attachment.relation_type === "string" ? attachment.relation_type.trim() : "";
          const nestedRecipe = normalizeRecipeShape(attachment.recipe);

          if (!title || !relationType || !nestedRecipe) {
            return null;
          }

          const nestedWithoutAttachments = { ...nestedRecipe } as Record<string, JsonValue>;
          delete nestedWithoutAttachments.attachments;

          return {
            title,
            relation_type: relationType,
            recipe: nestedWithoutAttachments as Omit<RecipePayload, "attachments">
          };
        })
        .filter((attachment): attachment is NonNullable<RecipePayload["attachments"]>[number] => attachment !== null)
    : undefined;

  return {
    title: recipe.title.trim(),
    description: typeof recipe.description === "string" ? recipe.description.trim() : undefined,
    servings: Number(recipe.servings),
    ingredients,
    steps: normalizedSteps,
    notes: typeof recipe.notes === "string" ? recipe.notes.trim() : undefined,
    pairings: Array.isArray(recipe.pairings) ? recipe.pairings.filter((item): item is string => typeof item === "string") : [],
    emoji: Array.isArray(recipe.emoji) ? recipe.emoji.filter((item): item is string => typeof item === "string") : [],
    metadata:
      recipe.metadata && typeof recipe.metadata === "object" && !Array.isArray(recipe.metadata)
        ? (recipe.metadata as Record<string, JsonValue>)
        : undefined,
    attachments
  };
};

const normalizeAssistantReply = (candidate: unknown): AssistantReply | null => {
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return {
      text: candidate.trim()
    };
  }

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const reply = candidate as Partial<AssistantReply>;
  if (typeof reply.text !== "string" || reply.text.trim().length === 0) {
    return null;
  }

  return {
    text: reply.text.trim(),
    tone: typeof reply.tone === "string" && reply.tone.trim().length > 0 ? reply.tone.trim() : undefined,
    focus_summary:
      typeof reply.focus_summary === "string" && reply.focus_summary.trim().length > 0
        ? reply.focus_summary.trim()
        : undefined,
    emoji: Array.isArray(reply.emoji) ? reply.emoji.filter((item): item is string => typeof item === "string") : undefined,
    suggested_next_actions: Array.isArray(reply.suggested_next_actions)
      ? reply.suggested_next_actions.filter((item): item is string => typeof item === "string")
      : undefined
  };
};

const normalizeOnboardingState = (candidate: unknown): OnboardingState | null => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const state = candidate as {
    completed?: unknown;
    progress?: unknown;
    missing_topics?: unknown;
    state?: unknown;
  };

  const completed = Boolean(state.completed);
  const progressValue = Number(state.progress);
  const progress = Number.isFinite(progressValue) ? Math.max(0, Math.min(1, progressValue)) : completed ? 1 : 0;

  const missingTopics = Array.isArray(state.missing_topics)
    ? state.missing_topics.filter((topic): topic is string => typeof topic === "string" && topic.trim().length > 0)
    : [];

  const nestedState =
    state.state && typeof state.state === "object" && !Array.isArray(state.state)
      ? (state.state as Record<string, JsonValue>)
      : {};

  return {
    completed,
    progress,
    missing_topics: missingTopics,
    state: nestedState
  };
};

const normalizeOnboardingEnvelope = (candidate: unknown): OnboardingAssistantEnvelope | null => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const payload = candidate as Record<string, unknown>;
  const nestedAssistantReply =
    payload.assistant_reply ??
    ((payload.data as Record<string, unknown> | undefined)?.assistant_reply as unknown) ??
    ((payload.result as Record<string, unknown> | undefined)?.assistant_reply as unknown) ??
    (payload.assistant as unknown);

  const nestedOnboardingState =
    payload.onboarding_state ??
    ((payload.data as Record<string, unknown> | undefined)?.onboarding_state as unknown) ??
    ((payload.result as Record<string, unknown> | undefined)?.onboarding_state as unknown);

  const assistantReply = normalizeAssistantReply(nestedAssistantReply);
  const onboardingState = normalizeOnboardingState(nestedOnboardingState);
  if (!assistantReply || !onboardingState) {
    return null;
  }

  const preferenceUpdates =
    payload.preference_updates && typeof payload.preference_updates === "object" && !Array.isArray(payload.preference_updates)
      ? (payload.preference_updates as Record<string, JsonValue>)
      : payload.response_context &&
            typeof payload.response_context === "object" &&
            !Array.isArray(payload.response_context) &&
            typeof (payload.response_context as Record<string, unknown>).preference_updates === "object" &&
            !Array.isArray((payload.response_context as Record<string, unknown>).preference_updates)
        ? ((payload.response_context as Record<string, unknown>).preference_updates as Record<string, JsonValue>)
        : undefined;

  return {
    assistant_reply: assistantReply,
    onboarding_state: onboardingState,
    preference_updates: preferenceUpdates
  };
};

const normalizeResponseContext = (candidate: unknown): RecipeAssistantEnvelope["response_context"] | undefined => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return undefined;
  }

  const contextObject = candidate as Record<string, unknown>;
  const preferenceUpdates =
    contextObject.preference_updates &&
    typeof contextObject.preference_updates === "object" &&
    !Array.isArray(contextObject.preference_updates)
      ? (contextObject.preference_updates as Record<string, JsonValue>)
      : undefined;

  return {
    mode: typeof contextObject.mode === "string" ? contextObject.mode : undefined,
    changed_sections: Array.isArray(contextObject.changed_sections)
      ? contextObject.changed_sections.filter((item): item is string => typeof item === "string")
      : undefined,
    personalization_notes: Array.isArray(contextObject.personalization_notes)
      ? contextObject.personalization_notes.filter((item): item is string => typeof item === "string")
      : undefined,
    preference_updates: preferenceUpdates
  };
};

const normalizeRecipeEnvelope = (candidate: unknown): RecipeAssistantEnvelope | null => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const payload = candidate as Record<string, unknown>;
  const nestedRecipe =
    (payload.recipe as unknown) ??
    ((payload.data as Record<string, unknown> | undefined)?.recipe as unknown) ??
    ((payload.result as Record<string, unknown> | undefined)?.recipe as unknown);
  const nestedAssistantReply =
    payload.assistant_reply ??
    ((payload.data as Record<string, unknown> | undefined)?.assistant_reply as unknown) ??
    ((payload.result as Record<string, unknown> | undefined)?.assistant_reply as unknown) ??
    (payload.assistant as unknown);
  const nestedResponseContext =
    payload.response_context ??
    ((payload.data as Record<string, unknown> | undefined)?.response_context as unknown) ??
    ((payload.result as Record<string, unknown> | undefined)?.response_context as unknown);

  const recipe = normalizeRecipeShape(nestedRecipe ?? payload);
  if (!recipe) {
    return null;
  }

  const assistantReply = normalizeAssistantReply(nestedAssistantReply);
  if (!assistantReply) {
    return null;
  }

  const responseContext = normalizeResponseContext(nestedResponseContext);

  return {
    recipe,
    assistant_reply: assistantReply,
    response_context: responseContext
  };
};

const normalizeDraftEnvelope = (candidate: unknown): DraftAssistantEnvelope | null => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const payload = candidate as Record<string, unknown>;
  const nestedAssistantReply =
    payload.assistant_reply ??
    ((payload.data as Record<string, unknown> | undefined)?.assistant_reply as unknown) ??
    ((payload.result as Record<string, unknown> | undefined)?.assistant_reply as unknown) ??
    payload.assistant;

  const assistantReply = normalizeAssistantReply(nestedAssistantReply ?? payload);
  if (!assistantReply) {
    return null;
  }

  const nestedRecipe =
    payload.recipe ??
    ((payload.data as Record<string, unknown> | undefined)?.recipe as unknown) ??
    ((payload.result as Record<string, unknown> | undefined)?.recipe as unknown);

  const recipe = normalizeRecipeShape(nestedRecipe);

  const nestedResponseContext =
    payload.response_context ??
    ((payload.data as Record<string, unknown> | undefined)?.response_context as unknown) ??
    ((payload.result as Record<string, unknown> | undefined)?.response_context as unknown);

  return {
    assistant_reply: assistantReply,
    recipe: recipe ?? undefined,
    response_context: normalizeResponseContext(nestedResponseContext)
  };
};

const deriveAssistantReplyFromRecipe = (recipe: RecipePayload): AssistantReply | null => {
  const textCandidates = [recipe.notes, recipe.description, recipe.title].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );

  if (textCandidates.length === 0) {
    return null;
  }

  return {
    text: textCandidates[0].trim()
  };
};

const composeAssistantReply = async (params: {
  config: GatewayConfig;
  prompt: string;
  context: Record<string, JsonValue>;
  recipe: RecipePayload;
}): Promise<AssistantReply | null> => {
  const synthesized = await callProvider<Record<string, JsonValue>>({
    provider: params.config.provider,
    model: params.config.model,
    modelConfig: params.config.modelConfig,
    systemPrompt: params.config.promptTemplate,
    userInput: {
      task: "compose_assistant_reply",
      rule: params.config.rule,
      prompt: params.prompt,
      context: params.context,
      recipe: params.recipe
    }
  });

  return normalizeAssistantReply(synthesized.assistant_reply ?? synthesized);
};

const generateRecipePayload = async (
  client: SupabaseClient,
  scope: Extract<GatewayScope, "generate" | "tweak">,
  input: GatewayInput
): Promise<RecipeAssistantEnvelope> => {
  const config = await getActiveConfig(client, scope);

  const result = await callProvider<Record<string, JsonValue>>({
    provider: config.provider,
    model: config.model,
    modelConfig: config.modelConfig,
    systemPrompt: config.promptTemplate,
    userInput: {
      task: scope === "generate" ? "generate_recipe" : "tweak_recipe",
      rule: config.rule,
      prompt: input.userPrompt,
      context: input.context
    }
  });

  const envelope = normalizeRecipeEnvelope(result);
  if (envelope) {
    return envelope;
  }

  const directRecipe = normalizeRecipeShape(result);
  if (directRecipe) {
    const synthesizedReply = await composeAssistantReply({
      config,
      prompt: input.userPrompt,
      context: input.context,
      recipe: directRecipe
    });

    if (!synthesizedReply) {
      const derivedReply = deriveAssistantReplyFromRecipe(directRecipe);
      if (!derivedReply) {
        throw new ApiError(422, "assistant_reply_missing", "LLM did not provide assistant reply content");
      }

      return {
        recipe: directRecipe,
        assistant_reply: derivedReply
      };
    }

    return {
      recipe: directRecipe,
      assistant_reply: synthesizedReply
    };
  }

  const repaired = await callProvider<Record<string, JsonValue>>({
    provider: config.provider,
    model: config.model,
    modelConfig: config.modelConfig,
    systemPrompt: config.promptTemplate,
    userInput: {
      task: "repair_recipe_schema",
      rule: config.rule,
      prompt: input.userPrompt,
      context: input.context,
      invalid_payload: result
    }
  });

  const repairedEnvelope = normalizeRecipeEnvelope(repaired);
  if (repairedEnvelope) {
    return repairedEnvelope;
  }

  const repairedRecipe = normalizeRecipeShape(repaired);
  if (repairedRecipe) {
    const synthesizedReply = await composeAssistantReply({
      config,
      prompt: input.userPrompt,
      context: input.context,
      recipe: repairedRecipe
    });

    if (!synthesizedReply) {
      const derivedReply = deriveAssistantReplyFromRecipe(repairedRecipe);
      if (!derivedReply) {
        throw new ApiError(422, "assistant_reply_missing", "LLM did not provide assistant reply content");
      }

      return {
        recipe: repairedRecipe,
        assistant_reply: derivedReply
      };
    }

    return {
      recipe: repairedRecipe,
      assistant_reply: synthesizedReply
    };
  }

  const strictRepaired = await callProvider<Record<string, JsonValue>>({
    provider: config.provider,
    model: config.model,
    modelConfig: config.modelConfig,
    systemPrompt: `${config.promptTemplate}\n\nYou are in strict schema normalization mode. Return one valid JSON object with keys assistant_reply, recipe, and response_context. Do not include markdown or prose.`,
    userInput: {
      task: "normalize_recipe_envelope",
      rule: config.rule,
      prompt: input.userPrompt,
      context: input.context,
      invalid_payload: repaired
    }
  });

  const strictEnvelope = normalizeRecipeEnvelope(strictRepaired);
  if (strictEnvelope) {
    return strictEnvelope;
  }

  const strictRecipe = normalizeRecipeShape(strictRepaired);
  if (strictRecipe) {
    const synthesizedReply = await composeAssistantReply({
      config,
      prompt: input.userPrompt,
      context: input.context,
      recipe: strictRecipe
    });

    if (!synthesizedReply) {
      const derivedReply = deriveAssistantReplyFromRecipe(strictRecipe);
      if (!derivedReply) {
        throw new ApiError(422, "assistant_reply_missing", "LLM did not provide assistant reply content");
      }

      return {
        recipe: strictRecipe,
        assistant_reply: derivedReply
      };
    }

    return {
      recipe: strictRecipe,
      assistant_reply: synthesizedReply
    };
  }

  throw new ApiError(422, "recipe_schema_invalid", "Generated recipe did not match required envelope schema");
};

const generateDraftConversationPayload = async (
  client: SupabaseClient,
  scope: Extract<GatewayScope, "generate" | "tweak">,
  input: GatewayInput
): Promise<DraftAssistantEnvelope> => {
  const config = await getActiveConfig(client, scope);

  const result = await callProvider<Record<string, JsonValue>>({
    provider: config.provider,
    model: config.model,
    modelConfig: config.modelConfig,
    systemPrompt: config.promptTemplate,
    userInput: {
      task: "draft_conversation",
      rule: config.rule,
      contract: {
        format: "json_object",
        required_keys: ["assistant_reply"],
        optional_keys: ["recipe", "response_context"],
        behavior: {
          ideation_without_recipe: true,
          include_recipe_on_user_commit: true
        }
      },
      prompt: input.userPrompt,
      context: input.context
    }
  });

  const directDraftEnvelope = normalizeDraftEnvelope(result);
  if (directDraftEnvelope) {
    return directDraftEnvelope;
  }

  const recipeEnvelope = normalizeRecipeEnvelope(result);
  if (recipeEnvelope) {
    return {
      assistant_reply: recipeEnvelope.assistant_reply,
      recipe: recipeEnvelope.recipe,
      response_context: recipeEnvelope.response_context
    };
  }

  const directRecipe = normalizeRecipeShape(result);
  if (directRecipe) {
    const synthesizedReply = await composeAssistantReply({
      config,
      prompt: input.userPrompt,
      context: input.context,
      recipe: directRecipe
    });

    if (!synthesizedReply) {
      const derivedReply = deriveAssistantReplyFromRecipe(directRecipe);
      if (!derivedReply) {
        throw new ApiError(422, "assistant_reply_missing", "LLM did not provide assistant reply content");
      }

      return {
        assistant_reply: derivedReply,
        recipe: directRecipe
      };
    }

    return {
      assistant_reply: synthesizedReply,
      recipe: directRecipe
    };
  }

  const repaired = await callProvider<Record<string, JsonValue>>({
    provider: config.provider,
    model: config.model,
    modelConfig: config.modelConfig,
    systemPrompt: `${config.promptTemplate}\n\nYou are in strict schema normalization mode for draft chat. Return one valid JSON object with keys assistant_reply, optional recipe, and optional response_context. No markdown or prose.`,
    userInput: {
      task: "repair_draft_schema",
      rule: config.rule,
      prompt: input.userPrompt,
      context: input.context,
      invalid_payload: result
    }
  });

  const repairedDraftEnvelope = normalizeDraftEnvelope(repaired);
  if (repairedDraftEnvelope) {
    return repairedDraftEnvelope;
  }

  const repairedRecipeEnvelope = normalizeRecipeEnvelope(repaired);
  if (repairedRecipeEnvelope) {
    return {
      assistant_reply: repairedRecipeEnvelope.assistant_reply,
      recipe: repairedRecipeEnvelope.recipe,
      response_context: repairedRecipeEnvelope.response_context
    };
  }

  const repairedRecipe = normalizeRecipeShape(repaired);
  if (repairedRecipe) {
    const synthesizedReply = await composeAssistantReply({
      config,
      prompt: input.userPrompt,
      context: input.context,
      recipe: repairedRecipe
    });

    if (!synthesizedReply) {
      const derivedReply = deriveAssistantReplyFromRecipe(repairedRecipe);
      if (!derivedReply) {
        throw new ApiError(422, "assistant_reply_missing", "LLM did not provide assistant reply content");
      }

      return {
        assistant_reply: derivedReply,
        recipe: repairedRecipe
      };
    }

    return {
      assistant_reply: synthesizedReply,
      recipe: repairedRecipe
    };
  }

  throw new ApiError(422, "draft_schema_invalid", "Draft reply did not match required envelope schema");
};

const generateOnboardingInterviewEnvelope = async (
  client: SupabaseClient,
  input: GatewayInput
): Promise<OnboardingAssistantEnvelope> => {
  const config = await getActiveConfig(client, "onboarding");

  const result = await callProvider<Record<string, JsonValue>>({
    provider: config.provider,
    model: config.model,
    modelConfig: config.modelConfig,
    systemPrompt: config.promptTemplate,
    userInput: {
      task: "onboarding_interview",
      rule: config.rule,
      prompt: input.userPrompt,
      context: input.context
    }
  });

  const envelope = normalizeOnboardingEnvelope(result);
  if (envelope) {
    return envelope;
  }

  const repaired = await callProvider<Record<string, JsonValue>>({
    provider: config.provider,
    model: config.model,
    modelConfig: config.modelConfig,
    systemPrompt: `${config.promptTemplate}\n\nYou are in strict schema normalization mode. Return one valid JSON object with keys assistant_reply, onboarding_state, and optional preference_updates. Do not include markdown or prose.`,
    userInput: {
      task: "repair_onboarding_schema",
      rule: config.rule,
      prompt: input.userPrompt,
      context: input.context,
      invalid_payload: result
    }
  });

  const repairedEnvelope = normalizeOnboardingEnvelope(repaired);
  if (repairedEnvelope) {
    return repairedEnvelope;
  }

  throw new ApiError(422, "onboarding_schema_invalid", "Generated onboarding reply did not match required schema");
};

const logLlmEvent = async (
  client: SupabaseClient,
  userId: string,
  requestId: string,
  scope: GatewayScope,
  latencyMs: number,
  safetyState: string,
  payload?: Record<string, JsonValue>
): Promise<void> => {
  const { error } = await client.from("events").insert({
    user_id: userId,
    event_type: "llm_call",
    request_id: requestId,
    latency_ms: latencyMs,
    safety_state: safetyState,
    event_payload: { scope, ...(payload ?? {}) }
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
  }): Promise<RecipeAssistantEnvelope> {
    const startedAt = Date.now();

    try {
      const classification = await classifyScope(params.client, {
        userPrompt: params.prompt,
        context: params.context
      });

      if (!classification.isAllowed) {
        await logLlmEvent(params.client, params.userId, params.requestId, "generate", Date.now() - startedAt, "out_of_scope");
        throw new ApiError(422, "request_out_of_scope", classification.reason ?? "Request is outside active cooking scope");
      }

      const recipeEnvelope = await generateRecipePayload(params.client, "generate", {
        userPrompt: params.prompt,
        context: params.context
      });

      await logLlmEvent(params.client, params.userId, params.requestId, "generate", Date.now() - startedAt, "ok");
      return recipeEnvelope;
    } catch (error) {
      const errorCode = error instanceof ApiError ? error.code : "unknown_error";
      await logLlmEvent(params.client, params.userId, params.requestId, "generate", Date.now() - startedAt, "error", {
        error_code: errorCode
      });
      throw error;
    }
  },

  async tweakRecipe(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    prompt: string;
    context: Record<string, JsonValue>;
  }): Promise<RecipeAssistantEnvelope> {
    const startedAt = Date.now();

    try {
      const classification = await classifyScope(params.client, {
        userPrompt: params.prompt,
        context: params.context
      });

      if (!classification.isAllowed) {
        await logLlmEvent(params.client, params.userId, params.requestId, "tweak", Date.now() - startedAt, "out_of_scope");
        throw new ApiError(422, "request_out_of_scope", classification.reason ?? "Request is outside active cooking scope");
      }

      const recipeEnvelope = await generateRecipePayload(params.client, "tweak", {
        userPrompt: params.prompt,
        context: params.context
      });

      await logLlmEvent(params.client, params.userId, params.requestId, "tweak", Date.now() - startedAt, "ok");
      return recipeEnvelope;
    } catch (error) {
      const errorCode = error instanceof ApiError ? error.code : "unknown_error";
      await logLlmEvent(params.client, params.userId, params.requestId, "tweak", Date.now() - startedAt, "error", {
        error_code: errorCode
      });
      throw error;
    }
  },

  async converseDraft(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    prompt: string;
    context: Record<string, JsonValue>;
  }): Promise<DraftAssistantEnvelope> {
    const startedAt = Date.now();
    const hasActiveRecipe = Boolean(
      params.context.active_recipe && typeof params.context.active_recipe === "object" && !Array.isArray(params.context.active_recipe)
    );
    const scope: Extract<GatewayScope, "generate" | "tweak"> = hasActiveRecipe ? "tweak" : "generate";

    try {
      const classification = await classifyScope(params.client, {
        userPrompt: params.prompt,
        context: params.context
      });

      if (!classification.isAllowed) {
        await logLlmEvent(params.client, params.userId, params.requestId, scope, Date.now() - startedAt, "out_of_scope");
        throw new ApiError(422, "request_out_of_scope", classification.reason ?? "Request is outside active cooking scope");
      }

      const envelope = await generateDraftConversationPayload(params.client, scope, {
        userPrompt: params.prompt,
        context: params.context
      });

      await logLlmEvent(params.client, params.userId, params.requestId, scope, Date.now() - startedAt, "ok", {
        draft_mode: envelope.recipe ? "recipe" : "ideation"
      });
      return envelope;
    } catch (error) {
      const errorCode = error instanceof ApiError ? error.code : "unknown_error";
      await logLlmEvent(params.client, params.userId, params.requestId, scope, Date.now() - startedAt, "error", {
        error_code: errorCode
      });
      throw error;
    }
  },

  async inferCategories(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    recipe: RecipePayload;
    context: Record<string, JsonValue>;
  }): Promise<CategoryInference[]> {
    const startedAt = Date.now();
    try {
      const config = await getActiveConfig(params.client, "classify");

      const output = await callProvider<{ categories: CategoryInference[] }>({
        provider: config.provider,
        model: config.model,
        modelConfig: config.modelConfig,
        systemPrompt: config.promptTemplate,
        userInput: {
          task: "infer_categories",
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
    } catch (error) {
      const errorCode = error instanceof ApiError ? error.code : "unknown_error";
      await logLlmEvent(params.client, params.userId, params.requestId, "classify", Date.now() - startedAt, "error", {
        error_code: errorCode
      });
      throw error;
    }
  },

  async runOnboardingInterview(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    prompt: string;
    context: Record<string, JsonValue>;
  }): Promise<OnboardingAssistantEnvelope> {
    const startedAt = Date.now();

    try {
      const response = await generateOnboardingInterviewEnvelope(params.client, {
        userPrompt: params.prompt,
        context: params.context
      });

      await logLlmEvent(params.client, params.userId, params.requestId, "onboarding", Date.now() - startedAt, "ok", {
        completed: response.onboarding_state.completed,
        missing_topics: response.onboarding_state.missing_topics
      });

      return response;
    } catch (error) {
      const errorCode = error instanceof ApiError ? error.code : "unknown_error";
      await logLlmEvent(params.client, params.userId, params.requestId, "onboarding", Date.now() - startedAt, "error", {
        error_code: errorCode
      });
      throw error;
    }
  },

  async generateRecipeImage(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    recipe: RecipePayload;
    context: Record<string, JsonValue>;
  }): Promise<string> {
    const startedAt = Date.now();
    try {
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
    } catch (error) {
      const errorCode = error instanceof ApiError ? error.code : "unknown_error";
      await logLlmEvent(params.client, params.userId, params.requestId, "image", Date.now() - startedAt, "error", {
        error_code: errorCode
      });
      throw error;
    }
  },

  async extractMemories(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    context: Record<string, JsonValue>;
  }): Promise<MemoryCandidate[]> {
    const startedAt = Date.now();
    const config = await getActiveConfig(params.client, "memory_extract");

    const output = await callProvider<{ memories: MemoryCandidate[] }>({
      provider: config.provider,
      model: config.model,
      modelConfig: config.modelConfig,
      systemPrompt: config.promptTemplate,
      userInput: {
        rule: config.rule,
        context: params.context
      }
    });

    const records = (output.memories ?? [])
      .filter((item) => typeof item.memory_type === "string" && item.memory_type.trim().length > 0)
      .map((item) => ({
        memory_type: item.memory_type.trim(),
        memory_kind: typeof item.memory_kind === "string" ? item.memory_kind : "preference",
        memory_content: item.memory_content,
        confidence: Number.isFinite(Number(item.confidence)) ? Math.max(0, Math.min(1, Number(item.confidence))) : 0.5,
        salience: Number.isFinite(Number(item.salience)) ? Math.max(0, Math.min(1, Number(item.salience))) : 0.5,
        source: typeof item.source === "string" && item.source.trim().length > 0 ? item.source.trim() : "llm_extract"
      }));

    await logLlmEvent(params.client, params.userId, params.requestId, "memory_extract", Date.now() - startedAt, "ok", {
      extracted_count: records.length
    });

    return records;
  },

  async selectMemories(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    prompt: string;
    context: Record<string, JsonValue>;
    memories: MemoryRecord[];
  }): Promise<MemorySelection> {
    const startedAt = Date.now();
    const config = await getActiveConfig(params.client, "memory_select");

    const output = await callProvider<MemorySelection>({
      provider: config.provider,
      model: config.model,
      modelConfig: config.modelConfig,
      systemPrompt: config.promptTemplate,
      userInput: {
        rule: config.rule,
        prompt: params.prompt,
        context: params.context,
        memories: params.memories
      }
    });

    const selected = Array.isArray(output.selected_memory_ids)
      ? output.selected_memory_ids.filter((value): value is string => typeof value === "string")
      : [];

    await logLlmEvent(params.client, params.userId, params.requestId, "memory_select", Date.now() - startedAt, "ok", {
      selected_count: selected.length
    });

    return {
      selected_memory_ids: selected,
      rationale: output.rationale
    };
  },

  async summarizeMemories(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    memories: MemoryRecord[];
    context: Record<string, JsonValue>;
  }): Promise<MemorySummary> {
    const startedAt = Date.now();
    const config = await getActiveConfig(params.client, "memory_summarize");

    const output = await callProvider<MemorySummary>({
      provider: config.provider,
      model: config.model,
      modelConfig: config.modelConfig,
      systemPrompt: config.promptTemplate,
      userInput: {
        rule: config.rule,
        memories: params.memories,
        context: params.context
      }
    });

    await logLlmEvent(params.client, params.userId, params.requestId, "memory_summarize", Date.now() - startedAt, "ok");

    return {
      summary: output.summary ?? {},
      token_estimate: Number.isFinite(Number(output.token_estimate)) ? Number(output.token_estimate) : 0
    };
  },

  async resolveMemoryConflicts(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    existingMemories: MemoryRecord[];
    candidates: MemoryCandidate[];
  }): Promise<ConflictResolution> {
    const startedAt = Date.now();
    const config = await getActiveConfig(params.client, "memory_conflict_resolve");

    const output = await callProvider<ConflictResolution>({
      provider: config.provider,
      model: config.model,
      modelConfig: config.modelConfig,
      systemPrompt: config.promptTemplate,
      userInput: {
        rule: config.rule,
        existing_memories: params.existingMemories,
        candidate_memories: params.candidates
      }
    });

    await logLlmEvent(params.client, params.userId, params.requestId, "memory_conflict_resolve", Date.now() - startedAt, "ok", {
      actions_count: Array.isArray(output.actions) ? output.actions.length : 0
    });

    return {
      actions: Array.isArray(output.actions) ? output.actions : []
    };
  }
};
