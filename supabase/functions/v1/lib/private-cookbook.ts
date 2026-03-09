import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../../_shared/errors.ts";
import type { JsonValue, RecipePayload } from "../../_shared/types.ts";
import type { ModelOverrideMap } from "../../_shared/llm-gateway.ts";
import {
  canonicalizeRecipePayloadMetadata,
  resolveRecipePayloadDescription,
  resolveRecipePayloadSummary,
} from "../recipe-preview.ts";
import {
  fetchCanonicalIngredientRows,
  type RecipeViewOptions,
} from "./recipe-enrichment.ts";
import {
  fetchRecipeView,
  projectRecipePayloadForView,
} from "./recipe-persistence.ts";
import type {
  CookbookRecipeDetail,
  PreferenceContext,
  RecipeView,
  VariantStatus,
} from "../routes/shared.ts";

export type CookbookCanonicalStatus =
  | "pending"
  | "processing"
  | "ready"
  | "failed";

type SeedOrigin =
  | "chat_generation"
  | "chat_import"
  | "canonical_personalization"
  | "manual_edit"
  | "publish_merge";

type CookbookEntryRow = {
  id: string;
  canonical_recipe_id: string | null;
  canonical_status: CookbookCanonicalStatus;
  active_variant_id: string | null;
  autopersonalize: boolean;
  saved_at: string;
  updated_at: string;
  preview_image_url: string | null;
  preview_image_status: string;
  source_chat_id: string | null;
};

type VariantRow = {
  id: string;
  current_version_id: string | null;
  stale_status: string;
  preference_fingerprint: string | null;
  base_canonical_version_id: string | null;
  last_materialized_at: string | null;
  accumulated_manual_edits?: unknown;
  variant_tags?: unknown;
  created_at: string;
};

type VariantVersionRow = {
  id: string;
  payload: RecipePayload;
  derivation_kind: string;
  provenance: Record<string, JsonValue>;
  seed_origin: string;
  selected_memory_ids: string[];
  seed_provenance: Record<string, JsonValue>;
  source_canonical_version_id: string | null;
  created_at: string;
};

type CanonicalReviewResult = {
  approved: boolean;
  rationale: string | null;
  leakageDetected: boolean;
  semanticDriftDetected: boolean;
};

const asJsonRecord = (
  value: unknown,
): Record<string, JsonValue> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, JsonValue>;
};

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
};

const normalizeVariantStatus = (value: string | null | undefined): VariantStatus => {
  switch (value) {
    case "current":
    case "stale":
    case "processing":
    case "failed":
    case "needs_review":
    case "none":
      return value;
    default:
      return "none";
  }
};

const buildPrivateRecipeView = (params: {
  cookbookEntryId: string;
  payload: RecipePayload;
  canonicalRecipeId: string | null;
  canonicalRows?: Awaited<ReturnType<typeof fetchCanonicalIngredientRows>>;
  viewOptions: RecipeViewOptions;
  previewImageUrl: string | null;
  previewImageStatus: string;
  updatedAt: string;
  versionId: string;
  parentVersionId?: string | null;
  createdAt: string;
}): RecipeView => {
  const projected = projectRecipePayloadForView({
    payload: params.payload,
    canonicalRows: params.canonicalRows,
    options: params.viewOptions,
  });
  const metadata = canonicalizeRecipePayloadMetadata(params.payload);

  return {
    id: params.canonicalRecipeId ?? params.cookbookEntryId,
    title: params.payload.title,
    description: projected.description ?? resolveRecipePayloadDescription(params.payload),
    summary: projected.summary ?? resolveRecipePayloadSummary(params.payload),
    servings: params.payload.servings,
    ingredients: projected.ingredients,
    steps: projected.steps,
    ingredient_groups: projected.ingredient_groups,
    notes: projected.notes,
    pairings: projected.pairings,
    metadata: projected.metadata ?? (metadata as JsonValue | undefined),
    emoji: projected.emoji,
    image_url: params.previewImageUrl,
    image_status: params.previewImageStatus,
    visibility: "private",
    updated_at: params.updatedAt,
    version: {
      version_id: params.versionId,
      recipe_id: params.canonicalRecipeId ?? params.cookbookEntryId,
      parent_version_id: params.parentVersionId ?? null,
      diff_summary: null,
      created_at: params.createdAt,
    },
    attachments: [],
  };
};

