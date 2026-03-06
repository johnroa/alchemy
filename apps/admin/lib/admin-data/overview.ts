import { getAdminClient, toRecord } from "@/lib/supabase-admin";
import { isSchemaMissingError } from "./shared";

export const getDashboardData = async (): Promise<{
  requestCount: number;
  avgLatencyMs: number;
  totalCostUsd: number;
  safetyIncidentCount: number;
  emptyOutputCount: number;
  imagePendingCount: number;
  imageProcessingCount: number;
  imageReadyCount: number;
  imageFailedCount: number;
  imageTotalCount: number;
  activeMemoryCount: number;
  recentErrors: Array<{ created_at: string; scope: string; reason: string }>;
  recentActivity: Array<{ created_at: string; scope: string; entity_type: string; action: string }>;
}> => {
  const client = getAdminClient();

  const [
    { data: costRows },
    { data: flagsRows },
    { data: emptyOutputRows },
    { data: imageRows },
    { data: memoryRows },
    { data: activityRows }
  ] = await Promise.all([
    client.from("v_llm_cost_latency_rollup").select("request_count,avg_latency_ms,total_cost_usd"),
    client.from("v_abuse_rate_limit_flags").select("created_at,scope,reason").order("created_at", { ascending: false }).limit(8),
    client.from("events").select("id").eq("event_type", "llm_call").contains("event_payload", { error_code: "llm_empty_output" }),
    client.from("image_requests").select("status"),
    client.from("memories").select("status"),
    client.from("changelog_events").select("created_at,scope,entity_type,action").order("created_at", { ascending: false }).limit(10)
  ]);

  const requestCount = (costRows ?? []).reduce((sum, row) => sum + Number(row.request_count ?? 0), 0);
  const weightedLatencySum = (costRows ?? []).reduce((sum, row) => {
    return sum + Number(row.avg_latency_ms ?? 0) * Number(row.request_count ?? 0);
  }, 0);
  const avgLatencyMs = requestCount === 0 ? 0 : Math.round(weightedLatencySum / requestCount);
  const totalCostUsd = (costRows ?? []).reduce((sum, row) => sum + Number(row.total_cost_usd ?? 0), 0);

  let resolvedImageRows = imageRows ?? [];
  if (resolvedImageRows.length === 0) {
    const { data: legacyImageRows, error: legacyError } = await client
      .from("recipe_image_jobs")
      .select("status");
    if (legacyError && !isSchemaMissingError(legacyError)) {
      throw new Error(legacyError.message);
    }
    resolvedImageRows = legacyImageRows ?? [];
  }

  const imagePendingCount = resolvedImageRows.filter((row) => row.status === "pending").length;
  const imageProcessingCount = resolvedImageRows.filter((row) => row.status === "processing").length;
  const imageReadyCount = resolvedImageRows.filter((row) => row.status === "ready").length;
  const imageFailedCount = resolvedImageRows.filter((row) => row.status === "failed").length;
  const imageTotalCount = resolvedImageRows.length;
  const activeMemoryCount = (memoryRows ?? []).filter((row) => row.status === "active").length;

  return {
    requestCount,
    avgLatencyMs,
    totalCostUsd,
    safetyIncidentCount: (flagsRows ?? []).length,
    emptyOutputCount: (emptyOutputRows ?? []).length,
    imagePendingCount,
    imageProcessingCount,
    imageReadyCount,
    imageFailedCount,
    imageTotalCount,
    activeMemoryCount,
    recentErrors: (flagsRows ?? []).map((row) => ({
      created_at: row.created_at as string,
      scope: (row.scope as string) ?? "unknown",
      reason: (row.reason as string) ?? "n/a"
    })),
    recentActivity: (activityRows ?? []).map((row) => ({
      created_at: row.created_at as string,
      scope: String(row.scope ?? "unknown"),
      entity_type: String(row.entity_type ?? "unknown"),
      action: String(row.action ?? "unknown")
    }))
  };
};

export const getUsersData = async (): Promise<Array<{ id: string; email: string | null; status: string; updated_at: string }>> => {
  const client = getAdminClient();
  const { data } = await client.from("users").select("id,email,status,updated_at").order("updated_at", { ascending: false }).limit(100);

  return (data ?? []) as Array<{ id: string; email: string | null; status: string; updated_at: string }>;
};

export const getChangelogData = async (): Promise<{
  items: Array<{
    id: string;
    created_at: string;
    scope: string;
    entity_type: string;
    entity_id: string | null;
    action: string;
    request_id: string | null;
    actor_email: string | null;
  }>;
}> => {
  const client = getAdminClient();
  const { data } = await client
    .from("v_changelog_recent")
    .select("id,created_at,scope,entity_type,entity_id,action,request_id,actor_email")
    .order("created_at", { ascending: false })
    .limit(200);

  return {
    items: (data ?? []) as Array<{
      id: string;
      created_at: string;
      scope: string;
      entity_type: string;
      entity_id: string | null;
      action: string;
      request_id: string | null;
      actor_email: string | null;
    }>
  };
};

export const getRequestTraceData = async (): Promise<{
  events: Array<{ id: string; request_id: string | null; event_type: string; created_at: string; safety_state: string | null; latency_ms: number | null; event_payload: Record<string, unknown> }>;
  changes: Array<{ id: string; request_id: string | null; scope: string; entity_type: string; action: string; created_at: string }>;
}> => {
  const client = getAdminClient();

  const [{ data: events }, { data: changes }] = await Promise.all([
    client
      .from("events")
      .select("id,request_id,event_type,created_at,safety_state,latency_ms,event_payload")
      .order("created_at", { ascending: false })
      .limit(200),
    client
      .from("changelog_events")
      .select("id,request_id,scope,entity_type,action,created_at")
      .order("created_at", { ascending: false })
      .limit(200)
  ]);

  return {
    events: (events ?? []).map((row) => ({
      id: String(row.id),
      request_id: (row.request_id as string | null) ?? null,
      event_type: String(row.event_type ?? ""),
      created_at: String(row.created_at ?? ""),
      safety_state: (row.safety_state as string | null) ?? null,
      latency_ms: row.latency_ms != null ? Number(row.latency_ms) : null,
      event_payload: toRecord(row.event_payload as never) as Record<string, unknown>
    })),
    changes: (changes ?? []) as Array<{ id: string; request_id: string | null; scope: string; entity_type: string; action: string; created_at: string }>
  };
};

export const getVersionCausalityData = async (): Promise<{
  versionEvents: Array<{ id: string; recipe_version_id: string; event_type: string; request_id: string | null; created_at: string }>;
  links: Array<{ id: string; parent_recipe_id: string; child_recipe_id: string; position: number; updated_at: string }>;
}> => {
  const client = getAdminClient();

  const [{ data: versionEvents }, { data: links }] = await Promise.all([
    client
      .from("recipe_version_events")
      .select("id,recipe_version_id,event_type,request_id,created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    client
      .from("recipe_links")
      .select("id,parent_recipe_id,child_recipe_id,position,updated_at")
      .order("updated_at", { ascending: false })
      .limit(200)
  ]);

  return {
    versionEvents: (versionEvents ?? []) as Array<{ id: string; recipe_version_id: string; event_type: string; request_id: string | null; created_at: string }>,
    links: (links ?? []) as Array<{ id: string; parent_recipe_id: string; child_recipe_id: string; position: number; updated_at: string }>
  };
};
