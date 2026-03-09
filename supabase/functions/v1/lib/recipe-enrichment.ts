/**
 * Recipe enrichment pipeline — ingredient resolution, metadata enrichment,
 * relation inference, and knowledge-graph upserts.
 *
 * Extracted from index.ts. Contains:
 *  - Types for recipe ingredient rows, mentions, enrichment stages, and parsed components.
 *  - Confidence helpers (clamping, persist/track thresholds).
 *  - DB loaders for ingredients, aliases, ontology terms, diet rules, and mentions.
 *  - `resolveCanonicalRecipeIngredientsAsync` — LLM-driven ingredient line parsing,
 *    alias resolution, mention persistence, and ontology qualifier linking.
 *  - `persistCanonicalRecipeIngredients` — initial canonical ingredient row insertion
 *    from a RecipePayload (used at recipe creation time).
 *  - `upsertIngredientEnrichment` — LLM-driven per-ingredient metadata enrichment
 *    with ontology term canonicalization and semantic diet guards.
 *  - `enrichRecipeMetadataAsync` — LLM-driven recipe-level metadata enrichment.
 *  - `inferIngredientRelationsAsync` — LLM-driven ingredient relation inference.
 *  - `upsertMetadataGraph` — full knowledge-graph entity + edge upsert from enrichment
 *    outputs, ingredient mentions, recipe links, and LLM-inferred relations.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { normalizeDelimitedToken } from "../../../../packages/shared/src/text-normalization.ts";
import { ApiError } from "../../_shared/errors.ts";
import type { JsonValue, RecipePayload } from "../../_shared/types.ts";
import { llmGateway } from "../../_shared/llm-gateway.ts";
import {
  canonicalizeIngredients,
  deriveCanonicalIngredientIdentity,
  type GroupByPreference,
  type InstructionVerbosity,
  type NormalizedStatus,
  normalizeIngredientKey,
  type TemperatureUnitPreference,
  type UnitKind,
  type UnitPreference,
} from "../recipe-standardization.ts";
import {
  applySemanticDietIncompatibilityRules,
  type SemanticDietIncompatibilityRule,
} from "../semantic-diet-compatibility.ts";
import {
  buildOntologyCanonicalizationCatalog,
  canonicalizeOntologyTerm,
  type OntologyCatalogTerm,
} from "../ontology-canonicalization.ts";
import { isOptionalSemanticCapabilityUnavailable } from "./routing-utils.ts";

export type RecipeViewOptions = {
  units: UnitPreference;
  groupBy: GroupByPreference;
  inlineMeasurements: boolean;
  verbosity: InstructionVerbosity;
  temperatureUnit: TemperatureUnitPreference;
};

export type CanonicalRecipeIngredientRow = {
  id: string;
  position: number;
  ingredient_id: string | null;
  source_name: string;
  source_amount: number | null;
  source_unit: string | null;
  normalized_amount_si: number | null;
  normalized_unit: string | null;
  unit_kind: UnitKind;
  normalized_status: NormalizedStatus;
  category: string | null;
  component: string | null;
  metadata: Record<string, JsonValue>;
};

export type RecipeIngredientMentionRow = {
  id: string;
  recipe_ingredient_id: string;
  recipe_version_id: string;
  ingredient_id: string | null;
  mention_index: number;
  mention_role: "primary" | "optional" | "alternative" | "garnish" | "unspecified";
  alternative_group_key: string | null;
  confidence: number;
  source: string;
  metadata: Record<string, JsonValue>;
  created_at: string;
  updated_at: string;
};

export const defaultRecipeViewOptions: RecipeViewOptions = {
  units: "source",
  groupBy: "component",
  inlineMeasurements: false,
  verbosity: "balanced",
  temperatureUnit: "fahrenheit",
};

export const toFiniteNumberOrNull = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export const listifyText = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

export const ENRICHMENT_PERSIST_CONFIDENCE = 0.85;
export const ENRICHMENT_TRACK_CONFIDENCE = 0.65;

export const clampConfidence = (value: unknown, fallback = 0.5): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, numeric));
};

export const shouldPersistEnrichment = (confidence: unknown): boolean =>
  clampConfidence(confidence, 0) >= ENRICHMENT_PERSIST_CONFIDENCE;

export const listifyMaybeText = (value: unknown): string[] => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }
  return listifyText(value);
};

export const normalizeTermKey = (value: string): string =>
  normalizeDelimitedToken(value);

export const parseCsvParam = (value: string | null): string[] => {
  if (!value) return [];
  return value.split(",")
    .map((entry) => entry.trim().toLocaleLowerCase())
    .filter((entry) => entry.length > 0);
};

export const loadSemanticDietIncompatibilityRules = async (
  client: SupabaseClient,
): Promise<SemanticDietIncompatibilityRule[]> => {
  const { data, error } = await client
    .from("semantic_diet_incompatibility_rules")
    .select("source_term_type,source_term_key,blocked_diet_tag,reason,is_active")
    .eq("is_active", true);

  if (error) {
    if (isOptionalSemanticCapabilityUnavailable(error)) {
      return [];
    }
    throw new ApiError(
      500,
      "semantic_diet_rules_fetch_failed",
      "Could not fetch semantic diet incompatibility rules",
      error.message,
    );
  }

  return (data ?? []).map((row) => ({
    source_term_type: String(row.source_term_type ?? ""),
    source_term_key: String(row.source_term_key ?? ""),
    blocked_diet_tag: String(row.blocked_diet_tag ?? ""),
    reason: typeof row.reason === "string" ? row.reason : null,
    is_active: Boolean(row.is_active),
  })).filter((row) =>
    row.source_term_type.length > 0 &&
    row.source_term_key.length > 0 &&
    row.blocked_diet_tag.length > 0
  );
};

export const loadOntologyCatalogTerms = async (
  client: SupabaseClient,
): Promise<OntologyCatalogTerm[]> => {
  const { data: terms, error: termsError } = await client
    .from("ontology_terms")
    .select("term_type,term_key,label");

  if (termsError) {
    if (isOptionalSemanticCapabilityUnavailable(termsError)) {
      return [];
    }
    throw new ApiError(
      500,
      "ontology_catalog_fetch_failed",
      "Could not fetch ontology catalog terms",
      termsError.message,
    );
  }

  return (terms ?? []).map((row) => ({
      term_type: String(row.term_type ?? ""),
      term_key: String(row.term_key ?? ""),
      label: String(row.label ?? ""),
      usage_count: 0,
    })).filter((row) =>
    row.term_type.length > 0 &&
    row.term_key.length > 0 &&
    row.label.length > 0
  );
};

export const loadCanonicalDietTags = async (
  client: SupabaseClient,
): Promise<string[]> => {
  const { data, error } = await client
    .from("graph_entities")
    .select("label")
    .eq("entity_type", "diet_tag");

  if (error) {
    if (isOptionalSemanticCapabilityUnavailable(error)) {
      return [];
    }
    throw new ApiError(
      500,
      "diet_tags_fetch_failed",
      "Could not fetch canonical diet tags",
      error.message,
    );
  }

  return Array.from(
    new Set(
      (data ?? [])
        .map((row) => normalizeTermKey(String(row.label ?? "")))
        .filter((value) => value.length > 0),
    ),
  );
};

export const fetchRecipeIngredientMentions = async (
  client: SupabaseClient,
  recipeVersionId: string,
): Promise<RecipeIngredientMentionRow[]> => {
  const result = await client
    .from("recipe_ingredient_mentions")
    .select(
      "id,recipe_ingredient_id,recipe_version_id,ingredient_id,mention_index,mention_role,alternative_group_key,confidence,source,metadata,created_at,updated_at",
    )
    .eq("recipe_version_id", recipeVersionId)
    .order("mention_index", { ascending: true });

  if (result.error) {
    if (isOptionalSemanticCapabilityUnavailable(result.error)) {
      return [];
    }
    throw new ApiError(
      500,
      "recipe_ingredient_mentions_fetch_failed",
      "Could not fetch recipe ingredient mentions",
      result.error.message,
    );
  }

  const allowedRoles = new Set([
    "primary",
    "optional",
    "alternative",
    "garnish",
    "unspecified",
  ]);

  return (result.data ?? []).map((row) => ({
    id: String(row.id ?? ""),
    recipe_ingredient_id: String(row.recipe_ingredient_id ?? ""),
    recipe_version_id: String(row.recipe_version_id ?? ""),
    ingredient_id: row.ingredient_id ? String(row.ingredient_id) : null,
    mention_index: Number(row.mention_index ?? 0),
    mention_role: allowedRoles.has(String(row.mention_role ?? "unspecified"))
      ? String(
        row.mention_role,
      ) as RecipeIngredientMentionRow["mention_role"]
      : "unspecified",
    alternative_group_key: row.alternative_group_key
      ? String(row.alternative_group_key)
      : null,
    confidence: clampConfidence(row.confidence, 0.5),
    source: row.source ? String(row.source) : "llm",
    metadata: row.metadata && typeof row.metadata === "object" &&
        !Array.isArray(row.metadata)
      ? row.metadata as Record<string, JsonValue>
      : {},
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  })).filter((row) => row.id.length > 0 && row.recipe_ingredient_id.length > 0);
};

export const fetchCanonicalIngredientRows = async (
  client: SupabaseClient,
  recipeVersionId: string,
): Promise<CanonicalRecipeIngredientRow[]> => {
  const rowsResult = await client
    .from("recipe_ingredients")
    .select(
      "id,position,ingredient_id,source_name,source_amount,source_unit,normalized_amount_si,normalized_unit,unit_kind,normalized_status,category,component,metadata",
    )
    .eq("recipe_version_id", recipeVersionId)
    .order("position", { ascending: true });

  if (rowsResult.error) {
    if (
      isOptionalSemanticCapabilityUnavailable(rowsResult.error)
    ) {
      return [];
    }

    throw new ApiError(
      500,
      "recipe_ingredients_fetch_failed",
      "Could not fetch canonical recipe ingredients",
      rowsResult.error.message,
    );
  }

  return (rowsResult.data ?? []).map((row) => ({
    id: String(row.id ?? ""),
    position: Number(row.position ?? 0),
    ingredient_id: row.ingredient_id ?? null,
    source_name: String(row.source_name ?? ""),
    source_amount: toFiniteNumberOrNull(row.source_amount),
    source_unit: row.source_unit ? String(row.source_unit) : null,
    normalized_amount_si: toFiniteNumberOrNull(row.normalized_amount_si),
    normalized_unit: row.normalized_unit ? String(row.normalized_unit) : null,
    unit_kind: row.unit_kind === "mass" || row.unit_kind === "volume" ||
        row.unit_kind === "count" || row.unit_kind === "unknown"
      ? row.unit_kind
      : "unknown",
    normalized_status: row.normalized_status === "normalized"
      ? "normalized"
      : "needs_retry",
    category: row.category ? String(row.category) : null,
    component: row.component ? String(row.component) : null,
    metadata: row.metadata && typeof row.metadata === "object" &&
        !Array.isArray(row.metadata)
      ? row.metadata as Record<string, JsonValue>
      : {},
  }));
};

export const loadIngredientNameById = async (
  client: SupabaseClient,
  ingredientIds: string[],
): Promise<Map<string, string>> => {
  if (ingredientIds.length === 0) {
    return new Map();
  }

  const { data, error } = await client.from("ingredients").select(
    "id,canonical_name",
  ).in("id", ingredientIds);
  if (error) {
    if (isOptionalSemanticCapabilityUnavailable(error)) {
      return new Map();
    }
    throw new ApiError(
      500,
      "ingredients_fetch_failed",
      "Could not fetch canonical ingredients",
      error.message,
    );
  }

  return new Map((data ?? []).map((row) => [row.id, row.canonical_name]));
};

export const loadIngredientIdsByAliasKey = async (
  client: SupabaseClient,
  aliasKeys: string[],
): Promise<Map<string, string>> => {
  if (aliasKeys.length === 0) {
    return new Map();
  }

  const { data, error } = await client.from("ingredient_aliases").select(
    "alias_key,ingredient_id",
  ).in("alias_key", aliasKeys);
  if (error) {
    if (isOptionalSemanticCapabilityUnavailable(error)) {
      return new Map();
    }
    throw new ApiError(
      500,
      "ingredient_aliases_fetch_failed",
      "Could not fetch ingredient aliases",
      error.message,
    );
  }

  return new Map(
    (data ?? [])
      .filter((row): row is { alias_key: string; ingredient_id: string } =>
        typeof row.alias_key === "string" &&
        typeof row.ingredient_id === "string" &&
        row.alias_key.length > 0 &&
        row.ingredient_id.length > 0
      )
      .map((row) => [row.alias_key, row.ingredient_id]),
  );
};

export const loadIngredientsByNormalizedKey = async (
  client: SupabaseClient,
  normalizedKeys: string[],
): Promise<Map<string, { id: string; canonical_name: string }>> => {
  if (normalizedKeys.length === 0) {
    return new Map();
  }

  const { data, error } = await client.from("ingredients").select(
    "id,normalized_key,canonical_name",
  ).in("normalized_key", normalizedKeys);
  if (error) {
    throw new ApiError(
      500,
      "ingredients_fetch_by_key_failed",
      "Could not fetch canonical ingredients by key",
      error.message,
    );
  }

  return new Map(
    (data ?? [])
      .filter((row): row is {
        id: string;
        normalized_key: string;
        canonical_name: string;
      } =>
        typeof row.id === "string" &&
        typeof row.normalized_key === "string" &&
        typeof row.canonical_name === "string" &&
        row.id.length > 0 &&
        row.normalized_key.length > 0
      )
      .map((row) => [
        row.normalized_key,
        { id: row.id, canonical_name: row.canonical_name },
      ]),
  );
};

export const resolveAliasCanonicalIdentity = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  unresolvedAliases: Array<{
    alias_key: string;
    source_name: string;
    fallback_canonical_name: string;
  }>;
}): Promise<
  Map<string, {
    canonical_key: string;
    canonical_name: string;
    confidence: number;
  }>
> => {
  if (params.unresolvedAliases.length === 0) {
    return new Map();
  }

  const suggested = await llmGateway.normalizeIngredientAliases({
    client: params.serviceClient,
    userId: params.userId,
    requestId: params.requestId,
    aliases: params.unresolvedAliases.map((alias) => ({
      alias_key: alias.alias_key,
      source_name: alias.source_name,
      fallback_canonical_name: alias.fallback_canonical_name,
    })),
  });
  const suggestedByAlias = new Map(
    suggested.map((entry) => [entry.alias_key, entry]),
  );

  const resolved = new Map<string, {
    canonical_key: string;
    canonical_name: string;
    confidence: number;
  }>();
  for (const alias of params.unresolvedAliases) {
    const suggestion = suggestedByAlias.get(alias.alias_key);
    if (!suggestion) {
      continue;
    }
    const suggestedCanonicalName = typeof suggestion?.canonical_name === "string"
      ? suggestion.canonical_name.trim()
      : "";
    if (suggestedCanonicalName.length === 0) {
      continue;
    }
    const numericConfidence = Number(suggestion.confidence);
    if (!Number.isFinite(numericConfidence)) {
      continue;
    }
    const identity = deriveCanonicalIngredientIdentity(
      suggestedCanonicalName,
    );
    if (!identity.canonicalKey) {
      continue;
    }

    resolved.set(alias.alias_key, {
      canonical_key: identity.canonicalKey,
      canonical_name: identity.canonicalName,
      confidence: Math.max(0, Math.min(1, numericConfidence)),
    });
  }

  return resolved;
};

export type EnrichmentStage =
  | "ingredient_resolution"
  | "ingredient_enrichment"
  | "recipe_enrichment"
  | "edge_inference"
  | "search_index"
  | "finalize";

const startEnrichmentRun = async (params: {
  serviceClient: SupabaseClient;
  jobId: string;
  recipeId: string;
  recipeVersionId: string;
  stage: EnrichmentStage;
  inputPayload?: Record<string, JsonValue>;
}): Promise<string | null> => {
  const { data, error } = await params.serviceClient.from("enrichment_runs")
    .insert({
      job_id: params.jobId,
      recipe_id: params.recipeId,
      recipe_version_id: params.recipeVersionId,
      stage: params.stage,
      status: "processing",
      input_payload: params.inputPayload ?? {},
      metadata: {},
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (error) {
    if (isOptionalSemanticCapabilityUnavailable(error)) {
      return null;
    }
    throw new ApiError(
      500,
      "enrichment_run_start_failed",
      "Could not start enrichment run",
      error.message,
    );
  }
  return data?.id ?? null;
};

const completeEnrichmentRun = async (params: {
  serviceClient: SupabaseClient;
  runId: string | null;
  status: "ready" | "failed" | "discarded";
  outputPayload?: Record<string, JsonValue>;
  confidenceSummary?: Record<string, JsonValue>;
  rejectionCount?: number;
  metadata?: Record<string, JsonValue>;
}): Promise<void> => {
  if (!params.runId) {
    return;
  }

  const { error } = await params.serviceClient.from("enrichment_runs").update({
    status: params.status,
    output_payload: params.outputPayload ?? {},
    confidence_summary: params.confidenceSummary ?? {},
    rejection_count: Math.max(0, Number(params.rejectionCount ?? 0)),
    metadata: params.metadata ?? {},
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", params.runId);

  if (error && !isOptionalSemanticCapabilityUnavailable(error)) {
    throw new ApiError(
      500,
      "enrichment_run_finalize_failed",
      "Could not finalize enrichment run",
      error.message,
    );
  }
};

export type ResolvedIngredientComponent = {
  canonical_name: string;
  canonical_key: string;
  confidence: number;
  ingredient_id: string | null;
  mention_index: number;
  mention_role: "primary" | "optional" | "alternative" | "garnish" | "unspecified";
  alternative_group_key: string | null;
};

export type ParsedIngredientQualifier = {
  term_type: string;
  term_key: string;
  label: string;
  relation_type: string;
  target: "line" | number;
  confidence: number;
};

export const resolveCanonicalRecipeIngredientsAsync = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  jobId: string;
  recipeId: string;
  recipeVersionId: string;
}): Promise<{ resolvedCount: number; rejectedCount: number }> => {
  const canonicalRows = await fetchCanonicalIngredientRows(
    params.serviceClient,
    params.recipeVersionId,
  );
  const unresolvedRows = canonicalRows.filter((row) =>
    !row.ingredient_id || row.normalized_status !== "normalized"
  );

  if (unresolvedRows.length === 0) {
    return { resolvedCount: 0, rejectedCount: 0 };
  }

  const runId = await startEnrichmentRun({
    serviceClient: params.serviceClient,
    jobId: params.jobId,
    recipeId: params.recipeId,
    recipeVersionId: params.recipeVersionId,
    stage: "ingredient_resolution",
    inputPayload: {
      unresolved_count: unresolvedRows.length,
    },
  });

  let rejectedCount = 0;
  try {
    const lineParses = await llmGateway.parseIngredientLines({
      client: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      sourceNames: unresolvedRows.map((row) => row.source_name),
    });
    const parseBySource = new Map(
      lineParses.map((item) => [item.source_name.toLocaleLowerCase(), item]),
    );

    const unresolvedAliases: Array<{
      alias_key: string;
      source_name: string;
      fallback_canonical_name: string;
    }> = [];
    const rowComponents = new Map<string, ResolvedIngredientComponent[]>();
    const rowQualifiers = new Map<string, ParsedIngredientQualifier[]>();
    const rowLineConfidence = new Map<string, number>();

    for (const row of unresolvedRows) {
      const parsed = parseBySource.get(row.source_name.toLocaleLowerCase());
      const mentions = parsed?.mentions?.length
        ? parsed.mentions
        : [];
      const qualifiers = parsed?.qualifiers?.length
        ? parsed.qualifiers
        : [];
      rowLineConfidence.set(row.id, clampConfidence(parsed?.line_confidence, 0.5));
      if (mentions.length === 0) {
        rejectedCount += 1;
      }

      const components: ResolvedIngredientComponent[] = [];
      for (let mentionIndex = 0; mentionIndex < mentions.length; mentionIndex += 1) {
        const mention = mentions[mentionIndex]!;
        const confidence = clampConfidence(mention.confidence, 0.5);
        const identity = deriveCanonicalIngredientIdentity(
          mention.name,
          row.source_name,
        );
        if (!identity.canonicalKey) {
          rejectedCount += 1;
          continue;
        }
        components.push({
          canonical_name: identity.canonicalName,
          canonical_key: identity.canonicalKey,
          confidence,
          ingredient_id: null,
          mention_index: mentionIndex,
          mention_role: mention.role,
          alternative_group_key: mention.alternative_group_key
            ? normalizeTermKey(mention.alternative_group_key)
            : null,
        });

        if (confidence >= ENRICHMENT_TRACK_CONFIDENCE) {
          unresolvedAliases.push({
            alias_key: identity.canonicalKey,
            source_name: mention.name,
            fallback_canonical_name: identity.canonicalName,
          });
        } else {
          rejectedCount += 1;
        }
      }
      rowComponents.set(row.id, components);
      rowQualifiers.set(
        row.id,
        qualifiers.map((qualifier) => ({
          term_type: normalizeTermKey(qualifier.term_type),
          term_key: normalizeTermKey(qualifier.term_key || qualifier.label),
          label: qualifier.label.trim(),
          relation_type: qualifier.relation_type.trim().toLocaleLowerCase(),
          target: qualifier.target,
          confidence: clampConfidence(qualifier.confidence, 0.5),
        })).filter((qualifier) =>
          qualifier.term_type.length > 0 &&
          qualifier.term_key.length > 0 &&
          qualifier.label.length > 0 &&
          qualifier.relation_type.length > 0
        ),
      );
    }

    const uniqueAliases = Array.from(
      new Map(
        unresolvedAliases.map((alias) => [alias.alias_key, alias]),
      ).values(),
    );

    const aliasKeys = uniqueAliases.map((entry) => entry.alias_key);
    const ingredientIdByAliasKey = await loadIngredientIdsByAliasKey(
      params.serviceClient,
      aliasKeys,
    );

    const missingAliases = uniqueAliases.filter((alias) =>
      !ingredientIdByAliasKey.has(alias.alias_key)
    );
    const canonicalByAlias = await resolveAliasCanonicalIdentity({
      serviceClient: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      unresolvedAliases: missingAliases,
    });

    const ingredientRowsByKey = new Map<string, {
      canonical_name: string;
      normalized_key: string;
      metadata: Record<string, JsonValue>;
    }>();

    for (const [aliasKey, resolved] of canonicalByAlias.entries()) {
      if (!shouldPersistEnrichment(resolved.confidence)) {
        rejectedCount += 1;
        continue;
      }
      ingredientRowsByKey.set(aliasKey, {
        canonical_name: resolved.canonical_name,
        normalized_key: resolved.canonical_key,
        metadata: {
          source: "llm",
          metadata_schema_version: 2,
          last_enriched_at: new Date().toISOString(),
        },
      });
    }

    if (ingredientRowsByKey.size > 0) {
      const ingredientRows = Array.from(ingredientRowsByKey.values());
      const { error: ingredientUpsertError } = await params.serviceClient
        .from("ingredients")
        .upsert(ingredientRows, {
          onConflict: "normalized_key",
          ignoreDuplicates: false,
        });
      if (ingredientUpsertError) {
        throw new ApiError(
          500,
          "ingredient_resolution_upsert_failed",
          "Could not persist resolved canonical ingredients",
          ingredientUpsertError.message,
        );
      }

      const resolvedIngredientByKey = await loadIngredientsByNormalizedKey(
        params.serviceClient,
        ingredientRows.map((row) => row.normalized_key),
      );
      for (const [aliasKey, ingredient] of resolvedIngredientByKey.entries()) {
        ingredientIdByAliasKey.set(aliasKey, ingredient.id);
      }
    }

    const aliasRows = Array.from(canonicalByAlias.entries())
      .map(([aliasKey, resolved]) => {
        const ingredientId = ingredientIdByAliasKey.get(resolved.canonical_key);
        if (!ingredientId || !shouldPersistEnrichment(resolved.confidence)) {
          return null;
        }
        return {
          alias_key: aliasKey,
          ingredient_id: ingredientId,
          source: "llm",
          confidence: clampConfidence(resolved.confidence, 0.5),
        };
      })
      .filter((row): row is {
        alias_key: string;
        ingredient_id: string;
        source: string;
        confidence: number;
      } => row !== null);

    if (aliasRows.length > 0) {
      const { error: aliasError } = await params.serviceClient
        .from("ingredient_aliases")
        .upsert(aliasRows, {
          onConflict: "alias_key",
          ignoreDuplicates: false,
        });
      if (aliasError) {
        throw new ApiError(
          500,
          "ingredient_resolution_alias_upsert_failed",
          "Could not upsert ingredient aliases",
          aliasError.message,
        );
      }
    }

    let resolvedCount = 0;
    const unresolvedRowIds = unresolvedRows.map((row) => row.id);
    type MentionWriteRow = {
      recipe_ingredient_id: string;
      recipe_version_id: string;
      ingredient_id: string | null;
      mention_index: number;
      mention_role: string;
      alternative_group_key: string | null;
      confidence: number;
      source: string;
      metadata: Record<string, JsonValue>;
    };
    const mentionsToPersist: MentionWriteRow[] = [];

    for (const row of unresolvedRows) {
      const components = rowComponents.get(row.id) ?? [];
      const withIds = components.map((component) => {
        const ingredientId =
          ingredientIdByAliasKey.get(component.canonical_key) ??
            null;
        return {
          ...component,
          ingredient_id: ingredientId,
        };
      });
      const persistableWithIds = withIds.filter((component) =>
        shouldPersistEnrichment(component.confidence)
      );
      rejectedCount += withIds.length - persistableWithIds.length;

      const best = persistableWithIds.find((component) =>
        component.ingredient_id !== null &&
        shouldPersistEnrichment(component.confidence)
      ) ?? null;

      const normalizedStatus = best?.ingredient_id
        ? "normalized"
        : "needs_retry";
      if (best?.ingredient_id) {
        resolvedCount += 1;
      }

      const nextMetadata: Record<string, JsonValue> = {
        ...(row.metadata ?? {}),
        alias_key: row.metadata?.alias_key ??
          normalizeIngredientKey(row.source_name),
        needs_ingredient_resolution: !best?.ingredient_id,
        ingredient_line_confidence: rowLineConfidence.get(row.id) ?? 0.5,
        components: persistableWithIds.map((component) => ({
          canonical_name: component.canonical_name,
          canonical_key: component.canonical_key,
          ingredient_id: component.ingredient_id,
          confidence: component.confidence,
          mention_index: component.mention_index,
          mention_role: component.mention_role,
          alternative_group_key: component.alternative_group_key,
        })),
      };

      const { error: rowUpdateError } = await params.serviceClient
        .from("recipe_ingredients")
        .update({
          ingredient_id: best?.ingredient_id ?? null,
          normalized_status: normalizedStatus,
          metadata: nextMetadata,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      if (rowUpdateError) {
        throw new ApiError(
          500,
          "recipe_ingredient_resolution_update_failed",
          "Could not update resolved recipe ingredient row",
          rowUpdateError.message,
        );
      }

      for (const component of persistableWithIds) {
        mentionsToPersist.push({
          recipe_ingredient_id: row.id,
          recipe_version_id: params.recipeVersionId,
          ingredient_id: component.ingredient_id,
          mention_index: component.mention_index,
          mention_role: component.mention_role,
          alternative_group_key: component.alternative_group_key,
          confidence: component.confidence,
          source: "llm",
          metadata: {
            canonical_name: component.canonical_name,
            canonical_key: component.canonical_key,
          },
        });
      }
    }

    if (unresolvedRowIds.length > 0) {
      const { error: clearMentionsError } = await params.serviceClient
        .from("recipe_ingredient_mentions")
        .delete()
        .in("recipe_ingredient_id", unresolvedRowIds);
      if (
        clearMentionsError &&
        !isOptionalSemanticCapabilityUnavailable(clearMentionsError)
      ) {
        throw new ApiError(
          500,
          "recipe_ingredient_mentions_clear_failed",
          "Could not clear recipe ingredient mentions",
          clearMentionsError.message,
        );
      }
    }

    let mentionRowsWritten: Array<{
      id: string;
      recipe_ingredient_id: string;
      mention_index: number;
    }> = [];
    if (mentionsToPersist.length > 0) {
      const { data: mentionData, error: mentionUpsertError } = await params
        .serviceClient
        .from("recipe_ingredient_mentions")
        .upsert(mentionsToPersist, {
          onConflict: "recipe_ingredient_id,mention_index",
          ignoreDuplicates: false,
        })
        .select("id,recipe_ingredient_id,mention_index");
      if (
        mentionUpsertError &&
        !isOptionalSemanticCapabilityUnavailable(mentionUpsertError)
      ) {
        throw new ApiError(
          500,
          "recipe_ingredient_mentions_upsert_failed",
          "Could not persist recipe ingredient mentions",
          mentionUpsertError.message,
        );
      }
      mentionRowsWritten = (mentionData ?? [])
        .map((row) => ({
          id: String(row.id ?? ""),
          recipe_ingredient_id: String(row.recipe_ingredient_id ?? ""),
          mention_index: Number(row.mention_index ?? 0),
        }))
        .filter((row) => row.id.length > 0 && row.recipe_ingredient_id.length > 0);
    }

    const mentionIdByRowAndIndex = new Map<string, string>();
    for (const mention of mentionRowsWritten) {
      mentionIdByRowAndIndex.set(
        `${mention.recipe_ingredient_id}:${mention.mention_index}`,
        mention.id,
      );
    }

    if (unresolvedRowIds.length > 0) {
      const { error: clearQualifierLinksError } = await params.serviceClient
        .from("recipe_ingredient_ontology_links")
        .delete()
        .in("recipe_ingredient_id", unresolvedRowIds);
      if (
        clearQualifierLinksError &&
        !isOptionalSemanticCapabilityUnavailable(clearQualifierLinksError)
      ) {
        throw new ApiError(
          500,
          "recipe_ingredient_qualifier_links_clear_failed",
          "Could not clear recipe ingredient qualifier links",
          clearQualifierLinksError.message,
        );
      }
    }

    type QualifierUpsert = {
      recipe_ingredient_id: string;
      mention_id: string | null;
      term_type: string;
      term_key: string;
      label: string;
      relation_type: string;
      confidence: number;
      metadata: Record<string, JsonValue>;
    };
    const qualifierUpserts: QualifierUpsert[] = [];
    for (const row of unresolvedRows) {
      const qualifiers = rowQualifiers.get(row.id) ?? [];
      for (const qualifier of qualifiers) {
        if (!shouldPersistEnrichment(qualifier.confidence)) {
          rejectedCount += 1;
          continue;
        }

        const mentionId = typeof qualifier.target === "number"
          ? mentionIdByRowAndIndex.get(`${row.id}:${qualifier.target}`) ?? null
          : null;
        qualifierUpserts.push({
          recipe_ingredient_id: row.id,
          mention_id: mentionId,
          term_type: qualifier.term_type,
          term_key: qualifier.term_key,
          label: qualifier.label,
          relation_type: qualifier.relation_type,
          confidence: qualifier.confidence,
          metadata: {
            target: qualifier.target,
          },
        });
      }
    }

    if (qualifierUpserts.length > 0) {
      const termRows = Array.from(
        new Map(
          qualifierUpserts.map((item) => [
            `${item.term_type}:${item.term_key}`,
            {
              term_type: item.term_type,
              term_key: item.term_key,
              label: item.label,
              source: "llm",
              metadata: {},
              updated_at: new Date().toISOString(),
            },
          ]),
        ).values(),
      );
      const { error: termUpsertError } = await params.serviceClient
        .from("ontology_terms")
        .upsert(termRows, { onConflict: "term_type,term_key" });
      if (
        termUpsertError &&
        !isOptionalSemanticCapabilityUnavailable(termUpsertError)
      ) {
        throw new ApiError(
          500,
          "recipe_ingredient_qualifier_terms_upsert_failed",
          "Could not persist ingredient qualifier ontology terms",
          termUpsertError.message,
        );
      }

      const { data: termRowsWithIds, error: termFetchError } = await params
        .serviceClient
        .from("ontology_terms")
        .select("id,term_type,term_key")
        .or(
          termRows.map((row) =>
            `and(term_type.eq.${row.term_type},term_key.eq.${row.term_key})`
          ).join(","),
        );
      if (
        termFetchError &&
        !isOptionalSemanticCapabilityUnavailable(termFetchError)
      ) {
        throw new ApiError(
          500,
          "recipe_ingredient_qualifier_terms_fetch_failed",
          "Could not resolve ingredient qualifier ontology term ids",
          termFetchError.message,
        );
      }

      const termIdByKey = new Map(
        (termRowsWithIds ?? []).map((row) => [
          `${row.term_type}:${row.term_key}`,
          String(row.id),
        ]),
      );

      const qualifierLinkRows = Array.from(
        new Map(
          qualifierUpserts.map((item) => {
            const termId = termIdByKey.get(`${item.term_type}:${item.term_key}`);
            if (!termId) return null;
            const key = `${item.recipe_ingredient_id}:${item.mention_id ?? "line"}:${termId}:${item.relation_type}:llm`;
            return [key, {
              recipe_ingredient_id: item.recipe_ingredient_id,
              mention_id: item.mention_id,
              ontology_term_id: termId,
              relation_type: item.relation_type,
              source: "llm",
              confidence: item.confidence,
              metadata: item.metadata,
              updated_at: new Date().toISOString(),
            }];
          }).filter((entry): entry is [string, {
            recipe_ingredient_id: string;
            mention_id: string | null;
            ontology_term_id: string;
            relation_type: string;
            source: string;
            confidence: number;
            metadata: Record<string, JsonValue>;
            updated_at: string;
          }] => entry !== null),
        ).values(),
      );

      if (qualifierLinkRows.length > 0) {
        const { error: qualifierLinkError } = await params.serviceClient
          .from("recipe_ingredient_ontology_links")
          .upsert(qualifierLinkRows, {
            onConflict:
              "recipe_ingredient_id,mention_id,ontology_term_id,relation_type,source",
          });
        if (
          qualifierLinkError &&
          !isOptionalSemanticCapabilityUnavailable(qualifierLinkError)
        ) {
          throw new ApiError(
            500,
            "recipe_ingredient_qualifier_links_upsert_failed",
            "Could not persist ingredient qualifier links",
            qualifierLinkError.message,
          );
        }
      }
    }

    await completeEnrichmentRun({
      serviceClient: params.serviceClient,
      runId,
      status: "ready",
      outputPayload: {
        resolved_count: resolvedCount,
        rejected_count: rejectedCount,
        mention_count: mentionsToPersist.length,
        qualifier_count: qualifierUpserts.length,
      },
      confidenceSummary: {
        persist_threshold: ENRICHMENT_PERSIST_CONFIDENCE,
        track_threshold: ENRICHMENT_TRACK_CONFIDENCE,
      },
      rejectionCount: rejectedCount,
    });

    return { resolvedCount, rejectedCount };
  } catch (error) {
    await completeEnrichmentRun({
      serviceClient: params.serviceClient,
      runId,
      status: "failed",
      outputPayload: {},
      confidenceSummary: {},
      rejectionCount: rejectedCount,
      metadata: {
        error: error instanceof Error ? error.message : "unknown_error",
      },
    });
    throw error;
  }
};

export const persistCanonicalRecipeIngredients = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  recipeVersionId: string;
  recipe: RecipePayload;
}): Promise<void> => {
  const canonicalRows = canonicalizeIngredients(params.recipe.ingredients);
  if (canonicalRows.length === 0) {
    return;
  }

  const keySet = Array.from(
    new Set(
      canonicalRows.map((row) => row.normalized_key).filter((key) =>
        key.length > 0
      ),
    ),
  );

  if (keySet.length === 0) {
    return;
  }

  const ingredientIdByAliasKey = await loadIngredientIdsByAliasKey(
    params.serviceClient,
    keySet,
  );

  const { error: clearError } = await params.serviceClient
    .from("recipe_ingredients")
    .delete()
    .eq("recipe_version_id", params.recipeVersionId);
  if (clearError) {
    throw new ApiError(
      500,
      "recipe_ingredients_clear_failed",
      "Could not clear recipe ingredients",
      clearError.message,
    );
  }

  const rowsToInsert = canonicalRows.map((row) => ({
    recipe_version_id: params.recipeVersionId,
    ingredient_id: ingredientIdByAliasKey.get(row.normalized_key) ?? null,
    source_name: row.source_name,
    source_amount: row.source_amount,
    source_unit: row.source_unit,
    normalized_amount_si: row.normalized_amount_si,
    normalized_unit: row.normalized_unit,
    unit_kind: row.unit_kind,
    normalized_status: row.normalized_status === "normalized" &&
        ingredientIdByAliasKey.has(row.normalized_key)
      ? "normalized"
      : "needs_retry",
    category: row.category,
    component: row.component,
    position: row.position,
    metadata: {
      preparation: row.preparation ?? null,
      alias_key: row.normalized_key,
      needs_ingredient_resolution: !ingredientIdByAliasKey.has(
        row.normalized_key,
      ),
    },
  }));

  const { error: insertError } = await params.serviceClient.from(
    "recipe_ingredients",
  ).insert(rowsToInsert);
  if (insertError) {
    throw new ApiError(
      500,
      "recipe_ingredients_insert_failed",
      "Could not persist recipe ingredients",
      insertError.message,
    );
  }
};

export const upsertIngredientPairStats = async (params: {
  serviceClient: SupabaseClient;
  ingredientIds: string[];
}): Promise<void> => {
  const unique = Array.from(
    new Set(params.ingredientIds.filter((id) => id.length > 0)),
  );
  if (unique.length < 2) {
    return;
  }

  for (let i = 0; i < unique.length; i += 1) {
    for (let j = i + 1; j < unique.length; j += 1) {
      const left = unique[i]!;
      const right = unique[j]!;
      const [ingredientA, ingredientB] = left < right
        ? [left, right]
        : [right, left];

      const { data: existing, error: fetchError } = await params.serviceClient
        .from("ingredient_pair_stats")
        .select("co_occurrence_count,recipe_count")
        .eq("ingredient_a_id", ingredientA)
        .eq("ingredient_b_id", ingredientB)
        .maybeSingle();

      if (
        fetchError && !isOptionalSemanticCapabilityUnavailable(fetchError)
      ) {
        throw new ApiError(
          500,
          "ingredient_pair_stats_fetch_failed",
          "Could not fetch ingredient pair stats",
          fetchError.message,
        );
      }

      const nextCount = Number(existing?.co_occurrence_count ?? 0) + 1;
      const nextRecipeCount = Number(existing?.recipe_count ?? 0) + 1;
      const pmi = Math.log10(Math.max(1, nextCount));
      const lift = Math.max(1, nextCount / Math.max(1, nextRecipeCount));

      const { error: writeError } = await params.serviceClient
        .from("ingredient_pair_stats")
        .upsert({
          ingredient_a_id: ingredientA,
          ingredient_b_id: ingredientB,
          co_occurrence_count: nextCount,
          recipe_count: nextRecipeCount,
          pmi,
          lift,
          last_computed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "ingredient_a_id,ingredient_b_id" });

      if (
        writeError && !isOptionalSemanticCapabilityUnavailable(writeError)
      ) {
        throw new ApiError(
          500,
          "ingredient_pair_stats_upsert_failed",
          "Could not upsert ingredient pair stats",
          writeError.message,
        );
      }
    }
  }
};

export const upsertIngredientEnrichment = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  jobId: string;
  recipeId: string;
  recipeVersionId: string;
  canonicalRows: CanonicalRecipeIngredientRow[];
  canonicalIngredientNameById: Map<string, string>;
  dietIncompatibilityRules: SemanticDietIncompatibilityRule[];
}): Promise<{
  rejectedCount: number;
}> => {
  const ingredientById = new Map<string, string>();
  for (const row of params.canonicalRows) {
    if (!row.ingredient_id) continue;
    const canonicalName =
      params.canonicalIngredientNameById.get(row.ingredient_id) ??
        row.source_name;
    ingredientById.set(row.ingredient_id, canonicalName);
  }

  const ingredientItems = Array.from(ingredientById.entries()).map(
    ([ingredient_id, canonical_name]) => ({
      ingredient_id,
      canonical_name,
    }),
  );
  if (ingredientItems.length === 0) {
    return { rejectedCount: 0 };
  }

  const runId = await startEnrichmentRun({
    serviceClient: params.serviceClient,
    jobId: params.jobId,
    recipeId: params.recipeId,
    recipeVersionId: params.recipeVersionId,
    stage: "ingredient_enrichment",
    inputPayload: {
      ingredient_count: ingredientItems.length,
    },
  });

  let rejectedCount = 0;
  let dietGuardRemovalCount = 0;
  try {
    const [ontologyCatalogTerms, canonicalDietTags] = await Promise.all([
      loadOntologyCatalogTerms(params.serviceClient),
      loadCanonicalDietTags(params.serviceClient),
    ]);
    const ontologyCanonicalizationCatalog = buildOntologyCanonicalizationCatalog({
      terms: ontologyCatalogTerms,
      dietTags: canonicalDietTags,
    });

    const enrichment = await llmGateway.enrichIngredients({
      client: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      ingredients: ingredientItems,
    });

    const enrichmentByName = new Map(
      enrichment.map((item) => [item.canonical_name.toLocaleLowerCase(), item]),
    );
    const { data: ingredientRows, error: ingredientFetchError } = await params
      .serviceClient
      .from("ingredients")
      .select("id,canonical_name,metadata")
      .in("id", ingredientItems.map((item) => item.ingredient_id));

    if (ingredientFetchError) {
      throw new ApiError(
        500,
        "ingredient_enrichment_fetch_failed",
        "Could not load ingredient metadata rows",
        ingredientFetchError.message,
      );
    }

    type OntologyUpsertRow = {
      ingredient_id: string;
      term_type: string;
      term_key: string;
      label: string;
      relation_type: string;
      confidence: number;
    };
    const ontologyUpserts: OntologyUpsertRow[] = [];
    const enrichedIngredientIds = new Set<string>();

    for (const row of ingredientRows ?? []) {
      const key = String(row.canonical_name ?? "").toLocaleLowerCase();
      const candidate = enrichmentByName.get(key);
      if (!candidate || !shouldPersistEnrichment(candidate.confidence)) {
        rejectedCount += 1;
        continue;
      }

      const canonicalizedOntologyTerms: Array<{
        term_type: string;
        term_key: string;
        label: string;
        relation_type: string;
        confidence: number;
      }> = [];
      for (const term of candidate.ontology_terms ?? []) {
        if (!shouldPersistEnrichment(term.confidence)) {
          rejectedCount += 1;
          continue;
        }

        const relationType = normalizeTermKey(
          String(term.relation_type ?? "classified_as"),
        );
        if (!relationType) {
          rejectedCount += 1;
          continue;
        }

        const canonicalized = canonicalizeOntologyTerm({
          term: {
            term_type: String(term.term_type ?? ""),
            term_key: term.term_key || term.label,
            label: String(term.label ?? ""),
            relation_type: relationType,
          },
          catalog: ontologyCanonicalizationCatalog,
        });
        if (!canonicalized) {
          rejectedCount += 1;
          continue;
        }

        canonicalizedOntologyTerms.push({
          term_type: canonicalized.term_type,
          term_key: canonicalized.term_key,
          label: canonicalized.label,
          relation_type: relationType,
          confidence: clampConfidence(term.confidence, candidate.confidence),
        });
      }

      const existingMetadata =
        row.metadata && typeof row.metadata === "object" &&
          !Array.isArray(row.metadata)
          ? row.metadata as Record<string, JsonValue>
          : {};

      const guarded = applySemanticDietIncompatibilityRules({
        metadata: candidate.metadata,
        rules: params.dietIncompatibilityRules,
        ontologyTerms: canonicalizedOntologyTerms.map((term) => ({
          term_type: term.term_type,
          term_key: term.term_key,
          label: term.label,
        })),
      });
      dietGuardRemovalCount += guarded.removedDietTags.length;
      const nextMetadata: Record<string, JsonValue> = {
        ...existingMetadata,
        ...guarded.metadata,
        metadata_schema_version: 2,
        enrichment_confidence: candidate.confidence,
        enriched_at: new Date().toISOString(),
      };

      let { error: ingredientWriteError } = await params.serviceClient
        .from("ingredients")
        .update({
          metadata: nextMetadata,
          metadata_schema_version: 2,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (ingredientWriteError) {
        throw new ApiError(
          500,
          "ingredient_enrichment_write_failed",
          "Could not persist ingredient enrichment",
          ingredientWriteError.message,
        );
      }

      enrichedIngredientIds.add(row.id);
      const dedupedOntologyByKey = new Map<string, OntologyUpsertRow>();
      for (const term of canonicalizedOntologyTerms) {
        const dedupeKey = `${row.id}:${term.term_type}:${term.term_key}:${term.relation_type}`;
        const existing = dedupedOntologyByKey.get(dedupeKey);
        if (!existing || term.confidence > existing.confidence) {
          dedupedOntologyByKey.set(dedupeKey, {
            ingredient_id: row.id,
            term_type: term.term_type,
            term_key: term.term_key,
            label: term.label,
            relation_type: term.relation_type,
            confidence: term.confidence,
          });
        }
      }
      ontologyUpserts.push(...dedupedOntologyByKey.values());
    }

    if (enrichedIngredientIds.size > 0) {
      const { error: clearLinksError } = await params.serviceClient
        .from("ingredient_ontology_links")
        .delete()
        .in("ingredient_id", Array.from(enrichedIngredientIds))
        .eq("source", "llm");
      if (
        clearLinksError &&
        !isOptionalSemanticCapabilityUnavailable(clearLinksError)
      ) {
        throw new ApiError(
          500,
          "ingredient_ontology_links_clear_failed",
          "Could not clear stale ingredient ontology links",
          clearLinksError.message,
        );
      }
    }

    if (ontologyUpserts.length > 0) {
      const termRows = Array.from(
        new Map(
          ontologyUpserts.map((item) => [
            `${item.term_type}:${item.term_key}`,
            {
              term_type: item.term_type,
              term_key: item.term_key,
              label: item.label,
              source: "llm",
              metadata: {},
              updated_at: new Date().toISOString(),
            },
          ]),
        ).values(),
      );
      const { error: termUpsertError } = await params.serviceClient
        .from("ontology_terms")
        .upsert(termRows, { onConflict: "term_type,term_key" });
      if (
        termUpsertError &&
        !isOptionalSemanticCapabilityUnavailable(termUpsertError)
      ) {
        throw new ApiError(
          500,
          "ontology_terms_upsert_failed",
          "Could not persist ontology terms",
          termUpsertError.message,
        );
      }

      const { data: termIds, error: termFetchError } = await params
        .serviceClient
        .from("ontology_terms")
        .select("id,term_type,term_key")
        .or(
          termRows.map((row) =>
            `and(term_type.eq.${row.term_type},term_key.eq.${row.term_key})`
          ).join(","),
        );
      if (
        termFetchError &&
        !isOptionalSemanticCapabilityUnavailable(termFetchError)
      ) {
        throw new ApiError(
          500,
          "ontology_terms_fetch_failed",
          "Could not load ontology term ids",
          termFetchError.message,
        );
      }

      const termIdByKey = new Map(
        (termIds ?? []).map((row) => [
          `${row.term_type}:${row.term_key}`,
          row.id,
        ]),
      );

      const ontologyLinkRows = ontologyUpserts
        .map((item) => {
          const termId = termIdByKey.get(`${item.term_type}:${item.term_key}`);
          if (!termId) return null;
          return {
            ingredient_id: item.ingredient_id,
            ontology_term_id: termId,
            relation_type: item.relation_type,
            source: "llm",
            confidence: item.confidence,
            metadata: {},
            updated_at: new Date().toISOString(),
          };
        })
        .filter((item): item is {
          ingredient_id: string;
          ontology_term_id: string;
          relation_type: string;
          source: string;
          confidence: number;
          metadata: Record<string, JsonValue>;
          updated_at: string;
        } => item !== null);

      if (ontologyLinkRows.length > 0) {
        const { error: linkError } = await params.serviceClient
          .from("ingredient_ontology_links")
          .upsert(ontologyLinkRows, {
            onConflict: "ingredient_id,ontology_term_id,relation_type,source",
          });
        if (
          linkError && !isOptionalSemanticCapabilityUnavailable(linkError)
        ) {
          throw new ApiError(
            500,
            "ingredient_ontology_links_upsert_failed",
            "Could not persist ingredient ontology links",
            linkError.message,
          );
        }
      }
    }

    await completeEnrichmentRun({
      serviceClient: params.serviceClient,
      runId,
      status: "ready",
      outputPayload: {
        ingredient_count: ingredientItems.length,
        semantic_diet_rule_removed_tags: dietGuardRemovalCount,
      },
      confidenceSummary: {
        persist_threshold: ENRICHMENT_PERSIST_CONFIDENCE,
      },
      rejectionCount: rejectedCount,
    });
    return { rejectedCount };
  } catch (error) {
    await completeEnrichmentRun({
      serviceClient: params.serviceClient,
      runId,
      status: "failed",
      rejectionCount: rejectedCount,
      metadata: {
        error: error instanceof Error ? error.message : "unknown_error",
      },
    });
    throw error;
  }
};

export const enrichRecipeMetadataAsync = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  jobId: string;
  recipeId: string;
  recipeVersionId: string;
  payload: RecipePayload;
  ingredientNames: string[];
}): Promise<
  {
    metadataPatch: Record<string, JsonValue>;
    confidence: number;
    rejectedCount: number;
  }
> => {
  const runId = await startEnrichmentRun({
    serviceClient: params.serviceClient,
    jobId: params.jobId,
    recipeId: params.recipeId,
    recipeVersionId: params.recipeVersionId,
    stage: "recipe_enrichment",
    inputPayload: {
      ingredient_count: params.ingredientNames.length,
    },
  });

  let rejectedCount = 0;
  try {
    const result = await llmGateway.enrichRecipeMetadata({
      client: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      recipe: params.payload,
      ingredientNames: params.ingredientNames,
    });

    if (!shouldPersistEnrichment(result.confidence)) {
      rejectedCount += 1;
      await completeEnrichmentRun({
        serviceClient: params.serviceClient,
        runId,
        status: "discarded",
        outputPayload: {},
        confidenceSummary: {
          confidence: result.confidence,
          persist_threshold: ENRICHMENT_PERSIST_CONFIDENCE,
        },
        rejectionCount: rejectedCount,
      });
      return {
        metadataPatch: {},
        confidence: result.confidence,
        rejectedCount,
      };
    }

    await completeEnrichmentRun({
      serviceClient: params.serviceClient,
      runId,
      status: "ready",
      outputPayload: result.metadata,
      confidenceSummary: {
        confidence: result.confidence,
        persist_threshold: ENRICHMENT_PERSIST_CONFIDENCE,
      },
      rejectionCount: rejectedCount,
    });
    return {
      metadataPatch: result.metadata,
      confidence: result.confidence,
      rejectedCount,
    };
  } catch (error) {
    await completeEnrichmentRun({
      serviceClient: params.serviceClient,
      runId,
      status: "failed",
      rejectionCount: rejectedCount,
      metadata: {
        error: error instanceof Error ? error.message : "unknown_error",
      },
    });
    throw error;
  }
};

export const inferIngredientRelationsAsync = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  jobId: string;
  recipeId: string;
  recipeVersionId: string;
  ingredientNames: string[];
}): Promise<{
  relations: Array<{
    from_canonical_name: string;
    to_canonical_name: string;
    relation_type: string;
    confidence: number;
    rationale?: string;
  }>;
  rejectedCount: number;
}> => {
  const runId = await startEnrichmentRun({
    serviceClient: params.serviceClient,
    jobId: params.jobId,
    recipeId: params.recipeId,
    recipeVersionId: params.recipeVersionId,
    stage: "edge_inference",
    inputPayload: {
      ingredient_count: params.ingredientNames.length,
    },
  });

  let rejectedCount = 0;
  try {
    const suggestions = await llmGateway.inferIngredientRelations({
      client: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      ingredientNames: params.ingredientNames,
    });
    const relations = suggestions.filter((item) => {
      if (!shouldPersistEnrichment(item.confidence)) {
        rejectedCount += 1;
        return false;
      }
      return true;
    });

    await completeEnrichmentRun({
      serviceClient: params.serviceClient,
      runId,
      status: "ready",
      outputPayload: {
        relation_count: relations.length,
      },
      confidenceSummary: {
        persist_threshold: ENRICHMENT_PERSIST_CONFIDENCE,
      },
      rejectionCount: rejectedCount,
    });
    return { relations, rejectedCount };
  } catch (error) {
    await completeEnrichmentRun({
      serviceClient: params.serviceClient,
      runId,
      status: "failed",
      rejectionCount: rejectedCount,
      metadata: {
        error: error instanceof Error ? error.message : "unknown_error",
      },
    });
    throw error;
  }
};

export const ensureGraphRelationTypes = async (
  client: SupabaseClient,
  relationNames: string[],
): Promise<Map<string, string>> => {
  const normalizedNames = relationNames.map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 0);
  if (normalizedNames.length === 0) {
    return new Map();
  }

  const uniqueNames = Array.from(new Set(normalizedNames));
  const insertPayload = uniqueNames.map((name) => ({
    name,
    description: `Graph relation: ${name}`,
  }));

  const { error: upsertError } = await client.from("graph_relation_types")
    .upsert(insertPayload, { onConflict: "name" });
  if (upsertError) {
    throw new ApiError(
      500,
      "metadata_relation_type_upsert_failed",
      "Could not upsert graph relation types",
      upsertError.message,
    );
  }

  const { data, error } = await client.from("graph_relation_types").select(
    "id,name",
  ).in("name", uniqueNames);
  if (error) {
    throw new ApiError(
      500,
      "metadata_relation_type_fetch_failed",
      "Could not fetch graph relation types",
      error.message,
    );
  }

  return new Map((data ?? []).map((row) => [row.name, row.id]));
};

export const upsertMetadataGraph = async (params: {
  serviceClient: SupabaseClient;
  recipeId: string;
  recipeVersionId: string;
  payload: RecipePayload;
  canonicalRows: CanonicalRecipeIngredientRow[];
  mentionRows: RecipeIngredientMentionRow[];
  canonicalIngredientNameById: Map<string, string>;
  recipeMetadataPatch?: Record<string, JsonValue>;
  ingredientRelations?: Array<{
    from_canonical_name: string;
    to_canonical_name: string;
    relation_type: string;
    confidence: number;
    rationale?: string;
  }>;
}): Promise<void> => {
  const recipeLabel = params.payload.title.trim();
  if (!recipeLabel) {
    return;
  }

  const mergedMetadata: Record<string, JsonValue> = {
    ...(params.payload.metadata ?? {}),
    ...(params.recipeMetadataPatch ?? {}),
    metadata_schema_version: 2,
  };

  const canonicalRowById = new Map(
    params.canonicalRows.map((row) => [row.id, row]),
  );
  const ingredientNameSet = new Set<string>();
  const ingredientRoleAssignments: Array<{
    canonical_name: string;
    mention_role: RecipeIngredientMentionRow["mention_role"];
    confidence: number;
    alternative_group_key: string | null;
  }> = [];

  for (const mention of params.mentionRows) {
    const canonicalName = mention.ingredient_id
      ? params.canonicalIngredientNameById.get(mention.ingredient_id) ??
        String(mention.metadata?.canonical_name ?? "")
      : String(mention.metadata?.canonical_name ?? "");
    const value = canonicalName.trim();
    if (value.length === 0) continue;
    ingredientNameSet.add(value);
    ingredientRoleAssignments.push({
      canonical_name: value,
      mention_role: mention.mention_role,
      confidence: clampConfidence(mention.confidence, 0.5),
      alternative_group_key: mention.alternative_group_key,
    });
  }

  if (ingredientNameSet.size === 0) {
    for (const row of params.canonicalRows) {
      const trimmed = row.ingredient_id
        ? (
          params.canonicalIngredientNameById.get(row.ingredient_id) ?? ""
        ).trim()
        : "";
      if (trimmed.length > 0) {
        ingredientNameSet.add(trimmed);
      }

      const components = Array.isArray(row.metadata?.components)
        ? row.metadata.components
        : [];
      for (const component of components) {
        if (
          !component || typeof component !== "object" || Array.isArray(component)
        ) {
          continue;
        }
        const name = (component as { canonical_name?: unknown }).canonical_name;
        if (typeof name === "string" && name.trim().length > 0) {
          const confidenceRaw = Number(
            (component as { confidence?: unknown }).confidence,
          );
          if (!Number.isFinite(confidenceRaw)) {
            continue;
          }
          ingredientNameSet.add(name.trim());
          ingredientRoleAssignments.push({
            canonical_name: name.trim(),
            mention_role: "unspecified",
            confidence: Math.max(0, Math.min(1, confidenceRaw)),
            alternative_group_key: typeof (
                component as { alternative_group_key?: unknown }
              ).alternative_group_key === "string"
              ? normalizeTermKey(
                String(
                  (component as { alternative_group_key?: unknown })
                    .alternative_group_key,
                ),
              )
              : null,
          });
        }
      }
    }
  }
  const ingredientNames = Array.from(ingredientNameSet);

  const categoryNames = Array.from(
    new Set(
      [
        ...params.canonicalRows.map((row) => row.category).filter((
          value,
        ): value is string => Boolean(value)),
        ...listifyMaybeText(mergedMetadata.cuisine_tags),
        ...listifyMaybeText(mergedMetadata.occasion_tags),
        ...listifyMaybeText(mergedMetadata.course_type),
      ]
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );

  const keywordNames = Array.from(
    new Set(
      [
        ...listifyMaybeText(mergedMetadata.flavor_profile),
        ...listifyMaybeText(params.payload.pairings),
        ...listifyMaybeText(mergedMetadata.pairing_rationale),
        ...listifyMaybeText(mergedMetadata.health_flags),
      ]
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );

  const dietTags = Array.from(
    new Set(
      listifyMaybeText(mergedMetadata.diet_tags).map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
  const allergenFlags = Array.from(
    new Set(
      [
        ...listifyMaybeText(mergedMetadata.allergen_flags),
        ...listifyMaybeText(mergedMetadata.allergens),
      ].map((value) => value.trim()).filter((value) => value.length > 0),
    ),
  );
  const techniques = Array.from(
    new Set(
      listifyMaybeText(mergedMetadata.techniques).map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
  const equipments = Array.from(
    new Set(
      listifyMaybeText(mergedMetadata.equipment).map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
  const cuisines = Array.from(
    new Set(
      [
        ...listifyMaybeText(mergedMetadata.cuisine),
        ...listifyMaybeText(mergedMetadata.cuisine_tags),
      ].map((value) => value.trim()).filter((value) => value.length > 0),
    ),
  );
  const occasions = Array.from(
    new Set(
      listifyMaybeText(mergedMetadata.occasion_tags).map((value) =>
        value.trim()
      )
        .filter((value) => value.length > 0),
    ),
  );
  const spiceLevels = Array.from(
    new Set(
      listifyMaybeText(mergedMetadata.spice_level).map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
  const difficultyValues = Array.from(
    new Set(
      listifyMaybeText(mergedMetadata.difficulty).map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );

  type RecipeLinkGraphRow = {
    parent_recipe_id: string;
    child_recipe_id: string;
    relation_type_id: string;
    position: number | null;
  };
  let recipeLinkRows: RecipeLinkGraphRow[] = [];
  const recipeLinkRelationNameById = new Map<string, string>();
  const relatedRecipeLabelById = new Map<string, string>();

  const recipeLinkResult = await params.serviceClient
    .from("recipe_links")
    .select("parent_recipe_id,child_recipe_id,relation_type_id,position")
    .or(`parent_recipe_id.eq.${params.recipeId},child_recipe_id.eq.${params.recipeId}`);
  if (
    recipeLinkResult.error &&
    !isOptionalSemanticCapabilityUnavailable(recipeLinkResult.error)
  ) {
    throw new ApiError(
      500,
      "recipe_links_graph_fetch_failed",
      "Could not fetch recipe links for graph enrichment",
      recipeLinkResult.error.message,
    );
  }
  recipeLinkRows = (recipeLinkResult.data ?? []) as RecipeLinkGraphRow[];

  const recipeRelationTypeIds = Array.from(
    new Set(recipeLinkRows.map((row) => row.relation_type_id).filter(Boolean)),
  );
  if (recipeRelationTypeIds.length > 0) {
    const relationTypeResult = await params.serviceClient
      .from("graph_relation_types")
      .select("id,name")
      .in("id", recipeRelationTypeIds);
    if (relationTypeResult.error) {
      throw new ApiError(
        500,
        "recipe_link_relation_types_fetch_failed",
        "Could not fetch recipe link relation types",
        relationTypeResult.error.message,
      );
    }
    for (const row of relationTypeResult.data ?? []) {
      recipeLinkRelationNameById.set(String(row.id), String(row.name));
    }
  }

  const relatedRecipeIds = Array.from(
    new Set(
      recipeLinkRows.flatMap((row) => [
        row.parent_recipe_id,
        row.child_recipe_id,
      ]).filter((id) => id && id !== params.recipeId),
    ),
  );
  if (relatedRecipeIds.length > 0) {
    const relatedRecipesResult = await params.serviceClient
      .from("recipes")
      .select("id,title")
      .in("id", relatedRecipeIds);
    if (relatedRecipesResult.error) {
      throw new ApiError(
        500,
        "related_recipes_fetch_failed",
        "Could not fetch related recipes for graph enrichment",
        relatedRecipesResult.error.message,
      );
    }
    for (const recipe of relatedRecipesResult.data ?? []) {
      const title = String(recipe.title ?? "").trim();
      if (!title) continue;
      relatedRecipeLabelById.set(String(recipe.id), title);
    }
  }

  const entityLookupKey = (entityType: string, value: string): string =>
    `${entityType}|${value.toLowerCase()}`;
  const recipeEntityKey = (recipeId: string): string => `recipe:${recipeId}`;

  const entityPayload: Array<{
    entity_type: string;
    label: string;
    entity_key: string | null;
    metadata: Record<string, JsonValue>;
  }> = [
    {
      entity_type: "recipe",
      label: recipeLabel,
      entity_key: recipeEntityKey(params.recipeId),
      metadata: {
        recipe_id: params.recipeId,
      },
    },
    ...ingredientNames.map((label) => ({
      entity_type: "ingredient",
      label,
      entity_key: label.toLowerCase(),
      metadata: {},
    })),
    ...categoryNames.map((label) => ({
      entity_type: "category",
      label,
      entity_key: label.toLowerCase(),
      metadata: {},
    })),
    ...keywordNames.map((label) => ({
      entity_type: "keyword",
      label,
      entity_key: label.toLowerCase(),
      metadata: {},
    })),
    ...dietTags.map((label) => ({
      entity_type: "diet_tag",
      label,
      entity_key: label.toLowerCase(),
      metadata: {},
    })),
    ...allergenFlags.map((label) => ({
      entity_type: "allergen",
      label,
      entity_key: label.toLowerCase(),
      metadata: {},
    })),
    ...techniques.map((label) => ({
      entity_type: "technique",
      label,
      entity_key: label.toLowerCase(),
      metadata: {},
    })),
    ...equipments.map((label) => ({
      entity_type: "equipment",
      label,
      entity_key: label.toLowerCase(),
      metadata: {},
    })),
    ...cuisines.map((label) => ({
      entity_type: "cuisine",
      label,
      entity_key: label.toLowerCase(),
      metadata: {},
    })),
    ...occasions.map((label) => ({
      entity_type: "occasion",
      label,
      entity_key: label.toLowerCase(),
      metadata: {},
    })),
    ...spiceLevels.map((label) => ({
      entity_type: "spice_level",
      label,
      entity_key: label.toLowerCase(),
      metadata: {},
    })),
    ...difficultyValues.map((label) => ({
      entity_type: "difficulty_level",
      label,
      entity_key: label.toLowerCase(),
      metadata: {},
    })),
    ...Array.from(relatedRecipeLabelById.entries()).map(([id, label]) => ({
      entity_type: "recipe",
      label,
      entity_key: recipeEntityKey(id),
      metadata: { recipe_id: id },
    })),
  ];

  const uniqueEntityPayload = Array.from(
    new Map(
      entityPayload.map((entity) => [
        entity.entity_key
          ? entityLookupKey(entity.entity_type, entity.entity_key)
          : entityLookupKey(entity.entity_type, entity.label),
        entity,
      ]),
    ).values(),
  );

  const { data: entityRows, error: entityError } = await params.serviceClient
    .from("graph_entities")
    .upsert(uniqueEntityPayload, { onConflict: "entity_type,entity_key" })
    .select("id,entity_type,label,entity_key");

  if (entityError || !entityRows) {
    throw new ApiError(
      500,
      "metadata_entity_upsert_failed",
      "Could not upsert graph entities",
      entityError?.message,
    );
  }

  const entityByKey = new Map(
    entityRows.map((entity) => [
      entityLookupKey(
        entity.entity_type,
        entity.entity_key ?? entity.label,
      ),
      entity.id,
    ]),
  );
  const recipeEntityId = entityByKey.get(
    entityLookupKey("recipe", recipeEntityKey(params.recipeId)),
  );
  if (!recipeEntityId) {
    return;
  }

  const linkPayload = entityRows.map((entity) => ({
    recipe_version_id: params.recipeVersionId,
    entity_id: entity.id,
  }));
  const { error: linkError } = await params.serviceClient.from(
    "recipe_graph_links",
  ).upsert(linkPayload, {
    onConflict: "recipe_version_id,entity_id",
  });
  if (linkError) {
    throw new ApiError(
      500,
      "metadata_graph_link_failed",
      "Could not upsert recipe graph links",
      linkError.message,
    );
  }

  const relationTypeByName = await ensureGraphRelationTypes(
    params.serviceClient,
    [
      "contains_ingredient",
      "primary_ingredient",
      "optional_ingredient",
      "alternative_ingredient",
      "has_category",
      "has_keyword",
      "compatible_with_diet",
      "contains_allergen",
      "uses_technique",
      "requires_equipment",
      "belongs_to_cuisine",
      "fits_occasion",
      "has_spice_level",
      "has_difficulty",
      "co_occurs_with",
      "alternative_to",
      "complements",
      "substitutes_for",
      "same_family_as",
      "derived_from",
      "conflicts_with",
      "pairs_with",
      "is_side_of",
      "is_appetizer_of",
      "is_dessert_of",
      "is_drink_of",
      "variant_of",
      "similar_to",
    ],
  );

  const containsIngredientRelation = relationTypeByName.get(
    "contains_ingredient",
  );
  const primaryIngredientRelation = relationTypeByName.get("primary_ingredient");
  const optionalIngredientRelation = relationTypeByName.get(
    "optional_ingredient",
  );
  const alternativeIngredientRelation = relationTypeByName.get(
    "alternative_ingredient",
  );
  const alternativeToRelation = relationTypeByName.get("alternative_to");
  const hasCategoryRelation = relationTypeByName.get("has_category");
  const hasKeywordRelation = relationTypeByName.get("has_keyword");
  const dietRelation = relationTypeByName.get("compatible_with_diet");
  const allergenRelation = relationTypeByName.get("contains_allergen");
  const techniqueRelation = relationTypeByName.get("uses_technique");
  const equipmentRelation = relationTypeByName.get("requires_equipment");
  const cuisineRelation = relationTypeByName.get("belongs_to_cuisine");
  const occasionRelation = relationTypeByName.get("fits_occasion");
  const spiceRelation = relationTypeByName.get("has_spice_level");
  const difficultyRelation = relationTypeByName.get("has_difficulty");
  const coOccurRelation = relationTypeByName.get("co_occurs_with");

  const edgePayload: Array<{
    from_entity_id: string;
    to_entity_id: string;
    relation_type_id: string;
    source: string;
    confidence: number;
    metadata: Record<string, JsonValue>;
  }> = [];
  const edgeEvidence: Array<{
    from_entity_id: string;
    to_entity_id: string;
    relation_type_id: string;
    source: string;
    evidence_type: string;
    evidence_ref: string;
    excerpt: string | null;
  }> = [];

  if (containsIngredientRelation) {
    for (const ingredientName of ingredientNames) {
      const entityId = entityByKey.get(
        entityLookupKey("ingredient", ingredientName),
      );
      if (!entityId) {
        continue;
      }

      edgePayload.push({
        from_entity_id: recipeEntityId,
        to_entity_id: entityId,
        relation_type_id: containsIngredientRelation,
        source: "metadata_job",
        confidence: 1,
        metadata: {},
      });
    }
  }

  if (
    primaryIngredientRelation || optionalIngredientRelation ||
    alternativeIngredientRelation
  ) {
    for (const assignment of ingredientRoleAssignments) {
      const ingredientEntityId = entityByKey.get(
        entityLookupKey("ingredient", assignment.canonical_name),
      );
      if (!ingredientEntityId) continue;

      const relationTypeId = assignment.mention_role === "primary"
        ? primaryIngredientRelation
        : assignment.mention_role === "optional" ||
            assignment.mention_role === "garnish"
        ? optionalIngredientRelation
        : assignment.mention_role === "alternative"
        ? alternativeIngredientRelation
        : null;
      if (!relationTypeId) continue;

      edgePayload.push({
        from_entity_id: recipeEntityId,
        to_entity_id: ingredientEntityId,
        relation_type_id: relationTypeId,
        source: "ingredient_mentions",
        confidence: clampConfidence(assignment.confidence, 0.9),
        metadata: {
          mention_role: assignment.mention_role,
          alternative_group_key: assignment.alternative_group_key,
        },
      });
    }
  }

  if (alternativeToRelation) {
    const byGroup = new Map<string, Array<{
      canonical_name: string;
      confidence: number;
    }>>();
    for (const assignment of ingredientRoleAssignments) {
      if (
        assignment.mention_role !== "alternative" ||
        !assignment.alternative_group_key
      ) {
        continue;
      }
      const current = byGroup.get(assignment.alternative_group_key) ?? [];
      current.push({
        canonical_name: assignment.canonical_name,
        confidence: assignment.confidence,
      });
      byGroup.set(assignment.alternative_group_key, current);
    }

    for (const [groupKey, candidates] of byGroup.entries()) {
      const deduped = Array.from(
        new Map(
          candidates.map((candidate) => [
            candidate.canonical_name.toLowerCase(),
            candidate,
          ]),
        ).values(),
      );
      for (let i = 0; i < deduped.length; i += 1) {
        for (let j = i + 1; j < deduped.length; j += 1) {
          const left = deduped[i]!;
          const right = deduped[j]!;
          const leftEntity = entityByKey.get(
            entityLookupKey("ingredient", left.canonical_name),
          );
          const rightEntity = entityByKey.get(
            entityLookupKey("ingredient", right.canonical_name),
          );
          if (!leftEntity || !rightEntity) continue;

          edgePayload.push({
            from_entity_id: leftEntity,
            to_entity_id: rightEntity,
            relation_type_id: alternativeToRelation,
            source: "ingredient_mentions",
            confidence: Math.min(
              clampConfidence(left.confidence, 0.9),
              clampConfidence(right.confidence, 0.9),
            ),
            metadata: {
              alternative_group_key: groupKey,
              recipe_id: params.recipeId,
              recipe_version_id: params.recipeVersionId,
            },
          });
        }
      }
    }
  }

  if (coOccurRelation) {
    for (let i = 0; i < ingredientNames.length; i += 1) {
      for (let j = i + 1; j < ingredientNames.length; j += 1) {
        const left = ingredientNames[i]!;
        const right = ingredientNames[j]!;
        const leftEntity = entityByKey.get(entityLookupKey("ingredient", left));
        const rightEntity = entityByKey.get(
          entityLookupKey("ingredient", right),
        );
        if (!leftEntity || !rightEntity) {
          continue;
        }

        edgePayload.push({
          from_entity_id: leftEntity,
          to_entity_id: rightEntity,
          relation_type_id: coOccurRelation,
          source: "metadata_job",
          confidence: 0.9,
          metadata: {
            recipe_id: params.recipeId,
            recipe_version_id: params.recipeVersionId,
          },
        });
      }
    }
  }

  if (hasCategoryRelation) {
    for (const categoryName of categoryNames) {
      const entityId = entityByKey.get(
        entityLookupKey("category", categoryName),
      );
      if (!entityId) {
        continue;
      }
      edgePayload.push({
        from_entity_id: recipeEntityId,
        to_entity_id: entityId,
        relation_type_id: hasCategoryRelation,
        source: "metadata_job",
        confidence: 0.85,
        metadata: {},
      });
    }
  }

  if (hasKeywordRelation) {
    for (const keywordName of keywordNames) {
      const entityId = entityByKey.get(entityLookupKey("keyword", keywordName));
      if (!entityId) {
        continue;
      }
      edgePayload.push({
        from_entity_id: recipeEntityId,
        to_entity_id: entityId,
        relation_type_id: hasKeywordRelation,
        source: "metadata_job",
        confidence: 0.8,
        metadata: {},
      });
    }
  }

  if (dietRelation) {
    for (const value of dietTags) {
      const entityId = entityByKey.get(entityLookupKey("diet_tag", value));
      if (!entityId) continue;
      edgePayload.push({
        from_entity_id: recipeEntityId,
        to_entity_id: entityId,
        relation_type_id: dietRelation,
        source: "metadata_job",
        confidence: 0.9,
        metadata: {},
      });
    }
  }

  if (allergenRelation) {
    for (const value of allergenFlags) {
      const entityId = entityByKey.get(entityLookupKey("allergen", value));
      if (!entityId) continue;
      edgePayload.push({
        from_entity_id: recipeEntityId,
        to_entity_id: entityId,
        relation_type_id: allergenRelation,
        source: "metadata_job",
        confidence: 0.9,
        metadata: {},
      });
    }
  }

  if (techniqueRelation) {
    for (const value of techniques) {
      const entityId = entityByKey.get(entityLookupKey("technique", value));
      if (!entityId) continue;
      edgePayload.push({
        from_entity_id: recipeEntityId,
        to_entity_id: entityId,
        relation_type_id: techniqueRelation,
        source: "metadata_job",
        confidence: 0.88,
        metadata: {},
      });
    }
  }

  if (equipmentRelation) {
    for (const value of equipments) {
      const entityId = entityByKey.get(entityLookupKey("equipment", value));
      if (!entityId) continue;
      edgePayload.push({
        from_entity_id: recipeEntityId,
        to_entity_id: entityId,
        relation_type_id: equipmentRelation,
        source: "metadata_job",
        confidence: 0.88,
        metadata: {},
      });
    }
  }

  if (cuisineRelation) {
    for (const value of cuisines) {
      const entityId = entityByKey.get(entityLookupKey("cuisine", value));
      if (!entityId) continue;
      edgePayload.push({
        from_entity_id: recipeEntityId,
        to_entity_id: entityId,
        relation_type_id: cuisineRelation,
        source: "metadata_job",
        confidence: 0.9,
        metadata: {},
      });
    }
  }

  if (occasionRelation) {
    for (const value of occasions) {
      const entityId = entityByKey.get(entityLookupKey("occasion", value));
      if (!entityId) continue;
      edgePayload.push({
        from_entity_id: recipeEntityId,
        to_entity_id: entityId,
        relation_type_id: occasionRelation,
        source: "metadata_job",
        confidence: 0.87,
        metadata: {},
      });
    }
  }

  if (spiceRelation) {
    for (const value of spiceLevels) {
      const entityId = entityByKey.get(entityLookupKey("spice_level", value));
      if (!entityId) continue;
      edgePayload.push({
        from_entity_id: recipeEntityId,
        to_entity_id: entityId,
        relation_type_id: spiceRelation,
        source: "metadata_job",
        confidence: 0.9,
        metadata: {},
      });
    }
  }

  if (difficultyRelation) {
    for (const value of difficultyValues) {
      const entityId = entityByKey.get(
        entityLookupKey("difficulty_level", value),
      );
      if (!entityId) continue;
      edgePayload.push({
        from_entity_id: recipeEntityId,
        to_entity_id: entityId,
        relation_type_id: difficultyRelation,
        source: "metadata_job",
        confidence: 0.9,
        metadata: {},
      });
    }
  }

  const recipeLabelById = new Map<string, string>([[params.recipeId, recipeLabel]]);
  for (const [id, label] of relatedRecipeLabelById.entries()) {
    recipeLabelById.set(id, label);
  }
  const recipeEntityIdByRecipeId = new Map<string, string>();
  for (const [id] of recipeLabelById.entries()) {
    const entityId = entityByKey.get(
      entityLookupKey("recipe", recipeEntityKey(id)),
    );
    if (entityId) {
      recipeEntityIdByRecipeId.set(id, entityId);
    }
  }

  for (const link of recipeLinkRows) {
    const rawRelationName = recipeLinkRelationNameById.get(link.relation_type_id);
    if (!rawRelationName) continue;
    const relationName = rawRelationName === "is_a_side_of"
      ? "is_side_of"
      : rawRelationName;
    const relationTypeId = relationTypeByName.get(relationName);
    if (!relationTypeId) continue;

    const directionalFromChildToParent = /^is_.*_of$/.test(relationName);
    const fromRecipeId = directionalFromChildToParent
      ? link.child_recipe_id
      : link.parent_recipe_id;
    const toRecipeId = directionalFromChildToParent
      ? link.parent_recipe_id
      : link.child_recipe_id;
    const fromEntityId = recipeEntityIdByRecipeId.get(fromRecipeId);
    const toEntityId = recipeEntityIdByRecipeId.get(toRecipeId);
    if (!fromEntityId || !toEntityId) continue;

    edgePayload.push({
      from_entity_id: fromEntityId,
      to_entity_id: toEntityId,
      relation_type_id: relationTypeId,
      source: "recipe_links",
      confidence: 1,
      metadata: {
        recipe_link_position: link.position ?? null,
        recipe_id: params.recipeId,
        recipe_version_id: params.recipeVersionId,
      },
    });
    edgeEvidence.push({
      from_entity_id: fromEntityId,
      to_entity_id: toEntityId,
      relation_type_id: relationTypeId,
      source: "recipe_links",
      evidence_type: "recipe_link",
      evidence_ref: "recipe_links",
      excerpt: null,
    });
  }

  for (const relation of params.ingredientRelations ?? []) {
    const fromEntityId = entityByKey.get(
      entityLookupKey("ingredient", relation.from_canonical_name),
    );
    const toEntityId = entityByKey.get(
      entityLookupKey("ingredient", relation.to_canonical_name),
    );
    const relationTypeId = relationTypeByName.get(relation.relation_type);
    if (!fromEntityId || !toEntityId || !relationTypeId) {
      continue;
    }
    if (!shouldPersistEnrichment(relation.confidence)) {
      continue;
    }

    edgePayload.push({
      from_entity_id: fromEntityId,
      to_entity_id: toEntityId,
      relation_type_id: relationTypeId,
      source: "llm_inference",
      confidence: clampConfidence(relation.confidence, 0.5),
      metadata: {
        recipe_id: params.recipeId,
        recipe_version_id: params.recipeVersionId,
      },
    });
    edgeEvidence.push({
      from_entity_id: fromEntityId,
      to_entity_id: toEntityId,
      relation_type_id: relationTypeId,
      source: "llm_inference",
      evidence_type: "llm_rationale",
      evidence_ref: "ingredient_relation_inference_v2",
      excerpt: relation.rationale ?? null,
    });
  }

  if (edgePayload.length === 0) {
    return;
  }

  const dedupedEdgePayload = Array.from(
    new Map(
      edgePayload.map((edge) => [
        `${edge.from_entity_id}:${edge.to_entity_id}:${edge.relation_type_id}:${edge.source}`,
        edge,
      ]),
    ).values(),
  );

  const { data: writtenEdges, error: edgeError } = await params.serviceClient
    .from("graph_edges")
    .upsert(dedupedEdgePayload, {
      onConflict: "from_entity_id,to_entity_id,relation_type_id,source",
    })
    .select("id,from_entity_id,to_entity_id,relation_type_id,source");

  if (edgeError) {
    throw new ApiError(
      500,
      "metadata_graph_edge_upsert_failed",
      "Could not upsert graph edges",
      edgeError.message,
    );
  }

  if ((writtenEdges ?? []).length > 0 && edgeEvidence.length > 0) {
    const edgeIdByKey = new Map(
      (writtenEdges ?? []).map((edge) => [
        `${edge.from_entity_id}:${edge.to_entity_id}:${edge.relation_type_id}:${edge.source}`,
        edge.id,
      ]),
    );

    const evidenceRows = edgeEvidence
      .map((item) => {
        const edgeId = edgeIdByKey.get(
          `${item.from_entity_id}:${item.to_entity_id}:${item.relation_type_id}:${item.source}`,
        );
        if (!edgeId) return null;
        return {
          graph_edge_id: edgeId,
          evidence_type: item.evidence_type,
          evidence_ref: item.evidence_ref,
          excerpt: item.excerpt,
          metadata: {},
        };
      })
      .filter((item): item is {
        graph_edge_id: string;
        evidence_type: string;
        evidence_ref: string;
        excerpt: string | null;
        metadata: Record<string, JsonValue>;
      } => item !== null);

    if (evidenceRows.length > 0) {
      const { error: evidenceError } = await params.serviceClient
        .from("graph_edge_evidence")
        .insert(evidenceRows);
      if (
        evidenceError && !isOptionalSemanticCapabilityUnavailable(evidenceError)
      ) {
        throw new ApiError(
          500,
          "metadata_graph_evidence_insert_failed",
          "Could not persist edge evidence",
          evidenceError.message,
        );
      }
    }
  }

  const ingredientIds = Array.from(
    new Set(
      params.canonicalRows
        .map((row) => row.ingredient_id)
        .filter((value): value is string =>
          typeof value === "string" && value.length > 0
        ),
    ),
  );
  await upsertIngredientPairStats({
    serviceClient: params.serviceClient,
    ingredientIds,
  });
};
