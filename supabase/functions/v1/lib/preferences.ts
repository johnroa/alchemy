import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../../_shared/errors.ts";
import type { JsonValue } from "../../_shared/types.ts";
import { llmGateway } from "../../_shared/llm-gateway.ts";
import type { SearchSafetyExclusions } from "../recipe-search.ts";
import { sanitizeModelPreferencePatch } from "../preference-auto-update.ts";
import { logChangelog } from "./user-profile.ts";

export type PreferenceContext = {
  free_form: string | null;
  dietary_preferences: string[];
  dietary_restrictions: string[];
  skill_level: string;
  equipment: string[];
  cuisines: string[];
  aversions: string[];
  cooking_for: string | null;
  max_difficulty: number;
  presentation_preferences: Record<string, JsonValue>;
};

/**
 * Constraint-category preference fields that are fingerprinted for stale
 * variant detection. Only changes to these fields invalidate existing
 * variants. Non-constraint fields (dietary_preferences, cuisines,
 * skill_level, etc.) are forward-only — they influence future generation
 * but don't trigger variant re-materialization.
 */
export const CONSTRAINT_FIELDS = [
  "dietary_restrictions",
  "aversions",
  "equipment",
] as const;

/**
 * Computes a deterministic hash (SHA-256 hex) of the constraint-category
 * preference values. Used as the `preference_fingerprint` on variants.
 *
 * The hash is order-independent within each field (arrays are sorted)
 * but field order is fixed. Empty arrays produce the same fingerprint
 * as missing fields — both mean "no constraints in this category."
 *
 * Returns null when all constraint fields are empty (no constraints at all,
 * so no fingerprint needed).
 */
export const computePreferenceFingerprint = async (
  preferences: PreferenceContext,
): Promise<string | null> => {
  const constraintData: Record<string, string[]> = {};
  let hasAnyConstraint = false;

  for (const field of CONSTRAINT_FIELDS) {
    const value = preferences[field];
    const sorted = Array.isArray(value)
      ? [...value].map((v) => String(v).toLowerCase().trim()).filter(Boolean).sort()
      : [];
    constraintData[field] = sorted;
    if (sorted.length > 0) hasAnyConstraint = true;
  }

  if (!hasAnyConstraint) return null;

  const canonical = JSON.stringify(constraintData);
  const encoded = new TextEncoder().encode(canonical);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
};

/**
 * Classifies a preference field as constraint or preference for the
 * propagation logic. Constraint changes trigger retroactive variant
 * refresh; preference changes are forward-only.
 */
export const classifyPreferenceField = (
  field: string,
): "constraint" | "preference" => {
  return (CONSTRAINT_FIELDS as readonly string[]).includes(field)
    ? "constraint"
    : "preference";
};

/**
 * Builds safety exclusions for recipe search from user preferences.
 * Aversions map to excluded ingredient names; dietary_restrictions
 * map to required diet tags (the recipe must satisfy all restrictions).
 *
 * Returns undefined if no constraints are active (no filtering needed).
 */
export const buildSafetyExclusions = (
  preferences: PreferenceContext,
): SearchSafetyExclusions | undefined => {
  const excludeIngredients = (preferences.aversions ?? [])
    .map((s) => s.toLowerCase().trim())
    .filter(Boolean);

  const requireDietTags = (preferences.dietary_restrictions ?? [])
    .map((s) => s.toLowerCase().trim())
    .filter(Boolean);

  if (excludeIngredients.length === 0 && requireDietTags.length === 0) {
    return undefined;
  }

  return { excludeIngredients, requireDietTags };
};

/**
 * Marks all of a user's variants with stale_status = 'current' as 'stale'.
 * Called when a constraint-category preference changes so the user knows
 * their variants need re-materialization. Variants already in 'processing',
 * 'failed', or 'needs_review' states are left untouched — they have their
 * own lifecycle.
 */
