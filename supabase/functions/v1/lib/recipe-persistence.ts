import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../../_shared/errors.ts";
import type { JsonValue, RecipePayload } from "../../_shared/types.ts";
import {
  buildIngredientGroups,
  type CanonicalIngredientView,
  type GroupByPreference,
  type IngredientGroup,
  projectIngredientsForOutput,
  projectInlineMeasurements,
  type UnitPreference,
} from "../recipe-standardization.ts";
import {
  canonicalizeRecipePayloadMetadata,
  resolveRecipePayloadDescription,
  resolveRecipePayloadSummary,
} from "../recipe-preview.ts";
import {
  resolveRecipeImageStatus,
  resolveRecipeImageUrl,
} from "../recipe-images.ts";
import {
  type RecipeViewOptions,
  defaultRecipeViewOptions,
  fetchCanonicalIngredientRows,
  persistCanonicalRecipeIngredients,
} from "./recipe-enrichment.ts";
import { enqueueRecipeMetadataJob } from "./metadata-pipeline.ts";
import { scheduleMetadataQueueDrain } from "./background-tasks.ts";
import { logChangelog, resolveRelationTypeId } from "./user-profile.ts";
import { toJsonValue } from "./chat-types.ts";
import type { RecipeView, RecipeAttachmentView, ContextPack } from "./chat-types.ts";

/**
 * Fetch a fully-projected recipe view including optional attachments.
 * Resolves the current version payload, projects ingredients through the
 * standardization layer (unit conversion, grouping), resolves image URLs,
 * and recursively fetches child recipe attachments via recipe_links.
 */
export const fetchRecipeView = async (
  client: SupabaseClient,
  recipeId: string,
  includeAttachments = true,
  options: RecipeViewOptions = defaultRecipeViewOptions,
): Promise<RecipeView> => {
  const { data: recipe, error: recipeError } = await client
    .from("recipes")
    .select(
      "id,title,hero_image_url,image_status,visibility,updated_at,current_version_id",
    )
    .eq("id", recipeId)
    .maybeSingle();

  if (recipeError) {
    throw new ApiError(
      500,
      "recipe_fetch_failed",
      "Could not fetch recipe",
      recipeError.message,
    );
  }

  if (!recipe) {
    throw new ApiError(404, "recipe_not_found", "Recipe not found");
  }

  if (!recipe.current_version_id) {
    throw new ApiError(
      500,
      "recipe_version_missing",
      "Recipe does not have a current version",
    );
  }

  const { data: version, error: versionError } = await client
    .from("recipe_versions")
    .select("id,payload,created_at,parent_version_id,diff_summary")
    .eq("id", recipe.current_version_id)
    .maybeSingle();

  if (versionError || !version) {
    throw new ApiError(
      500,
      "recipe_version_fetch_failed",
      "Could not fetch recipe version",
      versionError?.message,
    );
  }

  const payload = version.payload as RecipePayload;
  const canonicalRows = await fetchCanonicalIngredientRows(client, version.id);
  const projectedIngredients = projectIngredientsForOutput({
    sourceIngredients: payload.ingredients,
    canonicalRows,
    units: options.units,
  });
  const ingredientGroups = buildIngredientGroups({
    ingredients: projectedIngredients,
    groupBy: options.groupBy,
  });

  const projectedSteps = projectInlineMeasurements({
    steps: payload.steps,
    units: options.units,
    includeInlineMeasurements: options.inlineMeasurements,
  });
  const canonicalMetadata = canonicalizeRecipePayloadMetadata(payload);

  let attachments: RecipeAttachmentView[] = [];
  if (includeAttachments) {
    const linksResult = await client
      .from("recipe_links")
      .select("id,child_recipe_id,relation_type_id,position")
      .eq("parent_recipe_id", recipe.id)
      .order("position", { ascending: true });

    const links = linksResult.data ?? [];
    if (linksResult.error) {
      throw new ApiError(
        500,
        "recipe_links_fetch_failed",
        "Could not fetch recipe attachments",
        linksResult.error.message,
      );
    }

    const relationTypeIds = Array.from(
      new Set(links.map((link) => link.relation_type_id)),
    );
    let relationById = new Map<string, string>();

    if (relationTypeIds.length > 0) {
      const { data: relationTypes, error: relationError } = await client
        .from("graph_relation_types")
        .select("id,name")
        .in("id", relationTypeIds);

      if (relationError) {
        throw new ApiError(
          500,
          "relation_types_fetch_failed",
          "Could not fetch relation type names",
          relationError.message,
        );
      }

      relationById = new Map(
        (relationTypes ?? []).map((item) => [item.id, item.name]),
      );
    }

    const attachmentItems: RecipeAttachmentView[] = [];
    for (const link of links) {
      const childRecipe = await fetchRecipeView(
        client,
        link.child_recipe_id,
        false,
        options,
      );
      attachmentItems.push({
        attachment_id: link.id,
        relation_type: relationById.get(link.relation_type_id) ?? "attached_to",
        position: link.position,
        recipe: childRecipe,
      });
    }

    attachments = attachmentItems;
  }

  return {
    id: recipe.id,
    title: payload.title ?? recipe.title,
    description: resolveRecipePayloadDescription(payload),
    summary: resolveRecipePayloadSummary(payload),
    servings: payload.servings,
    ingredients: projectedIngredients,
    steps: projectedSteps,
    ingredient_groups: ingredientGroups,
    notes: payload.notes,
    pairings: payload.pairings ?? [],
    metadata: canonicalMetadata ? toJsonValue(canonicalMetadata) : undefined,
    emoji: payload.emoji ?? [],
    image_url: resolveRecipeImageUrl(recipe.hero_image_url),
    image_status: resolveRecipeImageStatus(
      recipe.hero_image_url,
      recipe.image_status,
    ),
    visibility: recipe.visibility,
    updated_at: recipe.updated_at,
    version: {
      version_id: version.id,
      recipe_id: recipe.id,
      parent_version_id: version.parent_version_id,
      diff_summary: version.diff_summary,
      created_at: version.created_at,
    },
    attachments,
  };
};

