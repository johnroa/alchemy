import { normalizeDelimitedToken } from "../../../packages/shared/src/text-normalization.ts";
import type { PreferenceConflictContext } from "../_shared/types.ts";

export type PendingPreferenceConflict = {
  conflicting_preferences: string[];
  conflicting_aversions: string[];
  requested_terms: string[];
};

export type ThreadPreferenceOverrides = {
  ignored_dietary_restrictions?: string[];
  ignored_aversions?: string[];
};

export type PreferenceContextLike = {
  dietary_restrictions: string[];
  aversions: string[];
};

export const normalizePreferenceMatchKey = (value: string): string =>
  normalizeDelimitedToken(value, "").replace(/_/g, "");

export const normalizeChatStringList = (values: unknown): string[] => {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const key = normalizePreferenceMatchKey(trimmed);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(trimmed);
  }
  return normalized;
};

export const normalizePendingPreferenceConflict = (
  value: unknown,
): PendingPreferenceConflict | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const conflictingPreferences = normalizeChatStringList(
    record.conflicting_preferences,
  );
  const conflictingAversions = normalizeChatStringList(
    record.conflicting_aversions,
  );
  const requestedTerms = normalizeChatStringList(record.requested_terms);

  if (
    conflictingPreferences.length === 0 && conflictingAversions.length === 0
  ) {
    return null;
  }

  return {
    conflicting_preferences: conflictingPreferences,
    conflicting_aversions: conflictingAversions,
    requested_terms: requestedTerms,
  };
};

export const normalizeThreadPreferenceOverrides = (
  value: unknown,
): ThreadPreferenceOverrides | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const ignoredDietaryRestrictions = normalizeChatStringList(
    record.ignored_dietary_restrictions,
  );
  const ignoredAversions = normalizeChatStringList(record.ignored_aversions);
  if (
    ignoredDietaryRestrictions.length === 0 && ignoredAversions.length === 0
  ) {
    return null;
  }

  return {
    ...(ignoredDietaryRestrictions.length > 0
      ? { ignored_dietary_restrictions: ignoredDietaryRestrictions }
      : {}),
    ...(ignoredAversions.length > 0
      ? { ignored_aversions: ignoredAversions }
      : {}),
  };
};

export const applyThreadPreferenceOverrides = <T extends PreferenceContextLike>(
  preferences: T,
  overrides?: ThreadPreferenceOverrides | null,
): T => {
  if (!overrides) {
    return preferences;
  }

  const ignoredRestrictionKeys = new Set(
    (overrides.ignored_dietary_restrictions ?? []).map(
      normalizePreferenceMatchKey,
    ),
  );
  const ignoredAversionKeys = new Set(
    (overrides.ignored_aversions ?? []).map(normalizePreferenceMatchKey),
  );

  return {
    ...preferences,
    dietary_restrictions: preferences.dietary_restrictions.filter((value) =>
      !ignoredRestrictionKeys.has(normalizePreferenceMatchKey(value))
    ),
    aversions: preferences.aversions.filter((value) =>
      !ignoredAversionKeys.has(normalizePreferenceMatchKey(value))
    ),
  };
};

export const derivePendingPreferenceConflictFromResponse = (
  preferenceConflict: PreferenceConflictContext | undefined,
): PendingPreferenceConflict | null => {
  if (preferenceConflict?.status !== "pending_confirmation") {
    return null;
  }

  return normalizePendingPreferenceConflict(preferenceConflict);
};

export const mergeThreadPreferenceOverrides = (params: {
  current: ThreadPreferenceOverrides | null | undefined;
  pendingConflict: PendingPreferenceConflict | null | undefined;
  preferenceConflict: PreferenceConflictContext | undefined;
}): ThreadPreferenceOverrides | null => {
  if (
    params.preferenceConflict?.status !== "override" || !params.pendingConflict
  ) {
    return normalizeThreadPreferenceOverrides(params.current);
  }

  const current = normalizeThreadPreferenceOverrides(params.current);
  const ignoredDietaryRestrictions = normalizeChatStringList([
    ...(current?.ignored_dietary_restrictions ?? []),
    ...params.pendingConflict.conflicting_preferences,
  ]);
  const ignoredAversions = normalizeChatStringList([
    ...(current?.ignored_aversions ?? []),
    ...params.pendingConflict.conflicting_aversions,
  ]);

  return normalizeThreadPreferenceOverrides({
    ignored_dietary_restrictions: ignoredDietaryRestrictions,
    ignored_aversions: ignoredAversions,
  });
};