export const markUserVariantsStale = async (
  serviceClient: SupabaseClient,
  userId: string,
): Promise<number> => {
  const { data, error } = await serviceClient
    .from("user_recipe_variants")
    .update({ stale_status: "stale" })
    .eq("user_id", userId)
    .eq("stale_status", "current")
    .select("id");

  if (error) {
    console.error("mark_variants_stale_failed", {
      user_id: userId,
      error: error.message,
    });
    return 0;
  }

  const count = data?.length ?? 0;
  if (count > 0) {
    console.log("variants_marked_stale", {
      user_id: userId,
      count,
    });
  }
  return count;
};

/**
 * All preference fields that can be tracked in the change log.
 * Maps field name → { category, propagation } for the change log insert.
 *
 * Constraint fields trigger retroactive variant refresh; preference fields
 * are forward-only (influence future generation). Rendering fields (like
 * presentation_preferences) never enter the variant pipeline.
 */
export const PREFERENCE_FIELD_CONFIG: Record<
  string,
  { category: "constraint" | "preference" | "rendering"; propagation: "retroactive" | "forward_only" | "none" }
> = {
  dietary_restrictions: { category: "constraint", propagation: "retroactive" },
  aversions: { category: "constraint", propagation: "retroactive" },
  equipment: { category: "constraint", propagation: "retroactive" },
  dietary_preferences: { category: "preference", propagation: "forward_only" },
  cuisines: { category: "preference", propagation: "forward_only" },
  skill_level: { category: "preference", propagation: "forward_only" },
  cooking_for: { category: "preference", propagation: "forward_only" },
  max_difficulty: { category: "preference", propagation: "forward_only" },
  free_form: { category: "preference", propagation: "forward_only" },
  presentation_preferences: { category: "rendering", propagation: "none" },
};

/**
 * Diffs two PreferenceContext snapshots and inserts rows into
 * preference_change_log for every field that changed. Uses service-role
 * client because the table is write-restricted to service role for users.
 *
 * Returns true if any constraint-category field changed (caller can use
 * this to trigger stale variant detection).
 */
export const logPreferenceChanges = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  before: PreferenceContext;
  after: PreferenceContext;
  source: "chat" | "settings" | "onboarding";
}): Promise<{ hasConstraintChange: boolean }> => {
  const rows: Array<{
    user_id: string;
    field: string;
    old_value: JsonValue;
    new_value: JsonValue;
    category: string;
    propagation: string;
    source: string;
  }> = [];

  let hasConstraintChange = false;

  for (const [field, config] of Object.entries(PREFERENCE_FIELD_CONFIG)) {
    const oldVal = params.before[field as keyof PreferenceContext];
    const newVal = params.after[field as keyof PreferenceContext];

    const oldJson = JSON.stringify(oldVal ?? null);
    const newJson = JSON.stringify(newVal ?? null);

    if (oldJson === newJson) continue;

    rows.push({
      user_id: params.userId,
      field,
      old_value: (oldVal ?? null) as JsonValue,
      new_value: (newVal ?? null) as JsonValue,
      category: config.category,
      propagation: config.propagation,
      source: params.source,
    });

    if (config.propagation === "retroactive") {
      hasConstraintChange = true;
    }
  }

  if (rows.length > 0) {
    const { error } = await params.serviceClient
      .from("preference_change_log")
      .insert(rows);

    if (error) {
      console.error("preference_change_log_insert_failed", {
        user_id: params.userId,
        error: error.message,
        fields: rows.map((r) => r.field),
      });
    }
  }

  return { hasConstraintChange };
};

export const defaultPreferences: PreferenceContext = {
  free_form: null,
  dietary_preferences: [],
  dietary_restrictions: [],
  skill_level: "intermediate",
  equipment: [],
  cuisines: [],
  aversions: [],
  cooking_for: null,
  max_difficulty: 3,
  presentation_preferences: {},
};

