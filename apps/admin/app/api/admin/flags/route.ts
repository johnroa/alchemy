import { NextResponse } from "next/server";
import {
  FEATURE_FLAG_ENVIRONMENTS,
  isFeatureFlagEnvironment,
  isFeatureFlagKey,
  isFeatureFlagPayload,
  isFeatureFlagType,
  normalizeFeatureFlagKey,
  type FeatureFlagEnvironment,
  type FeatureFlagPayload,
  type FeatureFlagType,
} from "../../../../../../packages/shared/src/feature-flags";
import {
  getFeatureFlagByKey,
  loadFeatureFlagsAdminSnapshot,
  type AdminFeatureFlag,
  type FeatureFlagsAdminSnapshot,
} from "@/lib/feature-flags-admin";
import { getAdminClient, requireCloudflareAccess } from "@/lib/supabase-admin";

type EnvironmentConfigInput = {
  environment_key?: string;
  enabled?: boolean;
  payload_json?: unknown;
};

type CreateFlagBody = {
  key?: string;
  name?: string;
  description?: string;
  flag_type?: string;
  owner?: string;
  tags?: unknown;
  expires_at?: string | null;
  environment_configs?: EnvironmentConfigInput[];
};

type UpdateFlagBody = {
  key?: string;
  name?: string;
  description?: string;
  flag_type?: string;
  owner?: string;
  tags?: unknown;
  expires_at?: string | null;
  archived?: boolean;
  environment_configs?: EnvironmentConfigInput[];
};

class ValidationError extends Error {}

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

