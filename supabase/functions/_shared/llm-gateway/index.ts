/**
 * llm-gateway/index.ts
 *
 * Facade module: re-assembles the `llmGateway` public API object from
 * the split domain modules. Most methods delegate directly to an
 * extracted domain function. Orchestration methods (generateRecipe,
 * converseChat, runOnboardingInterview) combine multiple domain calls
 * with event logging. enrichRecipeMetadata is implemented inline
 * because it hasn't been extracted to a domain module yet.
 *
 * Re-exports key types for consumers that previously imported from
 * the monolithic llm-gateway.ts.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../errors.ts";
import { executeScope } from "../llm-executor.ts";
import type {
  ChatAssistantEnvelope,
  JsonValue,
  OnboardingAssistantEnvelope,
  RecipeAssistantEnvelope,
  RecipePayload,
} from "../types.ts";
import {
  normalizeRecipeMetadata,
  sumRecipeStepTimerSeconds,
} from "../recipe-metadata-normalization.ts";

import type {
  ChatConversationScope,
  ModelOverrideMap,
  RecipeSemanticEnrichment,
  TokenAccum,
} from "./types.ts";
import { DEFAULT_OUT_OF_SCOPE_FALLBACK_TEXT } from "./config.ts";
import { logLlmEvent } from "./event-log.ts";
import { classifyScope } from "./classify.ts";
import { inferCategories } from "./classify.ts";
import { addTokens, generateRecipePayload } from "./recipe.ts";
import { generateChatConversationPayload } from "./chat.ts";
import { generateOnboardingInterviewEnvelope } from "./onboarding.ts";
import {
  enrichIngredients,
  inferIngredientRelations,
  normalizeIngredientAliases,
  parseIngredientLines,
  splitIngredientPhrases,
} from "./ingredients.ts";
import {
  buildExploreForYouProfile,
  embedRecipeSearchQuery,
  interpretRecipeSearch,
  rerankExploreForYou,
  rerankRecipeSearch,
} from "./search.ts";
import {
  embedMemoryRetrievalQuery,
  extractMemories,
  resolveMemoryConflicts,
  selectMemories,
  summarizeMemories,
} from "./memory.ts";
import {
  evaluateImageQualityPair,
  evaluateRecipeImageReuse,
  generateRecipeImage,
  generateRecipeImageDetailed,
} from "./image.ts";
import {
  canonicalizeRecipe,
  executeRecipeCanonMatch,
  reviewCanonicalRecipe,
} from "./canonical.ts";
import { personalizeRecipe } from "./personalize.ts";
import {
  filterEquipmentPreferenceUpdates,
  normalizePreferenceList,
} from "./preferences.ts";
import { generateGreeting } from "./greeting.ts";
import {
  extractDemandIterationDelta,
  extractDemandObservation,
  linkDemandEntities,
  summarizeDemandOutcomeReason,
} from "./demand.ts";

export type {
  CanonicalizeRecipeResult,
  CanonicalRecipeReviewResult,
  ModelOverrideMap,
  PersonalizeRecipeResult,
  RecipeCanonMatchEnvelope,
  SubstitutionDiff,
} from "./types.ts";

const RECOVERABLE_CHAT_ERROR_CODES = new Set([
  "llm_invalid_json",
  "llm_json_truncated",
  "llm_empty_output",
  "chat_schema_invalid",
  "llm_provider_timeout",
  "llm_provider_error",
]);

const buildRecoverableChatEnvelope = (
  scope: ChatConversationScope,
  errorCode: string,
): ChatAssistantEnvelope => ({
  assistant_reply: {
    text: scope === "chat_iteration"
      ? "I hit a temporary issue updating that recipe. Try again and I'll pick up from here."
      : "I hit a temporary issue with that request. Try again and I'll pick up from here.",
    suggested_next_actions: ["Try again"],
  },
  trigger_recipe: false,
  response_context: {
    mode: scope === "chat_iteration"
      ? "iteration"
      : scope === "chat_generation"
      ? "generation"
      : "ideation",
    intent: scope === "chat_ideation"
      ? "in_scope_ideation"
      : "in_scope_generate",
  },
  gateway_metadata: {
    recovery_path: "graceful_retry_copy",
    error_code: errorCode,
  },
});

export const llmGateway = {
  /**
   * Full recipe generation with safety classification gate.
   * Classifies the prompt first, rejects out-of-scope requests, then
   * runs the recipe generation pipeline. Logs events for each outcome.
   */
  async generateRecipe(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    prompt: string;
    context: Record<string, JsonValue>;
    modelOverrides?: ModelOverrideMap;
  }): Promise<RecipeAssistantEnvelope> {
    const startedAt = Date.now();
    const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };

    try {
      const classification = await classifyScope(
        params.client,
        {
          userPrompt: params.prompt,
          context: params.context,
        },
        params.modelOverrides,
        accum,
      );

      if (!classification.isAllowed) {
        await logLlmEvent(
          params.client,
          params.userId,
          params.requestId,
          "generate",
          Date.now() - startedAt,
          "out_of_scope",
          {
            classification_label: classification.label,
            classification_reason: classification.reason ?? null,
          },
          accum,
        );
        throw new ApiError(
          422,
          "request_out_of_scope",
          DEFAULT_OUT_OF_SCOPE_FALLBACK_TEXT,
        );
      }

      const recipeEnvelope = await generateRecipePayload(
        params.client,
        "generate",
        {
          userPrompt: params.prompt,
          context: params.context,
        },
        params.modelOverrides,
        accum,
      );

      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "generate",
        Date.now() - startedAt,
        "ok",
        undefined,
        accum,
      );
      return recipeEnvelope;
    } catch (error) {
      const errorCode = error instanceof ApiError
        ? error.code
        : "unknown_error";
      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "generate",
        Date.now() - startedAt,
        "error",
        {
          error_code: errorCode,
        },
        accum,
      );
      throw error;
    }
  },

  /**
   * Chat conversation with automatic scope detection and one graceful
   * recovery owner. Recoverable provider/schema faults return retry copy
   * instead of cascading into more model work.
   */
  async converseChat(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    prompt: string;
    context: Record<string, JsonValue>;
    scopeHint?: ChatConversationScope;
    modelOverrides?: ModelOverrideMap;
  }): Promise<ChatAssistantEnvelope> {
    const startedAt = Date.now();
    const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };
    const hasActiveRecipe = Boolean(
      params.context.active_recipe &&
        typeof params.context.active_recipe === "object" &&
        !Array.isArray(params.context.active_recipe),
    );
    const scope: ChatConversationScope = params.scopeHint ??
      (hasActiveRecipe ? "chat_iteration" : "chat_ideation");

    try {
      const envelope = await generateChatConversationPayload(
        params.client,
        scope,
        {
          userPrompt: params.prompt,
          context: params.context,
        },
        params.modelOverrides,
        accum,
      );

      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        scope,
        Date.now() - startedAt,
        "ok",
        {
          chat_mode: envelope.recipe || envelope.candidate_recipe_set
            ? "recipe"
            : "ideation",
          classification_skipped: true,
          recovery_path: envelope.gateway_metadata?.recovery_path ?? "direct",
          structured_output: envelope.gateway_metadata?.structured_output ??
            null,
        },
        accum,
      );
      return envelope;
    } catch (error) {
      const errorCode = error instanceof ApiError
        ? error.code
        : "unknown_error";
      if (
        error instanceof ApiError &&
        RECOVERABLE_CHAT_ERROR_CODES.has(error.code)
      ) {
        const gracefulEnvelope = buildRecoverableChatEnvelope(
          scope,
          error.code,
        );
        await logLlmEvent(
          params.client,
          params.userId,
          params.requestId,
          scope,
          Date.now() - startedAt,
          "degraded",
          {
            error_code: error.code,
            recovery_path: gracefulEnvelope.gateway_metadata?.recovery_path ??
              "graceful_retry_copy",
          },
          accum,
        );
        return gracefulEnvelope;
      }
      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        scope,
        Date.now() - startedAt,
        "error",
        {
          error_code: errorCode,
        },
        accum,
      );
      throw error;
    }
  },

  inferCategories,

  normalizeIngredientAliases,

  parseIngredientLines,

  splitIngredientPhrases,

  enrichIngredients,

  /**
   * Enriches recipe metadata via the recipe_metadata_enrich LLM scope.
   * Not yet extracted to a domain module — implemented inline.
   */
  async enrichRecipeMetadata(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    recipe: RecipePayload;
    ingredientNames: string[];
  }): Promise<RecipeSemanticEnrichment> {
    const startedAt = Date.now();
    const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };
    try {
      const { result, inputTokens, outputTokens, config } = await executeScope<
        { confidence?: unknown; metadata?: unknown }
      >({
        client: params.client,
        scope: "recipe_metadata_enrich",
        userInput: {
          task: "recipe_metadata_enrichment_v2",
          recipe: params.recipe as unknown as JsonValue,
          ingredient_names: params.ingredientNames,
        },
      });
      addTokens(accum, inputTokens, outputTokens, config);

      const rawMetadata = result.metadata;
      const metadata = rawMetadata && typeof rawMetadata === "object" &&
          !Array.isArray(rawMetadata)
        ? rawMetadata as Record<string, JsonValue>
        : {};
      const normalizedMetadata = normalizeRecipeMetadata({
        metadata,
        ingredientCount: Array.isArray(params.recipe.ingredients)
          ? params.recipe.ingredients.length
          : 0,
        stepTimerSecondsTotal: sumRecipeStepTimerSeconds(params.recipe.steps),
      }).metadata;
      const rawConfidence = Number(result.confidence);
      const confidence = Number.isFinite(rawConfidence)
        ? Math.max(0, Math.min(1, rawConfidence))
        : 0;

      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "recipe_metadata_enrich",
        Date.now() - startedAt,
        "ok",
        {
          task: "recipe_metadata_enrichment_v2",
          ingredient_count: params.ingredientNames.length,
        },
        accum,
      );

      return { confidence, metadata: normalizedMetadata };
    } catch (error) {
      const errorCode = error instanceof ApiError
        ? error.code
        : "unknown_error";
      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "recipe_metadata_enrich",
        Date.now() - startedAt,
        "error",
        {
          task: "recipe_metadata_enrichment_v2",
          error_code: errorCode,
        },
        accum,
      );
      throw error;
    }
  },

  embedRecipeSearchQuery,

  embedMemoryRetrievalQuery,

  interpretRecipeSearch,

  rerankRecipeSearch,

  buildExploreForYouProfile,

  rerankExploreForYou,

  inferIngredientRelations,

  normalizePreferenceList,

  filterEquipmentPreferenceUpdates,

  extractDemandObservation,

  extractDemandIterationDelta,

  linkDemandEntities,

  summarizeDemandOutcomeReason,

  /**
   * Onboarding interview orchestration: runs the onboarding LLM scope
   * and wraps it with event logging for the "onboarding" scope label.
   */
  async runOnboardingInterview(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    prompt: string;
    context: Record<string, JsonValue>;
  }): Promise<OnboardingAssistantEnvelope> {
    const startedAt = Date.now();
    const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };

    try {
      const response = await generateOnboardingInterviewEnvelope(
        params.client,
        {
          userPrompt: params.prompt,
          context: params.context,
        },
        accum,
      );

      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "onboarding",
        Date.now() - startedAt,
        "ok",
        {
          completed: response.onboarding_state.completed,
          missing_topics: response.onboarding_state.missing_topics,
        },
        accum,
      );

      return response;
    } catch (error) {
      const errorCode = error instanceof ApiError
        ? error.code
        : "unknown_error";
      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "onboarding",
        Date.now() - startedAt,
        "error",
        {
          error_code: errorCode,
        },
        accum,
      );
      throw error;
    }
  },

  generateRecipeImage,

  generateRecipeImageDetailed,

  evaluateImageQualityPair,

  evaluateRecipeImageReuse,

  extractMemories,

  selectMemories,

  summarizeMemories,

  resolveMemoryConflicts,

  generateGreeting,

  canonicalizeRecipe,

  reviewCanonicalRecipe,

  executeRecipeCanonMatch,

  personalizeRecipe,
};
