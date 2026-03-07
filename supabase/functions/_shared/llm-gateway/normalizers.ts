/**
 * llm-gateway/normalizers.ts
 *
 * Pure normalizer functions that coerce raw LLM output into the typed
 * shapes expected by gateway callers. Every normalizer is defensive —
 * it accepts `unknown` and returns a typed result or `null`/`undefined`
 * when the input cannot be salvaged. No side-effects, no I/O.
 *
 * Covers: image evaluation results, scope classification, recipe shapes,
 * assistant replies, onboarding envelopes, candidate recipe sets,
 * response context, recipe/chat envelopes, and reply derivation.
 */

import type {
  AssistantReply,
  ChatAssistantEnvelope,
  JsonValue,
  OnboardingAssistantEnvelope,
  OnboardingState,
  RecipeAssistantEnvelope,
  RecipePayload,
} from "../types.ts";
import {
  normalizeRecipeMetadata,
  sumRecipeStepTimerSeconds,
} from "../recipe-metadata-normalization.ts";
import type {
  ClassificationResult,
  GatewayInput,
  ImageQualityEvaluationResult,
  ImageQualityWinner,
  ImageReuseDecision,
  ImageReuseEvaluationResult,
  ModelOverrideMap,
  TokenAccum,
} from "./types.ts";
import { numericToDisplayFraction } from "./config.ts";
import { ApiError } from "../errors.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { executeScope } from "../llm-executor.ts";

export const normalizeImageQualityWinner = (value: unknown): ImageQualityWinner | null => {
  if (value === "A" || value === "B" || value === "tie") {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "a") {
    return "A";
  }
  if (normalized === "b") {
    return "B";
  }
  if (normalized === "tie") {
    return "tie";
  }
  return null;
};

export const normalizeOptionalText = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

export const normalizeCandidateImageStatus = (
  value: unknown,
): "pending" | "processing" | "ready" | "failed" => {
  const normalized = normalizeOptionalText(value)?.toLowerCase();
  if (
    normalized === "pending" || normalized === "processing" ||
    normalized === "ready" || normalized === "failed"
  ) {
    return normalized;
  }
  return "pending";
};

export const normalizeImageQualityEvaluation = (
  value: unknown,
): ImageQualityEvaluationResult | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const winner = normalizeImageQualityWinner(record.winner);
  const rationale = typeof record.rationale === "string"
    ? record.rationale.trim()
    : "";
  const confidenceValue = Number(record.confidence);
  const confidence = Number.isFinite(confidenceValue)
    ? Math.max(0, Math.min(1, confidenceValue))
    : null;

  if (!winner || !rationale) {
    return null;
  }

  return {
    winner,
    rationale,
    confidence,
  };
};

export const normalizeImageReuseDecision = (
  value: unknown,
): ImageReuseDecision | null => {
  if (value === "reuse" || value === "generate_new") {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "reuse") {
    return "reuse";
  }
  if (normalized === "generate_new") {
    return "generate_new";
  }

  return null;
};

export const normalizeImageReuseEvaluation = (
  value: unknown,
  candidateIds: Set<string>,
): ImageReuseEvaluationResult | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const decision = normalizeImageReuseDecision(record.decision);
  const selectedCandidateId = normalizeOptionalText(record.selected_candidate_id) ??
    normalizeOptionalText(record.selectedCandidateId);
  const rationale = typeof record.rationale === "string"
    ? record.rationale.trim()
    : "";
  const confidenceValue = Number(record.confidence);
  const confidence = Number.isFinite(confidenceValue)
    ? Math.max(0, Math.min(1, confidenceValue))
    : null;

  if (!decision || !rationale) {
    return null;
  }

  if (decision === "reuse") {
    if (!selectedCandidateId || !candidateIds.has(selectedCandidateId)) {
      return null;
    }
  }

  return {
    decision,
    selectedCandidateId: decision === "reuse" ? selectedCandidateId : null,
    rationale,
    confidence,
  };
};

