import {
  ApiError,
  requireJsonBody,
} from "../../../_shared/errors.ts";
import type {
  JsonValue,
  RecipePayload,
} from "../../../_shared/types.ts";
import { getInstallIdFromHeaders, logBehaviorEvents } from "../../lib/behavior-events.ts";
import { materializeRecipeVariant } from "../../lib/variant-materialization.ts";
import { fetchCanonicalIngredientRows } from "../../lib/recipe-enrichment.ts";
import { projectRecipePayloadForView } from "../../lib/recipe-persistence.ts";
import type { RouteContext, VariantStatus } from "../shared.ts";
import type { RecipesDeps } from "./types.ts";

export const handleVariantRoutes = async (
  context: RouteContext,
  deps: RecipesDeps,
): Promise<Response | null> => {
  const { request, url, segments, method, auth, client, serviceClient, requestId, respond, modelOverrides } =
    context;
  const {
    parseUuid,
    getPreferences,
    resolvePresentationOptions,
    fetchRecipeView,
    logChangelog,
    computePreferenceFingerprint,
    computeVariantTags,
    fetchGraphSubstitutions,
    enqueueDemandExtractionJob,
    scheduleDemandQueueDrain,
  } = deps;

  // ── GET /recipes/{id}/variant ──
  // Returns the user's personalised variant for a canonical recipe.
  if (
    segments.length === 3 &&
    segments[0] === "recipes" &&
    segments[2] === "variant" &&
    method === "GET"
  ) {
    const recipeId = parseUuid(segments[1]);
    const installId = getInstallIdFromHeaders(request);

    const { data: variant, error: variantError } = await client
      .from("user_recipe_variants")
      .select(
        "id, current_version_id, base_canonical_version_id, preference_fingerprint, stale_status, last_materialized_at",
      )
      .eq("user_id", auth.userId)
      .eq("canonical_recipe_id", recipeId)
      .maybeSingle();

    if (variantError) {
      throw new ApiError(
        500,
        "variant_fetch_failed",
        "Could not fetch variant",
        variantError.message,
      );
    }

    if (!variant || !variant.current_version_id) {
      throw new ApiError(
        404,
        "variant_not_found",
        "No variant exists for this user and recipe",
      );
    }

    const { data: variantVersion, error: versionError } = await client
      .from("user_recipe_variant_versions")
      .select(
        "id, payload, derivation_kind, provenance, source_canonical_version_id, created_at",
      )
      .eq("id", variant.current_version_id)
      .single();

    if (versionError || !variantVersion) {
      throw new ApiError(
        500,
        "variant_version_fetch_failed",
        "Could not fetch variant version",
        versionError?.message,
      );
    }

    const payload = variantVersion.payload as Record<string, JsonValue>;
    const provenance = variantVersion.provenance as Record<string, JsonValue>;

    // Apply rendering-only presentation options (units, groupBy, inline measurements).
    const preferences = await getPreferences(client, auth.userId);
    const viewOptions = resolvePresentationOptions({
      query: url.searchParams,
      presentationPreferences:
        preferences.presentation_preferences as Record<string, unknown>,
    });

    // Build a recipe view from the variant payload using the same projection
    // as canonical reads, but sourcing from the variant's payload.
    const canonicalRecipe = await fetchRecipeView(
      client,
      recipeId,
      true,
      viewOptions,
    );

    const canonicalRows = await fetchCanonicalIngredientRows(
      client,
      variant.base_canonical_version_id ??
        variantVersion.source_canonical_version_id ??
        canonicalRecipe.version.version_id,
    );
    const projectedVariantPayload = projectRecipePayloadForView({
      payload: payload as RecipePayload,
      canonicalRows,
      options: viewOptions,
    });

    // Overlay variant payload fields onto the canonical recipe view.
    // The variant payload has the same structure as recipe_versions.payload,
    // but still needs the same render-time projection as canonical reads.
    const variantRecipe = {
      ...canonicalRecipe,
      description: projectedVariantPayload.description,
      summary: projectedVariantPayload.summary,
      ingredients: projectedVariantPayload.ingredients,
      ingredient_groups: projectedVariantPayload.ingredient_groups,
      steps: projectedVariantPayload.steps,
      notes: projectedVariantPayload.notes,
      pairings: projectedVariantPayload.pairings,
      metadata: projectedVariantPayload.metadata,
      emoji: projectedVariantPayload.emoji,
    };

    return respond(200, {
      variant_id: variant.id,
      variant_version_id: variantVersion.id,
      canonical_recipe_id: recipeId,
      recipe: variantRecipe,
      adaptation_summary:
        (provenance.adaptation_summary as string) ?? "",
      variant_status: variant.stale_status as VariantStatus,
      derivation_kind: variantVersion.derivation_kind,
      personalized_at:
        variant.last_materialized_at ?? variantVersion.created_at,
      tag_diff: (provenance.tag_diff as JsonValue) ?? { added: [], removed: [] },
      substitution_diffs:
        (provenance.substitution_diffs as JsonValue) ?? [],
      provenance,
    });
  }

  // ── POST /recipes/{id}/variant/refresh ──
  // Creates or refreshes the user's personalised variant by calling the
  // recipe_personalize LLM scope. Pipeline:
  //   1. Load canonical payload + user preferences
  //   2. LLM generates personalised recipe + adaptation metadata
  //   3. Insert new variant version (or create variant row if first time)
  //   4. Return the materialised variant state
  if (
    segments.length === 4 &&
    segments[0] === "recipes" &&
    segments[2] === "variant" &&
    segments[3] === "refresh" &&
    method === "POST"
  ) {
    const recipeId = parseUuid(segments[1]);
    const installId = getInstallIdFromHeaders(request);

    // 1. Load canonical recipe + its current version payload.
    const { data: recipe, error: recipeError } = await client
      .from("recipes")
      .select("id, current_version_id")
      .eq("id", recipeId)
      .maybeSingle();

    if (recipeError || !recipe || !recipe.current_version_id) {
      throw new ApiError(
        404,
        "recipe_not_found",
        "Canonical recipe not found",
        recipeError?.message,
      );
    }

    const { data: canonicalVersion, error: cvError } = await client
      .from("recipe_versions")
      .select("id, payload")
      .eq("id", recipe.current_version_id)
      .single();

    if (cvError || !canonicalVersion) {
      throw new ApiError(
        500,
        "canonical_version_fetch_failed",
        "Could not load canonical recipe version",
        cvError?.message,
      );
    }

    const canonicalPayload = canonicalVersion.payload as RecipePayload;

    // 2. Load user preferences for materialization.
    const preferences = await getPreferences(client, auth.userId);

    // Parse optional manual edit instructions from request body.
    let manualEditInstructions: string | undefined;
    try {
      const body = await requireJsonBody<{ instructions?: string }>(request);
      if (body.instructions?.trim()) {
        manualEditInstructions = body.instructions.trim();
      }
    } catch {
      // Body is optional for refresh.
    }

    // 3. Check for existing variant row (including accumulated manual edits).
    const { data: existingVariant } = await client
      .from("user_recipe_variants")
      .select("id, current_version_id, accumulated_manual_edits")
      .eq("user_id", auth.userId)
      .eq("canonical_recipe_id", recipeId)
      .maybeSingle();

    const materializedVariant = await materializeRecipeVariant({
      llmClient: serviceClient,
      serviceClient,
      userId: auth.userId,
      requestId,
      recipeId,
      canonicalVersionId: canonicalVersion.id,
      canonicalPayload,
      preferences,
      computePreferenceFingerprint,
      computeVariantTags,
      fetchGraphSubstitutions,
      existingVariant,
      manualEditInstructions,
      modelOverrides,
    });

    await logChangelog({
      serviceClient,
      actorUserId: auth.userId,
      scope: "variants",
      entityType: "user_recipe_variant",
      entityId: materializedVariant.variantId,
      action: existingVariant ? "refreshed" : "created",
      requestId,
      afterJson: {
        canonical_recipe_id: recipeId,
        derivation_kind: materializedVariant.derivationKind,
        adaptations_count: Array.isArray(
          materializedVariant.provenance["applied_adaptations"],
        )
          ? materializedVariant.provenance["applied_adaptations"].length
          : 0,
      } as unknown as JsonValue,
    });

    await logBehaviorEvents({
      serviceClient,
      events: [{
        eventId: crypto.randomUUID(),
        userId: auth.userId,
        installId,
        eventType: "variant_refreshed",
        entityType: "recipe",
        entityId: recipeId,
        payload: {
          variant_id: materializedVariant.variantId,
          variant_version_id: materializedVariant.variantVersionId,
          has_manual_edits: Boolean(manualEditInstructions),
          substitution_count: Array.isArray(
              materializedVariant.provenance["substitution_diffs"],
            )
            ? materializedVariant.provenance["substitution_diffs"].length
            : 0,
        },
      }],
    });

    if (enqueueDemandExtractionJob) {
      await enqueueDemandExtractionJob({
        serviceClient,
        sourceKind: "variant_refresh",
        sourceId: materializedVariant.variantVersionId,
        userId: auth.userId,
        stage: manualEditInstructions ? "iteration" : "feedback",
        extractorScope: manualEditInstructions
          ? "demand_extract_iteration_delta"
          : "demand_summarize_outcome_reason",
        observedAt: materializedVariant.personalizedAt,
        payload: {
          recipe_id: recipeId,
          variant_id: materializedVariant.variantId,
          variant_version_id: materializedVariant.variantVersionId,
          manual_edit_instructions: (manualEditInstructions ?? null) as JsonValue,
          adaptation_summary:
            ((materializedVariant.provenance["adaptation_summary"] as string) ?? null) as JsonValue,
          substitution_diffs:
            (Array.isArray(materializedVariant.provenance["substitution_diffs"])
              ? materializedVariant.provenance["substitution_diffs"]
              : []) as JsonValue,
          conflicts: materializedVariant.conflicts as unknown as JsonValue,
          provenance: materializedVariant.provenance as JsonValue,
        },
      });
      scheduleDemandQueueDrain?.({
        serviceClient,
        actorUserId: auth.userId,
        requestId,
        limit: 1,
      });
    }

    return respond(200, {
      variant_id: materializedVariant.variantId,
      variant_version_id: materializedVariant.variantVersionId,
      variant_status: materializedVariant.variantStatus,
      adaptation_summary:
        (materializedVariant.provenance["adaptation_summary"] as string) ?? "",
      substitution_diffs: Array.isArray(
          materializedVariant.provenance["substitution_diffs"],
        )
        ? materializedVariant.provenance["substitution_diffs"] as JsonValue[]
        : undefined,
      conflicts: materializedVariant.conflicts.length > 0
        ? materializedVariant.conflicts
        : undefined,
    });
  }

  return null;
};
