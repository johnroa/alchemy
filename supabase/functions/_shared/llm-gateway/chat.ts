/**
 * Chat conversation envelope generation.
 *
 * Uses provider-native structured outputs for chat scopes so schema
 * compliance is enforced by the adapter layer instead of repaired with
 * follow-up prompts. Scope-specific business rules are still validated
 * locally after normalization.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../errors.ts";
import type { ChatAssistantEnvelope, JsonValue } from "../types.ts";
import type {
  ChatConversationScope,
  GatewayInput,
  ModelOverrideMap,
  TokenAccum,
} from "./types.ts";
import {
  callProvider,
  cleanLegacyModelConfig,
  defaultChatPromptForScope,
  defaultChatRuleForScope,
  getActiveConfig,
} from "./config.ts";
import { normalizeChatEnvelope } from "./normalizers.ts";
import { addTokens } from "./recipe.ts";

const nullable = (
  schema: Record<string, JsonValue>,
): Record<string, JsonValue> => ({
  anyOf: [schema, { type: "null" }],
});

const assistantReplySchema: Record<string, JsonValue> = {
  type: "object",
  additionalProperties: false,
  required: ["text"],
  properties: {
    text: { type: "string" },
    tone: { type: "string" },
    emoji: {
      type: "array",
      items: { type: "string" },
    },
    suggested_next_actions: {
      type: "array",
      items: { type: "string" },
    },
    focus_summary: { type: "string" },
  },
};

const preferenceConflictSchema: Record<string, JsonValue> = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: {
      type: "string",
      enum: ["pending_confirmation", "adapt", "override", "cleared"],
    },
    conflicting_preferences: {
      type: "array",
      items: { type: "string" },
    },
    conflicting_aversions: {
      type: "array",
      items: { type: "string" },
    },
    requested_terms: {
      type: "array",
      items: { type: "string" },
    },
  },
};

const responseContextSchema: Record<string, JsonValue> = {
  type: "object",
  additionalProperties: false,
  properties: {
    mode: { type: "string" },
    intent: {
      type: "string",
      enum: ["in_scope_ideation", "in_scope_generate", "out_of_scope"],
    },
    changed_sections: {
      type: "array",
      items: { type: "string" },
    },
    personalization_notes: {
      type: "array",
      items: { type: "string" },
    },
    preference_updates: {
      type: "object",
      additionalProperties: true,
    },
    preference_conflict: preferenceConflictSchema,
  },
};

const instructionPartSchema: Record<string, JsonValue> = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "value"],
      properties: {
        type: { type: "string", enum: ["text"] },
        value: { type: "string" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "value", "unit"],
      properties: {
        type: { type: "string", enum: ["temperature"] },
        value: { type: "number" },
        unit: { type: "string", enum: ["fahrenheit", "celsius"] },
      },
    },
  ],
};

const recipeIngredientSchema: Record<string, JsonValue> = {
  type: "object",
  additionalProperties: false,
  required: ["name", "amount", "unit"],
  properties: {
    name: { type: "string" },
    amount: { type: "number" },
    unit: { type: "string" },
    display_amount: { type: "string" },
    preparation: { type: "string" },
    category: { type: "string" },
    component: nullable({ type: "string" }),
    ingredient_id: nullable({ type: "string" }),
    normalized_status: {
      type: "string",
      enum: ["normalized", "needs_retry"],
    },
  },
};

const instructionViewsSchema: Record<string, JsonValue> = {
  type: "object",
  additionalProperties: false,
  properties: {
    concise: { type: "array", items: instructionPartSchema },
    balanced: { type: "array", items: instructionPartSchema },
    detailed: { type: "array", items: instructionPartSchema },
  },
};

const recipeStepSchema: Record<string, JsonValue> = {
  type: "object",
  additionalProperties: false,
  required: ["index", "instruction"],
  properties: {
    index: { type: "number" },
    instruction: { type: "string" },
    instruction_views: instructionViewsSchema,
    timer_seconds: { type: "number" },
    notes: { type: "string" },
    inline_measurements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ingredient", "amount", "unit"],
        properties: {
          ingredient: { type: "string" },
          amount: { type: "number" },
          unit: { type: "string" },
        },
      },
    },
  },
};

const recipeMetadataSchema: Record<string, JsonValue> = {
  type: "object",
  additionalProperties: true,
  required: [
    "difficulty",
    "health_score",
    "time_minutes",
    "items",
    "timing",
    "quick_stats",
  ],
  properties: {
    difficulty: {
      type: "string",
      enum: ["easy", "medium", "complex"],
    },
    health_score: { type: "number" },
    time_minutes: { type: "number" },
    items: { type: "number" },
    timing: {
      type: "object",
      additionalProperties: true,
      required: ["total_minutes"],
      properties: {
        prep_minutes: { type: "number" },
        cook_minutes: { type: "number" },
        total_minutes: { type: "number" },
      },
    },
    quick_stats: {
      type: "object",
      additionalProperties: true,
      required: ["time_minutes", "difficulty", "health_score", "items"],
      properties: {
        time_minutes: { type: "number" },
        difficulty: {
          type: "string",
          enum: ["easy", "medium", "complex"],
        },
        health_score: { type: "number" },
        items: { type: "number" },
      },
    },
  },
};

const recipeSchema: Record<string, JsonValue> = {
  type: "object",
  additionalProperties: false,
  required: ["title", "servings", "ingredients", "steps", "metadata"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    description: { type: "string" },
    servings: { type: "number" },
    ingredients: { type: "array", items: recipeIngredientSchema },
    ingredient_groups: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "label", "ingredients"],
        properties: {
          key: { type: "string" },
          label: { type: "string" },
          ingredients: {
            type: "array",
            items: recipeIngredientSchema,
          },
        },
      },
    },
    steps: { type: "array", items: recipeStepSchema },
    notes: { type: "string" },
    pairings: {
      type: "array",
      items: { type: "string" },
    },
    emoji: {
      type: "array",
      items: { type: "string" },
    },
    metadata: recipeMetadataSchema,
  },
};

const candidateComponentSchema: Record<string, JsonValue> = {
  type: "object",
  additionalProperties: false,
  required: ["component_id", "role", "title", "recipe"],
  properties: {
    component_id: { type: "string" },
    role: {
      type: "string",
      enum: ["main", "side", "appetizer", "dessert", "drink"],
    },
    title: { type: "string" },
    image_url: nullable({ type: "string" }),
    image_status: {
      type: "string",
      enum: ["pending", "processing", "ready", "failed"],
    },
    recipe: recipeSchema,
  },
};

const candidateRecipeSetSchema: Record<string, JsonValue> = {
  type: "object",
  additionalProperties: false,
  required: ["candidate_id", "revision", "active_component_id", "components"],
  properties: {
    candidate_id: { type: "string" },
    revision: { type: "number" },
    active_component_id: { type: "string" },
    components: {
      type: "array",
      items: candidateComponentSchema,
    },
  },
};

const buildChatScopeSchema = (
  scope: ChatConversationScope,
): Record<string, JsonValue> => {
  const required = scope === "chat_ideation"
    ? ["assistant_reply", "trigger_recipe", "response_context"]
    : ["assistant_reply", "response_context"];

  return {
    type: "object",
    additionalProperties: false,
    required,
    properties: {
      assistant_reply: assistantReplySchema,
      trigger_recipe: { type: "boolean" },
      response_context: responseContextSchema,
      candidate_recipe_set: candidateRecipeSetSchema,
      recipe: recipeSchema,
    },
  };
};

const buildChatRuntimeContract = (params: {
  scope: ChatConversationScope;
  promptTemplate: string;
  rule: Record<string, JsonValue>;
}) => {
  const scopeInstructions = params.scope === "chat_ideation"
    ? [
      "Keep assistant_reply.text concise: 2-3 short sentences max.",
      "If the user asks for a recipe or names a dish to cook, set response_context.intent to in_scope_generate and trigger_recipe=true immediately.",
      "If the request is out of scope, set response_context.intent to out_of_scope, trigger_recipe=false, and return no recipe fields.",
    ]
    : [
      "Keep assistant_reply.text concise: 1-2 short sentences max.",
      "When you generate or update recipes, the recipe details should carry the depth. The assistant reply should only confirm the result.",
    ];

  const hardening = [
    "Runtime requirements:",
    "- Follow the structured output schema exactly.",
    "- Do not add markdown, code fences, or prose outside the response object.",
    "- If there is an unresolved conflict between an explicit dish request and dietary_restrictions or aversions, ask for confirmation instead of generating.",
    "- In that conflict case, set response_context.mode to preference_conflict, trigger_recipe=false, and return no recipe or candidate_recipe_set.",
    "- If you return recipe content, include metadata.difficulty, metadata.health_score, metadata.time_minutes, metadata.items, metadata.timing.total_minutes, and metadata.quick_stats.",
    ...scopeInstructions,
  ].join("\n");

  return {
    systemPrompt: `${params.promptTemplate}\n\n${hardening}`,
    contractSummary: {
      output_contract: `${params.scope}_native_structured_v1`,
      required_root_keys: params.scope === "chat_ideation"
        ? ["assistant_reply", "trigger_recipe", "response_context"]
        : ["assistant_reply", "response_context"],
      recipe_required_metadata: [
        "metadata.difficulty",
        "metadata.health_score",
        "metadata.time_minutes",
        "metadata.items",
        "metadata.timing.total_minutes",
        "metadata.quick_stats",
      ],
      preference_conflict_mode: "response_context.mode=preference_conflict",
      strict_json_only: true,
    },
    structuredOutput: {
      name: `${params.scope}_response`,
      schema: buildChatScopeSchema(params.scope),
      strict: true,
    },
  };
};

const validateEnvelopeForScope = (
  scope: ChatConversationScope,
  envelope: ChatAssistantEnvelope,
): ChatAssistantEnvelope => {
  const isPreferenceConflict = envelope.response_context?.mode ===
      "preference_conflict" ||
    envelope.response_context?.preference_conflict?.status ===
      "pending_confirmation";

  if (scope === "chat_ideation") {
    const intent = envelope.response_context?.intent;
    if (
      intent !== "in_scope_ideation" && intent !== "in_scope_generate" &&
      intent !== "out_of_scope"
    ) {
      throw new ApiError(
        422,
        "chat_schema_invalid",
        "Ideation response_context.intent is required",
      );
    }

    if (intent === "out_of_scope") {
      return {
        assistant_reply: envelope.assistant_reply,
        trigger_recipe: false,
        response_context: {
          ...(envelope.response_context ?? {}),
          intent: "out_of_scope",
          mode: "ideation",
        },
      };
    }

    if (isPreferenceConflict) {
      return {
        assistant_reply: envelope.assistant_reply,
        trigger_recipe: false,
        response_context: {
          ...(envelope.response_context ?? {}),
          mode: "preference_conflict",
          intent,
        },
      };
    }

    return {
      assistant_reply: envelope.assistant_reply,
      trigger_recipe: intent === "in_scope_generate"
        ? true
        : (envelope.trigger_recipe ?? false),
      candidate_recipe_set: envelope.candidate_recipe_set,
      recipe: envelope.recipe,
      response_context: {
        ...(envelope.response_context ?? {}),
        intent,
      },
    };
  }

  if (isPreferenceConflict) {
    return {
      assistant_reply: envelope.assistant_reply,
      trigger_recipe: false,
      response_context: {
        ...(envelope.response_context ?? {}),
        mode: "preference_conflict",
        intent: "in_scope_generate",
      },
    };
  }

  if (!envelope.candidate_recipe_set && !envelope.recipe) {
    throw new ApiError(
      422,
      "chat_schema_invalid",
      "Generation and iteration must return a candidate_recipe_set",
    );
  }

  return {
    ...envelope,
    response_context: {
      ...(envelope.response_context ?? {}),
      intent: "in_scope_generate",
    },
  };
};

export const generateChatConversationPayload = async (
  client: SupabaseClient,
  scope: ChatConversationScope,
  input: GatewayInput,
  overrides?: ModelOverrideMap,
  accum?: TokenAccum,
): Promise<ChatAssistantEnvelope> => {
  const runtimeOverride = overrides?.[scope];
  const config = await getActiveConfig(client, scope, runtimeOverride);

  const runtimeModelConfig = cleanLegacyModelConfig(config.modelConfig);
  const runtimeProvider = config.provider;
  const runtimeModel = config.model;

  if (!Number.isFinite(Number(runtimeModelConfig.temperature))) {
    runtimeModelConfig.temperature = scope === "chat_ideation" ? 0.3 : 0.35;
  }

  const runtimePromptTemplate = config.promptTemplate?.trim().length
    ? config.promptTemplate
    : defaultChatPromptForScope(scope);
  const runtimeRule = config.rule &&
      typeof config.rule === "object" &&
      !Array.isArray(config.rule)
    ? config.rule
    : defaultChatRuleForScope(scope);
  const runtimeContract = buildChatRuntimeContract({
    scope,
    promptTemplate: runtimePromptTemplate,
    rule: runtimeRule,
  });

  const response = await callProvider<Record<string, JsonValue>>({
    provider: runtimeProvider,
    model: runtimeModel,
    modelConfig: runtimeModelConfig,
    systemPrompt: runtimeContract.systemPrompt,
    userInput: {
      task: "chat_conversation",
      scope,
      rule: runtimeRule,
      contract: runtimeContract.contractSummary,
      prompt: input.userPrompt,
      context: input.context,
    },
    structuredOutput: runtimeContract.structuredOutput,
  });
  if (accum) {
    addTokens(accum, response.inputTokens, response.outputTokens, config);
  }

  const envelope = normalizeChatEnvelope(response.result);
  if (!envelope) {
    throw new ApiError(
      422,
      "chat_schema_invalid",
      "Chat reply did not match required envelope schema",
    );
  }

  const validated = validateEnvelopeForScope(scope, envelope);
  return {
    ...validated,
    gateway_metadata: {
      ...(validated.gateway_metadata ?? {}),
      recovery_path: "direct",
      structured_output: `${runtimeProvider}_native`,
    },
  };
};