export const classifyScope = async (
  client: SupabaseClient,
  input: GatewayInput,
  overrides?: ModelOverrideMap,
  accum?: TokenAccum,
): Promise<ClassificationResult> => {
  const { result, inputTokens, outputTokens, config } = await executeScope<
    ClassificationResult
  >({
    client,
    scope: "classify",
    modelOverride: overrides?.["classify"],
    userInput: {
      task: "classify_request",
      user_prompt: input.userPrompt,
      context: input.context,
    },
  });

  if (accum) {
    accum.input += inputTokens;
    accum.output += outputTokens;
    accum.costUsd += (inputTokens * config.inputCostPer1m +
      outputTokens * config.outputCostPer1m) / 1_000_000;
  }

  if (!result.label) {
    throw new ApiError(
      422,
      "classification_failed",
      "Classification returned no label",
    );
  }

  const acceptLabelsValue = config.rule.accept_labels;
  if (!Array.isArray(acceptLabelsValue)) {
    throw new ApiError(
      500,
      "classification_rule_invalid",
      "classify rule must define accept_labels[]",
    );
  }

  const acceptLabels = acceptLabelsValue.filter((value): value is string =>
    typeof value === "string"
  );
  if (acceptLabels.length === 0) {
    throw new ApiError(
      500,
      "classification_rule_invalid",
      "classify accept_labels[] cannot be empty",
    );
  }

  return {
    ...result,
    isAllowed: acceptLabels.includes(result.label),
  };
};

