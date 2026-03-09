type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const FEATURE_FLAG_ENVIRONMENTS = [
  "development",
  "production",
] as const;

export type FeatureFlagEnvironment =
  (typeof FEATURE_FLAG_ENVIRONMENTS)[number];

export const isFeatureFlagEnvironment = (
  value: string,
): value is FeatureFlagEnvironment =>
  (FEATURE_FLAG_ENVIRONMENTS as readonly string[]).includes(value);

export const FEATURE_FLAG_TYPES = [
  "release",
  "operational",
  "kill_switch",
  "permission",
] as const;

export type FeatureFlagType = (typeof FEATURE_FLAG_TYPES)[number];

export const isFeatureFlagType = (value: string): value is FeatureFlagType =>
  (FEATURE_FLAG_TYPES as readonly string[]).includes(value);

export const FEATURE_FLAG_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export const normalizeFeatureFlagKey = (value: string): string =>
  value.trim().toLowerCase();

export const isFeatureFlagKey = (value: string): boolean =>
  FEATURE_FLAG_KEY_PATTERN.test(normalizeFeatureFlagKey(value));

export const FEATURE_FLAG_RESOLUTION_REASONS = [
  "resolved",
  "missing",
  "archived",
] as const;

export type FeatureFlagResolutionReason =
  (typeof FEATURE_FLAG_RESOLUTION_REASONS)[number];

export type FeatureFlagPayload = Record<string, JsonValue> | null;

export const isFeatureFlagPayload = (
  value: unknown,
): value is FeatureFlagPayload => {
  if (value === null || typeof value === "undefined") {
    return true;
  }
  return isJsonObject(value);
};

const isJsonValue = (value: unknown): value is JsonValue => {
  if (
    value === null || typeof value === "string" ||
    typeof value === "number" || typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((entry) => isJsonValue(entry));
  }
  return isJsonObject(value);
};

const isJsonObject = (
  value: unknown,
): value is Record<string, JsonValue> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((entry) => isJsonValue(entry));
};

export type FeatureFlagResolution = {
  enabled: boolean;
  payload: FeatureFlagPayload;
  reason: FeatureFlagResolutionReason;
  flag_type: FeatureFlagType | null;
};

export type ResolveFlagsRequest = {
  keys: string[];
};

export type ResolveFlagsResponse = {
  environment: FeatureFlagEnvironment;
  revision: number;
  flags: Record<string, FeatureFlagResolution>;
};

export type CompiledFeatureFlag = {
  key: string;
  flagType: FeatureFlagType;
  archivedAt: string | null;
  enabled: boolean;
  payload: FeatureFlagPayload;
};

export const evaluateCompiledFeatureFlags = (params: {
  compiledFlags: readonly CompiledFeatureFlag[];
  environment: FeatureFlagEnvironment;
  keys: readonly string[];
  revision: number;
}): ResolveFlagsResponse => {
  const flagByKey = new Map(
    params.compiledFlags.map((flag) => [flag.key, flag]),
  );
  const flags: Record<string, FeatureFlagResolution> = {};

  for (const key of params.keys) {
    const flag = flagByKey.get(key);
    if (!flag) {
      flags[key] = {
        enabled: false,
        payload: null,
        reason: "missing",
        flag_type: null,
      };
      continue;
    }

    if (flag.archivedAt) {
      flags[key] = {
        enabled: false,
        payload: null,
        reason: "archived",
        flag_type: flag.flagType,
      };
      continue;
    }

      flags[key] = {
        enabled: flag.enabled,
        payload: flag.payload,
        reason: "resolved",
        flag_type: flag.flagType,
      };
  }

  return {
    environment: params.environment,
    revision: params.revision,
    flags,
  };
};
