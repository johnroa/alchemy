import {
  ApiError,
  requireJsonBody,
} from "../../../_shared/errors.ts";
import { llmGateway } from "../../../_shared/llm-gateway.ts";
import type {
  JsonValue,
  RecipePayload,
} from "../../../_shared/types.ts";
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

    // Overlay variant payload fields onto the canonical recipe view.
    // The variant payload has the same structure as recipe_versions.payload.
    const variantRecipe = {
      ...canonicalRecipe,
      description: (payload.description as string) ??
        (payload.summary as string) ??
        canonicalRecipe.description,
      summary: (payload.summary as string) ??
        (payload.description as string) ??
        canonicalRecipe.summary,
      ingredients: (payload.ingredients as JsonValue[]) ?? canonicalRecipe.ingredients,
      steps: (payload.steps as JsonValue[]) ?? canonicalRecipe.steps,
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

    // 2. Load user preferences and build preference context for the LLM.
    const preferences = await getPreferences(client, auth.userId);
    const preferenceContext: Record<string, JsonValue> = {
      dietary_preferences: preferences.dietary_preferences as unknown as JsonValue,
      dietary_restrictions: preferences.dietary_restrictions as unknown as JsonValue,
      skill_level: preferences.skill_level as unknown as JsonValue,
      equipment: preferences.equipment as unknown as JsonValue,
      cuisines: preferences.cuisines as unknown as JsonValue,
      aversions: preferences.aversions as unknown as JsonValue,
      cooking_for: (preferences.cooking_for ?? null) as unknown as JsonValue,
      max_difficulty: preferences.max_difficulty as unknown as JsonValue,
      presentation_preferences: preferences.presentation_preferences as unknown as JsonValue,
    };

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
    // Must be fetched before storedEdits reference and LLM call.
    const { data: existingVariant } = await client
      .from("user_recipe_variants")
      .select("id, current_version_id, accumulated_manual_edits")
      .eq("user_id", auth.userId)
      .eq("canonical_recipe_id", recipeId)
      .maybeSingle();

    // Load any previously stored manual edits for replay during
    // re-personalization (e.g., constraint change triggered refresh).
    const storedEdits = Array.isArray(existingVariant?.accumulated_manual_edits)
      ? (existingVariant.accumulated_manual_edits as Array<{
          instruction: string;
          created_at: string;
        }>)
      : [];

    // 4. Query graph for known substitution patterns relevant to the
    //    user's constraints. These ground the LLM in proven patterns
    //    (e.g., "wheat flour → almond flour" for gluten-free) instead
    //    of reinventing substitutions from scratch each time.
    const userConstraints = [
      ...(Array.isArray(preferenceContext.dietary_restrictions)
        ? preferenceContext.dietary_restrictions
        : []),
      ...(Array.isArray(preferenceContext.aversions)
        ? preferenceContext.aversions
        : []),
    ].map((c) => String(c).toLowerCase());

    const graphSubstitutions = userConstraints.length > 0
      ? await fetchGraphSubstitutions({
          serviceClient,
          recipeVersionId: canonicalVersion.id,
          constraints: userConstraints,
        })
      : [];

    // 5. Call LLM to materialise the personalised variant.
    // Both new instructions and accumulated edits are sent so the LLM
    // can apply everything in one pass and detect conflicts.
    const result = await llmGateway.personalizeRecipe({
      client,
      userId: auth.userId,
      requestId,
      canonicalPayload,
      preferences: preferenceContext,
      graphSubstitutions: graphSubstitutions.length > 0
        ? graphSubstitutions
        : undefined,
      manualEditInstructions,
      accumulatedManualEdits: storedEdits.length > 0 ? storedEdits : undefined,
      modelOverrides: modelOverrides,
    });

    // 5. Compute preference fingerprint for stale detection.
    const fingerprint = await computePreferenceFingerprint(preferences);

    // 6. Persist: insert variant version, then upsert variant row.
    // Include manual edit instructions in provenance for audit trail.
    const provenance: Record<string, JsonValue> = {
      adaptation_summary: result.adaptationSummary,
      applied_adaptations: result.appliedAdaptations as JsonValue,
      tag_diff: result.tagDiff as unknown as JsonValue,
      substitution_diffs: result.substitutionDiffs as unknown as JsonValue,
      preference_fingerprint: fingerprint,
    };
    if (manualEditInstructions) {
      provenance.manual_edit_instructions = manualEditInstructions;
    }
    if (storedEdits.length > 0) {
      provenance.replayed_manual_edits = storedEdits as unknown as JsonValue;
    }
    if (result.conflicts.length > 0) {
      provenance.conflicts = result.conflicts as JsonValue;
    }

    // Derivation kind: manual_edit (only instructions, no prior auto),
    // mixed (both), or auto_personalized (no manual involvement).
    const hasManualInput = Boolean(manualEditInstructions) || storedEdits.length > 0;
    const derivationKind = hasManualInput ? "mixed" : "auto_personalized";

    // Conflicts → needs_review instead of current. The user will be
    // prompted to resolve in Sous Chef.
    const resolvedStaleStatus: string = result.conflicts.length > 0
      ? "needs_review"
      : "current";

    // Compute structured variant tags for cookbook filtering.
    const variantTags = computeVariantTags({
      canonicalPayload,
      variantPayload: result.recipe,
      tagDiff: result.tagDiff,
    });

    // Build the updated accumulated manual edits list.
    // If new instructions were provided, append them.
    const updatedManualEdits = manualEditInstructions
      ? [
          ...storedEdits,
          {
            instruction: manualEditInstructions,
            created_at: new Date().toISOString(),
          },
        ]
      : storedEdits;

    // Insert the new variant version.
    const { data: newVersion, error: versionInsertError } = await serviceClient
      .from("user_recipe_variant_versions")
      .insert({
        variant_id: existingVariant?.id ?? undefined,
        parent_variant_version_id: existingVariant?.current_version_id ?? null,
        source_canonical_version_id: canonicalVersion.id,
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

    let variantId: string;

    if (existingVariant) {
      // Update existing variant row with new version, fingerprint,
      // stale status, accumulated manual edits, and computed tags.
      const { error: updateError } = await serviceClient
        .from("user_recipe_variants")
        .update({
          current_version_id: newVersion.id,
          base_canonical_version_id: canonicalVersion.id,
          preference_fingerprint: fingerprint,
          stale_status: resolvedStaleStatus,
          accumulated_manual_edits: updatedManualEdits,
          variant_tags: variantTags,
          last_materialized_at: new Date().toISOString(),
        })
        .eq("id", existingVariant.id);

      if (updateError) {
        throw new ApiError(
          500,
          "variant_update_failed",
          "Could not update variant",
          updateError.message,
        );
      }
      variantId = existingVariant.id;
    } else {
      // Create new variant row with fingerprint, manual edits, and tags.
      const { data: newVariant, error: variantInsertError } = await serviceClient
        .from("user_recipe_variants")
        .insert({
          user_id: auth.userId,
          canonical_recipe_id: recipeId,
          current_version_id: newVersion.id,
          base_canonical_version_id: canonicalVersion.id,
          preference_fingerprint: fingerprint,
          stale_status: resolvedStaleStatus,
          accumulated_manual_edits: updatedManualEdits,
          variant_tags: variantTags,
          last_materialized_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (variantInsertError || !newVariant) {
        throw new ApiError(
          500,
          "variant_insert_failed",
          "Could not create variant",
          variantInsertError?.message,
        );
      }
      variantId = newVariant.id;

      // Back-link the version to the newly created variant row.
      await serviceClient
        .from("user_recipe_variant_versions")
        .update({ variant_id: variantId })
        .eq("id", newVersion.id);
    }

    // Update the cookbook entry to point to the active variant.
    await serviceClient
      .from("cookbook_entries")
      .update({
        active_variant_id: variantId,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", auth.userId)
      .eq("canonical_recipe_id", recipeId);

    await logChangelog({
      serviceClient,
      actorUserId: auth.userId,
      scope: "variants",
      entityType: "user_recipe_variant",
      entityId: variantId,
      action: existingVariant ? "refreshed" : "created",
      requestId,
      afterJson: {
        canonical_recipe_id: recipeId,
        derivation_kind: derivationKind,
        adaptations_count: result.appliedAdaptations.length,
      } as unknown as JsonValue,
    });

    return respond(200, {
      variant_id: variantId,
      variant_version_id: newVersion.id,
      variant_status: resolvedStaleStatus as VariantStatus,
      adaptation_summary: result.adaptationSummary,
      substitution_diffs: result.substitutionDiffs.length > 0
        ? result.substitutionDiffs
        : undefined,
      conflicts: result.conflicts.length > 0 ? result.conflicts : undefined,
    });
  }

  return null;
};