export const normalizeRecipeShape = (candidate: unknown): RecipePayload | null => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const recipe = candidate as Partial<RecipePayload> & Record<string, unknown>;
  const titleCandidate = typeof recipe.title === "string"
    ? recipe.title
    : typeof recipe.name === "string"
    ? recipe.name
    : typeof recipe.recipe_name === "string"
    ? recipe.recipe_name
    : typeof recipe.dish_name === "string"
    ? recipe.dish_name
    : "";
  const normalizedTitle = titleCandidate.trim();
  const ingredientsSource = recipe.ingredients ??
    recipe.ingredient_list ??
    recipe.ingredients_by_category ??
    recipe.ingredient_groups ??
    recipe.grouped_ingredients;
  const stepsSource = recipe.steps ??
    recipe.instructions ??
    recipe.directions ??
    recipe.method ??
    recipe.preparation;

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

    const mixedFraction = raw.match(/^(\d+)\s+(\d+)\/(\d+)/);
    if (mixedFraction) {
      const whole = Number(mixedFraction[1]);
      const numerator = Number(mixedFraction[2]);
      const denominator = Number(mixedFraction[3]);
      if (
        Number.isFinite(whole) && Number.isFinite(numerator) &&
        Number.isFinite(denominator) && denominator !== 0
      ) {
        return whole + numerator / denominator;
      }
    }

    const fraction = raw.match(/^(\d+)\/(\d+)/);
    if (fraction) {
      const numerator = Number(fraction[1]);
      const denominator = Number(fraction[2]);
      if (
        Number.isFinite(numerator) && Number.isFinite(denominator) &&
        denominator !== 0
      ) {
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

  const normalizeIngredientsInput = (
    input: unknown,
  ): Array<Record<string, unknown> | string> => {
    if (Array.isArray(input)) {
      return input.filter(
        (item): item is Record<string, unknown> | string =>
          typeof item === "string" ||
          (Boolean(item) && typeof item === "object" && !Array.isArray(item)),
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
          if (typeof row === "string") {
            flattened.push({ name: row, category });
            continue;
          }

          if (!row || typeof row !== "object" || Array.isArray(row)) {
            continue;
          }

          const withCategory = row as Record<string, unknown>;
          if (
            typeof withCategory.category !== "string" ||
            withCategory.category.trim().length === 0
          ) {
            flattened.push({ ...withCategory, category });
          } else {
            flattened.push(withCategory);
          }
        }
      }
    }

    return flattened;
  };

  const normalizeStepsInput = (
    input: unknown,
  ): Array<Record<string, unknown> | string> => {
    if (typeof input === "string") {
      return input
        .split(/\n+/)
        .map((row) => row.trim())
        .filter((row) => row.length > 0);
    }

    if (Array.isArray(input)) {
      return input.filter((item): item is Record<string, unknown> | string =>
        typeof item === "string" ||
        (Boolean(item) && typeof item === "object" && !Array.isArray(item))
      );
    }

    if (input && typeof input === "object" && !Array.isArray(input)) {
      return Object.values(input).filter((
        item,
      ): item is Record<string, unknown> | string =>
        typeof item === "string" ||
        (Boolean(item) && typeof item === "object" && !Array.isArray(item))
      );
    }

    return [];
  };

  const parseServings = (value: unknown): number | null => {
    if (Number.isFinite(Number(value))) {
      const numeric = Number(value);
      if (numeric >= 1) {
        return numeric;
      }
    }

    if (typeof value === "string") {
      const match = value.match(/(\d+(?:\.\d+)?)/);
      if (match) {
        const parsed = Number(match[1]);
        if (Number.isFinite(parsed) && parsed >= 1) {
          return parsed;
        }
      }
    }

    return null;
  };

  const servings = parseServings(recipe.servings) ??
    parseServings(recipe.serves) ??
    parseServings(recipe.yield) ??
    2;

  if (
    !normalizedTitle ||
    (!Array.isArray(ingredientsSource) &&
      (!ingredientsSource || typeof ingredientsSource !== "object")) ||
    (!Array.isArray(stepsSource) &&
      (!stepsSource || typeof stepsSource !== "object") &&
      typeof stepsSource !== "string")
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
        };
      }

      const nameCandidate = typeof ingredient.name === "string"
        ? ingredient.name
        : typeof ingredient.ingredient === "string"
        ? ingredient.ingredient
        : "";
      const name = nameCandidate.trim();
      const amountCandidate = ingredient.amount ??
        ingredient.quantity ??
        ingredient.qty ??
        ingredient.value;
      const amount = parseNumericAmount(amountCandidate);
      const unitCandidate = typeof ingredient.unit === "string"
        ? ingredient.unit
        : typeof ingredient.units === "string"
        ? ingredient.units
        : "";
      const unit = unitCandidate.trim();
      const quantityText = typeof ingredient.quantity === "string"
        ? ingredient.quantity.trim()
        : "";
      const fallbackAmount = parseNumericAmount(quantityText);
      const fallbackUnit = parseUnitFromQuantity(quantityText);

      if (!name) {
        return null;
      }

      const displayAmount = typeof ingredient.display_amount === "string" &&
          ingredient.display_amount.trim().length > 0
        ? ingredient.display_amount.trim()
        : numericToDisplayFraction(amount ?? fallbackAmount ?? 1);
      const preparation = typeof ingredient.preparation === "string" &&
          ingredient.preparation.trim().length > 0
        ? ingredient.preparation.trim()
        : null;
      const category = typeof ingredient.category === "string" &&
          ingredient.category.trim().length > 0
        ? ingredient.category.trim()
        : null;

      return {
        name,
        amount: amount ?? fallbackAmount ?? 1,
        unit: unit || fallbackUnit || "unit",
        ...(displayAmount ? { display_amount: displayAmount } : {}),
        ...(preparation ? { preparation } : {}),
        ...(category ? { category } : {}),
      };
    })
    .filter((ingredient): ingredient is RecipePayload["ingredients"][number] =>
      ingredient !== null
    );

  const steps = normalizeStepsInput(stepsSource)
    .map((step, stepIndex) => {
      if (typeof step === "string") {
        const instruction = step.trim();
        if (!instruction) {
          return null;
        }

        return {
          index: stepIndex + 1,
          instruction,
        };
      }

      const index = Number(
        step.index ?? step.step ?? step.step_number ?? (stepIndex + 1),
      );
      const instructionCandidate = typeof step.instruction === "string"
        ? step.instruction
        : typeof step.text === "string"
        ? step.text
        : typeof step.description === "string"
        ? step.description
        : typeof step.content === "string"
        ? step.content
        : typeof step.action === "string"
        ? step.action
        : typeof step.method === "string"
        ? step.method
        : typeof step.step === "string"
        ? step.step
        : typeof step.title === "string"
        ? step.title
        : "";
      const instruction = instructionCandidate.trim();
      if (!Number.isFinite(index) || index < 1 || !instruction) {
        return null;
      }

      const rawInlineMeasurements = Array.isArray(step.inline_measurements)
        ? step.inline_measurements
        : Array.isArray(step.inlineMeasurements)
        ? step.inlineMeasurements
        : null;

      return {
        index,
        instruction,
        timer_seconds: Number.isFinite(Number(step.timer_seconds ?? step.timer))
          ? Number(step.timer_seconds ?? step.timer)
          : undefined,
        notes: typeof step.notes === "string" && step.notes.trim().length > 0
          ? step.notes.trim()
          : undefined,
        inline_measurements: rawInlineMeasurements
          ? rawInlineMeasurements
            .map((measurement: unknown) => {
              const record = measurement as Record<string, unknown>;
              const ingredient = typeof record.ingredient === "string"
                ? record.ingredient.trim()
                : "";
              const amount = Number(record.amount);
              const unit = typeof record.unit === "string"
                ? record.unit.trim()
                : "";
              if (!ingredient || !Number.isFinite(amount) || !unit) {
                return null;
              }
              return {
                ingredient,
                amount,
                unit,
              };
            })
            .filter(
              (
                measurement,
              ): measurement is NonNullable<
                RecipePayload["steps"][number]["inline_measurements"]
              >[number] => measurement !== null,
            )
          : undefined,
      };
    })
    .filter((step): step is RecipePayload["steps"][number] => step !== null);

  const normalizedSteps = [...steps]
    .sort((a, b) => a.index - b.index)
    .map((step, index) => ({
      ...step,
      index: index + 1,
    }));

  if (ingredients.length === 0 || normalizedSteps.length === 0) {
    return null;
  }

  const attachments = Array.isArray(recipe.attachments)
    ? recipe.attachments
      .map((attachment) => {
        const title = typeof attachment.title === "string"
          ? attachment.title.trim()
          : "";
        const relationType = typeof attachment.relation_type === "string"
          ? attachment.relation_type.trim()
          : "";
        const nestedRecipe = normalizeRecipeShape(attachment.recipe);

        if (!title || !relationType || !nestedRecipe) {
          return null;
        }

        const nestedWithoutAttachments = { ...nestedRecipe } as Record<
          string,
          JsonValue
        >;
        delete nestedWithoutAttachments.attachments;

        return {
          title,
          relation_type: relationType,
          recipe: nestedWithoutAttachments as Omit<
            RecipePayload,
            "attachments"
          >,
        };
      })
      .filter((
        attachment,
      ): attachment is NonNullable<RecipePayload["attachments"]>[number] =>
        attachment !== null
      )
    : undefined;

  // Build metadata, synthesizing timing from top-level fields if needed
  let metadata: Record<string, JsonValue> | undefined =
    recipe.metadata && typeof recipe.metadata === "object" &&
      !Array.isArray(recipe.metadata)
      ? (recipe.metadata as Record<string, JsonValue>)
      : undefined;

  // Extract top-level timing fields into metadata.timing if not already present
  const prepMin = Number(
    recipe.prep_time_minutes ?? recipe.prepMinutes ?? recipe.prep_minutes,
  );
  const cookMin = Number(
    recipe.cook_time_minutes ?? recipe.cookMinutes ?? recipe.cook_minutes,
  );
  const totalMin = Number(
    recipe.total_time_minutes ?? recipe.totalMinutes ?? recipe.total_minutes,
  );
  const hasTopLevelTiming = Number.isFinite(prepMin) ||
    Number.isFinite(cookMin) || Number.isFinite(totalMin);
  if (hasTopLevelTiming && (!metadata || !metadata.timing)) {
    metadata = metadata ?? {};
    metadata.timing = {
      ...(Number.isFinite(prepMin) ? { prep_minutes: prepMin } : {}),
      ...(Number.isFinite(cookMin) ? { cook_minutes: cookMin } : {}),
      ...(Number.isFinite(totalMin)
        ? { total_minutes: totalMin }
        : (Number.isFinite(prepMin) && Number.isFinite(cookMin)
          ? { total_minutes: prepMin + cookMin }
          : {})),
    };
  }

  const { metadata: normalizedMetadata, issues } = normalizeRecipeMetadata({
    metadata,
    ingredientCount: ingredients.length,
    stepTimerSecondsTotal: sumRecipeStepTimerSeconds(normalizedSteps),
    requireModelSignals: true,
  });
  if (issues.length > 0) {
    return null;
  }
  metadata = normalizedMetadata;

  return {
    title: normalizedTitle,
    summary: typeof recipe.summary === "string"
      ? recipe.summary.trim()
      : undefined,
    description: typeof recipe.description === "string"
      ? recipe.description.trim()
      : undefined,
    servings,
    ingredients,
    steps: normalizedSteps,
    notes: typeof recipe.notes === "string" ? recipe.notes.trim() : undefined,
    pairings: Array.isArray(recipe.pairings)
      ? recipe.pairings.filter((item): item is string =>
        typeof item === "string"
      )
      : [],
    emoji: Array.isArray(recipe.emoji)
      ? recipe.emoji.filter((item): item is string => typeof item === "string")
      : [],
    metadata,
    attachments,
  };
};