/**
 * Create or update a recipe with a new version. Handles:
 * - Recipe row insert (if no recipeId provided) or title/image update
 * - Version row insert with parent linkage and diff summary
 * - Canonical ingredient persistence
 * - Metadata job enqueue + background queue drain
 * - Version event logging and memory link association
 * - Changelog entry
 *
 * Does NOT enqueue image generation — that happens only on explicit cookbook save.
 */
export const persistRecipe = async (params: {
  client: SupabaseClient;
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  payload: RecipePayload;
  sourceChatId?: string;
  recipeId?: string;
  parentVersionId?: string;
  diffSummary?: string;
  heroImageUrl?: string;
  imageError?: string;
  selectedMemoryIds?: string[];
}): Promise<{
  recipeId: string;
  versionId: string;
}> => {
  const now = new Date().toISOString();

  let recipeId = params.recipeId;
  if (!recipeId) {
    const preferredInsert = await params.client
      .from("recipes")
      .insert({
        owner_user_id: params.userId,
        title: params.payload.title,
        hero_image_url: params.heroImageUrl,
        image_status: params.heroImageUrl ? "ready" : "pending",
        image_updated_at: now,
        image_last_error: params.imageError ?? null,
        image_generation_attempts: params.heroImageUrl ? 1 : 0,
        visibility: "public",
        source_chat_id: params.sourceChatId,
        updated_at: now,
      })
      .select("id")
      .single();

    let recipe = preferredInsert.data;
    if (preferredInsert.error || !recipe) {
      throw new ApiError(
        500,
        "recipe_insert_failed",
        "Could not create recipe",
        preferredInsert.error?.message,
      );
    }

    recipeId = recipe.id;
  }

  if (!recipeId) {
    throw new ApiError(
      500,
      "recipe_insert_failed",
      "Could not resolve recipe id",
    );
  }

  const { data: version, error: versionError } = await params.client
    .from("recipe_versions")
    .insert({
      recipe_id: recipeId,
      parent_version_id: params.parentVersionId,
      payload: params.payload,
      diff_summary: params.diffSummary,
      created_by: params.userId,
    })
    .select("id")
    .single();

  if (versionError || !version) {
    throw new ApiError(
      500,
      "recipe_version_insert_failed",
      "Could not create recipe version",
      versionError?.message,
    );
  }

  const updatePayload: Record<string, JsonValue> = {
    title: params.payload.title,
    current_version_id: version.id,
    updated_at: now,
    image_updated_at: now,
    image_generation_attempts: params.heroImageUrl ? 1 : 0,
  };

  if (
    typeof params.heroImageUrl === "string" && params.heroImageUrl.length > 0
  ) {
    updatePayload.hero_image_url = params.heroImageUrl;
    updatePayload.image_status = "ready";
    updatePayload.image_last_error = null;
  } else {
    updatePayload.image_status = "pending";
    updatePayload.image_last_error = params.imageError ?? null;
  }

  const { error: updateError } = await params.client.from("recipes").update(
    updatePayload,
  ).eq("id", recipeId);
  if (updateError) {
    throw new ApiError(
      500,
      "recipe_update_failed",
      "Could not update recipe",
      updateError.message,
    );
  }

  await persistCanonicalRecipeIngredients({
    serviceClient: params.serviceClient,
    userId: params.userId,
    requestId: params.requestId,
    recipeVersionId: version.id,
    recipe: params.payload,
  });

  await enqueueRecipeMetadataJob({
    serviceClient: params.serviceClient,
    recipeId,
    recipeVersionId: version.id,
  });
  scheduleMetadataQueueDrain({
    serviceClient: params.serviceClient,
    actorUserId: params.userId,
    requestId: params.requestId,
    limit: 2,
  });

  // Image jobs are only enqueued when a recipe is explicitly saved to cookbook.
  // Do NOT enqueue here — avoids triggering slow image generation on every chatSession/tweak.

  const { error: versionEventError } = await params.client.from(
    "recipe_version_events",
  ).insert({
    recipe_version_id: version.id,
    event_type: params.parentVersionId ? "recipe_tweak" : "recipe_create",
    request_id: params.requestId,
    metadata: {
      source_chat_id: params.sourceChatId ?? null,
      diff_summary: params.diffSummary ?? null,
      selected_memory_ids: params.selectedMemoryIds ?? [],
    },
  });

  if (versionEventError) {
    console.error("recipe_version_event_failed", versionEventError);
  }

  if ((params.selectedMemoryIds ?? []).length > 0) {
    const records = (params.selectedMemoryIds ?? []).map((memoryId) => ({
      memory_id: memoryId,
      recipe_id: recipeId,
      recipe_version_id: version.id,
      source_event_id: null,
    }));

    const { error: memoryLinkError } = await params.client
      .from("memory_recipe_links")
      .upsert(records, { onConflict: "memory_id,recipe_version_id" });

    if (memoryLinkError) {
      console.error("memory_recipe_link_failed", memoryLinkError);
    }
  }

  await logChangelog({
    serviceClient: params.serviceClient,
    actorUserId: params.userId,
    scope: "recipe",
    entityType: "recipe",
    entityId: recipeId,
    action: params.parentVersionId ? "version_created" : "created",
    requestId: params.requestId,
    afterJson: {
      recipe_id: recipeId,
      version_id: version.id,
      diff_summary: params.diffSummary ?? null,
    },
  });

  return {
    recipeId,
    versionId: version.id,
  };
};