const loadCookbookEntryRow = async (params: {
  client: SupabaseClient;
  userId: string;
  cookbookEntryId: string;
}): Promise<CookbookEntryRow> => {
  const { data, error } = await params.client
    .from("cookbook_entries")
    .select(
      "id, canonical_recipe_id, canonical_status, active_variant_id, autopersonalize, saved_at, updated_at, preview_image_url, preview_image_status, source_chat_id",
    )
    .eq("id", params.cookbookEntryId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (error) {
    throw new ApiError(
      500,
      "cookbook_entry_fetch_failed",
      "Could not fetch cookbook entry",
      error.message,
    );
  }
  if (!data) {
    throw new ApiError(404, "cookbook_entry_not_found", "Cookbook entry not found");
  }
  return data as CookbookEntryRow;
};

const loadActiveVariantState = async (params: {
  client: SupabaseClient;
  cookbookEntryId: string;
  activeVariantId: string | null;
}): Promise<{ variant: VariantRow | null; version: VariantVersionRow | null }> => {
  if (!params.activeVariantId) {
    return { variant: null, version: null };
  }

  const { data: variant, error: variantError } = await params.client
    .from("user_recipe_variants")
    .select(
      "id,current_version_id,stale_status,preference_fingerprint,base_canonical_version_id,last_materialized_at,accumulated_manual_edits,variant_tags,created_at",
    )
    .eq("id", params.activeVariantId)
    .eq("cookbook_entry_id", params.cookbookEntryId)
    .maybeSingle();

  if (variantError) {
    throw new ApiError(
      500,
      "variant_fetch_failed",
      "Could not fetch active variant",
      variantError.message,
    );
  }
  if (!variant || !variant.current_version_id) {
    return { variant: null, version: null };
  }

  const { data: version, error: versionError } = await params.client
    .from("user_recipe_variant_versions")
    .select(
      "id,payload,derivation_kind,provenance,seed_origin,selected_memory_ids,seed_provenance,source_canonical_version_id,created_at",
    )
    .eq("id", variant.current_version_id)
    .maybeSingle();

  if (versionError) {
    throw new ApiError(
      500,
      "variant_version_fetch_failed",
      "Could not fetch variant version",
      versionError.message,
    );
  }

  return {
    variant: variant as VariantRow,
    version: version
      ? {
        ...(version as Omit<VariantVersionRow, "payload" | "provenance" | "selected_memory_ids" | "seed_provenance">),
        payload: version.payload as RecipePayload,
        provenance: asJsonRecord(version.provenance),
        selected_memory_ids: asStringArray(version.selected_memory_ids),
        seed_provenance: asJsonRecord(version.seed_provenance),
      }
      : null,
  };
};

export const createPrivateCookbookEntry = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  payload: RecipePayload;
  sourceKind: "created_private" | "imported_private";
  previewImageUrl?: string | null;
  previewImageStatus?: string | null;
  sourceChatId?: string | null;
  selectedMemoryIds?: string[];
  computePreferenceFingerprint: (
    preferences: PreferenceContext,
  ) => Promise<string | null>;
  computeVariantTags: (params: {
    canonicalPayload: RecipePayload;
    variantPayload: RecipePayload;
    tagDiff: { added: string[]; removed: string[] };
  }) => Record<string, unknown>;
  preferences: PreferenceContext;
}): Promise<{
  cookbookEntryId: string;
  variantId: string;
  variantVersionId: string;
  canonicalStatus: CookbookCanonicalStatus;
  variantStatus: VariantStatus;
}> => {
  const now = new Date().toISOString();
  const fingerprint = await params.computePreferenceFingerprint(params.preferences);
  const variantTags = params.computeVariantTags({
    canonicalPayload: params.payload,
    variantPayload: params.payload,
    tagDiff: { added: [], removed: [] },
  });

  const seedOrigin: SeedOrigin = params.sourceKind === "imported_private"
    ? "chat_import"
    : "chat_generation";

  const { data: cookbookEntry, error: cookbookError } = await params.serviceClient
    .from("cookbook_entries")
    .insert({
      user_id: params.userId,
      canonical_recipe_id: null,
      autopersonalize: true,
      source_kind: params.sourceKind,
      canonical_status: "pending",
      saved_at: now,
      updated_at: now,
      preview_image_url: params.previewImageUrl ?? null,
      preview_image_status: params.previewImageStatus ?? "pending",
      source_chat_id: params.sourceChatId ?? null,
    })
    .select("id")
    .single();

  if (cookbookError || !cookbookEntry) {
    throw new ApiError(
      500,
      "cookbook_entry_create_failed",
      "Could not create private cookbook entry",
      cookbookError?.message,
    );
  }

  const variantId = crypto.randomUUID();
  const { error: variantError } = await params.serviceClient
    .from("user_recipe_variants")
    .insert({
      id: variantId,
      user_id: params.userId,
      cookbook_entry_id: cookbookEntry.id,
      canonical_recipe_id: null,
      current_version_id: null,
      base_canonical_version_id: null,
      preference_fingerprint: fingerprint,
      stale_status: "current",
      accumulated_manual_edits: [],
      variant_tags: variantTags,
      last_materialized_at: now,
    });

  if (variantError) {
    throw new ApiError(
      500,
      "variant_insert_failed",
      "Could not create private recipe variant",
      variantError.message,
    );
  }

  const provenance: Record<string, JsonValue> = {
    adaptation_summary: "",
    applied_adaptations: [],
    tag_diff: { added: [], removed: [] },
    substitution_diffs: [],
    preference_fingerprint: fingerprint,
  };

  const { data: version, error: versionError } = await params.serviceClient
    .from("user_recipe_variant_versions")
    .insert({
      variant_id: variantId,
      parent_variant_version_id: null,
      source_canonical_version_id: null,
      payload: params.payload as unknown as JsonValue,
      derivation_kind: "auto_personalized",
      provenance,
      seed_origin: seedOrigin,
      selected_memory_ids: params.selectedMemoryIds ?? [],
      seed_provenance: {
        source_kind: params.sourceKind,
        source_chat_id: params.sourceChatId ?? null,
      },
    })
    .select("id")
    .single();

  if (versionError || !version) {
    throw new ApiError(
      500,
      "variant_version_insert_failed",
      "Could not create private variant version",
      versionError?.message,
    );
  }

  const [{ error: variantUpdateError }, { error: entryUpdateError }] = await Promise.all([
    params.serviceClient
      .from("user_recipe_variants")
      .update({ current_version_id: version.id })
      .eq("id", variantId),
    params.serviceClient
      .from("cookbook_entries")
      .update({ active_variant_id: variantId, updated_at: now })
      .eq("id", cookbookEntry.id),
  ]);

  if (variantUpdateError) {
    throw new ApiError(
      500,
      "variant_update_failed",
      "Could not activate private variant version",
      variantUpdateError.message,
    );
  }
  if (entryUpdateError) {
    throw new ApiError(
      500,
      "cookbook_entry_variant_link_failed",
      "Could not link private variant to cookbook entry",
      entryUpdateError.message,
    );
  }

  return {
    cookbookEntryId: cookbookEntry.id,
    variantId,
    variantVersionId: version.id,
    canonicalStatus: "pending",
    variantStatus: "current",
  };
};