export const normalizeAssistantReply = (candidate: unknown): AssistantReply | null => {
  const parseJsonRecordFromText = (
    text: string,
  ): Record<string, unknown> | null => {
    const trimmed = text.trim();
    if (!trimmed) {
      return null;
    }

    const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    const normalized = fencedMatch?.[1]?.trim() ?? trimmed;
    if (!normalized) {
      return null;
    }

    try {
      const parsed = JSON.parse(normalized) as unknown;
      if (
        parsed && typeof parsed === "object" &&
        !Array.isArray(parsed)
      ) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through
    }
    return null;
  };

  const looksLikeStructuredPayload = (text: string): boolean => {
    const trimmed = text.trim();
    if (!trimmed) {
      return false;
    }
    return trimmed.startsWith("{") || trimmed.startsWith("[") ||
      trimmed.startsWith("```") || trimmed.includes("\"assistant_reply\"") ||
      trimmed.includes("\"candidate_recipe_set\"");
  };

  const extractAssistantReplyText = (
    value: unknown,
    depth = 0,
  ): string | null => {
    if (depth > 4 || value === null || typeof value === "undefined") {
      return null;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }
      const parsed = parseJsonRecordFromText(trimmed);
      if (parsed) {
        return extractAssistantReplyText(parsed, depth + 1);
      }
      return looksLikeStructuredPayload(trimmed) ? null : trimmed;
    }

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const record = value as Record<string, unknown>;
    const nestedData = record.data && typeof record.data === "object" &&
        !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : undefined;
    const nestedResult = record.result && typeof record.result === "object" &&
        !Array.isArray(record.result)
      ? (record.result as Record<string, unknown>)
      : undefined;

    const candidates: unknown[] = [
      record.assistant_reply,
      record.assistantReply,
      record.assistant,
      record.reply,
      nestedData?.assistant_reply,
      nestedData?.assistantReply,
      nestedData?.assistant,
      nestedResult?.assistant_reply,
      nestedResult?.assistantReply,
      nestedResult?.assistant,
      record.text,
    ];

    for (const candidateValue of candidates) {
      const extracted = extractAssistantReplyText(candidateValue, depth + 1);
      if (extracted) {
        return extracted;
      }
    }

    return null;
  };

  const normalizedText = extractAssistantReplyText(candidate);
  if (normalizedText) {
    if (typeof candidate === "string") {
      return { text: normalizedText };
    }
  } else if (typeof candidate === "string") {
    return null;
  }

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const reply = candidate as Partial<AssistantReply>;
  if (typeof reply.text !== "string") {
    return null;
  }

  const safeText = extractAssistantReplyText(reply.text);
  if (!safeText) {
    return null;
  }

  return {
    text: safeText,
    tone: typeof reply.tone === "string" && reply.tone.trim().length > 0
      ? reply.tone.trim()
      : undefined,
    focus_summary: typeof reply.focus_summary === "string" &&
        reply.focus_summary.trim().length > 0
      ? reply.focus_summary.trim()
      : undefined,
    emoji: Array.isArray(reply.emoji)
      ? reply.emoji.filter((item): item is string => typeof item === "string")
      : undefined,
    suggested_next_actions: Array.isArray(reply.suggested_next_actions)
      ? reply.suggested_next_actions.filter((item): item is string =>
        typeof item === "string"
      )
      : undefined,
  };
};

