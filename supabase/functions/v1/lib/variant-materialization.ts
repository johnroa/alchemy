import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { ModelOverrideMap } from "../../_shared/llm-gateway.ts";
import { llmGateway } from "../../_shared/llm-gateway.ts";
import { ApiError } from "../../_shared/errors.ts";
import type { JsonValue, RecipePayload } from "../../_shared/types.ts";
import type { PreferenceContext, VariantStatus } from "../routes/shared.ts";

type StoredManualEdit = {
  instruction: string;
  created_at: string;
};

type VariantRowSeed = {
  id: string;
  current_version_id: string | null;
  accumulated_manual_edits?: unknown;
} | null | undefined;

const normalizeStoredManualEdits = (value: unknown): StoredManualEdit[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const instruction = typeof record.instruction === "string"
      ? record.instruction.trim()
      : "";
    const createdAt = typeof record.created_at === "string"
      ? record.created_at
      : "";
    if (!instruction || !createdAt) {
      return [];
    }
    return [{ instruction, created_at: createdAt }];
  });
};

export const buildVariantPreferenceContext = (
  preferences: PreferenceContext,
): Record<string, JsonValue> => ({
  dietary_preferences: preferences.dietary_preferences as unknown as JsonValue,
  dietary_restrictions: preferences.dietary_restrictions as unknown as JsonValue,
  skill_level: preferences.skill_level as unknown as JsonValue,
  equipment: preferences.equipment as unknown as JsonValue,
  cuisines: preferences.cuisines as unknown as JsonValue,
  aversions: preferences.aversions as unknown as JsonValue,
  cooking_for: (preferences.cooking_for ?? null) as unknown as JsonValue,
  max_difficulty: preferences.max_difficulty as unknown as JsonValue,
  presentation_preferences: preferences.presentation_preferences as unknown as JsonValue,
});

export const buildVariantConstraintList = (
  preferences: PreferenceContext,
): string[] =>
  [
    ...(Array.isArray(preferences.dietary_restrictions)
      ? preferences.dietary_restrictions
      : []),
    ...(Array.isArray(preferences.aversions) ? preferences.aversions : []),
  ].map((value) => String(value).toLowerCase());

const loadExistingVariantSeed = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  cookbookEntryId: string;
}): Promise<VariantRowSeed> => {
  const { data, error } = await params.serviceClient
    .from("user_recipe_variants")
    .select("id,current_version_id,accumulated_manual_edits")
    .eq("user_id", params.userId)
    .eq("cookbook_entry_id", params.cookbookEntryId)
    .maybeSingle();

  if (error) {
    throw new ApiError(
      500,
      "variant_seed_fetch_failed",
      "Could not load existing variant state",
      error.message,
    );
  }

  return data;
};

