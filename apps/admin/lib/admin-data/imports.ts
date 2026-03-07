import { getAdminClient } from "@/lib/supabase-admin";
import { isSchemaMissingError } from "./shared";

export type ImportProvenanceRow = {
  id: string;
  user_id: string;
  source_kind: string;
  source_url: string | null;
  source_origin: string | null;
  extraction_strategy: string | null;
  extraction_confidence: number | null;
  status: string;
  error_code: string | null;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type ImportEventRow = {
  id: string;
  event_type: string;
  request_id: string;
  event_payload: Record<string, unknown>;
  created_at: string;
};

export type ImportData = {
  totalImports: number;
  completedImports: number;
  failedImports: number;
  successRate: number;
  avgExtractLatencyMs: number;
  avgTransformLatencyMs: number;
  avgTotalLatencyMs: number;
  cacheHitCount: number;
  cacheHitRate: number;
  byKind: { kind: string; count: number }[];
  byStrategy: { kind: string; count: number }[];
  byOrigin: { kind: string; count: number }[];
  recentImports: ImportProvenanceRow[];
  recentFailures: ImportProvenanceRow[];
  importEvents: ImportEventRow[];
};

/**
 * Aggregates import telemetry data from import_provenance and events tables.
 * Gracefully handles missing tables (pre-migration state) by returning zeros.
 */
export const getImportData = async (): Promise<ImportData> => {
  const client = getAdminClient();

  let provenanceRows: ImportProvenanceRow[] = [];
  let eventRows: ImportEventRow[] = [];

  try {
    const [provenanceResult, eventsResult] = await Promise.all([
      client
        .from("import_provenance")
        .select("id,user_id,source_kind,source_url,source_origin,extraction_strategy,extraction_confidence,status,error_code,error_message,metadata,created_at")
        .order("created_at", { ascending: false })
        .limit(200),
      client
        .from("events")
        .select("id,event_type,request_id,event_payload,created_at")
        .eq("event_type", "import_completed")
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

    if (provenanceResult.error && !isSchemaMissingError(provenanceResult.error)) {
      throw provenanceResult.error;
    }
    if (eventsResult.error && !isSchemaMissingError(eventsResult.error)) {
      throw eventsResult.error;
    }

    provenanceRows = (provenanceResult.data ?? []) as ImportProvenanceRow[];
    eventRows = (eventsResult.data ?? []) as ImportEventRow[];
  } catch (err) {
    if (isSchemaMissingError(err)) {
      return emptyImportData();
    }
    throw err;
  }

  const totalImports = provenanceRows.length;
  const completedImports = provenanceRows.filter((r) => r.status === "completed").length;
  const failedImports = provenanceRows.filter((r) => r.status === "failed").length;
  const successRate = totalImports > 0 ? completedImports / totalImports : 0;

  // Latency averages from events
  let totalExtract = 0, totalTransform = 0, totalLatency = 0, latencyCount = 0;
  let cacheHitCount = 0;
  for (const evt of eventRows) {
    const p = evt.event_payload ?? {};
    if (typeof p["extract_latency_ms"] === "number") totalExtract += p["extract_latency_ms"];
    if (typeof p["transform_latency_ms"] === "number") totalTransform += p["transform_latency_ms"];
    if (typeof p["total_latency_ms"] === "number") {
      totalLatency += p["total_latency_ms"];
      latencyCount++;
    }
    if (p["fingerprint_cache_hit"] === true) cacheHitCount++;
  }

  const avgExtractLatencyMs = latencyCount > 0 ? Math.round(totalExtract / latencyCount) : 0;
  const avgTransformLatencyMs = latencyCount > 0 ? Math.round(totalTransform / latencyCount) : 0;
  const avgTotalLatencyMs = latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0;
  const cacheHitRate = eventRows.length > 0 ? cacheHitCount / eventRows.length : 0;

  // Breakdowns
  const byKind = groupAndCount(provenanceRows, (r) => r.source_kind);
  const byStrategy = groupAndCount(
    provenanceRows.filter((r) => r.extraction_strategy),
    (r) => r.extraction_strategy ?? "unknown",
  );
  const byOrigin = groupAndCount(provenanceRows, (r) => r.source_origin ?? "unknown");

  const recentFailures = provenanceRows
    .filter((r) => r.status === "failed")
    .slice(0, 20);

  return {
    totalImports,
    completedImports,
    failedImports,
    successRate,
    avgExtractLatencyMs,
    avgTransformLatencyMs,
    avgTotalLatencyMs,
    cacheHitCount,
    cacheHitRate,
    byKind,
    byStrategy,
    byOrigin,
    recentImports: provenanceRows.slice(0, 50),
    recentFailures,
    importEvents: eventRows,
  };
};

function groupAndCount<T>(
  rows: T[],
  keyFn: (row: T) => string,
): { kind: string; count: number }[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = keyFn(row);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count);
}

function emptyImportData(): ImportData {
  return {
    totalImports: 0,
    completedImports: 0,
    failedImports: 0,
    successRate: 0,
    avgExtractLatencyMs: 0,
    avgTransformLatencyMs: 0,
    avgTotalLatencyMs: 0,
    cacheHitCount: 0,
    cacheHitRate: 0,
    byKind: [],
    byStrategy: [],
    byOrigin: [],
    recentImports: [],
    recentFailures: [],
    importEvents: [],
  };
}
