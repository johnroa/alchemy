import {
  ApiError,
  requireJsonBody,
} from "../../../_shared/errors.ts";
import type {
  JsonValue,
  RecipePayload,
} from "../../../_shared/types.ts";
import { getInstallIdFromHeaders, logBehaviorEvents } from "../../lib/behavior-events.ts";
import { runInBackground } from "../../lib/background-tasks.ts";
import { materializeRecipeVariant } from "../../lib/variant-materialization.ts";
import type { RouteContext, VariantStatus } from "../shared.ts";
import type { RecipesDeps } from "./types.ts";

const parseManualEditInstructions = async (
  request: Request,
): Promise<string | undefined> => {
  try {
    const body = await requireJsonBody<{ instructions?: string }>(request);
    if (body.instructions?.trim()) {
      return body.instructions.trim();
    }
  } catch {
    // Body is optional for refresh.
  }
  return undefined;
};

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
    fetchCookbookEntryDetail,
    deriveCanonicalForCookbookEntry,
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
    const { data: entry, error: entryError } = await client
      .from("cookbook_entries")
      .select("id")
      .eq("user_id", auth.userId)
      .eq("canonical_recipe_id", recipeId)
      .maybeSingle();

    if (entryError) {
      throw new ApiError(
        500,
        "cookbook_entry_fetch_failed",
        "Could not fetch cookbook entry",
        entryError.message,
      );
    }
    if (!entry) {
      throw new ApiError(
        404,
        "variant_not_found",
        "No variant exists for this user and recipe",
      );
    }

    // Apply rendering-only presentation options (units, groupBy, inline measurements).
    const preferences = await getPreferences(client, auth.userId);
    const viewOptions = resolvePresentationOptions({
      query: url.searchParams,
      presentationPreferences:
        preferences.presentation_preferences as Record<string, unknown>,
    });
    const variantDetail = await fetchCookbookEntryDetail({
      client,
      userId: auth.userId,
      cookbookEntryId: entry.id,
      viewOptions,
    });

    return respond(200, {
      variant_id: variantDetail.variant_id,
      variant_version_id: variantDetail.variant_version_id,
      canonical_recipe_id: recipeId,
      recipe: variantDetail.recipe,
      adaptation_summary: variantDetail.adaptation_summary,
      variant_status: variantDetail.variant_status,
      derivation_kind: variantDetail.derivation_kind,
      personalized_at: variantDetail.personalized_at,
      tag_diff: ((variantDetail.provenance ?? {}).tag_diff as JsonValue) ??
        { added: [], removed: [] },
      substitution_diffs: variantDetail.substitution_diffs ?? [],
      provenance: variantDetail.provenance ?? {},
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
    segments.length === 5 &&
    segments[0] === "recipes" &&
    segments[1] === "cookbook" &&
    segments[3] === "variant" &&
    segments[4] === "refresh" &&
    method === "POST"
  ) {
    const cookbookEntryId = parseUuid(segments[2]);
    const installId = getInstallIdFromHeaders(request);
    const { data: entry, error: entryError } = await client
      .from("cookbook_entries")
      .select("id, canonical_recipe_id, canonical_status, active_variant_id")
      .eq("id", cookbookEntryId)
      .eq("user_id", auth.userId)
      .maybeSingle();

    if (entryError || !entry) {
      throw new ApiError(
        404,
        "cookbook_entry_not_found",
        "Cookbook entry not found",
        entryError?.message,
      );
    }

    const preferences = await getPreferences(client, auth.userId);
    const manualEditInstructions = await parseManualEditInstructions(request);

    const { data: existingVariant } = await client
      .from("user_recipe_variants")
      .select("id, current_version_id, accumulated_manual_edits")
      .eq("user_id", auth.userId)
      .eq("cookbook_entry_id", cookbookEntryId)
      .maybeSingle();

    let basePayload: RecipePayload;
    let canonicalVersionId: string | null = null;

    if (entry.canonical_recipe_id) {
      const { data: recipe, error: recipeError } = await client
        .from("recipes")
        .select("id, current_version_id")
        .eq("id", entry.canonical_recipe_id)
        .maybeSingle();

      if (recipeError || !recipe || !recipe.current_version_id) {
        throw new ApiError(
          404,
          "recipe_not_found",
          "Canonical recipe not found",
          recipeError?.message,
        );
      }

      const { data: canonicalVersion, error: canonicalVersionError } = await client
        .from("recipe_versions")
        .select("id,payload")
        .eq("id", recipe.current_version_id)
        .single();

      if (canonicalVersionError || !canonicalVersion) {
        throw new ApiError(
          500,
          "canonical_version_fetch_failed",
          "Could not load canonical recipe version",
          canonicalVersionError?.message,
        );
      }

      basePayload = canonicalVersion.payload as RecipePayload;
      canonicalVersionId = canonicalVersion.id;
    } else {
      if (!entry.active_variant_id) {
        throw new ApiError(
          409,
          "private_variant_missing",
          "Cookbook entry does not have a private variant to refresh",
        );
      }

      const { data: variantVersion, error: variantVersionError } = await client
        .from("user_recipe_variant_versions")
        .select("payload")
        .eq("id", existingVariant?.current_version_id ?? "")
        .maybeSingle();

      if (variantVersionError || !variantVersion) {
        throw new ApiError(
          500,
          "variant_version_fetch_failed",
          "Could not load private variant payload",
          variantVersionError?.message,
        );
      }

      basePayload = variantVersion.payload as RecipePayload;
    }

    const materializedVariant = await materializeRecipeVariant({
      llmClient: serviceClient,
      serviceClient,
      userId: auth.userId,
      requestId,
      cookbookEntryId,
      recipeId: entry.canonical_recipe_id,
      canonicalVersionId,
      canonicalPayload: basePayload,
      preferences,
      computePreferenceFingerprint,
      computeVariantTags,
      fetchGraphSubstitutions,
      existingVariant,
      manualEditInstructions,
      modelOverrides,
    });

    if (!entry.canonical_recipe_id || entry.canonical_status !== "ready") {
      runInBackground(
        deriveCanonicalForCookbookEntry({
          serviceClient,
          userId: auth.userId,
          requestId: crypto.randomUUID(),
          cookbookEntryId,
          canonicalizeRecipePayload: deps.canonicalizeRecipePayload,
          resolveAndPersistCanonicalRecipe: deps.resolveAndPersistCanonicalRecipe,
          ensurePersistedRecipeImageRequest: deps.ensurePersistedRecipeImageRequest,
          scheduleImageQueueDrain: deps.scheduleImageQueueDrain,
          modelOverrides,
        }).then(() => undefined).catch((error) => {
          console.error("cookbook_entry_canon_retry_failed", {
            cookbook_entry_id: cookbookEntryId,
            error: error instanceof Error ? error.message : String(error),
          });
        }),
      );
    }

    await logBehaviorEvents({
      serviceClient,
      events: [{
        eventId: crypto.randomUUID(),
        userId: auth.userId,
        installId,
        eventType: "variant_refreshed",
        entityType: "cookbook_entry",
        entityId: cookbookEntryId,
        payload: {
          canonical_recipe_id: entry.canonical_recipe_id,
          variant_id: materializedVariant.variantId,
          variant_version_id: materializedVariant.variantVersionId,
          has_manual_edits: Boolean(manualEditInstructions),
        },
      }],
    });

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

  if (
    segments.length === 4 &&
    segments[0] === "recipes" &&
    segments[2] === "variant" &&
    segments[3] === "refresh" &&
    method === "POST"
  ) {
    const recipeId = parseUuid(segments[1]);
    const installId = getInstallIdFromHeaders(request);
    const { data: entry, error: entryError } = await client
      .from("cookbook_entries")
      .select("id, canonical_recipe_id, canonical_status")
      .eq("user_id", auth.userId)
      .eq("canonical_recipe_id", recipeId)
      .maybeSingle();

    if (entryError || !entry) {
      throw new ApiError(
        404,
        "cookbook_entry_not_found",
        "No cookbook entry exists for this recipe",
        entryError?.message,
      );
    }

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
    const manualEditInstructions = await parseManualEditInstructions(request);

    // 3. Check for existing variant row (including accumulated manual edits).
    const { data: existingVariant } = await client
      .from("user_recipe_variants")
      .select("id, current_version_id, accumulated_manual_edits")
      .eq("user_id", auth.userId)
      .eq("cookbook_entry_id", entry.id)
      .maybeSingle();

    const materializedVariant = await materializeRecipeVariant({
      llmClient: serviceClient,
      serviceClient,
      userId: auth.userId,
      requestId,
      cookbookEntryId: entry.id,
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
        cookbook_entry_id: entry.id,
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
          cookbook_entry_id: entry.id,
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

  // ── POST /recipes/{id}/variant/dismiss ──
  // Resets a stale/needs_review variant back to "current" without
  // re-personalizing. Used when the user reviews a stale recipe and
  // decides to keep the existing variant as-is (e.g., a beef burger
  // after switching to vegan — they want to keep the original).
  if (
    segments.length === 4 &&
    segments[0] === "recipes" &&
    segments[2] === "variant" &&
    segments[3] === "dismiss" &&
    method === "POST"
  ) {
    const recipeId = parseUuid(segments[1]);

    const { data: variant, error: variantError } = await client
      .from("user_recipe_variants")
      .update({ stale_status: "current" })
      .eq("user_id", auth.userId)
      .eq("canonical_recipe_id", recipeId)
      .in("stale_status", ["stale", "needs_review"])
      .select("id, stale_status")
      .maybeSingle();

    if (variantError) {
      throw new ApiError(
        500,
        "variant_dismiss_failed",
        "Could not dismiss variant staleness",
        variantError.message,
      );
    }

    if (!variant) {
      throw new ApiError(
        404,
        "variant_not_found",
        "No stale variant found for this recipe",
      );
    }

    return respond(200, {
      variant_id: variant.id,
      variant_status: "current",
    });
  }

  return null;
};