export const normalizeOnboardingState = (
  candidate: unknown,
): OnboardingState | null => {
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
  const progress = Number.isFinite(progressValue)
    ? Math.max(0, Math.min(1, progressValue))
    : completed
    ? 1
    : 0;

  const missingTopics = Array.isArray(state.missing_topics)
    ? state.missing_topics.filter((topic): topic is string =>
      typeof topic === "string" && topic.trim().length > 0
    )
    : [];

  const nestedState = state.state && typeof state.state === "object" &&
      !Array.isArray(state.state)
    ? (state.state as Record<string, JsonValue>)
    : {};

  return {
    completed,
    progress,
    missing_topics: missingTopics,
    state: nestedState,
  };
};

export const normalizeOnboardingEnvelope = (
  candidate: unknown,
): OnboardingAssistantEnvelope | null => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const payload = candidate as Record<string, unknown>;
  const nestedAssistantReply = payload.assistant_reply ??
    ((payload.data as Record<string, unknown> | undefined)
      ?.assistant_reply as unknown) ??
    ((payload.result as Record<string, unknown> | undefined)
      ?.assistant_reply as unknown) ??
    (payload.assistant as unknown);

  const nestedOnboardingState = payload.onboarding_state ??
    ((payload.data as Record<string, unknown> | undefined)
      ?.onboarding_state as unknown) ??
    ((payload.result as Record<string, unknown> | undefined)
      ?.onboarding_state as unknown);

  const assistantReply = normalizeAssistantReply(nestedAssistantReply);
  const onboardingState = normalizeOnboardingState(nestedOnboardingState);
  if (!assistantReply || !onboardingState) {
    return null;
  }

  const preferenceUpdates = payload.preference_updates &&
      typeof payload.preference_updates === "object" &&
      !Array.isArray(payload.preference_updates)
    ? (payload.preference_updates as Record<string, JsonValue>)
    : payload.response_context &&
        typeof payload.response_context === "object" &&
        !Array.isArray(payload.response_context) &&
        typeof (payload.response_context as Record<string, unknown>)
            .preference_updates === "object" &&
        !Array.isArray(
          (payload.response_context as Record<string, unknown>)
            .preference_updates,
        )
    ? ((payload.response_context as Record<string, unknown>)
      .preference_updates as Record<string, JsonValue>)
    : undefined;

  return {
    assistant_reply: assistantReply,
    onboarding_state: onboardingState,
    preference_updates: preferenceUpdates,
  };
};