const normalizeOptionalString = (value: unknown, field: string): string | null => {
  if (typeof value === "undefined" || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string`);
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const normalizeRequiredString = (value: unknown, field: string): string => {
  const normalized = normalizeOptionalString(value, field);
  if (!normalized) {
    throw new ValidationError(`${field} is required`);
  }
  return normalized;
};

const normalizeExpiresAt = (value: unknown): string | null => {
  if (typeof value === "undefined" || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new ValidationError("expires_at must be an ISO timestamp or null");
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new ValidationError("expires_at must be a valid ISO timestamp");
  }
  return new Date(parsed).toISOString();
};

const normalizeEnvironmentConfigs = (
  value: unknown,
  fallbackUpdatedBy: string,
): Array<{
  environment_key: FeatureFlagEnvironment;
  enabled: boolean;
  payload_json: FeatureFlagPayload;
  updated_by: string;
}> => {
  if (typeof value === "undefined") {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new ValidationError("environment_configs must be an array");
  }

  const configs = new Map<FeatureFlagEnvironment, {
    environment_key: FeatureFlagEnvironment;
    enabled: boolean;
    payload_json: FeatureFlagPayload;
    updated_by: string;
  }>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ValidationError("environment_configs entries must be objects");
    }

    const environmentKey = typeof entry.environment_key === "string"
      ? entry.environment_key.trim().toLowerCase()
      : "";
    if (!isFeatureFlagEnvironment(environmentKey)) {
      throw new ValidationError(
        `environment_configs.environment_key must be one of ${FEATURE_FLAG_ENVIRONMENTS.join(", ")}`,
      );
    }
    if (typeof entry.enabled !== "boolean") {
      throw new ValidationError("environment_configs.enabled must be a boolean");
    }
    if (!isFeatureFlagPayload(entry.payload_json ?? null)) {
      throw new ValidationError("environment_configs.payload_json must be a JSON object or null");
    }

    configs.set(environmentKey, {
      environment_key: environmentKey,
      enabled: entry.enabled,
      payload_json: entry.payload_json ?? null,
      updated_by: fallbackUpdatedBy,
    });
  }

  return Array.from(configs.values());
};

const resolveActorId = async (
  client: ReturnType<typeof getAdminClient>,
  email: string,
): Promise<string | null> => {
  const { data, error } = await client.from("users").select("id").eq("email", email).maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data?.id ? String(data.id) : null;
};

const logFlagChangelog = async (params: {
  client: ReturnType<typeof getAdminClient>;
  actorUserId: string;
  action: string;
  requestId: string;
  flagId: string;
  beforeJson: AdminFeatureFlag | null;
  afterJson: AdminFeatureFlag | null;
  metadata: Record<string, unknown>;
}): Promise<void> => {
  const { error } = await params.client.rpc("log_changelog_event", {
    p_actor_user_id: params.actorUserId,
    p_scope: "feature_flags",
    p_entity_type: "feature_flag",
    p_entity_id: params.flagId,
    p_action: params.action,
    p_request_id: params.requestId,
    p_before_json: params.beforeJson,
    p_after_json: params.afterJson,
    p_metadata: params.metadata,
  });

  if (error) {
    console.error("feature_flag_changelog_failed", error);
  }
};

const snapshotResponse = (
  snapshot: FeatureFlagsAdminSnapshot,
  key?: string,
): NextResponse =>
  NextResponse.json({
    ok: true,
    environments: snapshot.environments,
    flags: snapshot.flags,
    key: key ?? null,
  });

export async function GET(): Promise<NextResponse> {
  await requireCloudflareAccess();
  const client = getAdminClient();
  const snapshot = await loadFeatureFlagsAdminSnapshot(client);
  return snapshotResponse(snapshot);
}

export async function POST(request: Request): Promise<NextResponse> {
  const identity = await requireCloudflareAccess();
  const client = getAdminClient();
  const actorUserId = await resolveActorId(client, identity.email);
  if (!actorUserId) {
    return NextResponse.json({ error: "Actor user record not found" }, { status: 403 });
  }

  try {
    const body = (await request.json()) as CreateFlagBody;
    const key = normalizeFeatureFlagKey(normalizeRequiredString(body.key, "key"));
    if (!isFeatureFlagKey(key)) {
      throw new ValidationError("key must match ^[a-z0-9][a-z0-9._-]*$");
    }

    const name = normalizeRequiredString(body.name, "name");
    const flagType = normalizeRequiredString(body.flag_type, "flag_type").toLowerCase();
    if (!isFeatureFlagType(flagType)) {
      throw new ValidationError("flag_type is invalid");
    }

    const owner = normalizeRequiredString(body.owner, "owner");
    const environmentConfigs = normalizeEnvironmentConfigs(
      body.environment_configs,
      identity.email,
    );

    const { data: insertedFlag, error: insertError } = await client
      .from("feature_flags")
      .insert({
        flag_key: key,
        name,
        description: normalizeOptionalString(body.description, "description") ?? "",
        flag_type: flagType,
        owner,
        tags: normalizeTags(body.tags),
        expires_at: normalizeExpiresAt(body.expires_at),
      })
      .select("id")
      .single();

    if (insertError || !insertedFlag?.id) {
      return NextResponse.json(
        { error: insertError?.message ?? "Could not create feature flag" },
        { status: insertError?.code === "23505" ? 409 : 500 },
      );
    }

    const configByEnvironment = new Map(
      environmentConfigs.map((config) => [config.environment_key, config]),
    );
    const { error: configError } = await client
      .from("feature_flag_environment_configs")
      .insert(
        FEATURE_FLAG_ENVIRONMENTS.map((environment) => {
          const config = configByEnvironment.get(environment);
          return {
            flag_id: insertedFlag.id,
            environment_key: environment,
            enabled: config?.enabled ?? false,
            payload_json: config?.payload_json ?? null,
            updated_by: config?.updated_by ?? identity.email,
          };
        }),
      );

    if (configError) {
      await client.from("feature_flags").delete().eq("id", insertedFlag.id);
      return NextResponse.json(
        { error: configError.message },
        { status: 500 },
      );
    }

    const snapshot = await loadFeatureFlagsAdminSnapshot(client);
    const createdFlag = getFeatureFlagByKey(snapshot, key);

    await logFlagChangelog({
      client,
      actorUserId,
      action: "create",
      requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
      flagId: String(insertedFlag.id),
      beforeJson: null,
      afterJson: createdFlag,
      metadata: {
        key,
        environments: FEATURE_FLAG_ENVIRONMENTS,
      },
    });

    return snapshotResponse(snapshot, key);
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const identity = await requireCloudflareAccess();
  const client = getAdminClient();
  const actorUserId = await resolveActorId(client, identity.email);
  if (!actorUserId) {
    return NextResponse.json({ error: "Actor user record not found" }, { status: 403 });
  }

  try {
    const body = (await request.json()) as UpdateFlagBody;
    const key = normalizeFeatureFlagKey(normalizeRequiredString(body.key, "key"));
    const beforeSnapshot = await loadFeatureFlagsAdminSnapshot(client);
    const beforeFlag = getFeatureFlagByKey(beforeSnapshot, key);
    if (!beforeFlag) {
      return NextResponse.json({ error: "Feature flag not found" }, { status: 404 });
    }

    const updates: Partial<{
      name: string;
      description: string;
      flag_type: FeatureFlagType;
      owner: string;
      tags: string[];
      expires_at: string | null;
      archived_at: string | null;
    }> = {};
    if (typeof body.name !== "undefined") {
      updates.name = normalizeRequiredString(body.name, "name");
    }
    if (typeof body.description !== "undefined") {
      updates.description = normalizeOptionalString(body.description, "description") ?? "";
    }
    if (typeof body.flag_type !== "undefined") {
      const flagType = normalizeRequiredString(body.flag_type, "flag_type").toLowerCase();
      if (!isFeatureFlagType(flagType)) {
        throw new ValidationError("flag_type is invalid");
      }
      updates.flag_type = flagType;
    }
    if (typeof body.owner !== "undefined") {
      updates.owner = normalizeRequiredString(body.owner, "owner");
    }
    if (typeof body.tags !== "undefined") {
      updates.tags = normalizeTags(body.tags);
    }
    if (typeof body.expires_at !== "undefined") {
      updates.expires_at = normalizeExpiresAt(body.expires_at);
    }
    if (typeof body.archived !== "undefined") {
      updates.archived_at = body.archived ? new Date().toISOString() : null;
    }

    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await client
        .from("feature_flags")
        .update(updates)
        .eq("id", beforeFlag.id);

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
    }

    const environmentConfigs = normalizeEnvironmentConfigs(
      body.environment_configs,
      identity.email,
    );
    if (environmentConfigs.length > 0) {
      const { error: configError } = await client
        .from("feature_flag_environment_configs")
        .upsert(
          environmentConfigs.map((config) => ({
            flag_id: beforeFlag.id,
            environment_key: config.environment_key,
            enabled: config.enabled,
            payload_json: config.payload_json,
            updated_by: config.updated_by,
          })),
          { onConflict: "flag_id,environment_key" },
        );

      if (configError) {
        return NextResponse.json({ error: configError.message }, { status: 500 });
      }
    }

    const afterSnapshot = await loadFeatureFlagsAdminSnapshot(client);
    const afterFlag = getFeatureFlagByKey(afterSnapshot, key);
    const action = typeof body.archived === "boolean"
      ? (body.archived ? "archive" : "restore")
      : "update";

    await logFlagChangelog({
      client,
      actorUserId,
      action,
      requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
      flagId: beforeFlag.id,
      beforeJson: beforeFlag,
      afterJson: afterFlag,
      metadata: {
        key,
        updated_environments: environmentConfigs.map((config) => config.environment_key),
      },
    });

    return snapshotResponse(afterSnapshot, key);
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