export const rawPreferenceTextKeys = {
  dietary_preferences: "raw_dietary_preferences",
  dietary_restrictions: "raw_dietary_restrictions",
  equipment: "raw_special_equipment",
  cuisines: "raw_cuisines",
  aversions: "raw_disliked_ingredients",
} as const;

export const normalizedRawPreferenceText = (
  preferences: PreferenceContext,
  field: keyof typeof rawPreferenceTextKeys,
): string | null => {
  const raw = preferences.presentation_preferences
    ?.[rawPreferenceTextKeys[field]];
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const joinCanonicalPreferenceList = (values: string[]): string =>
  values.join(", ");

const MAX_PROMPT_LIST_ITEMS = 5;
const MAX_PROMPT_FIELD_CHARS = 140;
const MAX_PROMPT_FREE_FORM_CHARS = 220;

const truncatePreferenceSummary = (
  value: string,
  maxChars: number,
): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
};

const compactPreferenceListForPrompt = (values: string[]): string => {
  if (values.length === 0) {
    return "";
  }
  const limited = values.slice(0, MAX_PROMPT_LIST_ITEMS);
  const summary = limited.join(", ");
  if (values.length <= MAX_PROMPT_LIST_ITEMS) {
    return truncatePreferenceSummary(summary, MAX_PROMPT_FIELD_CHARS);
  }
  return truncatePreferenceSummary(
    `${summary}, plus ${values.length - MAX_PROMPT_LIST_ITEMS} more`,
    MAX_PROMPT_FIELD_CHARS,
  );
};

const buildPresentationPreferenceSummary = (
  preferences: PreferenceContext,
): string => {
  const parts: string[] = [];
  const units = typeof preferences.presentation_preferences?.["recipe_units"] ===
      "string"
    ? preferences.presentation_preferences["recipe_units"]
    : null;
  const groupBy =
    typeof preferences.presentation_preferences?.["recipe_group_by"] === "string"
      ? preferences.presentation_preferences["recipe_group_by"]
      : null;
  const temperatureUnit =
    typeof preferences.presentation_preferences?.["recipe_temperature_unit"] ===
        "string"
      ? preferences.presentation_preferences["recipe_temperature_unit"]
      : null;
  const verbosity =
    typeof preferences.presentation_preferences?.[
        "recipe_instruction_verbosity"
      ] === "string"
      ? preferences.presentation_preferences["recipe_instruction_verbosity"]
      : null;
  const inlineMeasurements =
    typeof preferences.presentation_preferences?.[
        "recipe_inline_measurements"
      ] === "boolean"
      ? preferences.presentation_preferences["recipe_inline_measurements"]
      : null;

  if (units) parts.push(`units ${units}`);
  if (temperatureUnit) parts.push(`temperature ${temperatureUnit}`);
  if (groupBy) parts.push(`grouping ${groupBy}`);
  if (typeof inlineMeasurements === "boolean") {
    parts.push(
      inlineMeasurements ? "inline measurements on" : "inline measurements off",
    );
  }
  if (verbosity) parts.push(`instructions ${verbosity}`);

  return truncatePreferenceSummary(parts.join("; "), MAX_PROMPT_FIELD_CHARS);
};