export const normalizeCandidateRecipeSet = (
  candidate: unknown,
): ChatAssistantEnvelope["candidate_recipe_set"] | undefined => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return undefined;
  }

  const raw = candidate as Record<string, unknown>;
  const rawComponents = Array.isArray(raw.components) ? raw.components : [];
  const components = rawComponents
    .map((component) => {
      if (
        !component || typeof component !== "object" || Array.isArray(component)
      ) {
        return null;
      }
      const value = component as Record<string, unknown>;
      const nestedRecipe = value.recipe ??
        value.recipe_payload ??
        value.recipePayload ??
        ((value.data as Record<string, unknown> | undefined)
          ?.recipe as unknown) ??
        ((value.result as Record<string, unknown> | undefined)
          ?.recipe as unknown) ??
        value;
      const recipe = normalizeRecipeShape(nestedRecipe);
      if (!recipe) {
        return null;
      }

      const role = typeof value.role === "string"
        ? value.role.trim().toLowerCase()
        : "main";
      const normalizedRole =
        role === "main" || role === "side" || role === "appetizer" ||
          role === "dessert" || role === "drink"
          ? role
          : "main";

      return {
        component_id: typeof value.component_id === "string" &&
            value.component_id.trim().length > 0
          ? value.component_id.trim()
          : crypto.randomUUID(),
        role: normalizedRole,
        title: typeof value.title === "string" && value.title.trim().length > 0
          ? value.title.trim()
          : recipe.title,
        image_url: normalizeOptionalText(value.image_url),
        image_status: normalizeCandidateImageStatus(value.image_status),
        recipe,
      };
    })
    .filter((
      component,
    ): component is NonNullable<
      ChatAssistantEnvelope["candidate_recipe_set"]
    >["components"][number] => Boolean(component))
    .slice(0, 3);

  if (components.length === 0) {
    return undefined;
  }

  const activeComponentId = typeof raw.active_component_id === "string" &&
      components.some((component) =>
        component.component_id === raw.active_component_id
      )
    ? raw.active_component_id
    : components[0].component_id;

  const revision = Number(raw.revision);

  return {
    candidate_id:
      typeof raw.candidate_id === "string" && raw.candidate_id.trim().length > 0
        ? raw.candidate_id.trim()
        : crypto.randomUUID(),
    revision: Number.isFinite(revision) && revision >= 1
      ? Math.trunc(revision)
      : 1,
    active_component_id: activeComponentId,
    components,
  };
};

