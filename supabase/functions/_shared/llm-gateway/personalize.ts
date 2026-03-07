/**
 * llm-gateway/personalize.ts
 *
 * Recipe personalization: materialises a per-user variant from a
 * canonical recipe base using the recipe_personalize LLM scope.
 * Handles graph-grounded substitutions, manual edit replay,
 * conflict detection, and substitution diff extraction.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../errors.ts";
import type { GatewayScope, JsonValue, RecipePayload } from "../types.ts";
import type {
  ModelOverrideMap,
  PersonalizeRecipeResult,
  SubstitutionDiff,
  TokenAccum,
} from "./types.ts";
import { callProvider, cleanLegacyModelConfig, getActiveConfig, logLlmEvent } from "./config.ts";

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
 *   - manual_edit_instructions (optional): explicit user changes for this call
 *   - accumulated_manual_edits (optional): previously stored manual edits
 *     to replay during re-personalization
 *
 * Returns: { recipe, adaptation_summary, applied_adaptations, tag_diff, conflicts }
 */
export async function personalizeRecipe(params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  canonicalPayload: RecipePayload;
  preferences: Record<string, JsonValue>;
  graphSubstitutions?: Record<string, JsonValue>[];
  manualEditInstructions?: string;
  /** Previously stored manual edits to replay on re-personalization. */
  accumulatedManualEdits?: Array<{ instruction: string; created_at: string }>;
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
          "substitution_diffs",
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
    // Feed accumulated manual edits for replay during re-personalization.
    // These are prior user customizations that should be preserved across
    // constraint changes. The LLM should reapply them if compatible, or
    // flag conflicts in the "conflicts" output key.
    if (params.accumulatedManualEdits?.length) {
      userInput.accumulated_manual_edits =
        params.accumulatedManualEdits.map((e) => e.instruction) as unknown as JsonValue;
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

    // Substitution diffs: structured records of ingredient swaps.
    // Each entry has original (canonical ingredient), replacement (variant),
    // constraint (which user constraint triggered it), and reason.
    // Gracefully handles missing or malformed entries — the LLM may not
    // always produce this key until the prompt is updated.
    const substitutionDiffs: SubstitutionDiff[] = [];
    if (Array.isArray(result.substitution_diffs)) {
      for (const raw of result.substitution_diffs) {
        if (
          raw && typeof raw === "object" && !Array.isArray(raw) &&
          typeof (raw as Record<string, unknown>).original === "string" &&
          typeof (raw as Record<string, unknown>).replacement === "string"
        ) {
          const entry = raw as Record<string, unknown>;
          substitutionDiffs.push({
            original: entry.original as string,
            replacement: entry.replacement as string,
            constraint: typeof entry.constraint === "string"
              ? entry.constraint
              : "unspecified",
            reason: typeof entry.reason === "string"
              ? entry.reason
              : "",
          });
        }
      }
    }

    // Conflicts: manual edits that contradict the current constraint set.
    // The LLM returns these when accumulated_manual_edits were provided
    // but some conflict with the user's active constraints (e.g., "use
    // butter" vs. dairy-free). Presence of conflicts → needs_review.
    const conflicts = Array.isArray(result.conflicts)
      ? (result.conflicts as JsonValue[])
          .filter((c): c is string => typeof c === "string")
      : [];

    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      scope,
      Date.now() - startedAt,
      "ok",
      {
        adaptations_count: appliedAdaptations.length,
        substitution_count: substitutionDiffs.length,
        tags_added: (tagDiff.added ?? []).length,
        tags_removed: (tagDiff.removed ?? []).length,
        conflicts_count: conflicts.length,
        has_manual_edits: Boolean(
          params.manualEditInstructions || params.accumulatedManualEdits?.length,
        ),
        has_graph_substitutions: Boolean(params.graphSubstitutions?.length),
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
      substitutionDiffs,
      conflicts,
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
}