export const buildNaturalLanguagePreferenceContext = (
  preferences: PreferenceContext,
): Record<string, JsonValue> => ({
  chef_profile: preferences.free_form
    ? truncatePreferenceSummary(
      preferences.free_form,
      MAX_PROMPT_FREE_FORM_CHARS,
    )
    : "",
  cooking_for: preferences.cooking_for
    ? truncatePreferenceSummary(preferences.cooking_for, 80)
    : "",
  skill_level: preferences.skill_level,
  max_difficulty: preferences.max_difficulty,
  dietary_preferences:
    normalizedRawPreferenceText(preferences, "dietary_preferences")
      ? truncatePreferenceSummary(
        normalizedRawPreferenceText(preferences, "dietary_preferences")!,
        MAX_PROMPT_FIELD_CHARS,
      )
      : compactPreferenceListForPrompt(preferences.dietary_preferences),
  dietary_restrictions:
    normalizedRawPreferenceText(preferences, "dietary_restrictions")
      ? truncatePreferenceSummary(
        normalizedRawPreferenceText(preferences, "dietary_restrictions")!,
        MAX_PROMPT_FIELD_CHARS,
      )
      : compactPreferenceListForPrompt(preferences.dietary_restrictions),
  special_equipment: normalizedRawPreferenceText(preferences, "equipment")
    ? truncatePreferenceSummary(
      normalizedRawPreferenceText(preferences, "equipment")!,
      MAX_PROMPT_FIELD_CHARS,
    )
    : compactPreferenceListForPrompt(preferences.equipment),
  cuisines: normalizedRawPreferenceText(preferences, "cuisines")
    ? truncatePreferenceSummary(
      normalizedRawPreferenceText(preferences, "cuisines")!,
      MAX_PROMPT_FIELD_CHARS,
    )
    : compactPreferenceListForPrompt(preferences.cuisines),
  disliked_ingredients: normalizedRawPreferenceText(preferences, "aversions")
    ? truncatePreferenceSummary(
      normalizedRawPreferenceText(preferences, "aversions")!,
      MAX_PROMPT_FIELD_CHARS,
    )
    : compactPreferenceListForPrompt(preferences.aversions),
  display_preferences: buildPresentationPreferenceSummary(preferences),
});

export const getPreferences = async (
  client: SupabaseClient,
  userId: string,
): Promise<PreferenceContext> => {
  const { data, error } = await client.from("preferences").select("*").eq(
    "user_id",
    userId,
  ).maybeSingle();
  if (error) {
    throw new ApiError(
      500,
      "preferences_fetch_failed",
      "Could not load preferences",
      error.message,
    );
  }

  if (!data) {
    return defaultPreferences;
  }

  return {
    free_form: data.free_form,
    dietary_preferences: data.dietary_preferences ?? [],
    dietary_restrictions: data.dietary_restrictions ?? [],
    skill_level: data.skill_level,
    equipment: data.equipment ?? [],
    cuisines: data.cuisines ?? [],
    aversions: data.aversions ?? [],
    cooking_for: data.cooking_for,
    max_difficulty: data.max_difficulty,
    presentation_preferences: data.presentation_preferences &&
        typeof data.presentation_preferences === "object" &&
        !Array.isArray(data.presentation_preferences)
      ? (data.presentation_preferences as Record<string, JsonValue>)
      : {},
  };
};

export const normalizePreferenceStringArray = (
  value: unknown,
): string[] | undefined => {
  if (typeof value !== "string" && !Array.isArray(value) && value !== null) {
    return undefined;
  }

  const rawValues: string[] = value === null
    ? []
    : typeof value === "string"
    ? [value]
    : value.filter((item): item is string => typeof item === "string");

  const entries = rawValues
    .map((raw) => raw.trim())
    .filter((raw) => raw.length > 0);
  const seen = new Set<string>();
  const uniqueEntries: string[] = [];
  for (const entry of entries) {
    const key = entry.toLocaleLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueEntries.push(entry);
  }

  return uniqueEntries.slice(0, 32);
};

