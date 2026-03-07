import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  normalizeDelimitedToken,
} from "../../../packages/shared/src/text-normalization.ts";
import { ApiError } from "./errors.ts";
import {
  executeEmbeddingScope,
  executeImageWithConfig,
  executeScope,
  executeVisionScope,
  executeWithConfig,
  getActiveConfig as loadActiveConfig,
  type ModelOverrideMap as ExecutorModelOverrideMap,
} from "./llm-executor.ts";
import { estimateImageGenerationCostUsd } from "./image-billing.ts";
import {
  normalizeRecipeMetadata,
  sumRecipeStepTimerSeconds,
} from "./recipe-metadata-normalization.ts";
import type {
  AssistantReply,
  ChatAssistantEnvelope,
  GatewayConfig,
  GatewayScope,
  JsonValue,
  MemoryRecord,
  OnboardingAssistantEnvelope,
  OnboardingState,
  RecipeAssistantEnvelope,
  RecipePayload,
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

type IngredientAliasNormalization = {
  alias_key: string;
  canonical_name: string;
  confidence: number;
};

type IngredientPhraseSplit = {
  source_name: string;
  items: Array<{
    name: string;
    confidence: number;
  }>;
};

type IngredientLineMention = {
  name: string;
  role: "primary" | "optional" | "alternative" | "garnish" | "unspecified";
  alternative_group_key: string | null;
  confidence: number;
};

type IngredientLineQualifier = {
  term_type:
    | "preparation"
    | "state"
    | "quality"
    | "size"
    | "purpose"
    | "temperature"
    | "treatment";
  term_key: string;
  label: string;
  relation_type:
    | "prepared_as"
    | "has_state"
    | "has_quality"
    | "has_size"
    | "has_purpose"
    | "has_temperature"
    | "has_treatment";
  target: "line" | number;
  confidence: number;
};

type IngredientLineParse = {
  source_name: string;
  line_confidence: number;
  mentions: IngredientLineMention[];
  qualifiers: IngredientLineQualifier[];
};

type OntologySuggestion = {
  term_type: string;
  term_key: string;
  label: string;
  relation_type: string;
  confidence: number;
};

type IngredientSemanticEnrichment = {
  canonical_name: string;
  confidence: number;
  metadata: Record<string, JsonValue>;
  ontology_terms: OntologySuggestion[];
};

type RecipeSemanticEnrichment = {
  confidence: number;
  metadata: Record<string, JsonValue>;
};

type RecipeSearchEmbedding = {
  vector: number[];
  dimensions: number;
  provider: string;
  model: string;
};

type RecipeSearchInterpretationEnvelope = {
  normalized_query?: unknown;
  applied_context?: unknown;
  hard_filters?: unknown;
  soft_targets?: unknown;
  exclusions?: unknown;
  sort_bias?: unknown;
  query_style?: unknown;
};

type RecipeSearchRerankEnvelope = {
  ordered_recipe_ids?: unknown;
  rationale_tags_by_recipe?: unknown;
};

type IngredientSemanticRelation = {
  from_canonical_name: string;
  to_canonical_name: string;
  relation_type: string;
  confidence: number;
  rationale?: string;
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

export type ModelOverrideMap = ExecutorModelOverrideMap;

/** Output from llmGateway.personalizeRecipe — the materialised variant. */
export type PersonalizeRecipeResult = {
  recipe: RecipePayload;
  adaptationSummary: string;
  appliedAdaptations: JsonValue[];
  tagDiff: { added: string[]; removed: string[] };
};

type TokenAccum = { input: number; output: number; costUsd: number };

type ImageQualityWinner = "A" | "B" | "tie";

type ImageQualityEvaluationResult = {
  winner: ImageQualityWinner;
  rationale: string;
  confidence: number | null;
};

type ImageReuseDecision = "reuse" | "generate_new";

type ImageReuseEvaluationResult = {
  decision: ImageReuseDecision;
  selectedCandidateId: string | null;
  rationale: string;
  confidence: number | null;
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

type ChatConversationScope =
  | "chat_ideation"
  | "chat_generation"
  | "chat_iteration";

const DEFAULT_OUT_OF_SCOPE_FALLBACK_TEXT =
  "I’m here to help with recipes. What are you in the mood for?";

const defaultChatPromptForScope = (
  scope: ChatConversationScope,
): string => {
  if (scope === "chat_generation") {
    return `You are Alchemy. Generate candidate recipes from conversation context.
If an unresolved dietary restriction or aversion conflicts with the user's explicit dish request, ask for confirmation before generating.
When asking for confirmation, set response_context.mode to "preference_conflict", trigger_recipe=false, and return no recipe or candidate_recipe_set.
When you do generate, every recipe must include metadata.difficulty, metadata.health_score, metadata.time_minutes, metadata.items, metadata.timing.total_minutes, and metadata.quick_stats.
Return one strict JSON object that matches the provided contract.
Do not use markdown or code fences.`;
  }

  if (scope === "chat_iteration") {
    return `You are Alchemy. Update existing candidate recipes from the latest conversation turn.
If an unresolved dietary restriction or aversion conflicts with the user's explicit ingredient or dish request, ask for confirmation before changing the recipe.
When asking for confirmation, set response_context.mode to "preference_conflict", trigger_recipe=false, and return no new recipe or candidate_recipe_set.
When you do return updated recipes, preserve the requested dish anchor and include canonical metadata quick stats on every recipe.
Return one strict JSON object that matches the provided contract.
Do not use markdown or code fences.`;
  }

  return `You are Alchemy in recipe chat ideation mode.
If the user asks for a recipe or names a concrete dish to cook, set intent to "in_scope_generate" and trigger_recipe=true immediately.
If the user explicitly requests a dish or ingredient that conflicts with dietary_restrictions or aversions, ask for confirmation before generating.
In that conflict case, set response_context.mode to "preference_conflict", trigger_recipe=false, return no recipe or candidate_recipe_set, and use assistant_reply.suggested_next_actions for the obvious choices.
Avoid unnecessary clarifying questions when the request is already actionable.
Return one strict JSON object that matches the provided contract.
Do not use markdown or code fences.`;
};

const defaultChatRuleForScope = (
  scope: ChatConversationScope,
): Record<string, JsonValue> => {
  if (scope === "chat_generation") {
    return {
      response_contract: "chat_generation_v1",
      strict_json_only: true,
    };
  }

  if (scope === "chat_iteration") {
    return {
      response_contract: "chat_iteration_v1",
      strict_json_only: true,
    };
  }

  return {
    response_contract: "chat_ideation_v1",
    strict_json_only: true,
  };
};

const getActiveConfig = async (
  client: SupabaseClient,
  scope: GatewayScope,
  modelOverride?: { provider: string; model: string },
): Promise<GatewayConfig> => {
  return await loadActiveConfig(client, scope, modelOverride);
};


type ProviderResult<T> = {
  result: T;
  inputTokens: number;
  outputTokens: number;
};

const callProvider = async <T>(params: {
  provider: string;
  model: string;
  modelConfig: Record<string, JsonValue>;
  systemPrompt: string;
  userInput: Record<string, JsonValue>;
}): Promise<ProviderResult<T>> => {
  return await executeWithConfig<T>({
    provider: params.provider,
    model: params.model,
    modelConfig: params.modelConfig,
    systemPrompt: params.systemPrompt,
    userInput: params.userInput,
  });
};

const callImageProvider = async (params: {
  provider: string;
  model: string;
  modelConfig: Record<string, JsonValue>;
  prompt: string;
}): Promise<string> => {
  return await executeImageWithConfig({
    provider: params.provider,
    model: params.model,
    modelConfig: params.modelConfig,
    prompt: params.prompt,
  });
};

const buildRecipeImagePrompt = (params: {
  config: GatewayConfig;
  recipe: RecipePayload;
  context: Record<string, JsonValue>;
}): string => {
  return `${params.config.promptTemplate}\n\n${
    JSON.stringify({
      rule: params.config.rule,
      recipe: params.recipe,
      context: params.context,
    })
  }`;
};

const normalizeImageQualityWinner = (value: unknown): ImageQualityWinner | null => {
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

const normalizeOptionalText = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const normalizeCandidateImageStatus = (
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

const normalizeImageQualityEvaluation = (
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

const normalizeImageReuseDecision = (
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

const normalizeImageReuseEvaluation = (
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

const classifyScope = async (
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

const LEGACY_MODEL_CONFIG_KEYS = [
  "token_budget",
  "ingredient_budget",
  "max_ingredients",
  "max_steps",
] as const;

const cleanLegacyModelConfig = (
  modelConfig: Record<string, JsonValue>,
): Record<string, JsonValue> => {
  const cleaned: Record<string, JsonValue> = { ...modelConfig };
  for (const key of LEGACY_MODEL_CONFIG_KEYS) {
    delete cleaned[key];
  }
  return cleaned;
};

const numericToDisplayFraction = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return "1";
  const whole = Math.floor(value);
  const frac = value - whole;
  const fractionMap: Array<[number, string]> = [
    [0, ""], [1 / 8, "1/8"], [1 / 6, "1/6"], [1 / 4, "1/4"], [1 / 3, "1/3"],
    [3 / 8, "3/8"], [1 / 2, "1/2"], [5 / 8, "5/8"], [2 / 3, "2/3"],
    [3 / 4, "3/4"], [5 / 6, "5/6"], [7 / 8, "7/8"],
  ];
  let closest = fractionMap[0];
  let minDist = Infinity;
  for (const entry of fractionMap) {
    const dist = Math.abs(frac - entry[0]);
    if (dist < minDist) { minDist = dist; closest = entry; }
  }
  if (!closest[1]) return whole > 0 ? String(whole) : "1";
  return whole > 0 ? `${whole} ${closest[1]}` : closest[1];
};

const normalizeRecipeShape = (candidate: unknown): RecipePayload | null => {
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

const normalizeAssistantReply = (candidate: unknown): AssistantReply | null => {
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

const normalizeOnboardingState = (
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

const normalizeOnboardingEnvelope = (
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

const normalizeCandidateRecipeSet = (
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

const normalizeCandidateRecipeSetFromPayload = (
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

const normalizeResponseContext = (
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

const normalizeRecipeEnvelope = (
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

const normalizeChatEnvelope = (
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

const deriveAssistantReplyFromRecipe = (
  recipe: RecipePayload,
): AssistantReply | null => {
  const textCandidates = [recipe.notes, recipe.description, recipe.title]
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

const composeAssistantReply = async (params: {
  config: GatewayConfig;
  prompt: string;
  context: Record<string, JsonValue>;
  recipe: RecipePayload;
  accum?: TokenAccum;
}): Promise<AssistantReply | null> => {
  const { result: synthesized, inputTokens, outputTokens } = await callProvider<
    Record<string, JsonValue>
  >({
    provider: params.config.provider,
    model: params.config.model,
    modelConfig: params.config.modelConfig,
    systemPrompt: params.config.promptTemplate,
    userInput: {
      task: "compose_assistant_reply",
      rule: params.config.rule,
      prompt: params.prompt,
      context: params.context,
      recipe: params.recipe as unknown as JsonValue,
    },
  });

  if (params.accum) {
    params.accum.input += inputTokens;
    params.accum.output += outputTokens;
    params.accum.costUsd += (inputTokens * params.config.inputCostPer1m +
      outputTokens * params.config.outputCostPer1m) / 1_000_000;
  }

  return normalizeAssistantReply(synthesized.assistant_reply ?? synthesized);
};

const addTokens = (
  accum: TokenAccum,
  inputTokens: number,
  outputTokens: number,
  config: GatewayConfig,
): void => {
  accum.input += inputTokens;
  accum.output += outputTokens;
  accum.costUsd += (inputTokens * config.inputCostPer1m +
    outputTokens * config.outputCostPer1m) / 1_000_000;
};

const generateRecipePayload = async (
  client: SupabaseClient,
  scope: Extract<GatewayScope, "generate">,
  input: GatewayInput,
  overrides?: ModelOverrideMap,
  accum?: TokenAccum,
): Promise<RecipeAssistantEnvelope> => {
  const config = await getActiveConfig(client, scope, overrides?.[scope]);
  const runtimePromptTemplate = config.promptTemplate?.trim().length
    ? config.promptTemplate
    : `You are Alchemy. Generate complete, cookable recipes from user intent and context.
Return strict JSON only.`;
  const runtimeRule = config.rule &&
      typeof config.rule === "object" &&
      !Array.isArray(config.rule)
    ? config.rule
    : {};
  const runtimeConstraints = `Runtime requirements:
- Output one strict JSON object only.
- Do not emit markdown or code fences.
- Required top-level keys: assistant_reply, recipe, response_context.
- assistant_reply.text must be plain assistant text (never JSON).
- recipe must be complete and practical (ingredients + steps required).
- recipe.metadata must include difficulty, health_score, time_minutes, items, timing.total_minutes, and quick_stats.
- recipe.metadata.quick_stats must include time_minutes, difficulty, health_score, and items.
- difficulty must be exactly one of: easy, medium, complex.
- health_score must be an integer from 1 to 100.
- Do not enforce artificial ingredient, step, or token budgets.`;
  const runtimeSystemPrompt = `${runtimePromptTemplate}\n\n${runtimeConstraints}`;
  const recipeContract = {
    format: "json_object",
    required_keys: ["assistant_reply", "recipe", "response_context"],
    optional_keys: ["response_context"],
  };
  const runtimeModelConfig = cleanLegacyModelConfig(config.modelConfig);
  if (!Number.isFinite(Number(runtimeModelConfig.temperature))) {
    runtimeModelConfig.temperature = 0.35;
  }

  const { result, inputTokens, outputTokens } = await callProvider<
    Record<string, JsonValue>
  >({
    provider: config.provider,
    model: config.model,
    modelConfig: runtimeModelConfig,
    systemPrompt: runtimeSystemPrompt,
    userInput: {
      task: "generate_recipe",
      rule: runtimeRule,
      contract: recipeContract,
      prompt: input.userPrompt,
      context: input.context,
    },
  });
  if (accum) addTokens(accum, inputTokens, outputTokens, config);

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
      recipe: directRecipe,
      accum,
    });

    if (!synthesizedReply) {
      const derivedReply = deriveAssistantReplyFromRecipe(directRecipe);
      if (!derivedReply) {
        throw new ApiError(
          422,
          "assistant_reply_missing",
          "LLM did not provide assistant reply content",
        );
      }

      return {
        recipe: directRecipe,
        assistant_reply: derivedReply,
      };
    }

    return {
      recipe: directRecipe,
      assistant_reply: synthesizedReply,
    };
  }

  const { result: repaired, inputTokens: ri, outputTokens: ro } =
    await callProvider<Record<string, JsonValue>>({
      provider: config.provider,
      model: config.model,
      modelConfig: runtimeModelConfig,
      systemPrompt: runtimeSystemPrompt,
      userInput: {
        task: "repair_recipe_schema",
        rule: runtimeRule,
        contract: recipeContract,
        prompt: input.userPrompt,
        context: input.context,
        invalid_payload: result,
      },
    });
  if (accum) addTokens(accum, ri, ro, config);

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
      recipe: repairedRecipe,
      accum,
    });

    if (!synthesizedReply) {
      const derivedReply = deriveAssistantReplyFromRecipe(repairedRecipe);
      if (!derivedReply) {
        throw new ApiError(
          422,
          "assistant_reply_missing",
          "LLM did not provide assistant reply content",
        );
      }

      return {
        recipe: repairedRecipe,
        assistant_reply: derivedReply,
      };
    }

    return {
      recipe: repairedRecipe,
      assistant_reply: synthesizedReply,
    };
  }

  const { result: strictRepaired, inputTokens: si, outputTokens: so } =
    await callProvider<Record<string, JsonValue>>({
      provider: config.provider,
      model: config.model,
      modelConfig: runtimeModelConfig,
      systemPrompt:
        `${runtimeSystemPrompt}\n\nYou are in strict schema normalization mode. Return one valid JSON object with keys assistant_reply, recipe, and response_context. Do not include markdown or prose.`,
      userInput: {
        task: "normalize_recipe_envelope",
        rule: runtimeRule,
        contract: recipeContract,
        prompt: input.userPrompt,
        context: input.context,
        invalid_payload: repaired,
      },
    });
  if (accum) addTokens(accum, si, so, config);

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
      recipe: strictRecipe,
      accum,
    });

    if (!synthesizedReply) {
      const derivedReply = deriveAssistantReplyFromRecipe(strictRecipe);
      if (!derivedReply) {
        throw new ApiError(
          422,
          "assistant_reply_missing",
          "LLM did not provide assistant reply content",
        );
      }

      return {
        recipe: strictRecipe,
        assistant_reply: derivedReply,
      };
    }

    return {
      recipe: strictRecipe,
      assistant_reply: synthesizedReply,
    };
  }

  const recoveredFromChatEnvelope = normalizeChatEnvelope(strictRepaired) ??
    normalizeChatEnvelope(repaired) ??
    normalizeChatEnvelope(result);
  if (recoveredFromChatEnvelope?.assistant_reply) {
    const recoveredRecipe = recoveredFromChatEnvelope.recipe ??
      recoveredFromChatEnvelope.candidate_recipe_set?.components.find((
        component,
      ) => component.role === "main")?.recipe ??
      recoveredFromChatEnvelope.candidate_recipe_set?.components[0]?.recipe;
    if (recoveredRecipe) {
      return {
        recipe: recoveredRecipe,
        assistant_reply: recoveredFromChatEnvelope.assistant_reply,
        response_context: {
          mode: "generation",
          intent: "in_scope_generate",
        },
      };
    }
  }

  throw new ApiError(
    422,
    "recipe_schema_invalid",
    "Generated recipe did not match required envelope schema",
  );
};

const generateChatConversationPayload = async (
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

  const runtimeConstraints = `Runtime requirements:
- Output one strict JSON object only.
- Do not emit markdown or code fences.
- Match the provided contract keys and schema exactly.
- If you return a recipe or candidate_recipe_set, every recipe must include metadata.difficulty, metadata.health_score, metadata.time_minutes, metadata.items, metadata.timing.total_minutes, and metadata.quick_stats.
- If there is an unresolved conflict between an explicit dish request and dietary_restrictions or aversions, ask for confirmation instead of generating, set response_context.mode to "preference_conflict", and return no recipe or candidate_recipe_set.`;

  const runtimePromptTemplate = config.promptTemplate?.trim().length
    ? config.promptTemplate
    : defaultChatPromptForScope(scope);
  const runtimeRule = config.rule &&
      typeof config.rule === "object" &&
      !Array.isArray(config.rule)
    ? config.rule
    : defaultChatRuleForScope(scope);
  const runtimeSystemPrompt =
    `${runtimePromptTemplate}\n\n${runtimeConstraints}`;
  const contract = scope === "chat_ideation"
    ? {
      format: "json_object",
      required_keys: ["assistant_reply", "trigger_recipe", "response_context"],
      optional_keys: ["response_context", "candidate_recipe_set", "recipe"],
    }
    : {
      format: "json_object",
      required_keys: ["assistant_reply", "response_context"],
      optional_keys: ["candidate_recipe_set", "recipe", "trigger_recipe"],
    };

  const executeCall = async (
    extraSystemPrompt: string | null,
    callConfig: Record<string, JsonValue>,
    userInputOverride?: Record<string, JsonValue>,
  ): Promise<Record<string, JsonValue>> => {
    const response = await callProvider<Record<string, JsonValue>>({
      provider: runtimeProvider,
      model: runtimeModel,
      modelConfig: callConfig,
      systemPrompt: extraSystemPrompt
        ? `${runtimeSystemPrompt}\n\n${extraSystemPrompt}`
        : runtimeSystemPrompt,
      userInput: {
        task: "chat_conversation",
        rule: runtimeRule,
        contract,
        prompt: input.userPrompt,
        context: input.context,
        ...(userInputOverride ?? {}),
      },
    });
    if (accum) {
      addTokens(accum, response.inputTokens, response.outputTokens, config);
    }
    return response.result;
  };

  const validateEnvelopeForScope = (
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

  const attemptRepair = async (
    invalidPayload: Record<string, JsonValue>,
    reason: string,
  ): Promise<ChatAssistantEnvelope | null> => {
    const repaired = await executeCall(
      `CRITICAL: Return ONLY one valid raw JSON object for the chat-loop contract.
- No markdown/code fences.
- Ensure assistant_reply.text is plain assistant text (never JSON).
- Ensure required keys are present for this scope.
- Preserve user intent and recipe details from invalid_payload.
repair_reason: ${reason}`,
      runtimeModelConfig,
      {
        task: "repair_chat_schema",
        scope,
        reason,
        rule: runtimeRule,
        contract,
        prompt: input.userPrompt,
        context: input.context,
        invalid_payload: invalidPayload,
      },
    );
    return normalizeChatEnvelope(repaired);
  };

  const rawResult = await executeCall(null, runtimeModelConfig);

  let repaired = false;
  let envelope = normalizeChatEnvelope(rawResult);
  if (!envelope) {
    envelope = await attemptRepair(
      rawResult,
      "chat_envelope_normalization_failed",
    );
    repaired = true;
  }

  if (!envelope) {
    throw new ApiError(
      422,
      "chat_schema_invalid",
      "Chat reply did not match required envelope schema",
    );
  }

  try {
    return validateEnvelopeForScope(envelope);
  } catch (error) {
    if (
      !repaired &&
      error instanceof ApiError &&
      error.code === "chat_schema_invalid"
    ) {
      const repairedEnvelope = await attemptRepair(rawResult, error.message);
      if (repairedEnvelope) {
        return validateEnvelopeForScope(repairedEnvelope);
      }
    }
    throw error;
  }
};

const generateOnboardingInterviewEnvelope = async (
  client: SupabaseClient,
  input: GatewayInput,
  accum?: TokenAccum,
): Promise<OnboardingAssistantEnvelope> => {
  const config = await getActiveConfig(client, "onboarding");

  const { result, inputTokens, outputTokens } = await callProvider<
    Record<string, JsonValue>
  >({
    provider: config.provider,
    model: config.model,
    modelConfig: config.modelConfig,
    systemPrompt: config.promptTemplate,
    userInput: {
      task: "onboarding_interview",
      rule: config.rule,
      prompt: input.userPrompt,
      context: input.context,
    },
  });
  if (accum) addTokens(accum, inputTokens, outputTokens, config);

  const envelope = normalizeOnboardingEnvelope(result);
  if (envelope) {
    return envelope;
  }

  console.error("onboarding_envelope_normalization_failed", {
    result_keys: result && typeof result === "object"
      ? Object.keys(result)
      : typeof result,
    result_preview: JSON.stringify(result).slice(0, 800),
  });

  const { result: repaired, inputTokens: ri, outputTokens: ro } =
    await callProvider<Record<string, JsonValue>>({
      provider: config.provider,
      model: config.model,
      modelConfig: config.modelConfig,
      systemPrompt:
        `${config.promptTemplate}\n\nCRITICAL: You MUST return ONLY a raw JSON object. No markdown fences, no explanation, no text before or after the JSON. The JSON object MUST have these exact top-level keys: "assistant_reply" (object with required "text" string field), "onboarding_state" (object with "completed" boolean, "progress" number 0-1, "missing_topics" string array, "state" object), and optionally "preference_updates" (object).`,
      userInput: {
        task: "repair_onboarding_schema",
        rule: config.rule,
        prompt: input.userPrompt,
        context: input.context,
        invalid_payload: result,
      },
    });
  if (accum) addTokens(accum, ri, ro, config);

  const repairedEnvelope = normalizeOnboardingEnvelope(repaired);
  if (repairedEnvelope) {
    return repairedEnvelope;
  }

  console.error("onboarding_repair_also_failed", {
    repaired_keys: repaired && typeof repaired === "object"
      ? Object.keys(repaired)
      : typeof repaired,
    repaired_preview: JSON.stringify(repaired).slice(0, 800),
  });

  throw new ApiError(
    422,
    "onboarding_schema_invalid",
    "Generated onboarding reply did not match required schema",
  );
};

const logLlmEvent = async (
  client: SupabaseClient,
  userId: string,
  requestId: string,
  scope: GatewayScope,
  latencyMs: number,
  safetyState: string,
  payload?: Record<string, JsonValue>,
  tokens?: TokenAccum,
  costUsdOverride?: number | null,
): Promise<void> => {
  const { error } = await client.from("events").insert({
    user_id: userId,
    event_type: "llm_call",
    request_id: requestId,
    latency_ms: latencyMs,
    safety_state: safetyState,
    token_input: tokens?.input ?? null,
    token_output: tokens?.output ?? null,
    token_total: tokens ? tokens.input + tokens.output : null,
    cost_usd: typeof costUsdOverride === "number"
      ? costUsdOverride
      : tokens?.costUsd ?? null,
    event_payload: { scope, ...(payload ?? {}) },
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
        },
        accum,
      );
      return envelope;
    } catch (error) {
      const errorCode = error instanceof ApiError
        ? error.code
        : "unknown_error";
      const recoverableChatErrors = new Set([
        "llm_invalid_json",
        "llm_json_truncated",
        "llm_empty_output",
        "chat_schema_invalid",
      ]);
      if (
        error instanceof ApiError &&
        recoverableChatErrors.has(error.code)
      ) {
        try {
          const recipeFallback = await generateRecipePayload(
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
            scope,
            Date.now() - startedAt,
            "degraded",
            {
              error_code: error.code,
              fallback: "generate_scope_recipe_fallback",
            },
            accum,
          );
          return {
            assistant_reply: recipeFallback.assistant_reply,
            recipe: recipeFallback.recipe,
            trigger_recipe: true,
            response_context: {
              mode: scope === "chat_iteration" ? "iteration" : "generation",
              intent: "in_scope_generate",
            },
          };
        } catch (recipeFallbackError) {
          await logLlmEvent(
            params.client,
            params.userId,
            params.requestId,
            scope,
            Date.now() - startedAt,
            "degraded",
            {
              error_code: error.code,
              fallback: "generate_scope_recipe_fallback_failed",
              fallback_error_code: recipeFallbackError instanceof ApiError
                ? recipeFallbackError.code
                : "unknown_error",
            },
            accum,
          );
        }
        await logLlmEvent(
          params.client,
          params.userId,
          params.requestId,
          scope,
          Date.now() - startedAt,
          "degraded",
          {
            error_code: error.code,
            fallback: "chat_ideation_recovery_failed",
          },
          accum,
        );
        throw new ApiError(
          502,
          "chat_recovery_failed",
          "Chat generation failed after recovery attempts",
          `primary=${error.code}`,
        );
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

  async inferCategories(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    recipe: RecipePayload;
    context: Record<string, JsonValue>;
  }): Promise<CategoryInference[]> {
    const startedAt = Date.now();
    const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };
    try {
      const config = await getActiveConfig(params.client, "classify");

      const { result: output, inputTokens, outputTokens } = await callProvider<
        { categories: CategoryInference[] }
      >({
        provider: config.provider,
        model: config.model,
        modelConfig: config.modelConfig,
        systemPrompt: config.promptTemplate,
        userInput: {
          task: "infer_categories",
          rule: config.rule,
          recipe: params.recipe as unknown as JsonValue,
          context: params.context,
        },
      });
      addTokens(accum, inputTokens, outputTokens, config);

      const categories = (output.categories ?? [])
        .filter((entry) =>
          typeof entry.category === "string" && entry.category.trim().length > 0
        )
        .map((entry) => {
          const numeric = Number(entry.confidence);
          return {
            category: entry.category.trim(),
            confidence: Number.isFinite(numeric)
              ? Math.max(0, Math.min(1, numeric))
              : 0.5,
          };
        });

      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "classify",
        Date.now() - startedAt,
        "ok",
        undefined,
        accum,
      );
      return categories;
    } catch (error) {
      const errorCode = error instanceof ApiError
        ? error.code
        : "unknown_error";
      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "classify",
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

  async normalizeIngredientAliases(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    aliases: Array<{
      alias_key: string;
      source_name: string;
      fallback_canonical_name?: string;
    }>;
  }): Promise<IngredientAliasNormalization[]> {
    const cleanedAliases = params.aliases
      .map((alias) => ({
        alias_key: alias.alias_key.trim().toLocaleLowerCase(),
        source_name: alias.source_name.trim(),
        fallback_canonical_name:
          typeof alias.fallback_canonical_name === "string"
            ? alias.fallback_canonical_name.trim()
            : "",
      }))
      .filter((alias) =>
        alias.alias_key.length > 0 && alias.source_name.length > 0
      );

    if (cleanedAliases.length === 0) {
      return [];
    }

    const dedupedByAlias = new Map<
      string,
      { source_name: string; fallback_canonical_name: string }
    >();
    for (const alias of cleanedAliases) {
      if (dedupedByAlias.has(alias.alias_key)) {
        continue;
      }
      dedupedByAlias.set(alias.alias_key, {
        source_name: alias.source_name,
        fallback_canonical_name: alias.fallback_canonical_name,
      });
    }

    const dedupedAliases = Array.from(dedupedByAlias.entries()).map(
      ([alias_key, value]) => ({
        alias_key,
        source_name: value.source_name,
        fallback_canonical_name: value.fallback_canonical_name,
      }),
    );
    const allowedAliasKeys = new Set(
      dedupedAliases.map((alias) => alias.alias_key),
    );

    const startedAt = Date.now();
    const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };
    try {
      const { result, inputTokens, outputTokens, config } = await executeScope<
        { items?: unknown }
      >({
        client: params.client,
        scope: "ingredient_alias_normalize",
        userInput: {
          task: "normalize_ingredient_aliases",
          aliases: dedupedAliases,
        },
      });
      addTokens(accum, inputTokens, outputTokens, config);

      const rawItems = result.items;
      const normalized = Array.isArray(rawItems)
        ? rawItems
          .map((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
              return null;
            }

            const rawAlias = (item as { alias_key?: unknown }).alias_key;
            const rawCanonical = (item as { canonical_name?: unknown })
              .canonical_name;
            const rawConfidence = (item as { confidence?: unknown }).confidence;
            if (
              typeof rawAlias !== "string" || typeof rawCanonical !== "string"
            ) {
              return null;
            }

            const alias_key = rawAlias.trim().toLocaleLowerCase();
            const canonical_name = rawCanonical.trim();
            if (
              alias_key.length === 0 ||
              canonical_name.length === 0 ||
              !allowedAliasKeys.has(alias_key)
            ) {
              return null;
            }

            const numericConfidence = Number(rawConfidence);
            const confidence = Number.isFinite(numericConfidence)
              ? Math.max(0, Math.min(1, numericConfidence))
              : 0;

            return {
              alias_key,
              canonical_name,
              confidence,
            };
          })
          .filter(
            (item): item is IngredientAliasNormalization => item !== null,
          )
        : [];

      const mergedByAlias = new Map<string, IngredientAliasNormalization>();
      for (const item of normalized) {
        if (mergedByAlias.has(item.alias_key)) {
          continue;
        }
        mergedByAlias.set(item.alias_key, item);
      }

      const output = Array.from(mergedByAlias.values());
      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "ingredient_alias_normalize",
        Date.now() - startedAt,
        "ok",
        {
          task: "normalize_ingredient_aliases",
          input_count: dedupedAliases.length,
          output_count: output.length,
        },
        accum,
      );

      return output;
    } catch (error) {
      const errorCode = error instanceof ApiError
        ? error.code
        : "unknown_error";
      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "ingredient_alias_normalize",
        Date.now() - startedAt,
        "error",
        {
          task: "normalize_ingredient_aliases",
          input_count: dedupedAliases.length,
          error_code: errorCode,
        },
        accum,
      );
      throw error;
    }
  },

  async parseIngredientLines(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    sourceNames: string[];
  }): Promise<IngredientLineParse[]> {
    const cleaned = params.sourceNames
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (cleaned.length === 0) {
      return [];
    }

    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const value of cleaned) {
      const key = value.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(value);
    }

    const normalizeTermKey = (value: string): string =>
      normalizeDelimitedToken(value);

    const allowedRoles = new Set([
      "primary",
      "optional",
      "alternative",
      "garnish",
      "unspecified",
    ]);
    const allowedQualifierTypes = new Set([
      "preparation",
      "state",
      "quality",
      "size",
      "purpose",
      "temperature",
      "treatment",
    ]);
    const allowedQualifierRelations = new Set([
      "prepared_as",
      "has_state",
      "has_quality",
      "has_size",
      "has_purpose",
      "has_temperature",
      "has_treatment",
    ]);

    const defaultRelationByType: Record<string, IngredientLineQualifier["relation_type"]> = {
      preparation: "prepared_as",
      state: "has_state",
      quality: "has_quality",
      size: "has_size",
      purpose: "has_purpose",
      temperature: "has_temperature",
      treatment: "has_treatment",
    };

    const startedAt = Date.now();
    const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };
    try {
      const { result, inputTokens, outputTokens, config } = await executeScope<
        { items?: unknown }
      >({
        client: params.client,
        scope: "ingredient_line_parse",
        userInput: {
          task: "parse_ingredient_lines",
          source_names: deduped,
        },
      });
      addTokens(accum, inputTokens, outputTokens, config);

      const rawItems = Array.isArray(result.items) ? result.items : [];
      const bySource = new Map<string, IngredientLineParse>();
      for (const rawItem of rawItems) {
        if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
          continue;
        }
        const sourceName = (rawItem as { source_name?: unknown }).source_name;
        if (typeof sourceName !== "string" || sourceName.trim().length === 0) {
          continue;
        }
        const sourceKey = sourceName.trim().toLocaleLowerCase();
        if (!seen.has(sourceKey)) {
          continue;
        }

        const lineConfidenceRaw = Number(
          (rawItem as { line_confidence?: unknown }).line_confidence,
        );
        const lineConfidence = Number.isFinite(lineConfidenceRaw)
          ? Math.max(0, Math.min(1, lineConfidenceRaw))
          : 0;

        const rawMentions = Array.isArray((rawItem as { mentions?: unknown }).mentions)
          ? ((rawItem as { mentions?: unknown }).mentions as unknown[])
          : [];
        const normalizedMentions = rawMentions
          .map((mention): IngredientLineMention | null => {
            if (typeof mention === "string") {
              const trimmed = mention.trim();
              if (trimmed.length === 0) return null;
              return {
                name: trimmed,
                role: "unspecified",
                alternative_group_key: null,
                confidence: 0,
              };
            }
            if (!mention || typeof mention !== "object" || Array.isArray(mention)) {
              return null;
            }
            const name = (mention as { name?: unknown }).name;
            if (typeof name !== "string" || name.trim().length === 0) {
              return null;
            }
            const roleRaw = String(
              (mention as { role?: unknown }).role ?? "unspecified",
            ).trim().toLocaleLowerCase();
            const role = allowedRoles.has(roleRaw)
              ? roleRaw as IngredientLineMention["role"]
              : "unspecified";
            const groupRaw =
              (mention as { alternative_group_key?: unknown })
                .alternative_group_key;
            const alternative_group_key =
              typeof groupRaw === "string" && groupRaw.trim().length > 0
                ? normalizeTermKey(groupRaw)
                : null;
            const confidenceRaw = Number(
              (mention as { confidence?: unknown }).confidence,
            );
            const confidence = Number.isFinite(confidenceRaw)
              ? Math.max(0, Math.min(1, confidenceRaw))
              : 0;
            return {
              name: name.trim(),
              role,
              alternative_group_key,
              confidence,
            };
          })
          .filter((entry): entry is IngredientLineMention => entry !== null);

        const dedupedMentions: IngredientLineMention[] = [];
        const seenMention = new Set<string>();
        for (const mention of normalizedMentions) {
          const dedupeKey = `${mention.name.toLocaleLowerCase()}:${
            mention.alternative_group_key ?? ""
          }`;
          if (seenMention.has(dedupeKey)) continue;
          seenMention.add(dedupeKey);
          dedupedMentions.push(mention);
        }

        const rawQualifiers = Array.isArray(
          (rawItem as { qualifiers?: unknown }).qualifiers,
        )
          ? ((rawItem as { qualifiers?: unknown }).qualifiers as unknown[])
          : [];
        const normalizedQualifiers = rawQualifiers
          .map((qualifier): IngredientLineQualifier | null => {
            if (
              !qualifier || typeof qualifier !== "object" ||
              Array.isArray(qualifier)
            ) {
              return null;
            }

            const termTypeRaw = String(
              (qualifier as { term_type?: unknown }).term_type ?? "",
            )
              .trim()
              .toLocaleLowerCase();
            if (!allowedQualifierTypes.has(termTypeRaw)) {
              return null;
            }
            const term_type = termTypeRaw as IngredientLineQualifier["term_type"];
            const label = String((qualifier as { label?: unknown }).label ?? "")
              .trim();
            if (label.length === 0) {
              return null;
            }
            const term_key_raw = String(
              (qualifier as { term_key?: unknown }).term_key ?? label,
            );
            const term_key = normalizeTermKey(term_key_raw);
            if (term_key.length === 0) {
              return null;
            }

            const relationRaw = String(
              (qualifier as { relation_type?: unknown }).relation_type ??
                defaultRelationByType[termTypeRaw] ?? "has_state",
            )
              .trim()
              .toLocaleLowerCase();
            const relation_type = allowedQualifierRelations.has(relationRaw)
              ? relationRaw as IngredientLineQualifier["relation_type"]
              : defaultRelationByType[termTypeRaw];

            const targetRaw = (qualifier as { target?: unknown }).target;
            let target: IngredientLineQualifier["target"] = "line";
            if (Number.isInteger(Number(targetRaw))) {
              target = Math.max(0, Number(targetRaw));
            } else if (typeof targetRaw === "string") {
              const trimmedTarget = targetRaw.trim().toLocaleLowerCase();
              if (trimmedTarget === "line") {
                target = "line";
              } else if (Number.isInteger(Number(trimmedTarget))) {
                target = Math.max(0, Number(trimmedTarget));
              }
            }

            const confidenceRaw = Number(
              (qualifier as { confidence?: unknown }).confidence,
            );
            const confidence = Number.isFinite(confidenceRaw)
              ? Math.max(0, Math.min(1, confidenceRaw))
              : 0;

            return {
              term_type,
              term_key,
              label,
              relation_type,
              target,
              confidence,
            };
          })
          .filter((entry): entry is IngredientLineQualifier => entry !== null);

        const dedupedQualifiers: IngredientLineQualifier[] = [];
        const seenQualifier = new Set<string>();
        for (const qualifier of normalizedQualifiers) {
          const dedupeKey = `${qualifier.term_type}:${qualifier.term_key}:${
            qualifier.relation_type
          }:${String(qualifier.target)}`;
          if (seenQualifier.has(dedupeKey)) continue;
          seenQualifier.add(dedupeKey);
          dedupedQualifiers.push(qualifier);
        }

        if (dedupedMentions.length === 0) {
          continue;
        }

        bySource.set(sourceKey, {
          source_name: sourceName.trim(),
          line_confidence: lineConfidence,
          mentions: dedupedMentions.slice(0, 6),
          qualifiers: dedupedQualifiers.slice(0, 10),
        });
      }

      const output = deduped
        .map((sourceName) => bySource.get(sourceName.toLocaleLowerCase()))
        .filter((entry): entry is IngredientLineParse => entry !== undefined);

      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "ingredient_line_parse",
        Date.now() - startedAt,
        "ok",
        {
          task: "parse_ingredient_lines",
          input_count: deduped.length,
          output_count: output.length,
        },
        accum,
      );
      return output;
    } catch (error) {
      const errorCode = error instanceof ApiError
        ? error.code
        : "unknown_error";
      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "ingredient_line_parse",
        Date.now() - startedAt,
        "error",
        {
          task: "parse_ingredient_lines",
          input_count: deduped.length,
          error_code: errorCode,
        },
        accum,
      );
      throw error;
    }
  },

  async splitIngredientPhrases(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    sourceNames: string[];
  }): Promise<IngredientPhraseSplit[]> {
    const cleaned = params.sourceNames
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (cleaned.length === 0) {
      return [];
    }

    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const value of cleaned) {
      const key = value.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(value);
    }

    const startedAt = Date.now();
    const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };
    try {
      const { result, inputTokens, outputTokens, config } = await executeScope<
        { items?: unknown }
      >({
        client: params.client,
        scope: "ingredient_phrase_split",
        userInput: {
          task: "split_ingredient_phrases",
          source_names: deduped,
        },
      });
      addTokens(accum, inputTokens, outputTokens, config);

      const rawItems = Array.isArray(result.items) ? result.items : [];
      const bySource = new Map<string, IngredientPhraseSplit>();
      for (const rawItem of rawItems) {
        if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
          continue;
        }
        const sourceName = (rawItem as { source_name?: unknown }).source_name;
        const parts = (rawItem as { items?: unknown }).items;
        if (typeof sourceName !== "string" || !Array.isArray(parts)) {
          continue;
        }
        const source_key = sourceName.trim().toLocaleLowerCase();
        if (!seen.has(source_key)) {
          continue;
        }
        const normalizedParts = parts
          .map((part) => {
            if (typeof part === "string") {
              const trimmed = part.trim();
              if (!trimmed) return null;
              return { name: trimmed, confidence: 0 };
            }
            if (!part || typeof part !== "object" || Array.isArray(part)) {
              return null;
            }
            const name = (part as { name?: unknown }).name;
            const confidenceRaw = (part as { confidence?: unknown }).confidence;
            if (typeof name !== "string" || name.trim().length === 0) {
              return null;
            }
            const numeric = Number(confidenceRaw);
            return {
              name: name.trim(),
              confidence: Number.isFinite(numeric)
                ? Math.max(0, Math.min(1, numeric))
                : 0,
            };
          })
          .filter((item): item is { name: string; confidence: number } =>
            item !== null
          );

        if (normalizedParts.length === 0) {
          continue;
        }

        const dedupedParts: Array<{ name: string; confidence: number }> = [];
        const seenPart = new Set<string>();
        for (const part of normalizedParts) {
          const key = part.name.toLocaleLowerCase();
          if (seenPart.has(key)) continue;
          seenPart.add(key);
          dedupedParts.push(part);
        }

        bySource.set(source_key, {
          source_name: sourceName.trim(),
          items: dedupedParts.slice(0, 4),
        });
      }

      const output = deduped
        .map((sourceName) => bySource.get(sourceName.toLocaleLowerCase()))
        .filter((entry): entry is IngredientPhraseSplit => entry !== undefined);

      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "ingredient_phrase_split",
        Date.now() - startedAt,
        "ok",
        {
          task: "split_ingredient_phrases",
          input_count: deduped.length,
          output_count: output.length,
        },
        accum,
      );
      return output;
    } catch (error) {
      const errorCode = error instanceof ApiError
        ? error.code
        : "unknown_error";
      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "ingredient_phrase_split",
        Date.now() - startedAt,
        "error",
        {
          task: "split_ingredient_phrases",
          input_count: deduped.length,
          error_code: errorCode,
        },
        accum,
      );
      throw error;
    }
  },

  async enrichIngredients(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    ingredients: Array<{ canonical_name: string; ingredient_id?: string }>;
  }): Promise<IngredientSemanticEnrichment[]> {
    const cleaned = params.ingredients
      .map((entry) => ({
        canonical_name: entry.canonical_name.trim(),
        ingredient_id: typeof entry.ingredient_id === "string"
          ? entry.ingredient_id
          : undefined,
      }))
      .filter((entry) => entry.canonical_name.length > 0);

    if (cleaned.length === 0) {
      return [];
    }

    const dedupedByName = new Map<
      string,
      { canonical_name: string; ingredient_id?: string }
    >();
    for (const item of cleaned) {
      const key = item.canonical_name.toLocaleLowerCase();
      if (dedupedByName.has(key)) continue;
      dedupedByName.set(key, item);
    }
    const deduped = Array.from(dedupedByName.values());
    const allowed = new Set(
      deduped.map((item) => item.canonical_name.toLocaleLowerCase()),
    );

    const startedAt = Date.now();
    const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };
    try {
      const { result, inputTokens, outputTokens, config } = await executeScope<
        { items?: unknown }
      >({
        client: params.client,
        scope: "ingredient_enrich",
        userInput: {
          task: "ingredient_enrichment_v2",
          ingredients: deduped,
        },
      });
      addTokens(accum, inputTokens, outputTokens, config);

      const rawItems = Array.isArray(result.items) ? result.items : [];
      const output = rawItems
        .map((rawItem): IngredientSemanticEnrichment | null => {
          if (
            !rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)
          ) {
            return null;
          }
          const canonicalName = (rawItem as { canonical_name?: unknown })
            .canonical_name;
          const confidenceRaw =
            (rawItem as { confidence?: unknown }).confidence;
          const metadataRaw = (rawItem as { metadata?: unknown }).metadata;
          const ontologyRaw =
            (rawItem as { ontology_terms?: unknown }).ontology_terms;

          if (
            typeof canonicalName !== "string" ||
            canonicalName.trim().length === 0
          ) {
            return null;
          }
          const key = canonicalName.trim().toLocaleLowerCase();
          if (!allowed.has(key)) {
            return null;
          }

          const numeric = Number(confidenceRaw);
          const confidence = Number.isFinite(numeric)
            ? Math.max(0, Math.min(1, numeric))
            : 0;
          const metadata = metadataRaw && typeof metadataRaw === "object" &&
              !Array.isArray(metadataRaw)
            ? metadataRaw as Record<string, JsonValue>
            : {};
          const ontologyTerms = Array.isArray(ontologyRaw)
            ? ontologyRaw
              .map((term) => {
                if (!term || typeof term !== "object" || Array.isArray(term)) {
                  return null;
                }
                const termType = (term as { term_type?: unknown }).term_type;
                const termKey = (term as { term_key?: unknown }).term_key;
                const label = (term as { label?: unknown }).label;
                const relationType =
                  (term as { relation_type?: unknown }).relation_type;
                const termConfidenceRaw =
                  (term as { confidence?: unknown }).confidence;
                if (
                  typeof termType !== "string" ||
                  typeof termKey !== "string" ||
                  typeof label !== "string" ||
                  typeof relationType !== "string"
                ) {
                  return null;
                }
                const termNumeric = Number(termConfidenceRaw);
                return {
                  term_type: termType.trim(),
                  term_key: termKey.trim().toLocaleLowerCase(),
                  label: label.trim(),
                  relation_type: relationType.trim(),
                  confidence: Number.isFinite(termNumeric)
                    ? Math.max(0, Math.min(1, termNumeric))
                    : 0,
                };
              })
              .filter((entry): entry is OntologySuggestion => entry !== null)
            : [];

          return {
            canonical_name: canonicalName.trim(),
            confidence,
            metadata,
            ontology_terms: ontologyTerms,
          };
        })
        .filter((entry): entry is IngredientSemanticEnrichment =>
          entry !== null
        );

      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "ingredient_enrich",
        Date.now() - startedAt,
        "ok",
        {
          task: "ingredient_enrichment_v2",
          input_count: deduped.length,
          output_count: output.length,
        },
        accum,
      );
      return output;
    } catch (error) {
      const errorCode = error instanceof ApiError
        ? error.code
        : "unknown_error";
      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "ingredient_enrich",
        Date.now() - startedAt,
        "error",
        {
          task: "ingredient_enrichment_v2",
          input_count: deduped.length,
          error_code: errorCode,
        },
        accum,
      );
      throw error;
    }
  },

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

  async embedRecipeSearchQuery(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    inputText: string;
    modelOverrides?: ModelOverrideMap;
  }): Promise<RecipeSearchEmbedding> {
    const startedAt = Date.now();
    try {
      const { vector, dimensions, inputTokens, config } = await executeEmbeddingScope({
        client: params.client,
        scope: "recipe_search_embed",
        inputText: params.inputText,
        modelOverride: params.modelOverrides?.recipe_search_embed,
      });
      const inputCostUsd = inputTokens > 0
        ? (inputTokens / 1_000_000) * config.inputCostPer1m
        : 0;

      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "recipe_search_embed",
        Date.now() - startedAt,
        "ok",
        {
          task: "recipe_search_embedding_v1",
          dimensions,
        },
        {
          input: inputTokens,
          output: 0,
          costUsd: inputCostUsd,
        },
      );

      return {
        vector,
        dimensions,
        provider: config.provider,
        model: config.model,
      };
    } catch (error) {
      const errorCode = error instanceof ApiError
        ? error.code
        : "unknown_error";
      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "recipe_search_embed",
        Date.now() - startedAt,
        "error",
        {
          task: "recipe_search_embedding_v1",
          error_code: errorCode,
        },
      );
      throw error;
    }
  },

  async interpretRecipeSearch(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    context: Record<string, JsonValue>;
    modelOverrides?: ModelOverrideMap;
  }): Promise<RecipeSearchInterpretationEnvelope> {
    const startedAt = Date.now();
    const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };

    try {
      const { result, inputTokens, outputTokens, config } = await executeScope<
        RecipeSearchInterpretationEnvelope
      >({
        client: params.client,
        scope: "recipe_search_interpret",
        userInput: params.context,
        modelOverride: params.modelOverrides?.recipe_search_interpret,
      });
      addTokens(accum, inputTokens, outputTokens, config);

      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "recipe_search_interpret",
        Date.now() - startedAt,
        "ok",
        { task: "recipe_search_interpret_v1" },
        accum,
      );

      return result;
    } catch (error) {
      const errorCode = error instanceof ApiError
        ? error.code
        : "unknown_error";
      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "recipe_search_interpret",
        Date.now() - startedAt,
        "error",
        {
          task: "recipe_search_interpret_v1",
          error_code: errorCode,
        },
        accum,
      );
      throw error;
    }
  },

  async rerankRecipeSearch(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    context: Record<string, JsonValue>;
    timeoutMs: number;
    modelOverrides?: ModelOverrideMap;
  }): Promise<RecipeSearchRerankEnvelope> {
    const startedAt = Date.now();
    const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };

    try {
      const { result, inputTokens, outputTokens, config } = await executeScope<
        RecipeSearchRerankEnvelope
      >({
        client: params.client,
        scope: "recipe_search_rerank",
        userInput: params.context,
        modelOverride: params.modelOverrides?.recipe_search_rerank,
        modelConfigOverride: {
          timeout_ms: params.timeoutMs,
        },
      });
      addTokens(accum, inputTokens, outputTokens, config);

      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "recipe_search_rerank",
        Date.now() - startedAt,
        "ok",
        {
          task: "recipe_search_rerank_v1",
          candidate_count: Array.isArray(params.context.candidates)
            ? params.context.candidates.length
            : null,
        },
        accum,
      );

      return result;
    } catch (error) {
      const errorCode = error instanceof ApiError
        ? error.code
        : "unknown_error";
      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "recipe_search_rerank",
        Date.now() - startedAt,
        "error",
        {
          task: "recipe_search_rerank_v1",
          error_code: errorCode,
        },
        accum,
      );
      throw error;
    }
  },

  async inferIngredientRelations(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    ingredientNames: string[];
  }): Promise<IngredientSemanticRelation[]> {
    const cleaned = params.ingredientNames
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (cleaned.length < 2) {
      return [];
    }

    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const value of cleaned) {
      const key = value.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(value);
    }
    if (deduped.length < 2) {
      return [];
    }

    const allowed = new Set(deduped.map((value) => value.toLocaleLowerCase()));
    const allowedRelations = new Set([
      "complements",
      "substitutes_for",
      "same_family_as",
      "derived_from",
      "conflicts_with",
    ]);

    const startedAt = Date.now();
    const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };
    try {
      const { result, inputTokens, outputTokens, config } = await executeScope<
        { items?: unknown }
      >({
        client: params.client,
        scope: "ingredient_relation_infer",
        userInput: {
          task: "ingredient_relation_inference_v2",
          ingredient_names: deduped,
        },
      });
      addTokens(accum, inputTokens, outputTokens, config);

      const rawItems = Array.isArray(result.items) ? result.items : [];
      const output = rawItems
        .map((rawItem) => {
          if (
            !rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)
          ) {
            return null;
          }
          const from = (rawItem as { from_canonical_name?: unknown })
            .from_canonical_name;
          const to =
            (rawItem as { to_canonical_name?: unknown }).to_canonical_name;
          const relationType =
            (rawItem as { relation_type?: unknown }).relation_type;
          const confidenceRaw =
            (rawItem as { confidence?: unknown }).confidence;
          const rationaleRaw = (rawItem as { rationale?: unknown }).rationale;

          if (
            typeof from !== "string" ||
            typeof to !== "string" ||
            typeof relationType !== "string"
          ) {
            return null;
          }

          const fromKey = from.trim().toLocaleLowerCase();
          const toKey = to.trim().toLocaleLowerCase();
          const relationKey = relationType.trim().toLocaleLowerCase();
          if (
            fromKey.length === 0 ||
            toKey.length === 0 ||
            fromKey === toKey ||
            !allowed.has(fromKey) ||
            !allowed.has(toKey) ||
            !allowedRelations.has(relationKey)
          ) {
            return null;
          }

          const numeric = Number(confidenceRaw);
          const normalized: IngredientSemanticRelation = {
            from_canonical_name: from.trim(),
            to_canonical_name: to.trim(),
            relation_type: relationKey,
            confidence: Number.isFinite(numeric)
              ? Math.max(0, Math.min(1, numeric))
              : 0,
          };
          if (
            typeof rationaleRaw === "string" && rationaleRaw.trim().length > 0
          ) {
            normalized.rationale = rationaleRaw.trim();
          }
          return normalized;
        })
        .filter((entry): entry is IngredientSemanticRelation => entry !== null);

      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "ingredient_relation_infer",
        Date.now() - startedAt,
        "ok",
        {
          task: "ingredient_relation_inference_v2",
          ingredient_count: deduped.length,
          output_count: output.length,
        },
        accum,
      );
      return output;
    } catch (error) {
      const errorCode = error instanceof ApiError
        ? error.code
        : "unknown_error";
      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "ingredient_relation_infer",
        Date.now() - startedAt,
        "error",
        {
          task: "ingredient_relation_inference_v2",
          ingredient_count: deduped.length,
          error_code: errorCode,
        },
        accum,
      );
      throw error;
    }
  },

  async normalizePreferenceList(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    field: string;
    entries: string[];
  }): Promise<string[]> {
    const cleanedEntries = params.entries
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (cleanedEntries.length === 0) {
      return [];
    }

    const startedAt = Date.now();
    const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };
    try {
      const { result, inputTokens, outputTokens, config } = await executeScope<
        { items?: unknown }
      >({
        client: params.client,
        scope: "preference_normalize",
        userInput: {
          task: "normalize_preference_list",
          field: params.field,
          entries: cleanedEntries,
        },
      });
      addTokens(accum, inputTokens, outputTokens, config);

      const rawItems = result.items;
      const normalized = Array.isArray(rawItems)
        ? rawItems
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
        : [];

      const seen = new Set<string>();
      const unique: string[] = [];
      for (const item of normalized) {
        const key = item.toLocaleLowerCase();
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        unique.push(item);
      }

      const safeOutput = (unique.length > 0 ? unique : cleanedEntries).slice(
        0,
        32,
      );
      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "preference_normalize",
        Date.now() - startedAt,
        "ok",
        {
          task: "normalize_preference_list",
          field: params.field,
          input_count: cleanedEntries.length,
          output_count: safeOutput.length,
        },
        accum,
      );
      return safeOutput;
    } catch (error) {
      const errorCode = error instanceof ApiError
        ? error.code
        : "unknown_error";
      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "preference_normalize",
        Date.now() - startedAt,
        "error",
        {
          task: "normalize_preference_list",
          field: params.field,
          error_code: errorCode,
        },
        accum,
      );
      return cleanedEntries.slice(0, 32);
    }
  },

  async filterEquipmentPreferenceUpdates(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    latestUserMessage: string;
    userMessages: string[];
    candidateEquipment: string[];
  }): Promise<string[]> {
    const cleanedCandidates = params.candidateEquipment
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    if (cleanedCandidates.length === 0) {
      return [];
    }

    const seenCandidates = new Set<string>();
    const uniqueCandidates: string[] = [];
    for (const candidate of cleanedCandidates) {
      const key = candidate.toLocaleLowerCase();
      if (seenCandidates.has(key)) {
        continue;
      }
      seenCandidates.add(key);
      uniqueCandidates.push(candidate);
    }

    const cleanedMessages = [params.latestUserMessage, ...params.userMessages]
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .slice(0, 20);

    const startedAt = Date.now();
    const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };
    try {
      const { result, inputTokens, outputTokens, config } = await executeScope<
        { items?: unknown }
      >({
        client: params.client,
        scope: "equipment_filter",
        userInput: {
          task: "filter_equipment_preference_updates",
          latest_user_message: params.latestUserMessage,
          user_messages: cleanedMessages,
          candidate_equipment: uniqueCandidates,
        },
      });
      addTokens(accum, inputTokens, outputTokens, config);

      const rawItems = result.items;
      const normalized = Array.isArray(rawItems)
        ? rawItems
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
        : [];

      const seen = new Set<string>();
      const unique: string[] = [];
      for (const item of normalized) {
        const key = item.toLocaleLowerCase();
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        unique.push(item);
      }

      const safeOutput = unique.slice(0, 32);
      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "equipment_filter",
        Date.now() - startedAt,
        "ok",
        {
          task: "filter_equipment_preference_updates",
          candidate_count: uniqueCandidates.length,
          output_count: safeOutput.length,
        },
        accum,
      );

      return safeOutput;
    } catch (error) {
      const errorCode = error instanceof ApiError
        ? error.code
        : "unknown_error";
      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "equipment_filter",
        Date.now() - startedAt,
        "error",
        {
          task: "filter_equipment_preference_updates",
          error_code: errorCode,
        },
        accum,
      );
      return [];
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

  async generateRecipeImage(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    recipe: RecipePayload;
    context: Record<string, JsonValue>;
    modelOverride?: { provider: string; model: string };
    modelConfigOverride?: Record<string, JsonValue>;
    eventPayload?: Record<string, JsonValue>;
  }): Promise<string> {
    const detailed = await llmGateway.generateRecipeImageDetailed(params);
    return detailed.imageUrl;
  },

  async generateRecipeImageDetailed(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    recipe: RecipePayload;
    context: Record<string, JsonValue>;
    modelOverride?: { provider: string; model: string };
    modelConfigOverride?: Record<string, JsonValue>;
    eventPayload?: Record<string, JsonValue>;
  }): Promise<{
    imageUrl: string;
    provider: string;
    model: string;
    latencyMs: number;
    costUsd: number;
    prompt: string;
    config: GatewayConfig;
  }> {
    const startedAt = Date.now();
    let config: GatewayConfig | null = null;
    try {
      config = await getActiveConfig(params.client, "image", params.modelOverride);
      const runtimeModelConfig = {
        ...config.modelConfig,
        ...(params.modelConfigOverride ?? {}),
      };
      const runtimeConfig: GatewayConfig = {
        ...config,
        modelConfig: runtimeModelConfig,
      };
      const imagePrompt = buildRecipeImagePrompt({
        config: runtimeConfig,
        recipe: params.recipe,
        context: params.context,
      });
      const costUsd = estimateImageGenerationCostUsd(runtimeConfig);

      const imageUrl = await callImageProvider({
        provider: runtimeConfig.provider,
        model: runtimeConfig.model,
        modelConfig: runtimeConfig.modelConfig,
        prompt: imagePrompt,
      });

      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "image",
        Date.now() - startedAt,
        "ok",
        {
          provider: runtimeConfig.provider,
          model: runtimeConfig.model,
          billing_mode: runtimeConfig.billingMode,
          ...(params.eventPayload ?? {}),
        },
        undefined,
        costUsd,
      );

      return {
        imageUrl,
        provider: runtimeConfig.provider,
        model: runtimeConfig.model,
        latencyMs: Date.now() - startedAt,
        costUsd,
        prompt: imagePrompt,
        config: runtimeConfig,
      };
    } catch (error) {
      const errorCode = error instanceof ApiError
        ? error.code
        : "unknown_error";
      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "image",
        Date.now() - startedAt,
        "error",
        {
          provider: config?.provider ?? null,
          model: config?.model ?? null,
          error_code: errorCode,
          error_details: error instanceof ApiError
            ? error.details ?? null
            : null,
          ...(params.eventPayload ?? {}),
        },
      );
      throw error;
    }
  },

  async evaluateImageQualityPair(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    scenario: {
      id: string;
      title: string;
      description: string;
      heroIngredients: string[];
      visualBrief: string;
    };
    laneA: { imageUrl: string; provider: string; model: string };
    laneB: { imageUrl: string; provider: string; model: string };
  }): Promise<{
    winner: ImageQualityWinner;
    rationale: string;
    confidence: number | null;
    provider: string;
    model: string;
    latencyMs: number;
  }> {
    const startedAt = Date.now();
    const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };
    let config: GatewayConfig | null = null;

    try {
      const {
        result,
        inputTokens,
        outputTokens,
        config: resolvedConfig,
      } = await executeVisionScope<ImageQualityEvaluationResult>({
        client: params.client,
        scope: "image_quality_eval",
        userInput: {
          scenario: {
            id: params.scenario.id,
            title: params.scenario.title,
            description: params.scenario.description,
            hero_ingredients: params.scenario.heroIngredients,
            visual_brief: params.scenario.visualBrief,
          },
          comparison_focus: "visual_quality_only",
          lane_a: {
            label: "A",
            provider: params.laneA.provider,
            model: params.laneA.model,
          },
          lane_b: {
            label: "B",
            provider: params.laneB.provider,
            model: params.laneB.model,
          },
        },
        images: [
          { label: "A", imageUrl: params.laneA.imageUrl },
          { label: "B", imageUrl: params.laneB.imageUrl },
        ],
      });
      config = resolvedConfig;
      addTokens(accum, inputTokens, outputTokens, resolvedConfig);

      const evaluation = normalizeImageQualityEvaluation(result);
      if (!evaluation) {
        throw new ApiError(
          422,
          "image_quality_eval_invalid",
          "Image quality evaluation did not match required schema",
        );
      }

      const latencyMs = Date.now() - startedAt;
      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "image_quality_eval",
        latencyMs,
        "ok",
        {
          provider: resolvedConfig.provider,
          model: resolvedConfig.model,
          scenario_id: params.scenario.id,
          lane_a_model: `${params.laneA.provider}/${params.laneA.model}`,
          lane_b_model: `${params.laneB.provider}/${params.laneB.model}`,
          winner: evaluation.winner,
        },
        accum,
      );

      return {
        ...evaluation,
        provider: resolvedConfig.provider,
        model: resolvedConfig.model,
        latencyMs,
      };
    } catch (error) {
      const errorCode = error instanceof ApiError
        ? error.code
        : "unknown_error";
      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "image_quality_eval",
        Date.now() - startedAt,
        "error",
        {
          provider: config?.provider ?? null,
          model: config?.model ?? null,
          scenario_id: params.scenario.id,
          error_code: errorCode,
        },
        accum,
      );
      throw error;
    }
  },

  async evaluateRecipeImageReuse(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    targetRecipe: RecipePayload;
    targetTitle: string;
    targetSearchText: string;
    candidates: Array<{
      id: string;
      title: string;
      imageUrl: string;
      recipeId?: string | null;
      recipeVersionId?: string | null;
    }>;
    modelOverrides?: { provider: string; model: string };
  }): Promise<{
    decision: ImageReuseDecision;
    selectedCandidateId: string | null;
    rationale: string;
    confidence: number | null;
    provider: string;
    model: string;
    latencyMs: number;
  }> {
    const startedAt = Date.now();
    const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };
    let config: GatewayConfig | null = null;

    try {
      const {
        result,
        inputTokens,
        outputTokens,
        config: resolvedConfig,
      } = await executeVisionScope<{
        decision?: unknown;
        selected_candidate_id?: unknown;
        rationale?: unknown;
        confidence?: unknown;
      }>({
        client: params.client,
        scope: "image_reuse_eval",
        userInput: {
          target_recipe: params.targetRecipe as unknown as JsonValue,
          target_title: params.targetTitle,
          target_search_text: params.targetSearchText,
          candidates: params.candidates.map((candidate) => ({
            id: candidate.id,
            title: candidate.title,
            recipe_id: candidate.recipeId ?? null,
            recipe_version_id: candidate.recipeVersionId ?? null,
          })),
        },
        images: params.candidates.map((candidate) => ({
          label: candidate.id,
          imageUrl: candidate.imageUrl,
        })),
        modelOverride: params.modelOverrides,
      });
      config = resolvedConfig;
      addTokens(accum, inputTokens, outputTokens, resolvedConfig);

      const evaluation = normalizeImageReuseEvaluation(
        result,
        new Set(params.candidates.map((candidate) => candidate.id)),
      );
      if (!evaluation) {
        throw new ApiError(
          422,
          "image_reuse_eval_invalid",
          "Image reuse evaluation did not match required schema",
        );
      }

      const latencyMs = Date.now() - startedAt;
      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "image_reuse_eval",
        latencyMs,
        "ok",
        {
          provider: resolvedConfig.provider,
          model: resolvedConfig.model,
          decision: evaluation.decision,
          selected_candidate_id: evaluation.selectedCandidateId,
          candidate_count: params.candidates.length,
        },
        accum,
      );

      return {
        ...evaluation,
        provider: resolvedConfig.provider,
        model: resolvedConfig.model,
        latencyMs,
      };
    } catch (error) {
      const errorCode = error instanceof ApiError
        ? error.code
        : "unknown_error";
      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "image_reuse_eval",
        Date.now() - startedAt,
        "error",
        {
          provider: config?.provider ?? null,
          model: config?.model ?? null,
          error_code: errorCode,
          candidate_count: params.candidates.length,
        },
        accum,
      );
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
    const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };
    const config = await getActiveConfig(params.client, "memory_extract");

    const { result: output, inputTokens, outputTokens } = await callProvider<
      { memories: MemoryCandidate[] }
    >({
      provider: config.provider,
      model: config.model,
      modelConfig: config.modelConfig,
      systemPrompt: config.promptTemplate,
      userInput: {
        rule: config.rule,
        context: params.context,
      },
    });
    addTokens(accum, inputTokens, outputTokens, config);

    const records = (output.memories ?? [])
      .filter((item) =>
        typeof item.memory_type === "string" &&
        item.memory_type.trim().length > 0
      )
      .map((item) => ({
        memory_type: item.memory_type.trim(),
        memory_kind: typeof item.memory_kind === "string"
          ? item.memory_kind
          : "preference",
        memory_content: item.memory_content,
        confidence: Number.isFinite(Number(item.confidence))
          ? Math.max(0, Math.min(1, Number(item.confidence)))
          : 0.5,
        salience: Number.isFinite(Number(item.salience))
          ? Math.max(0, Math.min(1, Number(item.salience)))
          : 0.5,
        source: typeof item.source === "string" && item.source.trim().length > 0
          ? item.source.trim()
          : "llm_extract",
      }));

    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "memory_extract",
      Date.now() - startedAt,
      "ok",
      {
        extracted_count: records.length,
      },
      accum,
    );

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
    const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };
    const config = await getActiveConfig(params.client, "memory_select");

    const { result: output, inputTokens, outputTokens } = await callProvider<
      MemorySelection
    >({
      provider: config.provider,
      model: config.model,
      modelConfig: config.modelConfig,
      systemPrompt: config.promptTemplate,
      userInput: {
        rule: config.rule,
        prompt: params.prompt,
        context: params.context,
        memories: params.memories,
      },
    });
    addTokens(accum, inputTokens, outputTokens, config);

    const selected = Array.isArray(output.selected_memory_ids)
      ? output.selected_memory_ids.filter((value): value is string =>
        typeof value === "string"
      )
      : [];

    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "memory_select",
      Date.now() - startedAt,
      "ok",
      {
        selected_count: selected.length,
      },
      accum,
    );

    return {
      selected_memory_ids: selected,
      rationale: output.rationale,
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
    const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };
    const config = await getActiveConfig(params.client, "memory_summarize");

    const { result: output, inputTokens, outputTokens } = await callProvider<
      MemorySummary
    >({
      provider: config.provider,
      model: config.model,
      modelConfig: config.modelConfig,
      systemPrompt: config.promptTemplate,
      userInput: {
        rule: config.rule,
        memories: params.memories,
        context: params.context,
      },
    });
    addTokens(accum, inputTokens, outputTokens, config);

    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "memory_summarize",
      Date.now() - startedAt,
      "ok",
      undefined,
      accum,
    );

    return {
      summary: output.summary ?? {},
      token_estimate: Number.isFinite(Number(output.token_estimate))
        ? Number(output.token_estimate)
        : 0,
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
    const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };
    const config = await getActiveConfig(
      params.client,
      "memory_conflict_resolve",
    );

    const { result: output, inputTokens, outputTokens } = await callProvider<
      ConflictResolution
    >({
      provider: config.provider,
      model: config.model,
      modelConfig: config.modelConfig,
      systemPrompt: config.promptTemplate,
      userInput: {
        rule: config.rule,
        existing_memories: params.existingMemories,
        candidate_memories: params.candidates,
      },
    });
    addTokens(accum, inputTokens, outputTokens, config);

    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "memory_conflict_resolve",
      Date.now() - startedAt,
      "ok",
      {
        actions_count: Array.isArray(output.actions)
          ? output.actions.length
          : 0,
      },
      accum,
    );

    return {
      actions: Array.isArray(output.actions) ? output.actions : [],
    };
  },

  /**
   * Generate a short, personalized greeting for the Generate Recipe screen.
   * This is a non-critical, lightweight creative call — failures always return
   * a safe fallback string and never throw.
   */
  async generateGreeting(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    userName: string | null;
    timeOfDay: string;
    lastRecipeTitle: string | null;
  }): Promise<{ text: string }> {
    const FALLBACK_TEXT = "Hey Chef! What are we cooking?";
    const startedAt = Date.now();
    const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };

    try {
      const { result, inputTokens, outputTokens, config } = await executeScope<
        { text?: unknown }
      >({
        client: params.client,
        scope: "chat_greeting",
        userInput: {
          task: "generate_greeting",
          user_name: params.userName,
          time_of_day: params.timeOfDay,
          last_recipe_title: params.lastRecipeTitle,
        },
      });
      addTokens(accum, inputTokens, outputTokens, config);

      const text = typeof result.text === "string" && result.text.trim().length > 0
        ? result.text.trim()
        : FALLBACK_TEXT;

      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "chat_greeting",
        Date.now() - startedAt,
        "ok",
        {
          task: "generate_greeting",
          has_user_name: params.userName !== null,
          has_last_recipe: params.lastRecipeTitle !== null,
        },
        accum,
      );

      return { text };
    } catch (error) {
      const errorCode = error instanceof ApiError
        ? error.code
        : "unknown_error";
      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        "chat_greeting",
        Date.now() - startedAt,
        "error",
        {
          task: "generate_greeting",
          error_code: errorCode,
        },
        accum,
      );
      return { text: FALLBACK_TEXT };
    }
  },

  /**
   * Materialises a personalised recipe variant from a canonical recipe base.
   *
   * Uses the `recipe_personalize` LLM scope with prompt/rule/route loaded
   * from the database via admin API pipeline.
   *
   * Input context must include:
   *   - canonical_recipe: the canonical recipe payload (JSON)
   *   - user_preferences: structured preference profile
   *   - graph_substitutions (optional): known substitutions from knowledge graph
   *   - manual_edit_instructions (optional): explicit user changes
   *
   * Returns: { recipe, adaptation_summary, applied_adaptations, tag_diff }
   */
  async personalizeRecipe(params: {
    client: SupabaseClient;
    userId: string;
    requestId: string;
    canonicalPayload: RecipePayload;
    preferences: Record<string, JsonValue>;
    graphSubstitutions?: Record<string, JsonValue>[];
    manualEditInstructions?: string;
    modelOverrides?: ModelOverrideMap;
  }): Promise<PersonalizeRecipeResult> {
    const startedAt = Date.now();
    const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };
    const scope: GatewayScope = "recipe_personalize";

    try {
      const config = await getActiveConfig(
        params.client,
        scope,
        params.modelOverrides?.[scope],
      );

      const runtimeModelConfig = cleanLegacyModelConfig(config.modelConfig);
      if (!Number.isFinite(Number(runtimeModelConfig.temperature))) {
        runtimeModelConfig.temperature = 0.4;
      }

      const userInput: Record<string, JsonValue> = {
        task: "personalize_recipe",
        canonical_recipe: params.canonicalPayload as unknown as JsonValue,
        user_preferences: params.preferences as unknown as JsonValue,
        rule: config.rule,
        contract: {
          format: "json_object",
          required_keys: [
            "recipe",
            "adaptation_summary",
            "applied_adaptations",
            "tag_diff",
          ],
        },
      };

      if (params.graphSubstitutions?.length) {
        userInput.graph_substitutions =
          params.graphSubstitutions as unknown as JsonValue;
      }
      if (params.manualEditInstructions?.trim()) {
        userInput.manual_edit_instructions = params.manualEditInstructions;
      }

      const { result, inputTokens, outputTokens } = await callProvider<
        Record<string, JsonValue>
      >({
        provider: config.provider,
        model: config.model,
        modelConfig: runtimeModelConfig,
        systemPrompt: config.promptTemplate,
        userInput,
      });

      if (accum) {
        const inputCost =
          (inputTokens / 1_000_000) * config.inputCostPer1m;
        const outputCost =
          (outputTokens / 1_000_000) * config.outputCostPer1m;
        accum.input += inputTokens;
        accum.output += outputTokens;
        accum.costUsd += inputCost + outputCost;
      }

      const recipe = result.recipe as RecipePayload | undefined;
      if (!recipe || typeof recipe !== "object") {
        throw new ApiError(
          500,
          "personalize_invalid_output",
          "LLM did not return a valid recipe payload",
        );
      }

      const adaptationSummary =
        typeof result.adaptation_summary === "string"
          ? result.adaptation_summary
          : "";

      const appliedAdaptations = Array.isArray(result.applied_adaptations)
        ? (result.applied_adaptations as JsonValue[])
        : [];

      const tagDiff =
        result.tag_diff && typeof result.tag_diff === "object"
          ? (result.tag_diff as { added?: string[]; removed?: string[] })
          : { added: [], removed: [] };

      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        scope,
        Date.now() - startedAt,
        "ok",
        {
          adaptations_count: appliedAdaptations.length,
          tags_added: (tagDiff.added ?? []).length,
          tags_removed: (tagDiff.removed ?? []).length,
        },
        accum,
      );

      return {
        recipe,
        adaptationSummary,
        appliedAdaptations,
        tagDiff: {
          added: tagDiff.added ?? [],
          removed: tagDiff.removed ?? [],
        },
      };
    } catch (error) {
      const errorCode =
        error instanceof ApiError ? error.code : "unknown_error";
      await logLlmEvent(
        params.client,
        params.userId,
        params.requestId,
        scope,
        Date.now() - startedAt,
        "error",
        { error_code: errorCode },
        accum,
      );
      throw error;
    }
  },
};
