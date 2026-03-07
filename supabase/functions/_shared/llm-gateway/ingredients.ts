/**
 * llm-gateway/ingredients.ts
 *
 * Ingredient-domain LLM gateway methods: alias normalization,
 * ingredient line parsing, phrase splitting, semantic enrichment,
 * and relation inference. Each function wraps an executeScope call
 * with input cleaning, output normalization, dedup, and event logging.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { normalizeDelimitedToken } from "../../../../packages/shared/src/text-normalization.ts";
import { ApiError } from "../errors.ts";
import { executeScope } from "../llm-executor.ts";
import type { JsonValue } from "../types.ts";
import type {
  IngredientAliasNormalization,
  IngredientLineMention,
  IngredientLineParse,
  IngredientLineQualifier,
  IngredientPhraseSplit,
  IngredientSemanticEnrichment,
  IngredientSemanticRelation,
  OntologySuggestion,
  TokenAccum,
} from "./types.ts";
import { addTokens, logLlmEvent } from "./config.ts";

export async function normalizeIngredientAliases(params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  aliases: Array<{
    alias_key: string;
    source_name: string;
    fallback_canonical_name?: string;
  }>;
}): Promise<IngredientAliasNormalization[]> {
  const cleanedAliases = params.aliases
    .map((alias) => ({
      alias_key: alias.alias_key.trim().toLocaleLowerCase(),
      source_name: alias.source_name.trim(),
      fallback_canonical_name:
        typeof alias.fallback_canonical_name === "string"
          ? alias.fallback_canonical_name.trim()
          : "",
    }))
    .filter((alias) =>
      alias.alias_key.length > 0 && alias.source_name.length > 0
    );

  if (cleanedAliases.length === 0) {
    return [];
  }

  const dedupedByAlias = new Map<
    string,
    { source_name: string; fallback_canonical_name: string }
  >();
  for (const alias of cleanedAliases) {
    if (dedupedByAlias.has(alias.alias_key)) {
      continue;
    }
    dedupedByAlias.set(alias.alias_key, {
      source_name: alias.source_name,
      fallback_canonical_name: alias.fallback_canonical_name,
    });
  }

  const dedupedAliases = Array.from(dedupedByAlias.entries()).map(
    ([alias_key, value]) => ({
      alias_key,
      source_name: value.source_name,
      fallback_canonical_name: value.fallback_canonical_name,
    }),
  );
  const allowedAliasKeys = new Set(
    dedupedAliases.map((alias) => alias.alias_key),
  );

  const startedAt = Date.now();
  const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };
  try {
    const { result, inputTokens, outputTokens, config } = await executeScope<
      { items?: unknown }
    >({
      client: params.client,
      scope: "ingredient_alias_normalize",
      userInput: {
        task: "normalize_ingredient_aliases",
        aliases: dedupedAliases,
      },
    });
    addTokens(accum, inputTokens, outputTokens, config);

    const rawItems = result.items;
    const normalized = Array.isArray(rawItems)
      ? rawItems
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            return null;
          }

          const rawAlias = (item as { alias_key?: unknown }).alias_key;
          const rawCanonical = (item as { canonical_name?: unknown })
            .canonical_name;
          const rawConfidence = (item as { confidence?: unknown }).confidence;
          if (
            typeof rawAlias !== "string" || typeof rawCanonical !== "string"
          ) {
            return null;
          }

          const alias_key = rawAlias.trim().toLocaleLowerCase();
          const canonical_name = rawCanonical.trim();
          if (
            alias_key.length === 0 ||
            canonical_name.length === 0 ||
            !allowedAliasKeys.has(alias_key)
          ) {
            return null;
          }

          const numericConfidence = Number(rawConfidence);
          const confidence = Number.isFinite(numericConfidence)
            ? Math.max(0, Math.min(1, numericConfidence))
            : 0;

          return {
            alias_key,
            canonical_name,
            confidence,
          };
        })
        .filter(
          (item): item is IngredientAliasNormalization => item !== null,
        )
      : [];

    const mergedByAlias = new Map<string, IngredientAliasNormalization>();
    for (const item of normalized) {
      if (mergedByAlias.has(item.alias_key)) {
        continue;
      }
      mergedByAlias.set(item.alias_key, item);
    }

    const output = Array.from(mergedByAlias.values());
    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "ingredient_alias_normalize",
      Date.now() - startedAt,
      "ok",
      {
        task: "normalize_ingredient_aliases",
        input_count: dedupedAliases.length,
        output_count: output.length,
      },
      accum,
    );

    return output;
  } catch (error) {
    const errorCode = error instanceof ApiError
      ? error.code
      : "unknown_error";
    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "ingredient_alias_normalize",
      Date.now() - startedAt,
      "error",
      {
        task: "normalize_ingredient_aliases",
        input_count: dedupedAliases.length,
        error_code: errorCode,
      },
      accum,
    );
    throw error;
  }
}

export async function parseIngredientLines(params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  sourceNames: string[];
}): Promise<IngredientLineParse[]> {
  const cleaned = params.sourceNames
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (cleaned.length === 0) {
    return [];
  }

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const value of cleaned) {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(value);
  }

  const normalizeTermKey = (value: string): string =>
    normalizeDelimitedToken(value);

  const allowedRoles = new Set([
    "primary",
    "optional",
    "alternative",
    "garnish",
    "unspecified",
  ]);
  const allowedQualifierTypes = new Set([
    "preparation",
    "state",
    "quality",
    "size",
    "purpose",
    "temperature",
    "treatment",
  ]);
  const allowedQualifierRelations = new Set([
    "prepared_as",
    "has_state",
    "has_quality",
    "has_size",
    "has_purpose",
    "has_temperature",
    "has_treatment",
  ]);

  const defaultRelationByType: Record<string, IngredientLineQualifier["relation_type"]> = {
    preparation: "prepared_as",
    state: "has_state",
    quality: "has_quality",
    size: "has_size",
    purpose: "has_purpose",
    temperature: "has_temperature",
    treatment: "has_treatment",
  };

  const startedAt = Date.now();
  const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };
  try {
    const { result, inputTokens, outputTokens, config } = await executeScope<
      { items?: unknown }
    >({
      client: params.client,
      scope: "ingredient_line_parse",
      userInput: {
        task: "parse_ingredient_lines",
        source_names: deduped,
      },
    });
    addTokens(accum, inputTokens, outputTokens, config);

    const rawItems = Array.isArray(result.items) ? result.items : [];
    const bySource = new Map<string, IngredientLineParse>();
    for (const rawItem of rawItems) {
      if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
        continue;
      }
      const sourceName = (rawItem as { source_name?: unknown }).source_name;
      if (typeof sourceName !== "string" || sourceName.trim().length === 0) {
        continue;
      }
      const sourceKey = sourceName.trim().toLocaleLowerCase();
      if (!seen.has(sourceKey)) {
        continue;
      }

      const lineConfidenceRaw = Number(
        (rawItem as { line_confidence?: unknown }).line_confidence,
      );
      const lineConfidence = Number.isFinite(lineConfidenceRaw)
        ? Math.max(0, Math.min(1, lineConfidenceRaw))
        : 0;

      const rawMentions = Array.isArray((rawItem as { mentions?: unknown }).mentions)
        ? ((rawItem as { mentions?: unknown }).mentions as unknown[])
        : [];
      const normalizedMentions = rawMentions
        .map((mention): IngredientLineMention | null => {
          if (typeof mention === "string") {
            const trimmed = mention.trim();
            if (trimmed.length === 0) return null;
            return {
              name: trimmed,
              role: "unspecified",
              alternative_group_key: null,
              confidence: 0,
            };
          }
          if (!mention || typeof mention !== "object" || Array.isArray(mention)) {
            return null;
          }
          const name = (mention as { name?: unknown }).name;
          if (typeof name !== "string" || name.trim().length === 0) {
            return null;
          }
          const roleRaw = String(
            (mention as { role?: unknown }).role ?? "unspecified",
          ).trim().toLocaleLowerCase();
          const role = allowedRoles.has(roleRaw)
            ? roleRaw as IngredientLineMention["role"]
            : "unspecified";
          const groupRaw =
            (mention as { alternative_group_key?: unknown })
              .alternative_group_key;
          const alternative_group_key =
            typeof groupRaw === "string" && groupRaw.trim().length > 0
              ? normalizeTermKey(groupRaw)
              : null;
          const confidenceRaw = Number(
            (mention as { confidence?: unknown }).confidence,
          );
          const confidence = Number.isFinite(confidenceRaw)
            ? Math.max(0, Math.min(1, confidenceRaw))
            : 0;
          return {
            name: name.trim(),
            role,
            alternative_group_key,
            confidence,
          };
        })
        .filter((entry): entry is IngredientLineMention => entry !== null);

      const dedupedMentions: IngredientLineMention[] = [];
      const seenMention = new Set<string>();
      for (const mention of normalizedMentions) {
        const dedupeKey = `${mention.name.toLocaleLowerCase()}:${
          mention.alternative_group_key ?? ""
        }`;
        if (seenMention.has(dedupeKey)) continue;
        seenMention.add(dedupeKey);
        dedupedMentions.push(mention);
      }

      const rawQualifiers = Array.isArray(
        (rawItem as { qualifiers?: unknown }).qualifiers,
      )
        ? ((rawItem as { qualifiers?: unknown }).qualifiers as unknown[])
        : [];
      const normalizedQualifiers = rawQualifiers
        .map((qualifier): IngredientLineQualifier | null => {
          if (
            !qualifier || typeof qualifier !== "object" ||
            Array.isArray(qualifier)
          ) {
            return null;
          }

          const termTypeRaw = String(
            (qualifier as { term_type?: unknown }).term_type ?? "",
          )
            .trim()
            .toLocaleLowerCase();
          if (!allowedQualifierTypes.has(termTypeRaw)) {
            return null;
          }
          const term_type = termTypeRaw as IngredientLineQualifier["term_type"];
          const label = String((qualifier as { label?: unknown }).label ?? "")
            .trim();
          if (label.length === 0) {
            return null;
          }
          const term_key_raw = String(
            (qualifier as { term_key?: unknown }).term_key ?? label,
          );
          const term_key = normalizeTermKey(term_key_raw);
          if (term_key.length === 0) {
            return null;
          }

          const relationRaw = String(
            (qualifier as { relation_type?: unknown }).relation_type ??
              defaultRelationByType[termTypeRaw] ?? "has_state",
          )
            .trim()
            .toLocaleLowerCase();
          const relation_type = allowedQualifierRelations.has(relationRaw)
            ? relationRaw as IngredientLineQualifier["relation_type"]
            : defaultRelationByType[termTypeRaw];

          const targetRaw = (qualifier as { target?: unknown }).target;
          let target: IngredientLineQualifier["target"] = "line";
          if (Number.isInteger(Number(targetRaw))) {
            target = Math.max(0, Number(targetRaw));
          } else if (typeof targetRaw === "string") {
            const trimmedTarget = targetRaw.trim().toLocaleLowerCase();
            if (trimmedTarget === "line") {
              target = "line";
            } else if (Number.isInteger(Number(trimmedTarget))) {
              target = Math.max(0, Number(trimmedTarget));
            }
          }

          const confidenceRaw = Number(
            (qualifier as { confidence?: unknown }).confidence,
          );
          const confidence = Number.isFinite(confidenceRaw)
            ? Math.max(0, Math.min(1, confidenceRaw))
            : 0;

          return {
            term_type,
            term_key,
            label,
            relation_type,
            target,
            confidence,
          };
        })
        .filter((entry): entry is IngredientLineQualifier => entry !== null);

      const dedupedQualifiers: IngredientLineQualifier[] = [];
      const seenQualifier = new Set<string>();
      for (const qualifier of normalizedQualifiers) {
        const dedupeKey = `${qualifier.term_type}:${qualifier.term_key}:${
          qualifier.relation_type
        }:${String(qualifier.target)}`;
        if (seenQualifier.has(dedupeKey)) continue;
        seenQualifier.add(dedupeKey);
        dedupedQualifiers.push(qualifier);
      }

      if (dedupedMentions.length === 0) {
        continue;
      }

      bySource.set(sourceKey, {
        source_name: sourceName.trim(),
        line_confidence: lineConfidence,
        mentions: dedupedMentions.slice(0, 6),
        qualifiers: dedupedQualifiers.slice(0, 10),
      });
    }

    const output = deduped
      .map((sourceName) => bySource.get(sourceName.toLocaleLowerCase()))
      .filter((entry): entry is IngredientLineParse => entry !== undefined);

    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "ingredient_line_parse",
      Date.now() - startedAt,
      "ok",
      {
        task: "parse_ingredient_lines",
        input_count: deduped.length,
        output_count: output.length,
      },
      accum,
    );
    return output;
  } catch (error) {
    const errorCode = error instanceof ApiError
      ? error.code
      : "unknown_error";
    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "ingredient_line_parse",
      Date.now() - startedAt,
      "error",
      {
        task: "parse_ingredient_lines",
        input_count: deduped.length,
        error_code: errorCode,
      },
      accum,
    );
    throw error;
  }
}

export async function splitIngredientPhrases(params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  sourceNames: string[];
}): Promise<IngredientPhraseSplit[]> {
  const cleaned = params.sourceNames
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (cleaned.length === 0) {
    return [];
  }

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const value of cleaned) {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(value);
  }

  const startedAt = Date.now();
  const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };
  try {
    const { result, inputTokens, outputTokens, config } = await executeScope<
      { items?: unknown }
    >({
      client: params.client,
      scope: "ingredient_phrase_split",
      userInput: {
        task: "split_ingredient_phrases",
        source_names: deduped,
      },
    });
    addTokens(accum, inputTokens, outputTokens, config);

    const rawItems = Array.isArray(result.items) ? result.items : [];
    const bySource = new Map<string, IngredientPhraseSplit>();
    for (const rawItem of rawItems) {
      if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
        continue;
      }
      const sourceName = (rawItem as { source_name?: unknown }).source_name;
      const parts = (rawItem as { items?: unknown }).items;
      if (typeof sourceName !== "string" || !Array.isArray(parts)) {
        continue;
      }
      const source_key = sourceName.trim().toLocaleLowerCase();
      if (!seen.has(source_key)) {
        continue;
      }
      const normalizedParts = parts
        .map((part) => {
          if (typeof part === "string") {
            const trimmed = part.trim();
            if (!trimmed) return null;
            return { name: trimmed, confidence: 0 };
          }
          if (!part || typeof part !== "object" || Array.isArray(part)) {
            return null;
          }
          const name = (part as { name?: unknown }).name;
          const confidenceRaw = (part as { confidence?: unknown }).confidence;
          if (typeof name !== "string" || name.trim().length === 0) {
            return null;
          }
          const numeric = Number(confidenceRaw);
          return {
            name: name.trim(),
            confidence: Number.isFinite(numeric)
              ? Math.max(0, Math.min(1, numeric))
              : 0,
          };
        })
        .filter((item): item is { name: string; confidence: number } =>
          item !== null
        );

      if (normalizedParts.length === 0) {
        continue;
      }

      const dedupedParts: Array<{ name: string; confidence: number }> = [];
      const seenPart = new Set<string>();
      for (const part of normalizedParts) {
        const key = part.name.toLocaleLowerCase();
        if (seenPart.has(key)) continue;
        seenPart.add(key);
        dedupedParts.push(part);
      }

      bySource.set(source_key, {
        source_name: sourceName.trim(),
        items: dedupedParts.slice(0, 4),
      });
    }

    const output = deduped
      .map((sourceName) => bySource.get(sourceName.toLocaleLowerCase()))
      .filter((entry): entry is IngredientPhraseSplit => entry !== undefined);

    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "ingredient_phrase_split",
      Date.now() - startedAt,
      "ok",
      {
        task: "split_ingredient_phrases",
        input_count: deduped.length,
        output_count: output.length,
      },
      accum,
    );
    return output;
  } catch (error) {
    const errorCode = error instanceof ApiError
      ? error.code
      : "unknown_error";
    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "ingredient_phrase_split",
      Date.now() - startedAt,
      "error",
      {
        task: "split_ingredient_phrases",
        input_count: deduped.length,
        error_code: errorCode,
      },
      accum,
    );
    throw error;
  }
}

export async function enrichIngredients(params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  ingredients: Array<{ canonical_name: string; ingredient_id?: string }>;
}): Promise<IngredientSemanticEnrichment[]> {
  const cleaned = params.ingredients
    .map((entry) => ({
      canonical_name: entry.canonical_name.trim(),
      ingredient_id: typeof entry.ingredient_id === "string"
        ? entry.ingredient_id
        : undefined,
    }))
    .filter((entry) => entry.canonical_name.length > 0);

  if (cleaned.length === 0) {
    return [];
  }

  const dedupedByName = new Map<
    string,
    { canonical_name: string; ingredient_id?: string }
  >();
  for (const item of cleaned) {
    const key = item.canonical_name.toLocaleLowerCase();
    if (dedupedByName.has(key)) continue;
    dedupedByName.set(key, item);
  }
  const deduped = Array.from(dedupedByName.values());
  const allowed = new Set(
    deduped.map((item) => item.canonical_name.toLocaleLowerCase()),
  );

  const startedAt = Date.now();
  const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };
  try {
    const { result, inputTokens, outputTokens, config } = await executeScope<
      { items?: unknown }
    >({
      client: params.client,
      scope: "ingredient_enrich",
      userInput: {
        task: "ingredient_enrichment_v2",
        ingredients: deduped,
      },
    });
    addTokens(accum, inputTokens, outputTokens, config);

    const rawItems = Array.isArray(result.items) ? result.items : [];
    const output = rawItems
      .map((rawItem): IngredientSemanticEnrichment | null => {
        if (
          !rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)
        ) {
          return null;
        }
        const canonicalName = (rawItem as { canonical_name?: unknown })
          .canonical_name;
        const confidenceRaw =
          (rawItem as { confidence?: unknown }).confidence;
        const metadataRaw = (rawItem as { metadata?: unknown }).metadata;
        const ontologyRaw =
          (rawItem as { ontology_terms?: unknown }).ontology_terms;

        if (
          typeof canonicalName !== "string" ||
          canonicalName.trim().length === 0
        ) {
          return null;
        }
        const key = canonicalName.trim().toLocaleLowerCase();
        if (!allowed.has(key)) {
          return null;
        }

        const numeric = Number(confidenceRaw);
        const confidence = Number.isFinite(numeric)
          ? Math.max(0, Math.min(1, numeric))
          : 0;
        const metadata = metadataRaw && typeof metadataRaw === "object" &&
            !Array.isArray(metadataRaw)
          ? metadataRaw as Record<string, JsonValue>
          : {};
        const ontologyTerms = Array.isArray(ontologyRaw)
          ? ontologyRaw
            .map((term) => {
              if (!term || typeof term !== "object" || Array.isArray(term)) {
                return null;
              }
              const termType = (term as { term_type?: unknown }).term_type;
              const termKey = (term as { term_key?: unknown }).term_key;
              const label = (term as { label?: unknown }).label;
              const relationType =
                (term as { relation_type?: unknown }).relation_type;
              const termConfidenceRaw =
                (term as { confidence?: unknown }).confidence;
              if (
                typeof termType !== "string" ||
                typeof termKey !== "string" ||
                typeof label !== "string" ||
                typeof relationType !== "string"
              ) {
                return null;
              }
              const termNumeric = Number(termConfidenceRaw);
              return {
                term_type: termType.trim(),
                term_key: termKey.trim().toLocaleLowerCase(),
                label: label.trim(),
                relation_type: relationType.trim(),
                confidence: Number.isFinite(termNumeric)
                  ? Math.max(0, Math.min(1, termNumeric))
                  : 0,
              };
            })
            .filter((entry): entry is OntologySuggestion => entry !== null)
          : [];

        return {
          canonical_name: canonicalName.trim(),
          confidence,
          metadata,
          ontology_terms: ontologyTerms,
        };
      })
      .filter((entry): entry is IngredientSemanticEnrichment =>
        entry !== null
      );

    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "ingredient_enrich",
      Date.now() - startedAt,
      "ok",
      {
        task: "ingredient_enrichment_v2",
        input_count: deduped.length,
        output_count: output.length,
      },
      accum,
    );
    return output;
  } catch (error) {
    const errorCode = error instanceof ApiError
      ? error.code
      : "unknown_error";
    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "ingredient_enrich",
      Date.now() - startedAt,
      "error",
      {
        task: "ingredient_enrichment_v2",
        input_count: deduped.length,
        error_code: errorCode,
      },
      accum,
    );
    throw error;
  }
}

export async function inferIngredientRelations(params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  ingredientNames: string[];
}): Promise<IngredientSemanticRelation[]> {
  const cleaned = params.ingredientNames
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (cleaned.length < 2) {
    return [];
  }

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const value of cleaned) {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(value);
  }
  if (deduped.length < 2) {
    return [];
  }

  const allowed = new Set(deduped.map((value) => value.toLocaleLowerCase()));
  const allowedRelations = new Set([
    "complements",
    "substitutes_for",
    "same_family_as",
    "derived_from",
    "conflicts_with",
  ]);

  const startedAt = Date.now();
  const accum: TokenAccum = { input: 0, output: 0, costUsd: 0 };
  try {
    const { result, inputTokens, outputTokens, config } = await executeScope<
      { items?: unknown }
    >({
      client: params.client,
      scope: "ingredient_relation_infer",
      userInput: {
        task: "ingredient_relation_inference_v2",
        ingredient_names: deduped,
      },
    });
    addTokens(accum, inputTokens, outputTokens, config);

    const rawItems = Array.isArray(result.items) ? result.items : [];
    const output = rawItems
      .map((rawItem) => {
        if (
          !rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)
        ) {
          return null;
        }
        const from = (rawItem as { from_canonical_name?: unknown })
          .from_canonical_name;
        const to =
          (rawItem as { to_canonical_name?: unknown }).to_canonical_name;
        const relationType =
          (rawItem as { relation_type?: unknown }).relation_type;
        const confidenceRaw =
          (rawItem as { confidence?: unknown }).confidence;
        const rationaleRaw = (rawItem as { rationale?: unknown }).rationale;

        if (
          typeof from !== "string" ||
          typeof to !== "string" ||
          typeof relationType !== "string"
        ) {
          return null;
        }

        const fromKey = from.trim().toLocaleLowerCase();
        const toKey = to.trim().toLocaleLowerCase();
        const relationKey = relationType.trim().toLocaleLowerCase();
        if (
          fromKey.length === 0 ||
          toKey.length === 0 ||
          fromKey === toKey ||
          !allowed.has(fromKey) ||
          !allowed.has(toKey) ||
          !allowedRelations.has(relationKey)
        ) {
          return null;
        }

        const numeric = Number(confidenceRaw);
        const normalized: IngredientSemanticRelation = {
          from_canonical_name: from.trim(),
          to_canonical_name: to.trim(),
          relation_type: relationKey,
          confidence: Number.isFinite(numeric)
            ? Math.max(0, Math.min(1, numeric))
            : 0,
        };
        if (
          typeof rationaleRaw === "string" && rationaleRaw.trim().length > 0
        ) {
          normalized.rationale = rationaleRaw.trim();
        }
        return normalized;
      })
      .filter((entry): entry is IngredientSemanticRelation => entry !== null);

    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "ingredient_relation_infer",
      Date.now() - startedAt,
      "ok",
      {
        task: "ingredient_relation_inference_v2",
        ingredient_count: deduped.length,
        output_count: output.length,
      },
      accum,
    );
    return output;
  } catch (error) {
    const errorCode = error instanceof ApiError
      ? error.code
      : "unknown_error";
    await logLlmEvent(
      params.client,
      params.userId,
      params.requestId,
      "ingredient_relation_infer",
      Date.now() - startedAt,
      "error",
      {
        task: "ingredient_relation_inference_v2",
        ingredient_count: deduped.length,
        error_code: errorCode,
      },
      accum,
    );
    throw error;
  }
}