export const materializeRecipeVariant = async (params: {
  llmClient: SupabaseClient;
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  cookbookEntryId: string;
  recipeId?: string | null;
  canonicalVersionId?: string | null;
  canonicalPayload: RecipePayload;
  preferences: PreferenceContext;
  computePreferenceFingerprint: (
    preferences: PreferenceContext,
  ) => Promise<string | null>;
  computeVariantTags: (params: {
    canonicalPayload: RecipePayload;
    variantPayload: RecipePayload;
    tagDiff: { added: string[]; removed: string[] };
  }) => Record<string, unknown>;
  fetchGraphSubstitutions: (params: {
    serviceClient: SupabaseClient;
    recipeVersionId: string;
    constraints: string[];
  }) => Promise<Record<string, JsonValue>[]>;
  existingVariant?: VariantRowSeed;
  manualEditInstructions?: string;
  modelOverrides?: ModelOverrideMap;
}): Promise<{
  variantId: string;
  variantVersionId: string;
  variantStatus: VariantStatus;
  personalizedAt: string;
  derivationKind: string;
  provenance: Record<string, JsonValue>;
  variantTags: Record<string, unknown>;
  recipe: RecipePayload;
  conflicts: string[];
}> => {
  const preferenceContext = buildVariantPreferenceContext(params.preferences);
  const userConstraints = buildVariantConstraintList(params.preferences);
  const graphSubstitutions = userConstraints.length > 0
    ? params.canonicalVersionId
      ? await params.fetchGraphSubstitutions({
        serviceClient: params.serviceClient,
        recipeVersionId: params.canonicalVersionId,
        constraints: userConstraints,
      })
      : []
    : [];

  const existingVariant = params.existingVariant === undefined
    ? await loadExistingVariantSeed({
      serviceClient: params.serviceClient,
      userId: params.userId,
      cookbookEntryId: params.cookbookEntryId,
    })
    : params.existingVariant;
  const storedEdits = normalizeStoredManualEdits(
    existingVariant?.accumulated_manual_edits,
  );

  const result = await llmGateway.personalizeRecipe({
    client: params.llmClient,
    userId: params.userId,
    requestId: params.requestId,
    canonicalPayload: params.canonicalPayload,
    preferences: preferenceContext,
    graphSubstitutions: graphSubstitutions.length > 0
      ? graphSubstitutions
      : undefined,
    manualEditInstructions: params.manualEditInstructions,
    accumulatedManualEdits: storedEdits.length > 0 ? storedEdits : undefined,
    modelOverrides: params.modelOverrides,
  });

  const fingerprint = await params.computePreferenceFingerprint(params.preferences);
  const provenance: Record<string, JsonValue> = {
    adaptation_summary: result.adaptationSummary,
    applied_adaptations: result.appliedAdaptations as JsonValue,
    tag_diff: result.tagDiff as unknown as JsonValue,
    substitution_diffs: result.substitutionDiffs as unknown as JsonValue,
    preference_fingerprint: fingerprint,
  };

  if (params.manualEditInstructions) {
    provenance.manual_edit_instructions = params.manualEditInstructions;
  }
  if (storedEdits.length > 0) {
    provenance.replayed_manual_edits = storedEdits as unknown as JsonValue;
  }
  if (result.conflicts.length > 0) {
    provenance.conflicts = result.conflicts as unknown as JsonValue;
  }

  const hasManualInput = Boolean(params.manualEditInstructions) ||
    storedEdits.length > 0;
  const derivationKind = hasManualInput ? "mixed" : "auto_personalized";
  const variantStatus: VariantStatus = result.conflicts.length > 0
    ? "needs_review"
    : "current";
  const variantTags = params.computeVariantTags({
    canonicalPayload: params.canonicalPayload,
    variantPayload: result.recipe,
    tagDiff: result.tagDiff,
  });
  const personalizedAt = new Date().toISOString();
  const updatedManualEdits = params.manualEditInstructions
    ? [
      ...storedEdits,
      {
        instruction: params.manualEditInstructions,
        created_at: personalizedAt,
      },
    ]
    : storedEdits;
  const variantId = existingVariant?.id ?? crypto.randomUUID();

  if (!existingVariant) {
    const { error: variantInsertError } = await params.serviceClient
      .from("user_recipe_variants")
      .insert({
        id: variantId,
        user_id: params.userId,
        cookbook_entry_id: params.cookbookEntryId,
        canonical_recipe_id: params.recipeId ?? null,
        current_version_id: null,
        base_canonical_version_id: params.canonicalVersionId ?? null,
        preference_fingerprint: fingerprint,
        stale_status: variantStatus,
        accumulated_manual_edits: updatedManualEdits,
        variant_tags: variantTags,
        last_materialized_at: personalizedAt,
      });

    if (variantInsertError) {
      throw new ApiError(
        500,
        "variant_insert_failed",
        "Could not create variant",
        variantInsertError.message,
      );
    }
  }

  const { data: newVersion, error: versionInsertError } = await params
    .serviceClient
    .from("user_recipe_variant_versions")
    .insert({
      variant_id: variantId,
      parent_variant_version_id: existingVariant?.current_version_id ?? null,
      source_canonical_version_id: params.canonicalVersionId ?? null,
      payload: result.recipe as unknown as JsonValue,
      derivation_kind: derivationKind,
      provenance,
    })
    .select("id")
    .single();

  if (versionInsertError || !newVersion) {
    throw new ApiError(
      500,
      "variant_version_insert_failed",
      "Could not save personalised variant version",
      versionInsertError?.message,
    );
  }

  const { error: variantUpdateError } = await params.serviceClient
    .from("user_recipe_variants")
    .update({
      current_version_id: newVersion.id,
      canonical_recipe_id: params.recipeId ?? null,
      base_canonical_version_id: params.canonicalVersionId ?? null,
      preference_fingerprint: fingerprint,
      stale_status: variantStatus,
      accumulated_manual_edits: updatedManualEdits,
      variant_tags: variantTags,
      last_materialized_at: personalizedAt,
    })
    .eq("id", variantId);

  if (variantUpdateError) {
    throw new ApiError(
      500,
      "variant_update_failed",
      "Could not update variant",
      variantUpdateError.message,
    );
  }

  const { error: cookbookUpdateError } = await params.serviceClient
    .from("cookbook_entries")
    .update({
      active_variant_id: variantId,
      updated_at: personalizedAt,
    })
    .eq("id", params.cookbookEntryId)
    .eq("user_id", params.userId);

  if (cookbookUpdateError) {
    throw new ApiError(
      500,
      "cookbook_variant_link_failed",
      "Could not link the active variant to the cookbook entry",
      cookbookUpdateError.message,
    );
  }

  return {
    variantId,
    variantVersionId: newVersion.id,
    variantStatus,
    personalizedAt,
    derivationKind,
    provenance,
    variantTags,
    recipe: result.recipe,
    conflicts: result.conflicts,
  };
};
