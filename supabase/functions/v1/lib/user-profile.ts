import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../../_shared/errors.ts";
import type { JsonValue, MemoryRecord } from "../../_shared/types.ts";

export const ensureUserProfile = async (
  client: SupabaseClient,
  params: {
    userId: string;
    email?: string | null;
    fullName?: string | null;
    avatarUrl?: string | null;
  },
): Promise<void> => {
  // Insert-once path for request hot loops; avoid rewriting the user row on every API call.
  const { error } = await client.from("users").upsert(
    {
      id: params.userId,
      email: params.email ?? null,
      full_name: params.fullName ?? null,
      avatar_url: params.avatarUrl ?? null,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "id",
      ignoreDuplicates: true,
    },
  );
  if (error) {
    throw new ApiError(
      500,
      "user_profile_upsert_failed",
      "Could not ensure user profile",
      error.message,
    );
  }
};

export const getMemorySnapshot = async (
  client: SupabaseClient,
  userId: string,
): Promise<Record<string, JsonValue>> => {
  const { data, error } = await client
    .from("memory_snapshots")
    .select("summary")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new ApiError(
      500,
      "memory_snapshot_fetch_failed",
      "Could not load memory snapshot",
      error.message,
    );
  }

  if (
    !data || !data.summary || typeof data.summary !== "object" ||
    Array.isArray(data.summary)
  ) {
    return {};
  }

  return data.summary as Record<string, JsonValue>;
};

export const getActiveMemories = async (
  client: SupabaseClient,
  userId: string,
  limit: number,
): Promise<MemoryRecord[]> => {
  const preferred = await client
    .from("memories")
    .select(
      "id,memory_type,memory_kind,memory_content,confidence,salience,status,source,created_at,updated_at",
    )
    .eq("user_id", userId)
    .eq("status", "active")
    .order("salience", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (preferred.error) {
    throw new ApiError(
      500,
      "memory_fetch_failed",
      "Could not load user memories",
      preferred.error.message,
    );
  }

  return (preferred.data ?? []) as MemoryRecord[];
};

export const logChangelog = async (params: {
  serviceClient: SupabaseClient;
  actorUserId: string;
  scope: string;
  entityType: string;
  entityId?: string;
  action: string;
  requestId: string;
  beforeJson?: JsonValue;
  afterJson?: JsonValue;
  metadata?: Record<string, JsonValue>;
}): Promise<void> => {
  const { error } = await params.serviceClient.rpc("log_changelog_event", {
    p_actor_user_id: params.actorUserId,
    p_scope: params.scope,
    p_entity_type: params.entityType,
    p_entity_id: params.entityId ?? null,
    p_action: params.action,
    p_request_id: params.requestId,
    p_before_json: params.beforeJson ?? null,
    p_after_json: params.afterJson ?? null,
    p_metadata: params.metadata ?? {},
  });

  if (error) {
    console.error("changelog_log_failed", error);
  }
};

export const resolveRelationTypeId = async (
  client: SupabaseClient,
  name: string,
): Promise<string> => {
  const normalizedName = name.trim().toLowerCase();

  const { data: existing, error: existingError } = await client
    .from("graph_relation_types")
    .select("id")
    .eq("name", normalizedName)
    .maybeSingle();

  if (existingError) {
    throw new ApiError(
      500,
      "relation_type_lookup_failed",
      "Could not lookup relation type",
      existingError.message,
    );
  }

  if (existing?.id) {
    return existing.id;
  }

  const { data: inserted, error: insertError } = await client
    .from("graph_relation_types")
    .insert({
      name: normalizedName,
      description: `Attached recipe relation: ${normalizedName}`,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    throw new ApiError(
      500,
      "relation_type_create_failed",
      "Could not create relation type",
      insertError?.message,
    );
  }

  return inserted.id;
};