export const normalizePreferencePatch = (
  candidate: unknown,
): Partial<PreferenceContext> | null => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const patchObject = candidate as Record<string, unknown>;
  const patch: Partial<PreferenceContext> = {};

  if (typeof patchObject.free_form === "string") {
    const freeForm = patchObject.free_form.trim();
    patch.free_form = freeForm.length > 0 ? freeForm : null;
  } else if (patchObject.free_form === null) {
    patch.free_form = null;
  }

  const dietaryPreferences = normalizePreferenceStringArray(
    patchObject.dietary_preferences,
  );
  if (dietaryPreferences) {
    patch.dietary_preferences = dietaryPreferences;
  }

  const dietaryRestrictions = normalizePreferenceStringArray(
    patchObject.dietary_restrictions,
  );
  if (dietaryRestrictions) {
    patch.dietary_restrictions = dietaryRestrictions;
  }

  if (
    typeof patchObject.skill_level === "string" &&
    patchObject.skill_level.trim().length > 0
  ) {
    patch.skill_level = patchObject.skill_level.trim();
  }

  const equipment = normalizePreferenceStringArray(patchObject.equipment);
  if (equipment) {
    patch.equipment = equipment;
  }

  const cuisines = normalizePreferenceStringArray(patchObject.cuisines);
  if (cuisines) {
    patch.cuisines = cuisines;
  }

  const aversions = normalizePreferenceStringArray(patchObject.aversions);
  if (aversions) {
    patch.aversions = aversions;
  }

  if (typeof patchObject.cooking_for === "string") {
    const cookingFor = patchObject.cooking_for.trim();
    patch.cooking_for = cookingFor.length > 0 ? cookingFor : null;
  } else if (patchObject.cooking_for === null) {
    patch.cooking_for = null;
  }

  const maxDifficulty = Number(patchObject.max_difficulty);
  if (Number.isInteger(maxDifficulty)) {
    patch.max_difficulty = Math.max(1, Math.min(5, maxDifficulty));
  }

  if (
    patchObject.presentation_preferences &&
    typeof patchObject.presentation_preferences === "object" &&
    !Array.isArray(patchObject.presentation_preferences)
  ) {
    patch.presentation_preferences = patchObject
      .presentation_preferences as Record<string, JsonValue>;
  }

  return Object.keys(patch).length > 0 ? patch : null;
};

export const preferenceListFieldLabels: Record<
  | "dietary_preferences"
  | "dietary_restrictions"
  | "equipment"
  | "cuisines"
  | "aversions",
  string
> = {
  dietary_preferences: "dietary preferences",
  dietary_restrictions: "dietary restrictions",
  equipment: "special equipment",
  cuisines: "cuisines",
  aversions: "ingredients to avoid",
};

export const normalizePreferencePatchWithLlm = async (params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  patch: Partial<PreferenceContext>;
}): Promise<Partial<PreferenceContext>> => {
  const nextPatch: Partial<PreferenceContext> = { ...params.patch };

  const listFields = Object.keys(preferenceListFieldLabels) as Array<
    keyof typeof preferenceListFieldLabels
  >;
  await Promise.all(
    listFields.map(async (field) => {
      const candidate = params.patch[field];
      if (!Array.isArray(candidate)) {
        return;
      }

      const normalized = await llmGateway.normalizePreferenceList({
        client: params.client,
        userId: params.userId,
        requestId: params.requestId,
        field: preferenceListFieldLabels[field],
        entries: candidate,
      });
      nextPatch[field] = normalized;
    }),
  );

  return nextPatch;
};

export const sanitizePreferenceStringList = (values: unknown): string[] => {
  if (!Array.isArray(values)) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLocaleLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(normalized);
    if (out.length >= 32) {
      break;
    }
  }
  return out;
};

export const clampMaxDifficulty = (value: unknown, fallback: number): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(1, Math.min(5, Math.round(numeric)));
};

