import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../../_shared/errors.ts";
import {
  evaluateCompiledFeatureFlags,
  normalizeFeatureFlagKey,
  isFeatureFlagType,
  isFeatureFlagPayload,
  type CompiledFeatureFlag,
  type FeatureFlagEnvironment,
  type FeatureFlagPayload,
  type FeatureFlagResolution,
  type ResolveFlagsResponse,
} from "../../../../packages/shared/src/feature-flags.ts";

const FEATURE_FLAG_CACHE_TTL_MS = 5_000;

type CachedCompiledFlags = {
  revision: number;
  expiresAt: number;
  compiledFlags: CompiledFeatureFlag[];
};

type FeatureFlagConfigRow = {
  enabled: boolean | null;
  payload_json: unknown;
  feature_flags:
    | {
      flag_key: string | null;
      flag_type: string | null;
      archived_at: string | null;
    }
    | Array<{
      flag_key: string | null;
      flag_type: string | null;
      archived_at: string | null;
    }>
    | null;
};

const compiledFlagCache = new Map<
  FeatureFlagEnvironment,
  CachedCompiledFlags
>();

const isDevelopmentHost = (host: string): boolean =>
  host === "localhost" ||
  host === "127.0.0.1" ||
  host === "0.0.0.0" ||
  host.endsWith(".local") ||
  host.endsWith(".test");

export const inferFeatureFlagEnvironmentFromUrl = (
  inputUrl: string,
): FeatureFlagEnvironment => {
  try {
    const host = new URL(inputUrl).hostname.trim().toLowerCase();
    return isDevelopmentHost(host) ? "development" : "production";
  } catch {
    return "production";
  }
};

export const inferFeatureFlagEnvironment = (
  requestUrl?: string,
): FeatureFlagEnvironment => {
  if (requestUrl) {
    return inferFeatureFlagEnvironmentFromUrl(requestUrl);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (supabaseUrl) {
    return inferFeatureFlagEnvironmentFromUrl(supabaseUrl);
  }

  return "production";
};

const normalizeFeatureFlagPayload = (value: unknown): FeatureFlagPayload => {
  if (!isFeatureFlagPayload(value)) {
    return null;
  }
  return value;
};

const loadFeatureFlagRevision = async (
  serviceClient: SupabaseClient,
  environment: FeatureFlagEnvironment,
): Promise<number> => {
  const { data, error } = await serviceClient
    .from("feature_flag_state_revisions")
    .select("revision")
    .eq("environment_key", environment)
    .maybeSingle();

  if (error) {
    throw new ApiError(
      500,
      "feature_flag_revision_fetch_failed",
      "Could not load feature flag revision",
      error.message,
    );
  }

  return Math.max(1, Number(data?.revision ?? 1));
};

const loadCompiledFeatureFlags = async (
  serviceClient: SupabaseClient,
  environment: FeatureFlagEnvironment,
): Promise<CompiledFeatureFlag[]> => {
  const { data, error } = await serviceClient
    .from("feature_flag_environment_configs")
    .select(
      "enabled,payload_json,feature_flags!inner(flag_key,flag_type,archived_at)",
    )
    .eq("environment_key", environment);

  if (error) {
    throw new ApiError(
      500,
      "feature_flag_configs_fetch_failed",
      "Could not load feature flag configs",
      error.message,
    );
  }

  return ((data ?? []) as unknown as FeatureFlagConfigRow[])
    .flatMap((row) => {
      const featureFlag = Array.isArray(row.feature_flags)
        ? row.feature_flags[0] ?? null
        : row.feature_flags;
      const flagKey = featureFlag?.flag_key?.trim().toLowerCase();
      const flagType = featureFlag?.flag_type?.trim().toLowerCase();
      if (!flagKey || !flagType || !isFeatureFlagType(flagType)) {
        return [];
      }

      return [{
        key: flagKey,
        flagType,
        archivedAt: featureFlag?.archived_at ?? null,
        enabled: Boolean(row.enabled),
        payload: normalizeFeatureFlagPayload(row.payload_json),
      }];
    });
};

const getCompiledFlagsForEnvironment = async (params: {
  serviceClient: SupabaseClient;
  environment: FeatureFlagEnvironment;
}): Promise<CachedCompiledFlags> => {
  const now = Date.now();
  const cached = compiledFlagCache.get(params.environment);
  if (cached && cached.expiresAt > now) {
    return cached;
  }

  const revision = await loadFeatureFlagRevision(
    params.serviceClient,
    params.environment,
  );

  if (cached && cached.revision === revision) {
    const refreshed = {
      ...cached,
      expiresAt: now + FEATURE_FLAG_CACHE_TTL_MS,
    };
    compiledFlagCache.set(params.environment, refreshed);
    return refreshed;
  }

  const compiledFlags = await loadCompiledFeatureFlags(
    params.serviceClient,
    params.environment,
  );
  const nextState = {
    revision,
    expiresAt: now + FEATURE_FLAG_CACHE_TTL_MS,
    compiledFlags,
  };
  compiledFlagCache.set(params.environment, nextState);
  return nextState;
};

export const resolveRuntimeFlags = async (params: {
  serviceClient: SupabaseClient;
  keys: string[];
  environment?: FeatureFlagEnvironment;
  requestUrl?: string;
}): Promise<ResolveFlagsResponse> => {
  const environment = params.environment ??
    inferFeatureFlagEnvironment(params.requestUrl);
  const normalizedKeys = Array.from(
    new Set(
      params.keys
        .map((key) => normalizeFeatureFlagKey(key))
        .filter((key) => key.length > 0),
    ),
  );
  const compiled = await getCompiledFlagsForEnvironment({
    serviceClient: params.serviceClient,
    environment,
  });

  return evaluateCompiledFeatureFlags({
    compiledFlags: compiled.compiledFlags,
    environment,
    keys: normalizedKeys,
    revision: compiled.revision,
  });
};

export const resolveRuntimeFlag = async (params: {
  serviceClient: SupabaseClient;
  key: string;
  environment?: FeatureFlagEnvironment;
  requestUrl?: string;
}): Promise<FeatureFlagResolution> => {
  const resolved = await resolveRuntimeFlags({
    serviceClient: params.serviceClient,
    keys: [params.key],
    environment: params.environment,
    requestUrl: params.requestUrl,
  });

  return resolved.flags[params.key.trim().toLowerCase()] ?? {
    enabled: false,
    payload: null,
    reason: "missing",
    flag_type: null,
  };
};

export const clearFeatureFlagCacheForTests = (): void => {
  compiledFlagCache.clear();
};