const reviewCanonicalCandidate = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  privatePayload: RecipePayload;
  canonicalPayload: RecipePayload;
  modelOverrides?: ModelOverrideMap;
}): Promise<CanonicalReviewResult> => {
  const { llmGateway } = await import("../../_shared/llm-gateway.ts");
  return await llmGateway.reviewCanonicalRecipe({
    client: params.serviceClient,
    userId: params.userId,
    requestId: params.requestId,
    privatePayload: params.privatePayload,
    canonicalPayload: params.canonicalPayload,
    modelOverrides: params.modelOverrides,
  });
};

const mergeVariantIntoExistingEntry = async (params: {
  serviceClient: SupabaseClient;
  currentEntryId: string;
  targetEntryId: string;
  currentVariant: VariantRow | null;
  targetVariantId: string | null;
  canonicalRecipeId: string;
  canonicalVersionId: string;
  now: string;
}): Promise<string> => {
  if (!params.currentVariant) {
    await params.serviceClient
      .from("cookbook_entries")
      .delete()
      .eq("id", params.currentEntryId);
    return params.targetEntryId;
  }

  if (!params.targetVariantId) {
    const { error: variantMoveError } = await params.serviceClient
      .from("user_recipe_variants")
      .update({
        cookbook_entry_id: params.targetEntryId,
        canonical_recipe_id: params.canonicalRecipeId,
        base_canonical_version_id: params.canonicalVersionId,
      })
      .eq("id", params.currentVariant.id);

    if (variantMoveError) {
      throw new ApiError(
        500,
        "variant_reparent_failed",
        "Could not attach private variant to existing cookbook entry",
        variantMoveError.message,
      );
    }

    await params.serviceClient
      .from("cookbook_entries")
      .update({
        active_variant_id: params.currentVariant.id,
        updated_at: params.now,
      })
      .eq("id", params.targetEntryId);

    await params.serviceClient
      .from("cookbook_entries")
      .delete()
      .eq("id", params.currentEntryId);

    return params.targetEntryId;
  }

  const { data: targetVariant, error: targetVariantError } = await params
    .serviceClient
    .from("user_recipe_variants")
    .select("id,current_version_id")
    .eq("id", params.targetVariantId)
    .maybeSingle();

  if (targetVariantError || !targetVariant) {
    throw new ApiError(
      500,
      "variant_merge_target_missing",
      "Could not load target variant for merge",
      targetVariantError?.message,
    );
  }

  const { data: sourceVersions, error: sourceVersionsError } = await params
    .serviceClient
    .from("user_recipe_variant_versions")
    .select("id,created_at,parent_variant_version_id")
    .eq("variant_id", params.currentVariant.id)
    .order("created_at", { ascending: true });

  if (sourceVersionsError) {
    throw new ApiError(
      500,
      "variant_merge_versions_fetch_failed",
      "Could not load source variant versions",
      sourceVersionsError.message,
    );
  }

  if ((sourceVersions ?? []).length > 0) {
    const firstSourceVersion = sourceVersions?.[0];
    if (firstSourceVersion && targetVariant.current_version_id) {
      await params.serviceClient
        .from("user_recipe_variant_versions")
        .update({
          parent_variant_version_id: targetVariant.current_version_id,
        })
        .eq("id", firstSourceVersion.id);
    }

    const { error: reparentVersionsError } = await params.serviceClient
      .from("user_recipe_variant_versions")
      .update({ variant_id: targetVariant.id, seed_origin: "publish_merge" })
      .eq("variant_id", params.currentVariant.id);

    if (reparentVersionsError) {
      throw new ApiError(
        500,
        "variant_merge_versions_failed",
        "Could not merge variant version history",
        reparentVersionsError.message,
      );
    }
  }

  const { error: targetVariantUpdateError } = await params.serviceClient
    .from("user_recipe_variants")
    .update({
      current_version_id: params.currentVariant.current_version_id,
      preference_fingerprint: params.currentVariant.preference_fingerprint,
      stale_status: params.currentVariant.stale_status,
      base_canonical_version_id: params.canonicalVersionId,
      canonical_recipe_id: params.canonicalRecipeId,
      last_materialized_at: params.currentVariant.last_materialized_at ?? params.now,
      accumulated_manual_edits: params.currentVariant.accumulated_manual_edits ?? [],
      variant_tags: params.currentVariant.variant_tags ?? {},
    })
    .eq("id", targetVariant.id);

  if (targetVariantUpdateError) {
    throw new ApiError(
      500,
      "variant_merge_target_update_failed",
      "Could not activate merged variant history",
      targetVariantUpdateError.message,
    );
  }

  await params.serviceClient
    .from("user_recipe_variants")
    .delete()
    .eq("id", params.currentVariant.id);

  await params.serviceClient
    .from("cookbook_entries")
    .update({
      active_variant_id: targetVariant.id,
      updated_at: params.now,
    })
    .eq("id", params.targetEntryId);

  await params.serviceClient
    .from("cookbook_entries")
    .delete()
    .eq("id", params.currentEntryId);

  return params.targetEntryId;
};