export const normalizePreferencePatchDeterministic = (
  patch: ReturnType<typeof sanitizeModelPreferencePatch>,
): ReturnType<typeof sanitizeModelPreferencePatch> => {
  const normalized = { ...patch };
  if ("dietary_preferences" in normalized) {
    normalized.dietary_preferences = sanitizePreferenceStringList(
      normalized.dietary_preferences,
    );
  }
  if ("dietary_restrictions" in normalized) {
    normalized.dietary_restrictions = sanitizePreferenceStringList(
      normalized.dietary_restrictions,
    );
  }
  if ("equipment" in normalized) {
    normalized.equipment = sanitizePreferenceStringList(normalized.equipment);
  }
  if ("cuisines" in normalized) {
    normalized.cuisines = sanitizePreferenceStringList(normalized.cuisines);
  }
  if ("aversions" in normalized) {
    normalized.aversions = sanitizePreferenceStringList(normalized.aversions);
  }
  if (typeof normalized.skill_level === "string") {
    normalized.skill_level = normalized.skill_level.trim().slice(0, 48);
  }
  if (typeof normalized.cooking_for === "string") {
    normalized.cooking_for = normalized.cooking_for.trim().slice(0, 120);
  }
  if (typeof normalized.max_difficulty !== "undefined") {
    normalized.max_difficulty = clampMaxDifficulty(
      normalized.max_difficulty,
      3,
    );
  }
  return normalized;
};

export const applyModelPreferenceUpdates = async (params: {
  client: SupabaseClient;
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  currentPreferences: PreferenceContext;
  preferenceUpdates: unknown;
  latestUserMessage: string;
  userMessages?: string[];
}): Promise<PreferenceContext> => {
  const patch = normalizePreferencePatch(params.preferenceUpdates);
  if (!patch) {
    return params.currentPreferences;
  }

  const safePatch = normalizePreferencePatchDeterministic(
    sanitizeModelPreferencePatch(patch),
  );

  if (Object.keys(safePatch).length === 0) {
    return params.currentPreferences;
  }

  // CRITICAL: Only update the fields the LLM actually changed. The old
  // approach did a full-row upsert with { ...currentPreferences, ...safePatch },
  // but currentPreferences can be stale (loaded at session start, not at
  // this turn). A stale upsert would overwrite good data with old empty values.
  // Using .update() with only safePatch ensures we never wipe fields the LLM
  // didn't explicitly touch.
  const { data, error } = await params.client
    .from("preferences")
    .update({
      ...safePatch,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", params.userId)
    .select("*")
    .single();

  // Build the merged view for in-memory use downstream
  const nextPreferences: PreferenceContext = {
    ...params.currentPreferences,
    ...safePatch,
  };

  if (error) {
    console.error("preferences_auto_update_failed", error);
    return params.currentPreferences;
  }

  const persistedPreferences: PreferenceContext = {
    free_form: data.free_form,
    dietary_preferences: data.dietary_preferences ?? [],
    dietary_restrictions: data.dietary_restrictions ?? [],
    skill_level: data.skill_level,
    equipment: data.equipment ?? [],
    cuisines: data.cuisines ?? [],
    aversions: data.aversions ?? [],
    cooking_for: data.cooking_for,
    max_difficulty: data.max_difficulty,
    presentation_preferences: data.presentation_preferences &&
        typeof data.presentation_preferences === "object" &&
        !Array.isArray(data.presentation_preferences)
      ? (data.presentation_preferences as Record<string, JsonValue>)
      : {},
  };

  await logChangelog({
    serviceClient: params.serviceClient,
    actorUserId: params.userId,
    scope: "preferences",
    entityType: "preferences",
    entityId: params.userId,
    action: "assistant_updated",
    requestId: params.requestId,
    afterJson: persistedPreferences,
  });

  // Log field-level changes and mark variants stale if constraint fields
  // changed. Fire-and-forget — don't block the chat response.
  logPreferenceChanges({
    serviceClient: params.serviceClient,
    userId: params.userId,
    before: params.currentPreferences,
    after: persistedPreferences,
    source: "chat",
  }).then(({ hasConstraintChange }) => {
    if (hasConstraintChange) {
      return markUserVariantsStale(params.serviceClient, params.userId);
    }
  }).catch((err) => {
    console.error("preference_change_log_failed", err);
  });

  return persistedPreferences;
};
