import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../../_shared/errors.ts";
import { llmGateway, type ModelOverrideMap } from "../../_shared/llm-gateway.ts";
import type { JsonValue, RecipePayload } from "../../_shared/types.ts";
import {
  canonicalizeRecipePayloadMetadata,
  resolveRecipePayloadSummary,
} from "../recipe-preview.ts";
import {
  fetchCanonicalIngredientRows,
  loadIngredientNameById,
} from "./recipe-enrichment.ts";
import { persistRecipe } from "./recipe-persistence.ts";
import { resolveRuntimeFlag } from "./feature-flags.ts";

export type RecipeIdentityResolutionReason =
  | "exact_content_fingerprint"
  | "matched_existing_canon"
  | "matched_existing_canon_shadow"
  | "new_canon"
  | "canon_match_unavailable";

export type ImageResolutionReason =
  | "candidate_exact_fingerprint"
  | "candidate_generate"
  | "persisted_exact_fingerprint"
  | "persisted_canonical_image_fingerprint"
  | "persisted_canonical_judge_reuse"
  | "persisted_canonical_generate"
  | "legacy";

export type RecipeCanonMatchDecision =
  | "match_existing_canon"
  | "create_new_canon";

export type RecipeCanonMatchMode = "off" | "shadow" | "enforce";

export type RecipeIdentityDescriptor = {
  contentFingerprint: string;
  imageFingerprint: string;
  canonIdentityText: string;
  imageIdentityText: string;
  canonicalIngredientIds: string[];
  canonicalIngredientNames: string[];
  normalizedTitle: string;
  recipePayload: RecipePayload;
};

export type RecipeIdentityCandidate = {
  recipeId: string;
  recipeVersionId: string;
  title: string;
  summary: string;
  canonicalIngredientNames: string[];
  similarity: number | null;
};

export type RecipeIdentityResolution = {
  action:
    | "reuse_existing_version"
    | "append_existing_canon"
    | "create_new_canon";
  reason: RecipeIdentityResolutionReason;
  recipeId: string;
  versionId: string;
  matchedRecipeId: string | null;
  matchedRecipeVersionId: string | null;
  judgeInvoked: boolean;
  judgeCandidateCount: number;
  judgeConfidence: number | null;
};

type RecipeCanonMatchResult = {
  decision: RecipeCanonMatchDecision;
  matchedRecipeId: string | null;
  matchedRecipeVersionId: string | null;
  rationale: string;
  confidence: number | null;
  provider: string;
  model: string;
  latencyMs: number;
};

export const normalizeText = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
};

export const normalizeNumber = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export const normalizeInteger = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
};

export const normalizeStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    const normalized = normalizeText(entry);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
};

const normalizeInstructionPartForFingerprint = (
  value: unknown,
): JsonValue | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const part = value as Record<string, unknown>;
  const type = normalizeText(part.type)?.toLowerCase();
  if (type === "temperature") {
    return {
      type: "temperature",
      value: normalizeNumber(part.value),
      unit: normalizeText(part.unit)?.toLowerCase() ?? null,
    };
  }

  const text = normalizeText(part.value) ?? normalizeText(part.text);
  if (!text) {
    return null;
  }

  return {
    type: "text",
    value: text.toLowerCase(),
  };
};

const buildStepInstructionFingerprint = (
  step: RecipePayload["steps"][number],
): JsonValue => {
  const views = step.instruction_views;
  const parts = views?.balanced ?? views?.detailed ?? views?.concise;
  if (Array.isArray(parts) && parts.length > 0) {
    const normalizedParts = parts
      .map((part) => normalizeInstructionPartForFingerprint(part as unknown))
      .filter((part): part is JsonValue => part !== null);

    if (normalizedParts.length > 0) {
      return {
        mode: "balanced_view",
        parts: normalizedParts,
      };
    }
  }

  return {
    mode: "legacy_instruction",
    instruction: normalizeText(step.instruction)?.toLowerCase() ?? "",
  };
};