export const normalizeCandidateRecipeSetFromPayload = (
  payload: Record<string, unknown>,
): ChatAssistantEnvelope["candidate_recipe_set"] | undefined => {
  const nestedData = payload.data && typeof payload.data === "object" &&
      !Array.isArray(payload.data)
    ? (payload.data as Record<string, unknown>)
    : undefined;
  const nestedResult = payload.result && typeof payload.result === "object" &&
      !Array.isArray(payload.result)
    ? (payload.result as Record<string, unknown>)
    : undefined;

  const directCandidates: unknown[] = [
    payload.candidate_recipe_set,
    payload.candidate_set,
    payload.recipe_set,
    payload.candidate,
    nestedData?.candidate_recipe_set,
    nestedData?.candidate_set,
    nestedResult?.candidate_recipe_set,
    nestedResult?.candidate_set,
  ];

  for (const candidate of directCandidates) {
    const normalized = normalizeCandidateRecipeSet(candidate);
    if (normalized) {
      return normalized;
    }
  }

  const fromComponents = Array.isArray(payload.components)
    ? normalizeCandidateRecipeSet({
      candidate_id: payload.candidate_id,
      revision: payload.revision,
      active_component_id: payload.active_component_id,
      components: payload.components,
    })
    : undefined;
  if (fromComponents) {
    return fromComponents;
  }

  const recipeList = Array.isArray(payload.recipes) ? payload.recipes : null;
  if (recipeList && recipeList.length > 0) {
    const components = recipeList.map((recipe, index) => ({
      component_id: crypto.randomUUID(),
      role: index === 0 ? "main" : "side",
      title: typeof (recipe as Record<string, unknown>).title === "string"
        ? (recipe as Record<string, unknown>).title
        : `Recipe ${index + 1}`,
      recipe,
    }));
    const normalized = normalizeCandidateRecipeSet({
      candidate_id: payload.candidate_id,
      revision: payload.revision,
      active_component_id: payload.active_component_id,
      components,
    });
    if (normalized) {
      return normalized;
    }
  }

  return undefined;
};

export const normalizeResponseContext = (
  candidate: unknown,
): RecipeAssistantEnvelope["response_context"] | undefined => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return undefined;
  }

  const contextObject = candidate as Record<string, unknown>;
  const preferenceUpdates = contextObject.preference_updates &&
      typeof contextObject.preference_updates === "object" &&
      !Array.isArray(contextObject.preference_updates)
    ? (contextObject.preference_updates as Record<string, JsonValue>)
    : undefined;
  const intent = typeof contextObject.intent === "string"
    ? contextObject.intent
    : undefined;
  const normalizedIntent = intent === "in_scope_ideation" ||
      intent === "in_scope_generate" || intent === "out_of_scope"
    ? intent
    : undefined;
  const rawPreferenceConflict = contextObject.preference_conflict &&
      typeof contextObject.preference_conflict === "object" &&
      !Array.isArray(contextObject.preference_conflict)
    ? (contextObject.preference_conflict as Record<string, unknown>)
    : undefined;
  const preferenceConflictStatus =
    rawPreferenceConflict && typeof rawPreferenceConflict.status === "string" &&
        (
          rawPreferenceConflict.status === "pending_confirmation" ||
          rawPreferenceConflict.status === "adapt" ||
          rawPreferenceConflict.status === "override" ||
          rawPreferenceConflict.status === "cleared"
        )
      ? rawPreferenceConflict.status
      : undefined;

  return {
    mode: typeof contextObject.mode === "string"
      ? contextObject.mode
      : undefined,
    intent: normalizedIntent,
    changed_sections: Array.isArray(contextObject.changed_sections)
      ? contextObject.changed_sections.filter((item): item is string =>
        typeof item === "string"
      )
      : undefined,
    personalization_notes: Array.isArray(contextObject.personalization_notes)
      ? contextObject.personalization_notes.filter((item): item is string =>
        typeof item === "string"
      )
      : undefined,
    preference_updates: preferenceUpdates,
    preference_conflict: preferenceConflictStatus || rawPreferenceConflict
      ? {
        status: preferenceConflictStatus,
        conflicting_preferences: Array.isArray(
            rawPreferenceConflict?.conflicting_preferences,
          )
          ? rawPreferenceConflict.conflicting_preferences.filter(
            (item): item is string => typeof item === "string",
          )
          : undefined,
        conflicting_aversions: Array.isArray(
            rawPreferenceConflict?.conflicting_aversions,
          )
          ? rawPreferenceConflict.conflicting_aversions.filter(
            (item): item is string => typeof item === "string",
          )
          : undefined,
        requested_terms: Array.isArray(rawPreferenceConflict?.requested_terms)
          ? rawPreferenceConflict.requested_terms.filter((item): item is string =>
            typeof item === "string"
          )
          : undefined,
      }
      : undefined,
  };
};

