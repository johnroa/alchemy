import {
  ApiError,
  requireJsonBody,
} from "../../../_shared/errors.ts";
import { llmGateway } from "../../../_shared/llm-gateway.ts";
import type {
  JsonValue,
  RecipePayload,
} from "../../../_shared/types.ts";
import { getInstallIdFromHeaders, logBehaviorEvents } from "../../lib/behavior-events.ts";
import type { RouteContext, VariantStatus } from "../shared.ts";
import type { RecipesDeps } from "./types.ts";

export const handleSaveRoutes = async (
  context: RouteContext,
  deps: RecipesDeps,
): Promise<Response | null> => {
  const { request, segments, method, auth, client, serviceClient, requestId, respond, modelOverrides } =
    context;
  const {
    parseUuid,
    getPreferences,
    logChangelog,
    persistRecipe,
    resolveRelationTypeId,
    ensurePersistedRecipeImageRequest,
    scheduleImageQueueDrain,
    computePreferenceFingerprint,
    computeVariantTags,
    fetchGraphSubstitutions,
  } = deps;

  // ── POST/DELETE /recipes/:id/save ──
  if (
    segments.length === 3 &&
    segments[0] === "recipes" &&
    segments[2] === "save"
  ) {
    const recipeId = parseUuid(segments[1]);
    const installId = getInstallIdFromHeaders(request);
    if (method === "POST") {
      // Parse optional body for autopersonalize flag (defaults to true).
      let autopersonalize = true;
      let sourceSurface: string | null = null;
      try {
        const body = await requireJsonBody<{
          autopersonalize?: boolean;
          source_surface?: string;
        }>(request);
        if (typeof body.autopersonalize === "boolean") {
          autopersonalize = body.autopersonalize;
        }
        if (typeof body.source_surface === "string" && body.source_surface.trim().length > 0) {
          sourceSurface = body.source_surface.trim();
        }
      } catch {
        // Body is optional — empty request means default autopersonalize=true.
      }

      // cookbook_entries is the canonical save table (backfilled in migration 0047).
      // recipe_saves is deprecated — no longer written to.
      const { error: cookbookError } = await client
        .from("cookbook_entries")
        .upsert(
          {
            user_id: auth.userId,
            canonical_recipe_id: recipeId,
            autopersonalize,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,canonical_recipe_id" },
        );

      if (cookbookError) {
        throw new ApiError(
          500,
          "cookbook_entry_create_failed",
          "Could not create cookbook entry",
          cookbookError.message,
        );
      }

      await logChangelog({
        serviceClient,
        actorUserId: auth.userId,
        scope: "cookbook",
        entityType: "cookbook_entry",
        entityId: recipeId,
        action: "saved",
        requestId,
        afterJson: { autopersonalize } as unknown as JsonValue,
      });

      await logBehaviorEvents({
        serviceClient,
        events: [{
          eventId: crypto.randomUUID(),
          userId: auth.userId,
          installId,
          eventType: "recipe_saved",
          entityType: "recipe",
          entityId: recipeId,
          sourceSurface,
          payload: {
            autopersonalize,
          },
        }],
      });

      // Ensure image processing for the recipe.
      const { data: recipeImageCheck, error: recipeImageCheckError } = await client
        .from("recipes")
        .select("current_version_id")
        .eq("id", recipeId)
        .maybeSingle();

      if (recipeImageCheckError) {
        throw new ApiError(
          500,
          "recipe_image_state_lookup_failed",
          "Could not load recipe image state",
          recipeImageCheckError.message,
        );
      }

      if (recipeImageCheck?.current_version_id) {
        await ensurePersistedRecipeImageRequest({
          serviceClient,
          userId: auth.userId,
          requestId,
          recipeId,
          recipeVersionId: String(recipeImageCheck.current_version_id),
        });
        scheduleImageQueueDrain({
          serviceClient,
          actorUserId: auth.userId,
          requestId,
          limit: 5,
        });
      }

      // When autopersonalize is true, check if the user has constraint
      // preferences that would produce a meaningful variant. If so, schedule
      // background variant materialisation via the recipe_personalize scope.
      let variantStatus: VariantStatus = "none";
      if (autopersonalize) {
        const preferences = await getPreferences(client, auth.userId);
        const hasConstraints =
          (preferences.dietary_restrictions?.length ?? 0) > 0 ||
          (preferences.aversions?.length ?? 0) > 0 ||
          (preferences.equipment?.length ?? 0) > 0;

        if (hasConstraints && recipeImageCheck?.current_version_id) {
          // Mark as processing — background job will update to current/failed.
          variantStatus = "processing";

          // Fire-and-forget via EdgeRuntime.waitUntil (same pattern as
          // image queue draining). The variant/refresh endpoint contains
          // the full materialisation pipeline.
          const variantTask = (async () => {
            try {
              const { data: canonicalVersion } = await client
                .from("recipe_versions")
                .select("id, payload")
                .eq("id", recipeImageCheck.current_version_id)
                .single();

              if (!canonicalVersion) return;

              const canonicalPayload = canonicalVersion.payload as RecipePayload;
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

              // Query graph for proven substitution patterns.
              const bgConstraints = [
                ...(Array.isArray(preferences.dietary_restrictions)
                  ? preferences.dietary_restrictions
                  : []),
                ...(Array.isArray(preferences.aversions)
                  ? preferences.aversions
                  : []),
              ].map((c) => String(c).toLowerCase());

              const bgGraphSubs = bgConstraints.length > 0
                ? await fetchGraphSubstitutions({
                    serviceClient,
                    recipeVersionId: canonicalVersion.id,
                    constraints: bgConstraints,
                  })
                : [];

              const result = await llmGateway.personalizeRecipe({
                client,
                userId: auth.userId,
                requestId,
                canonicalPayload,
                preferences: preferenceContext,
                graphSubstitutions: bgGraphSubs.length > 0
                  ? bgGraphSubs
                  : undefined,
                modelOverrides,
              });

              // Fingerprint at materialization time for stale detection.
              const bgFingerprint = await computePreferenceFingerprint(preferences);

              const provenance: Record<string, JsonValue> = {
                adaptation_summary: result.adaptationSummary,
                applied_adaptations: result.appliedAdaptations as JsonValue,
                tag_diff: result.tagDiff as unknown as JsonValue,
                substitution_diffs: result.substitutionDiffs as unknown as JsonValue,
                preference_fingerprint: bgFingerprint,
              };

              // Insert variant version.
              const { data: newVersion } = await serviceClient
                .from("user_recipe_variant_versions")
                .insert({
                  source_canonical_version_id: canonicalVersion.id,
                  payload: result.recipe as unknown as JsonValue,
                  derivation_kind: "auto_personalized",
                  provenance,
                })
                .select("id")
                .single();

              if (!newVersion) return;

              // Compute variant tags for cookbook filtering.
              const bgVariantTags = computeVariantTags({
                canonicalPayload,
                variantPayload: result.recipe,
                tagDiff: result.tagDiff,
              });

              // Create variant row with fingerprint and tags.
              const { data: newVariant } = await serviceClient
                .from("user_recipe_variants")
                .insert({
                  user_id: auth.userId,
                  canonical_recipe_id: recipeId,
                  current_version_id: newVersion.id,
                  base_canonical_version_id: canonicalVersion.id,
                  preference_fingerprint: bgFingerprint,
                  variant_tags: bgVariantTags,
                  stale_status: "current",
                  last_materialized_at: new Date().toISOString(),
                })
                .select("id")
                .single();

              if (!newVariant) return;

              // Link version to variant and cookbook entry.
              await serviceClient
                .from("user_recipe_variant_versions")
                .update({ variant_id: newVariant.id })
                .eq("id", newVersion.id);

              await serviceClient
                .from("cookbook_entries")
                .update({
                  active_variant_id: newVariant.id,
                  updated_at: new Date().toISOString(),
                })
                .eq("user_id", auth.userId)
                .eq("canonical_recipe_id", recipeId);
            } catch (err) {
              console.error("variant_auto_materialization_failed", {
                request_id: requestId,
                recipe_id: recipeId,
                user_id: auth.userId,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          })();

          // runInBackground is injected via deps to use EdgeRuntime.waitUntil.
          // Since we don't have it as a dep, fire-and-forget with void.
          void variantTask;
        }
      }

      return respond(200, {
        saved: true,
        canonical_recipe_id: recipeId,
        variant_status: variantStatus,
        active_variant_version_id: null,
      });
    }

    if (method === "DELETE") {
      // Delete from cookbook_entries (recipe_saves is deprecated).
      const { error: cookbookDeleteError } = await client
        .from("cookbook_entries")
        .delete()
        .eq("user_id", auth.userId)
        .eq("canonical_recipe_id", recipeId);

      if (cookbookDeleteError) {
        throw new ApiError(
          500,
          "cookbook_entry_delete_failed",
          "Could not remove cookbook entry",
          cookbookDeleteError.message,
        );
      }

      await logChangelog({
        serviceClient,
        actorUserId: auth.userId,
        scope: "cookbook",
        entityType: "cookbook_entry",
        entityId: recipeId,
        action: "unsaved",
        requestId,
      });

      await logBehaviorEvents({
        serviceClient,
        events: [{
          eventId: crypto.randomUUID(),
          userId: auth.userId,
          installId,
          eventType: "recipe_unsaved",
          entityType: "recipe",
          entityId: recipeId,
        }],
      });

      return respond(200, { saved: false });
    }
  }

  // ── POST /recipes/:id/publish ──
  // Publishes a private variant as a new canonical recipe with derived_from edge.
  if (
    segments.length === 3 &&
    segments[0] === "recipes" &&
    segments[2] === "publish" &&
    method === "POST"
  ) {
    const sourceRecipeId = parseUuid(segments[1]);

    // Get the user's variant for this recipe.
    const { data: variant, error: variantError } = await client
      .from("user_recipe_variants")
      .select("id, current_version_id, canonical_recipe_id")
      .eq("user_id", auth.userId)
      .eq("canonical_recipe_id", sourceRecipeId)
      .maybeSingle();

    if (variantError || !variant || !variant.current_version_id) {
      throw new ApiError(
        404,
        "variant_not_found",
        "No variant to publish for this recipe",
        variantError?.message,
      );
    }

    // Get the variant version payload.
    const { data: variantVersion, error: vvError } = await client
      .from("user_recipe_variant_versions")
      .select("payload, source_canonical_version_id")
      .eq("id", variant.current_version_id)
      .single();

    if (vvError || !variantVersion) {
      throw new ApiError(
        500,
        "variant_version_fetch_failed",
        "Could not fetch variant payload for publishing",
        vvError?.message,
      );
    }

    // Parse optional title override.
    let newTitle: string | undefined;
    try {
      const body = await requireJsonBody<{ title?: string }>(request);
      if (body.title?.trim()) {
        newTitle = body.title.trim();
      }
    } catch {
      // Body is optional.
    }

    const payload = variantVersion.payload as RecipePayload;
    if (newTitle) {
      payload.title = newTitle;
    }

    // Persist as a new canonical recipe.
    const saved = await persistRecipe({
      client,
      serviceClient,
      userId: auth.userId,
      requestId,
      payload,
      diffSummary: `Published from variant of recipe ${sourceRecipeId}`,
    });

    // Create derived_from graph edge linking new canonical to source canonical.
    // Uses service client to bypass RLS on graph tables.
    const derivedFromTypeId = await resolveRelationTypeId(
      serviceClient,
      "derived_from",
    );

    // Create graph entities for both recipes if they don't exist,
    // then create the edge. Best-effort — don't fail the publish on graph errors.
    try {
      // Ensure recipe entities exist in graph.
      const sourceEntityResult = await serviceClient
        .from("graph_entities")
        .upsert(
          {
            entity_type: "recipe",
            label: payload.title ?? "Untitled",
            metadata: { recipe_id: saved.recipeId },
          },
          { onConflict: "entity_type,label" },
        )
        .select("id")
        .single();

      const targetEntityResult = await serviceClient
        .from("graph_entities")
        .select("id")
        .eq("entity_type", "recipe")
        .eq("metadata->>recipe_id", sourceRecipeId)
        .maybeSingle();

      if (sourceEntityResult.data && targetEntityResult.data) {
        await serviceClient.from("graph_edges").upsert(
          {
            from_entity_id: sourceEntityResult.data.id,
            to_entity_id: targetEntityResult.data.id,
            relation_type_id: derivedFromTypeId,
            source: "variant_publish",
            confidence: 1.0,
            metadata: {
              source_recipe_id: sourceRecipeId,
              published_recipe_id: saved.recipeId,
            },
          },
          {
            onConflict:
              "from_entity_id,to_entity_id,relation_type_id,source",
          },
        );
      }
    } catch {
      // Graph edge creation is best-effort. Log but don't fail the publish.
      console.warn(
        `[publish] Failed to create derived_from graph edge for recipe ${saved.recipeId}`,
      );
    }

    await logChangelog({
      serviceClient,
      actorUserId: auth.userId,
      scope: "cookbook",
      entityType: "recipe",
      entityId: saved.recipeId,
      action: "published_from_variant",
      requestId,
      afterJson: {
        source_recipe_id: sourceRecipeId,
        new_recipe_id: saved.recipeId,
        new_version_id: saved.versionId,
      } as unknown as JsonValue,
    });

    return respond(200, {
      recipe_id: saved.recipeId,
      recipe_version_id: saved.versionId,
      title: payload.title ?? "Untitled",
    });
  }

  return null;
};