export const stableStringify = (value: JsonValue): string => {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  const entries = Object.entries(value)
    .filter(([, entryValue]) => typeof entryValue !== "undefined")
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entryValue]) =>
    `${JSON.stringify(key)}:${stableStringify(entryValue)}`
  ).join(",")}}`;
};

export const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer)).map((value) =>
    value.toString(16).padStart(2, "0")
  ).join("");

export const buildRecipeContentFingerprintPayload = (
  recipe: RecipePayload,
): JsonValue => ({
  servings: normalizeInteger(recipe.servings),
  ingredients: (recipe.ingredients ?? []).map((ingredient) => ({
    name: normalizeText(ingredient.name)?.toLowerCase() ?? "",
    amount: normalizeNumber(ingredient.amount),
    unit: normalizeText(ingredient.unit)?.toLowerCase() ?? null,
    preparation: normalizeText(ingredient.preparation)?.toLowerCase() ?? null,
    category: normalizeText(ingredient.category)?.toLowerCase() ?? null,
    component: normalizeText(ingredient.component)?.toLowerCase() ?? null,
  })),
  steps: (recipe.steps ?? []).map((step) => ({
    index: normalizeInteger(step.index),
    instruction: buildStepInstructionFingerprint(step),
    timer_seconds: normalizeInteger(step.timer_seconds),
    notes: normalizeText(step.notes)?.toLowerCase() ?? null,
    inline_measurements: Array.isArray(step.inline_measurements)
      ? step.inline_measurements.map((measurement) => ({
        ingredient: normalizeText(measurement.ingredient)?.toLowerCase() ?? "",
        amount: normalizeNumber(measurement.amount),
        unit: normalizeText(measurement.unit)?.toLowerCase() ?? null,
      }))
      : [],
  })),
  notes: normalizeText(recipe.notes)?.toLowerCase() ?? null,
});

export const buildRecipeImageFingerprintPayload = (
  recipe: RecipePayload,
): JsonValue => ({
  servings: normalizeInteger(recipe.servings),
  ingredients: (recipe.ingredients ?? []).map((ingredient) => ({
    name: normalizeText(ingredient.name)?.toLowerCase() ?? "",
    amount: normalizeNumber(ingredient.amount),
    unit: normalizeText(ingredient.unit)?.toLowerCase() ?? null,
    preparation: normalizeText(ingredient.preparation)?.toLowerCase() ?? null,
    category: normalizeText(ingredient.category)?.toLowerCase() ?? null,
    component: normalizeText(ingredient.component)?.toLowerCase() ?? null,
  })),
  steps: (recipe.steps ?? []).map((step) => ({
    index: normalizeInteger(step.index),
    instruction: buildStepInstructionFingerprint(step),
    timer_seconds: normalizeInteger(step.timer_seconds),
    inline_measurements: Array.isArray(step.inline_measurements)
      ? step.inline_measurements.map((measurement) => ({
        ingredient: normalizeText(measurement.ingredient)?.toLowerCase() ?? "",
        amount: normalizeNumber(measurement.amount),
        unit: normalizeText(measurement.unit)?.toLowerCase() ?? null,
      }))
      : [],
  })),
});

const listifyMetadata = (
  metadata: Record<string, JsonValue> | null | undefined,
  key: string,
): string[] => {
  if (!metadata) {
    return [];
  }
  return normalizeStringList(metadata[key]);
};

const uniqueLowerPreservingCase = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
};

export const buildRecipeCanonIdentityText = (
  recipe: RecipePayload,
  canonicalIngredientNames: string[],
  normalizedTitle: string,
): string => {
  const metadata = canonicalizeRecipePayloadMetadata(recipe) ?? {};
  const lines = uniqueLowerPreservingCase([
    normalizedTitle,
    normalizeText(resolveRecipePayloadSummary(recipe)) ?? "",
    ...canonicalIngredientNames,
    ...(recipe.ingredients ?? []).map((ingredient) => ingredient.name),
    ...listifyMetadata(metadata, "cuisine_tags"),
    ...listifyMetadata(metadata, "techniques"),
    ...listifyMetadata(metadata, "occasion_tags"),
    ...listifyMetadata(metadata, "diet_tags"),
    ...normalizeStringList(recipe.pairings),
    normalizeText(metadata.vibe) ?? "",
  ]);

  return lines.join("\n");
};

export const buildRecipeImageIdentityText = (
  recipe: RecipePayload,
  canonicalIngredientNames: string[],
  normalizedTitle: string,
): string => {
  const metadata = canonicalizeRecipePayloadMetadata(recipe) ?? {};
  const lines = uniqueLowerPreservingCase([
    normalizedTitle,
    normalizeText(resolveRecipePayloadSummary(recipe)) ?? "",
    ...canonicalIngredientNames,
    ...(recipe.ingredients ?? []).map((ingredient) => ingredient.name),
    ...listifyMetadata(metadata, "cuisine_tags"),
    ...listifyMetadata(metadata, "techniques"),
    ...listifyMetadata(metadata, "serving_notes"),
    normalizeText(metadata.vibe) ?? "",
  ]);

  return lines.join("\n");
};

const sha256Hex = async (value: JsonValue): Promise<string> => {
  return toHex(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(stableStringify(value)),
    ),
  );
};

export const buildRecipeIdentityDescriptor = async (params: {
  recipe: RecipePayload;
  titleOverride?: string | null;
  canonicalIngredientIds?: string[];
  canonicalIngredientNames?: string[];
}): Promise<RecipeIdentityDescriptor> => {
  const normalizedTitle = normalizeText(params.titleOverride) ??
    normalizeText(params.recipe.title) ??
    "Untitled Recipe";
  const recipePayload = {
    ...params.recipe,
    title: normalizedTitle,
  };
  const canonicalIngredientIds = Array.from(
    new Set((params.canonicalIngredientIds ?? []).filter(Boolean)),
  );
  const canonicalIngredientNames = uniqueLowerPreservingCase(
    params.canonicalIngredientNames && params.canonicalIngredientNames.length > 0
      ? params.canonicalIngredientNames
      : (recipePayload.ingredients ?? []).map((ingredient) => ingredient.name),
  );

  const contentFingerprint = await sha256Hex(
    buildRecipeContentFingerprintPayload(recipePayload),
  );
  const imageFingerprint = await sha256Hex(
    buildRecipeImageFingerprintPayload(recipePayload),
  );

  return {
    contentFingerprint,
    imageFingerprint,
    canonIdentityText: buildRecipeCanonIdentityText(
      recipePayload,
      canonicalIngredientNames,
      normalizedTitle,
    ),
    imageIdentityText: buildRecipeImageIdentityText(
      recipePayload,
      canonicalIngredientNames,
      normalizedTitle,
    ),
    canonicalIngredientIds,
    canonicalIngredientNames,
    normalizedTitle,
    recipePayload,
  };
};

export const resolveRecipeCanonMatchMode = async (params: {
  serviceClient: SupabaseClient;
  requestUrl?: string;
}): Promise<RecipeCanonMatchMode> => {
  const resolved = await resolveRuntimeFlag({
    serviceClient: params.serviceClient,
    key: "recipe_canon_match",
    requestUrl: params.requestUrl,
  });

  if (!resolved.enabled) {
    return "off";
  }

  const mode = typeof resolved.payload?.mode === "string"
    ? resolved.payload.mode.trim().toLowerCase()
    : null;

  if (mode === "enforce") {
    return "enforce";
  }

  return "shadow";
};

export const resolveSameCanonImageJudgeEnabled = async (params: {
  serviceClient: SupabaseClient;
  requestUrl?: string;
}): Promise<boolean> => {
  const resolved = await resolveRuntimeFlag({
    serviceClient: params.serviceClient,
    key: "same_canon_image_judge",
    requestUrl: params.requestUrl,
  });
  return resolved.enabled;
};

export const isSameCanonImageJudgeEnabled = resolveSameCanonImageJudgeEnabled;

export const serializeVector = (vector: number[]): string => {
  return `[${vector.map((value) => Number(value).toFixed(12)).join(",")}]`;
};

export const loadRecipeIdentityIngredientContext = async (params: {
  serviceClient: SupabaseClient;
  recipeVersionId: string;
}): Promise<{
  canonicalIngredientIds: string[];
  canonicalIngredientNames: string[];
}> => {
  const ingredientRows = await fetchCanonicalIngredientRows(
    params.serviceClient,
    params.recipeVersionId,
  );
  const canonicalIngredientIds = Array.from(
    new Set(
      ingredientRows.flatMap((row) =>
        typeof row.ingredient_id === "string" && row.ingredient_id.length > 0
          ? [row.ingredient_id]
          : []
      ),
    ),
  );
  const ingredientNameById = await loadIngredientNameById(
    params.serviceClient,
    canonicalIngredientIds,
  );
  const canonicalIngredientNames = uniqueLowerPreservingCase(
    ingredientRows.flatMap((row) => {
      if (row.ingredient_id) {
        const canonicalName = ingredientNameById.get(row.ingredient_id);
        if (canonicalName) {
          return [canonicalName];
        }
      }

      const fallback = normalizeText(
        typeof row.metadata.canonical_name === "string"
          ? row.metadata.canonical_name
          : row.source_name,
      );
      return fallback ? [fallback] : [];
    }),
  );

  return {
    canonicalIngredientIds,
    canonicalIngredientNames,
  };
};

const logIdentityEvent = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  eventType: "recipe_identity_resolved" | "image_identity_resolved";
  requestId: string;
  payload: Record<string, JsonValue>;
}): Promise<void> => {
  const { error } = await params.serviceClient.from("events").insert({
    user_id: params.userId,
    event_type: params.eventType,
    request_id: params.requestId,
    event_payload: params.payload,
  });

  if (error) {
    console.error("identity_event_log_failed", {
      event_type: params.eventType,
      request_id: params.requestId,
      error: error.message,
    });
  }
};

const loadExactRecipeIdentityMatch = async (params: {
  serviceClient: SupabaseClient;
  contentFingerprint: string;
}): Promise<{
  recipeId: string;
  recipeVersionId: string;
} | null> => {
  const { data, error } = await params.serviceClient
    .from("recipe_identity_documents")
    .select("recipe_id,recipe_version_id,is_current_version,updated_at")
    .eq("content_fingerprint", params.contentFingerprint)
    .order("is_current_version", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new ApiError(
      500,
      "recipe_identity_lookup_failed",
      "Could not look up recipe identity",
      error.message,
    );
  }

  if (!data?.recipe_id || !data.recipe_version_id) {
    return null;
  }

  return {
    recipeId: String(data.recipe_id),
    recipeVersionId: String(data.recipe_version_id),
  };
};

const loadRecipeIdentityCandidates = async (params: {
  serviceClient: SupabaseClient;
  embeddingVector: number[];
  limit?: number;
}): Promise<RecipeIdentityCandidate[]> => {
  const { data, error } = await params.serviceClient.rpc(
    "list_recipe_identity_candidates",
    {
      p_query_embedding: serializeVector(params.embeddingVector),
      p_limit: Math.max(1, Math.min(5, Number(params.limit ?? 5))),
    },
  );

  if (error) {
    throw new ApiError(
      500,
      "recipe_identity_candidates_failed",
      "Could not load recipe identity candidates",
      error.message,
    );
  }

  if (!Array.isArray(data)) {
    return [];
  }

  return data.map((row) => ({
    recipeId: String((row as Record<string, unknown>).recipe_id ?? ""),
    recipeVersionId: String(
      (row as Record<string, unknown>).recipe_version_id ?? "",
    ),
    title: String((row as Record<string, unknown>).title ?? ""),
    summary: String((row as Record<string, unknown>).summary ?? ""),
    canonicalIngredientNames: normalizeStringList(
      (row as Record<string, unknown>).canonical_ingredient_names,
    ),
    similarity: normalizeNumber(
      (row as Record<string, unknown>).similarity,
    ),
  })).filter((row) => row.recipeId.length > 0 && row.recipeVersionId.length > 0);
};

const normalizeCanonMatchResult = (
  value: Record<string, unknown>,
  validCandidateIds: Set<string>,
): RecipeCanonMatchResult | null => {
  const decision = normalizeText(value.decision)?.toLowerCase();
  if (
    decision !== "match_existing_canon" &&
    decision !== "create_new_canon"
  ) {
    return null;
  }

  const matchedRecipeId = normalizeText(value.matched_recipe_id);
  const matchedRecipeVersionId = normalizeText(value.matched_recipe_version_id);
  if (
    decision === "match_existing_canon" &&
    (!matchedRecipeId || !matchedRecipeVersionId ||
      !validCandidateIds.has(matchedRecipeVersionId))
  ) {
    return null;
  }

  return {
    decision,
    matchedRecipeId: decision === "match_existing_canon" ? matchedRecipeId : null,
    matchedRecipeVersionId: decision === "match_existing_canon"
      ? matchedRecipeVersionId
      : null,
    rationale: normalizeText(value.rationale) ?? "",
    confidence: normalizeNumber(value.confidence),
    provider: normalizeText(value.provider) ?? "",
    model: normalizeText(value.model) ?? "",
    latencyMs: normalizeInteger(value.latency_ms) ?? 0,
  };
};

const runRecipeCanonMatch = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  descriptor: RecipeIdentityDescriptor;
  candidates: RecipeIdentityCandidate[];
  modelOverrides?: ModelOverrideMap;
}): Promise<RecipeCanonMatchResult | null> => {
  try {
    const startedAt = Date.now();
    const { result, config } = await llmGateway.executeRecipeCanonMatch({
      client: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      targetRecipe: params.descriptor.recipePayload,
      targetDescriptor: {
        canonical_ingredient_ids: params.descriptor.canonicalIngredientIds,
        canonical_ingredient_names: params.descriptor.canonicalIngredientNames,
        canon_identity_text: params.descriptor.canonIdentityText,
        content_fingerprint: params.descriptor.contentFingerprint,
      },
      candidates: params.candidates.map((candidate) => ({
        recipe_id: candidate.recipeId,
        recipe_version_id: candidate.recipeVersionId,
        title: candidate.title,
        summary: candidate.summary,
        canonical_ingredient_names: candidate.canonicalIngredientNames,
        similarity: candidate.similarity,
      })),
      modelOverrides: params.modelOverrides,
    });

    const normalized = normalizeCanonMatchResult(
      {
        ...result,
        provider: config.provider,
        model: config.model,
        latency_ms: Date.now() - startedAt,
      } as Record<string, unknown>,
      new Set(params.candidates.map((candidate) => candidate.recipeVersionId)),
    );
    return normalized;
  } catch (error) {
    if (
      error instanceof ApiError &&
      (
        error.code === "gateway_prompt_missing" ||
        error.code === "gateway_rule_missing" ||
        error.code === "gateway_route_missing"
      )
    ) {
      return null;
    }
    throw error;
  }
};

const markCanonicalRecipeVariantsStale = async (params: {
  serviceClient: SupabaseClient;
  recipeId: string;
}): Promise<number> => {
  const { data, error } = await params.serviceClient
    .from("user_recipe_variants")
    .update({
      stale_status: "stale",
      updated_at: new Date().toISOString(),
    })
    .eq("canonical_recipe_id", params.recipeId)
    .eq("stale_status", "current")
    .select("id");

  if (error) {
    throw new ApiError(
      500,
      "variant_stale_mark_failed",
      "Could not mark canonical variants stale",
      error.message,
    );
  }

  return data?.length ?? 0;
};

export const upsertRecipeIdentityDocument = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  recipeId: string;
  recipeVersionId: string;
  payload: RecipePayload;
  modelOverrides?: ModelOverrideMap;
}): Promise<RecipeIdentityDescriptor> => {
  const ingredientContext = await loadRecipeIdentityIngredientContext({
    serviceClient: params.serviceClient,
    recipeVersionId: params.recipeVersionId,
  });
  const descriptor = await buildRecipeIdentityDescriptor({
    recipe: params.payload,
    canonicalIngredientIds: ingredientContext.canonicalIngredientIds,
    canonicalIngredientNames: ingredientContext.canonicalIngredientNames,
  });
  const embedding = await llmGateway.embedRecipeSearchQuery({
    client: params.serviceClient,
    userId: params.userId,
    requestId: params.requestId,
    inputText: descriptor.canonIdentityText,
    modelOverrides: params.modelOverrides,
  });

  await params.serviceClient.from("recipe_identity_documents").update({
    is_current_version: false,
    updated_at: new Date().toISOString(),
  }).eq("recipe_id", params.recipeId);

  const { error } = await params.serviceClient.from("recipe_identity_documents")
    .upsert({
      recipe_version_id: params.recipeVersionId,
      recipe_id: params.recipeId,
      is_current_version: true,
      content_fingerprint: descriptor.contentFingerprint,
      image_fingerprint: descriptor.imageFingerprint,
      canonical_ingredient_ids: descriptor.canonicalIngredientIds,
      canonical_ingredient_names: descriptor.canonicalIngredientNames,
      identity_text: descriptor.canonIdentityText,
      embedding: serializeVector(embedding.vector),
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "recipe_version_id",
    });

  if (error) {
    throw new ApiError(
      500,
      "recipe_identity_upsert_failed",
      "Could not persist recipe identity document",
      error.message,
    );
  }

  return descriptor;
};

export const resolveAndPersistCanonicalRecipe = async (params: {
  client: SupabaseClient;
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  requestUrl?: string;
  payload: RecipePayload;
  sourceChatId?: string;
  diffSummary?: string;
  selectedMemoryIds?: string[];
  modelOverrides?: ModelOverrideMap;
}): Promise<RecipeIdentityResolution> => {
  const descriptor = await buildRecipeIdentityDescriptor({
    recipe: params.payload,
  });

  const exactMatch = await loadExactRecipeIdentityMatch({
    serviceClient: params.serviceClient,
    contentFingerprint: descriptor.contentFingerprint,
  });
  if (exactMatch) {
    await logIdentityEvent({
      serviceClient: params.serviceClient,
      userId: params.userId,
      eventType: "recipe_identity_resolved",
      requestId: params.requestId,
      payload: {
        action: "reuse_existing_version",
        reason: "exact_content_fingerprint",
        recipe_id: exactMatch.recipeId,
        recipe_version_id: exactMatch.recipeVersionId,
        content_fingerprint: descriptor.contentFingerprint,
      },
    });
    return {
      action: "reuse_existing_version",
      reason: "exact_content_fingerprint",
      recipeId: exactMatch.recipeId,
      versionId: exactMatch.recipeVersionId,
      matchedRecipeId: exactMatch.recipeId,
      matchedRecipeVersionId: exactMatch.recipeVersionId,
      judgeInvoked: false,
      judgeCandidateCount: 0,
      judgeConfidence: null,
    };
  }

  const canonMatchMode = await resolveRecipeCanonMatchMode({
    serviceClient: params.serviceClient,
    requestUrl: params.requestUrl,
  });
  let candidates: RecipeIdentityCandidate[] = [];
  let canonMatch: RecipeCanonMatchResult | null = null;
  if (canonMatchMode !== "off") {
    const embedding = await llmGateway.embedRecipeSearchQuery({
      client: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      inputText: descriptor.canonIdentityText,
      modelOverrides: params.modelOverrides,
    });
    candidates = await loadRecipeIdentityCandidates({
      serviceClient: params.serviceClient,
      embeddingVector: embedding.vector,
      limit: 5,
    });
    if (candidates.length > 0) {
      canonMatch = await runRecipeCanonMatch({
        serviceClient: params.serviceClient,
        userId: params.userId,
        requestId: params.requestId,
        descriptor,
        candidates,
        modelOverrides: params.modelOverrides,
      });
    }
  }
  const judgeInvoked = canonMatchMode !== "off" && candidates.length > 0;
  const matchedCanonRecipeId = canonMatch?.matchedRecipeId ?? null;
  const matchedCanonRecipeVersionId = canonMatch?.matchedRecipeVersionId ?? null;

  const shouldAppendExistingCanon = canonMatchMode === "enforce" &&
    canonMatch?.decision === "match_existing_canon" &&
    Boolean(matchedCanonRecipeId) &&
    Boolean(matchedCanonRecipeVersionId);

  const saved = await persistRecipe({
    client: params.client,
    serviceClient: params.serviceClient,
    userId: params.userId,
    requestId: params.requestId,
    payload: params.payload,
    sourceChatId: params.sourceChatId,
    recipeId: shouldAppendExistingCanon ? matchedCanonRecipeId ?? undefined : undefined,
    parentVersionId: shouldAppendExistingCanon
      ? matchedCanonRecipeVersionId ?? undefined
      : undefined,
    diffSummary: params.diffSummary,
    selectedMemoryIds: params.selectedMemoryIds,
  });

  await upsertRecipeIdentityDocument({
    serviceClient: params.serviceClient,
    userId: params.userId,
    requestId: params.requestId,
    recipeId: saved.recipeId,
    recipeVersionId: saved.versionId,
    payload: params.payload,
    modelOverrides: params.modelOverrides,
  });

  let action: RecipeIdentityResolution["action"] = "create_new_canon";
  let reason: RecipeIdentityResolutionReason = "new_canon";
  let matchedRecipeId: string | null = null;
  let matchedRecipeVersionId: string | null = null;

  if (shouldAppendExistingCanon) {
    action = "append_existing_canon";
    reason = "matched_existing_canon";
    matchedRecipeId = matchedCanonRecipeId;
    matchedRecipeVersionId = matchedCanonRecipeVersionId;
    await markCanonicalRecipeVariantsStale({
      serviceClient: params.serviceClient,
      recipeId: saved.recipeId,
    });
  } else if (
    canonMatchMode === "shadow" &&
    canonMatch?.decision === "match_existing_canon"
  ) {
    reason = "matched_existing_canon_shadow";
    matchedRecipeId = canonMatch.matchedRecipeId;
    matchedRecipeVersionId = canonMatch.matchedRecipeVersionId;
  } else if (canonMatchMode !== "off" && candidates.length > 0 && !canonMatch) {
    reason = "canon_match_unavailable";
  }

  await logIdentityEvent({
    serviceClient: params.serviceClient,
    userId: params.userId,
    eventType: "recipe_identity_resolved",
    requestId: params.requestId,
    payload: {
      action,
      reason,
      recipe_id: saved.recipeId,
      recipe_version_id: saved.versionId,
      content_fingerprint: descriptor.contentFingerprint,
      matched_recipe_id: matchedRecipeId,
      matched_recipe_version_id: matchedRecipeVersionId,
      judge_invoked: judgeInvoked,
      judge_candidate_count: candidates.length,
      judge_confidence: canonMatch?.confidence ?? null,
      canon_match_mode: canonMatchMode,
    },
  });

  return {
    action,
    reason,
    recipeId: saved.recipeId,
    versionId: saved.versionId,
    matchedRecipeId,
    matchedRecipeVersionId,
    judgeInvoked,
    judgeCandidateCount: candidates.length,
    judgeConfidence: canonMatch?.confidence ?? null,
  };
};

export const canonicalizeRecipePayload = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  payload: RecipePayload;
  preferences: Record<string, JsonValue>;
  modelOverrides?: ModelOverrideMap;
}): Promise<RecipePayload> => {
  const canonicalized = await llmGateway.canonicalizeRecipe({
    client: params.serviceClient,
    userId: params.userId,
    requestId: params.requestId,
    recipe: params.payload,
    preferences: params.preferences,
    modelOverrides: params.modelOverrides,
  });

  return canonicalized.recipe;
};

export const logImageIdentityResolution = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  imageRequestId: string;
  recipeId: string | null;
  recipeVersionId: string | null;
  reason: ImageResolutionReason;
  judgeInvoked: boolean;
  judgeCandidateCount: number;
  assetId: string | null;
}): Promise<void> => {
  await logIdentityEvent({
    serviceClient: params.serviceClient,
    userId: params.userId,
    eventType: "image_identity_resolved",
    requestId: params.requestId,
    payload: {
      image_request_id: params.imageRequestId,
      recipe_id: params.recipeId,
      recipe_version_id: params.recipeVersionId,
      reason: params.reason,
      judge_invoked: params.judgeInvoked,
      judge_candidate_count: params.judgeCandidateCount,
      asset_id: params.assetId,
    },
  });
};