export const normalizeRecipeEnvelope = (
  candidate: unknown,
): RecipeAssistantEnvelope | null => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const payload = candidate as Record<string, unknown>;
  const nestedRecipe = (payload.recipe as unknown) ??
    (payload.recipe_payload as unknown) ??
    (payload.recipePayload as unknown) ??
    ((payload.data as Record<string, unknown> | undefined)
      ?.recipe as unknown) ??
    ((payload.result as Record<string, unknown> | undefined)
      ?.recipe as unknown);
  const candidateRecipeSet = normalizeCandidateRecipeSetFromPayload(payload);
  const candidateMainRecipe = candidateRecipeSet?.components.find((component) =>
      component.role === "main"
    )?.recipe ??
    candidateRecipeSet?.components[0]?.recipe ??
    null;
  const nestedAssistantReply = payload.assistant_reply ??
    payload.assistantReply ??
    ((payload.data as Record<string, unknown> | undefined)
      ?.assistant_reply as unknown) ??
    ((payload.data as Record<string, unknown> | undefined)
      ?.assistantReply as unknown) ??
    ((payload.result as Record<string, unknown> | undefined)
      ?.assistant_reply as unknown) ??
    ((payload.result as Record<string, unknown> | undefined)
      ?.assistantReply as unknown) ??
    (payload.assistant as unknown);
  const nestedResponseContext = payload.response_context ??
    payload.responseContext ??
    ((payload.data as Record<string, unknown> | undefined)
      ?.response_context as unknown) ??
    ((payload.data as Record<string, unknown> | undefined)
      ?.responseContext as unknown) ??
    ((payload.result as Record<string, unknown> | undefined)
      ?.response_context as unknown);

  const recipe = normalizeRecipeShape(nestedRecipe ?? candidateMainRecipe ?? payload);
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
    response_context: responseContext,
  };
};

export const normalizeChatEnvelope = (
  candidate: unknown,
): ChatAssistantEnvelope | null => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const payload = candidate as Record<string, unknown>;
  const nestedRecipe = payload.recipe ??
    ((payload.data as Record<string, unknown> | undefined)
      ?.recipe as unknown) ??
    ((payload.result as Record<string, unknown> | undefined)
      ?.recipe as unknown);

  const recipe = normalizeRecipeShape(nestedRecipe);
  const candidateRecipeSet = normalizeCandidateRecipeSetFromPayload(payload);
  const nestedAssistantReply = payload.assistant_reply ??
    ((payload.data as Record<string, unknown> | undefined)
      ?.assistant_reply as unknown) ??
    ((payload.result as Record<string, unknown> | undefined)
      ?.assistant_reply as unknown) ??
    payload.assistant;

  const deriveFallbackReply = (candidateRecipe: RecipePayload | null):
    | AssistantReply
    | null => {
    if (!candidateRecipe) {
      return null;
    }
    const textCandidate = [
      candidateRecipe.notes,
      candidateRecipe.description,
      candidateRecipe.title,
    ].find((value): value is string =>
      typeof value === "string" && value.trim().length > 0
    );
    return textCandidate ? { text: textCandidate.trim() } : null;
  };

  const derivedReply = deriveFallbackReply(recipe) ??
    deriveFallbackReply(candidateRecipeSet?.components?.[0]?.recipe ?? null);
  const assistantReply = normalizeAssistantReply(
    nestedAssistantReply ?? payload,
  ) ?? derivedReply;
  if (!assistantReply) {
    return null;
  }

  const triggerRecipe = typeof payload.trigger_recipe === "boolean"
    ? payload.trigger_recipe
    : undefined;

  const nestedResponseContext = payload.response_context ??
    ((payload.data as Record<string, unknown> | undefined)
      ?.response_context as unknown) ??
    ((payload.result as Record<string, unknown> | undefined)
      ?.response_context as unknown);

  return {
    assistant_reply: assistantReply,
    recipe: recipe ?? undefined,
    trigger_recipe: triggerRecipe,
    candidate_recipe_set: candidateRecipeSet,
    response_context: normalizeResponseContext(nestedResponseContext),
  };
};

export const deriveAssistantReplyFromRecipe = (
  recipe: RecipePayload,
): AssistantReply | null => {
  const textCandidates = [recipe.notes, recipe.summary, recipe.title]
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    );

  if (textCandidates.length === 0) {
    return null;
  }

  return {
    text: textCandidates[0].trim(),
  };
};