export const deriveCanonicalForCookbookEntry = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  cookbookEntryId: string;
  canonicalizeRecipePayload: (input: {
    serviceClient: SupabaseClient;
    userId: string;
    requestId: string;
    payload: RecipePayload;
    preferences: Record<string, JsonValue>;
    modelOverrides?: ModelOverrideMap;
  }) => Promise<RecipePayload>;
  resolveAndPersistCanonicalRecipe: (input: {
    client: SupabaseClient;
    serviceClient: SupabaseClient;
    userId: string;
    requestId: string;
    payload: RecipePayload;
    sourceChatId?: string;
    diffSummary?: string;
    selectedMemoryIds?: string[];
    modelOverrides?: ModelOverrideMap;
  }) => Promise<{
    recipeId: string;
    versionId: string;
  }>;
  ensurePersistedRecipeImageRequest?: (input: {
    serviceClient: SupabaseClient;
    userId: string;
    requestId: string;
    recipeId: string;
    recipeVersionId: string;
  }) => Promise<void>;
  scheduleImageQueueDrain?: (input: {
    serviceClient: SupabaseClient;
    actorUserId: string;
    requestId: string;
    limit?: number;
    modelOverrides?: ModelOverrideMap;
  }) => void;
  modelOverrides?: ModelOverrideMap;
}): Promise<{
  cookbookEntryId: string;
  canonicalRecipeId: string | null;
  canonicalStatus: CookbookCanonicalStatus;
}> => {
  const entry = await loadCookbookEntryRow({
    client: params.serviceClient,
    userId: params.userId,
    cookbookEntryId: params.cookbookEntryId,
  });
  const { variant, version } = await loadActiveVariantState({
    client: params.serviceClient,
    cookbookEntryId: entry.id,
    activeVariantId: entry.active_variant_id,
  });

  if (!variant || !version) {
    throw new ApiError(
      409,
      "cookbook_entry_variant_missing",
      "Cookbook entry does not have a private variant to canonicalize",
    );
  }

  const now = new Date().toISOString();
  await params.serviceClient
    .from("cookbook_entries")
    .update({
      canonical_status: "processing",
      canonical_attempted_at: now,
      canonical_failed_at: null,
      canonical_failure_reason: null,
      updated_at: now,
    })
    .eq("id", entry.id);

  try {
    const canonicalPayload = await params.canonicalizeRecipePayload({
      serviceClient: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      payload: version.payload,
      preferences: {},
      modelOverrides: params.modelOverrides,
    });

    const review = await reviewCanonicalCandidate({
      serviceClient: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      privatePayload: version.payload,
      canonicalPayload,
      modelOverrides: params.modelOverrides,
    });

    if (!review.approved) {
      await params.serviceClient
        .from("cookbook_entries")
        .update({
          canonical_status: "failed",
          canonical_failed_at: new Date().toISOString(),
          canonical_failure_reason: review.rationale ?? "Canonical review rejected the candidate",
          updated_at: new Date().toISOString(),
        })
        .eq("id", entry.id);

      return {
        cookbookEntryId: entry.id,
        canonicalRecipeId: null,
        canonicalStatus: "failed",
      };
    }

    const saved = await params.resolveAndPersistCanonicalRecipe({
      client: params.serviceClient,
      serviceClient: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      payload: canonicalPayload,
      sourceChatId: entry.source_chat_id ?? undefined,
      diffSummary: `Derived from private cookbook entry ${entry.id}`,
      selectedMemoryIds: [],
      modelOverrides: params.modelOverrides,
    });

    const { data: existingEntry, error: existingEntryError } = await params
      .serviceClient
      .from("cookbook_entries")
      .select("id,active_variant_id")
      .eq("user_id", params.userId)
      .eq("canonical_recipe_id", saved.recipeId)
      .neq("id", entry.id)
      .maybeSingle();

    if (existingEntryError) {
      throw new ApiError(
        500,
        "cookbook_entry_duplicate_lookup_failed",
        "Could not check for duplicate cookbook entry",
        existingEntryError.message,
      );
    }

    const targetEntryId = existingEntry
      ? await mergeVariantIntoExistingEntry({
        serviceClient: params.serviceClient,
        currentEntryId: entry.id,
        targetEntryId: existingEntry.id,
        currentVariant: variant,
        targetVariantId: existingEntry.active_variant_id,
        canonicalRecipeId: saved.recipeId,
        canonicalVersionId: saved.versionId,
        now,
      })
      : entry.id;

    if (!existingEntry) {
      const [{ error: entryUpdateError }, { error: variantUpdateError }] = await Promise.all([
        params.serviceClient
          .from("cookbook_entries")
          .update({
            canonical_recipe_id: saved.recipeId,
            canonical_status: "ready",
            canonical_ready_at: now,
            canonical_failed_at: null,
            canonical_failure_reason: null,
            updated_at: now,
          })
          .eq("id", entry.id),
        params.serviceClient
          .from("user_recipe_variants")
          .update({
            canonical_recipe_id: saved.recipeId,
            base_canonical_version_id: saved.versionId,
          })
          .eq("id", variant.id),
      ]);

      if (entryUpdateError) {
        throw new ApiError(
          500,
          "cookbook_entry_canonical_link_failed",
          "Could not link cookbook entry to canonical recipe",
          entryUpdateError.message,
        );
      }
      if (variantUpdateError) {
        throw new ApiError(
          500,
          "variant_canonical_link_failed",
          "Could not link private variant to canonical recipe",
          variantUpdateError.message,
        );
      }
    } else {
      await params.serviceClient
        .from("cookbook_entries")
        .update({
          canonical_recipe_id: saved.recipeId,
          canonical_status: "ready",
          canonical_ready_at: now,
          canonical_failed_at: null,
          canonical_failure_reason: null,
          updated_at: now,
        })
        .eq("id", targetEntryId);
    }

    if (params.ensurePersistedRecipeImageRequest) {
      await params.ensurePersistedRecipeImageRequest({
        serviceClient: params.serviceClient,
        userId: params.userId,
        requestId: params.requestId,
        recipeId: saved.recipeId,
        recipeVersionId: saved.versionId,
      });
    }
    params.scheduleImageQueueDrain?.({
      serviceClient: params.serviceClient,
      actorUserId: params.userId,
      requestId: params.requestId,
      limit: 2,
      modelOverrides: params.modelOverrides,
    });

    return {
      cookbookEntryId: targetEntryId,
      canonicalRecipeId: saved.recipeId,
      canonicalStatus: "ready",
    };
  } catch (error) {
    await params.serviceClient
      .from("cookbook_entries")
      .update({
        canonical_status: "failed",
        canonical_failed_at: new Date().toISOString(),
        canonical_failure_reason: error instanceof Error ? error.message : String(error),
        updated_at: new Date().toISOString(),
      })
      .eq("id", entry.id);
    throw error;
  }
};

