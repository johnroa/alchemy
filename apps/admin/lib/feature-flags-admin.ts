import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FEATURE_FLAG_ENVIRONMENTS,
  evaluateCompiledFeatureFlags,
  isFeatureFlagEnvironment,
  isFeatureFlagPayload,
  isFeatureFlagType,
  normalizeFeatureFlagKey,
  type CompiledFeatureFlag,
  type FeatureFlagEnvironment,
  type FeatureFlagPayload,
  type FeatureFlagType,
  type ResolveFlagsResponse,
} from "../../../packages/shared/src/feature-flags";

type FeatureFlagEnvironmentRow = {
  environment_key: string | null;
  label: string | null;
  description: string | null;
};

type FeatureFlagStateRevisionRow = {
  environment_key: string | null;
  revision: number | null;
  updated_at: string | null;
};

type FeatureFlagRow = {
  id: string | null;
  flag_key: string | null;
  name: string | null;
  description: string | null;
  flag_type: string | null;
  owner: string | null;
  tags: unknown;
  expires_at: string | null;
  archived_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type FeatureFlagConfigRow = {
  flag_id: string | null;
  environment_key: string | null;
  enabled: boolean | null;
  payload_json: unknown;
  revision: number | null;
  updated_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type AdminFeatureFlagEnvironment = {
  key: FeatureFlagEnvironment;
  label: string;
  description: string;
  revision: number;
  updated_at: string | null;
};

export type AdminFeatureFlagConfig = {
  environment_key: FeatureFlagEnvironment;
  enabled: boolean;
  payload_json: FeatureFlagPayload;
  revision: number;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminFeatureFlag = {
  id: string;
  key: string;
  name: string;
  description: string;
  flag_type: FeatureFlagType;
  owner: string;
  tags: string[];
  expires_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  configs: Record<FeatureFlagEnvironment, AdminFeatureFlagConfig | null>;
};

export type FeatureFlagsAdminSnapshot = {
  environments: AdminFeatureFlagEnvironment[];
  flags: AdminFeatureFlag[];
};

const environmentRank = new Map(
  FEATURE_FLAG_ENVIRONMENTS.map((environment, index) => [environment, index]),
);

const normalizeTags = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const tags: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const normalized = entry.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    tags.push(normalized);
  }
  return tags;
};

const normalizePayload = (value: unknown): FeatureFlagPayload =>
  isFeatureFlagPayload(value) ? value : null;

const createEmptyConfigMap = (): Record<FeatureFlagEnvironment, AdminFeatureFlagConfig | null> => ({
  development: null,
  production: null,
});

export const loadFeatureFlagsAdminSnapshot = async (
  client: SupabaseClient,
): Promise<FeatureFlagsAdminSnapshot> => {
  const [
    { data: environmentRows, error: environmentsError },
    { data: revisionRows, error: revisionsError },
    { data: flagRows, error: flagsError },
    { data: configRows, error: configsError },
  ] = await Promise.all([
    client
      .from("feature_flag_environments")
      .select("environment_key,label,description"),
    client
      .from("feature_flag_state_revisions")
      .select("environment_key,revision,updated_at"),
    client
      .from("feature_flags")
      .select(
        "id,flag_key,name,description,flag_type,owner,tags,expires_at,archived_at,created_at,updated_at",
      )
      .order("archived_at", { ascending: true, nullsFirst: true })
      .order("flag_key", { ascending: true }),
    client
      .from("feature_flag_environment_configs")
      .select(
        "flag_id,environment_key,enabled,payload_json,revision,updated_by,created_at,updated_at",
      ),
  ]);

  if (environmentsError) {
    throw new Error(environmentsError.message);
  }
  if (revisionsError) {
    throw new Error(revisionsError.message);
  }
  if (flagsError) {
    throw new Error(flagsError.message);
  }
  if (configsError) {
    throw new Error(configsError.message);
  }

  const revisionByEnvironment = new Map<
    FeatureFlagEnvironment,
    FeatureFlagStateRevisionRow
  >();
  for (const row of (revisionRows ?? []) as FeatureFlagStateRevisionRow[]) {
    if (!row.environment_key || !isFeatureFlagEnvironment(row.environment_key)) {
      continue;
    }
    revisionByEnvironment.set(row.environment_key, row);
  }

  const environments = ((environmentRows ?? []) as FeatureFlagEnvironmentRow[])
    .flatMap((row) => {
      const key = row.environment_key?.trim().toLowerCase();
      if (!key || !isFeatureFlagEnvironment(key)) {
        return [];
      }

      const revision = revisionByEnvironment.get(key);
      return [{
        key,
        label: row.label?.trim() || key,
        description: row.description?.trim() || "",
        revision: Math.max(1, Number(revision?.revision ?? 1)),
        updated_at: revision?.updated_at ?? null,
      }];
    })
    .sort((left, right) =>
      (environmentRank.get(left.key) ?? 999) - (environmentRank.get(right.key) ?? 999)
    );

  const flags = ((flagRows ?? []) as FeatureFlagRow[])
    .flatMap((row) => {
      const key = row.flag_key ? normalizeFeatureFlagKey(row.flag_key) : "";
      if (!row.id || !key || !row.flag_type || !isFeatureFlagType(row.flag_type)) {
        return [];
      }

      return [{
        id: row.id,
        key,
        name: row.name?.trim() || key,
        description: row.description?.trim() || "",
        flag_type: row.flag_type,
        owner: row.owner?.trim() || "unknown",
        tags: normalizeTags(row.tags),
        expires_at: row.expires_at ?? null,
        archived_at: row.archived_at ?? null,
        created_at: row.created_at ?? "",
        updated_at: row.updated_at ?? "",
        configs: createEmptyConfigMap(),
      }];
    });

  const flagById = new Map(flags.map((flag) => [flag.id, flag]));
  for (const row of (configRows ?? []) as FeatureFlagConfigRow[]) {
    if (
      !row.flag_id ||
      !row.environment_key ||
      !isFeatureFlagEnvironment(row.environment_key)
    ) {
      continue;
    }

    const flag = flagById.get(row.flag_id);
    if (!flag) {
      continue;
    }

    flag.configs[row.environment_key] = {
      environment_key: row.environment_key,
      enabled: Boolean(row.enabled),
      payload_json: normalizePayload(row.payload_json),
      revision: Math.max(1, Number(row.revision ?? 1)),
      updated_by: row.updated_by ?? null,
      created_at: row.created_at ?? "",
      updated_at: row.updated_at ?? "",
    };
  }

  return {
    environments,
    flags,
  };
};

const buildCompiledFeatureFlagsForEnvironment = (
  snapshot: FeatureFlagsAdminSnapshot,
  environment: FeatureFlagEnvironment,
): CompiledFeatureFlag[] =>
  snapshot.flags.flatMap((flag) => {
    const config = flag.configs[environment];
    if (!config) {
      return [];
    }

    return [{
      key: flag.key,
      flagType: flag.flag_type,
      archivedAt: flag.archived_at,
      enabled: config.enabled,
      payload: config.payload_json,
    }];
  });

export const previewFeatureFlags = (params: {
  snapshot: FeatureFlagsAdminSnapshot;
  environment: FeatureFlagEnvironment;
  keys: string[];
}): ResolveFlagsResponse => {
  const revision = params.snapshot.environments.find((environment) =>
    environment.key === params.environment
  )?.revision ?? 1;

  return evaluateCompiledFeatureFlags({
    compiledFlags: buildCompiledFeatureFlagsForEnvironment(
      params.snapshot,
      params.environment,
    ),
    environment: params.environment,
    keys: params.keys.map((key) => normalizeFeatureFlagKey(key)),
    revision,
  });
};

export const getFeatureFlagByKey = (
  snapshot: FeatureFlagsAdminSnapshot,
  key: string,
): AdminFeatureFlag | null => {
  const normalizedKey = normalizeFeatureFlagKey(key);
  return snapshot.flags.find((flag) => flag.key === normalizedKey) ?? null;
};