/**
 * Upsert auto-generated category labels for a recipe.
 * Categories come from LLM enrichment with confidence scores.
 * Keyed on (recipe_id, category) to allow incremental updates.
 */
export const applyAutoCategories = async (params: {
  client: SupabaseClient;
  recipeId: string;
  categories: Array<{ category: string; confidence: number }>;
}): Promise<void> => {
  const records = params.categories.map((item) => ({
    recipe_id: params.recipeId,
    category: item.category,
    confidence: item.confidence,
    source: "llm",
  }));

  if (records.length === 0) {
    return;
  }

  const { error } = await params.client.from("recipe_auto_categories").upsert(
    records,
    {
      onConflict: "recipe_id,category",
    },
  );

  if (error) {
    throw new ApiError(
      500,
      "auto_categories_failed",
      "Could not apply recipe auto categories",
      error.message,
    );
  }
};

/**
 * Derive an attachment payload from a recipe by stripping nested attachments.
 * Prevents recursive attachment chains — child recipes are always flat.
 */
export const deriveAttachmentPayload = (
  recipe: Omit<RecipePayload, "attachments">,
): RecipePayload => {
  return {
    ...recipe,
    attachments: [],
  };
};

/**
 * Synchronize recipe attachment links for a parent recipe.
 * Clears all existing recipe_links for the parent, then persists each
 * attachment as a new child recipe and creates the link row.
 * Attachments are persisted in order (position = array index).
 */
export const syncRecipeAttachments = async (params: {
  userClient: SupabaseClient;
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  parentRecipeId: string;
  payload: RecipePayload;
  contextPack: ContextPack;
}): Promise<void> => {
  const attachments = params.payload.attachments ?? [];

  const { error: clearError } = await params.userClient
    .from("recipe_links")
    .delete()
    .eq("parent_recipe_id", params.parentRecipeId);

  if (clearError) {
    throw new ApiError(
      500,
      "recipe_links_clear_failed",
      "Could not clear existing attachments",
      clearError.message,
    );
  }

  if (attachments.length === 0) {
    return;
  }

  for (let index = 0; index < attachments.length; index += 1) {
    const attachment = attachments[index];
    const relationType = attachment.relation_type?.trim();

    if (!relationType) {
      continue;
    }

    const childPayload = deriveAttachmentPayload(attachment.recipe);

    const childSaved = await persistRecipe({
      client: params.userClient,
      serviceClient: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      payload: childPayload,
      diffSummary: `Attached to ${params.parentRecipeId}`,
      selectedMemoryIds: params.contextPack.selectedMemoryIds,
    });

    const relationTypeId = await resolveRelationTypeId(
      params.userClient,
      relationType,
    );

    const { error: linkError } = await params.userClient.from("recipe_links")
      .insert({
        parent_recipe_id: params.parentRecipeId,
        child_recipe_id: childSaved.recipeId,
        relation_type_id: relationTypeId,
        position: index,
        source: "llm",
      });

    if (linkError) {
      throw new ApiError(
        500,
        "recipe_link_insert_failed",
        "Could not create recipe attachment link",
        linkError.message,
      );
    }

    await logChangelog({
      serviceClient: params.serviceClient,
      actorUserId: params.userId,
      scope: "attachments",
      entityType: "recipe_link",
      entityId: childSaved.recipeId,
      action: "attached",
      requestId: params.requestId,
      afterJson: {
        parent_recipe_id: params.parentRecipeId,
        child_recipe_id: childSaved.recipeId,
        relation_type: relationType,
        position: index,
      },
    });
  }
};