export const fetchCookbookEntryDetail = async (params: {
  client: SupabaseClient;
  userId: string;
  cookbookEntryId: string;
  viewOptions: RecipeViewOptions;
}): Promise<CookbookRecipeDetail> => {
  const entry = await loadCookbookEntryRow({
    client: params.client,
    userId: params.userId,
    cookbookEntryId: params.cookbookEntryId,
  });
  const { variant, version } = await loadActiveVariantState({
    client: params.client,
    cookbookEntryId: entry.id,
    activeVariantId: entry.active_variant_id,
  });

  if (!variant || !version) {
    if (!entry.canonical_recipe_id) {
      throw new ApiError(
        409,
        "cookbook_entry_unreadable",
        "Cookbook entry does not have a readable recipe payload",
      );
    }
    const recipe = await fetchRecipeView(
      params.client,
      entry.canonical_recipe_id,
      true,
      params.viewOptions,
    );
    return {
      cookbook_entry_id: entry.id,
      canonical_recipe_id: entry.canonical_recipe_id,
      canonical_status: entry.canonical_status,
      variant_id: null,
      variant_version_id: null,
      recipe,
      adaptation_summary: "",
      variant_status: "none",
      derivation_kind: null,
      personalized_at: null,
      substitution_diffs: [],
    };
  }

  if (entry.canonical_recipe_id) {
    const canonicalRecipe = await fetchRecipeView(
      params.client,
      entry.canonical_recipe_id,
      true,
      params.viewOptions,
    );
    const canonicalRows = variant.base_canonical_version_id
      ? await fetchCanonicalIngredientRows(params.client, variant.base_canonical_version_id)
      : version.source_canonical_version_id
      ? await fetchCanonicalIngredientRows(params.client, version.source_canonical_version_id)
      : undefined;
    const projectedVariantPayload = projectRecipePayloadForView({
      payload: version.payload,
      canonicalRows,
      options: params.viewOptions,
    });

    return {
      cookbook_entry_id: entry.id,
      canonical_recipe_id: entry.canonical_recipe_id,
      canonical_status: entry.canonical_status,
      variant_id: variant.id,
      variant_version_id: version.id,
      recipe: {
        ...canonicalRecipe,
        title: version.payload.title ?? canonicalRecipe.title,
        description: projectedVariantPayload.description,
        summary: projectedVariantPayload.summary,
        ingredients: projectedVariantPayload.ingredients,
        ingredient_groups: projectedVariantPayload.ingredient_groups,
        steps: projectedVariantPayload.steps,
        notes: projectedVariantPayload.notes,
        pairings: projectedVariantPayload.pairings,
        metadata: projectedVariantPayload.metadata,
        emoji: projectedVariantPayload.emoji,
      },
      adaptation_summary: (version.provenance.adaptation_summary as string) ?? "",
      variant_status: normalizeVariantStatus(variant.stale_status),
      derivation_kind: version.derivation_kind,
      personalized_at: variant.last_materialized_at ?? version.created_at,
      substitution_diffs: (version.provenance.substitution_diffs as JsonValue) ?? [],
      provenance: version.provenance,
    };
  }

  return {
    cookbook_entry_id: entry.id,
    canonical_recipe_id: null,
    canonical_status: entry.canonical_status,
    variant_id: variant.id,
    variant_version_id: version.id,
    recipe: buildPrivateRecipeView({
      cookbookEntryId: entry.id,
      payload: version.payload,
      viewOptions: params.viewOptions,
      previewImageUrl: entry.preview_image_url,
      previewImageStatus: entry.preview_image_status,
      updatedAt: entry.updated_at,
      versionId: version.id,
      createdAt: version.created_at,
      canonicalRecipeId: null,
    }),
    adaptation_summary: (version.provenance.adaptation_summary as string) ?? "",
    variant_status: normalizeVariantStatus(variant.stale_status),
    derivation_kind: version.derivation_kind,
    personalized_at: variant.last_materialized_at ?? version.created_at,
    substitution_diffs: (version.provenance.substitution_diffs as JsonValue) ?? [],
    provenance: version.provenance,
  };
};
