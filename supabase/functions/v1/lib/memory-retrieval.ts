import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../../_shared/errors.ts";
import { llmGateway } from "../../_shared/llm-gateway.ts";
import type { JsonValue, MemoryRecord } from "../../_shared/types.ts";

type MemorySearchSourceRecord = MemoryRecord & {
  user_id: string;
};

type HybridMemoryRpcRow = {
  memory_id: string;
  user_id: string;
  memory_type: string;
  memory_kind: string;
  memory_content: JsonValue;
  confidence: number;
  salience: number;
  status: string;
  source: string | null;
  created_at: string | null;
  updated_at: string | null;
  indexed_at: string | null;
  hybrid_score: number | null;
  fts_rank: number | null;
  semantic_distance: number | null;
};

const ACTIVE_MEMORY_SELECT =
  "id,user_id,memory_type,memory_kind,memory_content,confidence,salience,status,source,created_at,updated_at";

const MAX_QUERY_CONTEXT_CHARS = 1_800;

const normalizeScalarText = (value: unknown): string | null => {
  if (typeof value === "string") {
    const normalized = value.trim().replace(/\s+/g, " ");
    return normalized.length > 0 ? normalized : null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return null;
};

const appendJsonText = (
  value: JsonValue,
  out: string[],
  prefix = "",
): void => {
  const scalar = normalizeScalarText(value);
  if (scalar) {
    out.push(prefix ? `${prefix}: ${scalar}` : scalar);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      appendJsonText(item, out, prefix);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    const nextPrefix = prefix ? `${prefix} ${key}` : key;
    appendJsonText(entry, out, nextPrefix);
  }
};

const clampScore = (value: unknown, fallback = 0.5): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, numeric));
};

const serializeVector = (vector: number[]): string => {
  return `[${vector.map((value) => Number(value).toFixed(12)).join(",")}]`;
};

const normalizeMemorySearchSource = (
  row: Record<string, unknown>,
): MemorySearchSourceRecord => {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    memory_type: String(row.memory_type ?? ""),
    memory_kind: String(row.memory_kind ?? "preference"),
    memory_content: (row.memory_content ?? {}) as JsonValue,
    confidence: clampScore(row.confidence),
    salience: clampScore(row.salience),
    status: String(row.status ?? "active"),
    source: typeof row.source === "string" ? row.source : undefined,
    created_at: typeof row.created_at === "string" ? row.created_at : undefined,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : undefined,
  };
};

export const buildMemoryRetrievalText = (
  memory: Pick<
    MemorySearchSourceRecord,
    "memory_type" | "memory_kind" | "memory_content" | "source"
  >,
): string => {
  const segments = [
    `type: ${memory.memory_type}`,
    `kind: ${memory.memory_kind}`,
  ];

  if (memory.source) {
    segments.push(`source: ${memory.source}`);
  }

  appendJsonText(memory.memory_content, segments, "memory");

  return segments
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join("\n")
    .slice(0, 4_000);
};

export const buildMemoryRetrievalQueryText = (params: {
  prompt: string;
  context: Record<string, JsonValue>;
}): string => {
  const segments: string[] = [];
  const normalizedPrompt = normalizeScalarText(params.prompt);
  if (normalizedPrompt) {
    segments.push(`prompt: ${normalizedPrompt}`);
  }
  appendJsonText(params.context as JsonValue, segments, "context");
  return segments
    .join("\n")
    .slice(0, MAX_QUERY_CONTEXT_CHARS);
};

const fetchActiveMemorySourceRows = async (params: {
  serviceClient: SupabaseClient;
  userId?: string;
  limit: number;
}): Promise<MemorySearchSourceRecord[]> => {
  let query = params.serviceClient
    .from("memories")
    .select(ACTIVE_MEMORY_SELECT)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(Math.max(1, Math.min(params.limit, 5_000)));

  if (params.userId) {
    query = query.eq("user_id", params.userId);
  }

  const { data, error } = await query;
  if (error) {
    throw new ApiError(
      500,
      "memory_backfill_fetch_failed",
      "Could not load memories for retrieval backfill",
      error.message,
    );
  }

  return (data ?? []).map((row) =>
    normalizeMemorySearchSource(row as Record<string, unknown>)
  );
};

const fetchActiveMemoryRowsByIds = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  memoryIds: string[];
}): Promise<MemorySearchSourceRecord[]> => {
  if (params.memoryIds.length === 0) {
    return [];
  }

  const { data, error } = await params.serviceClient
    .from("memories")
    .select(ACTIVE_MEMORY_SELECT)
    .eq("user_id", params.userId)
    .eq("status", "active")
    .in("id", params.memoryIds);

  if (error) {
    throw new ApiError(
      500,
      "memory_fetch_by_id_failed",
      "Could not load memories by id",
      error.message,
    );
  }

  const rowById = new Map(
    (data ?? []).map((row) => {
      const normalized = normalizeMemorySearchSource(row as Record<string, unknown>);
      return [normalized.id, normalized];
    }),
  );

  return params.memoryIds
    .map((id) => rowById.get(id))
    .filter((row): row is MemorySearchSourceRecord => Boolean(row));
};

export const removeMemorySearchDocuments = async (params: {
  serviceClient: SupabaseClient;
  memoryIds: string[];
}): Promise<number> => {
  const memoryIds = Array.from(
    new Set(params.memoryIds.filter((id) => typeof id === "string" && id.length > 0)),
  );
  if (memoryIds.length === 0) {
    return 0;
  }

  const { error } = await params.serviceClient
    .from("memory_search_documents")
    .delete()
    .in("memory_id", memoryIds);

  if (error) {
    throw new ApiError(
      500,
      "memory_search_delete_failed",
      "Could not remove memory retrieval documents",
      error.message,
    );
  }

  return memoryIds.length;
};

export const syncMemorySearchDocuments = async (params: {
  serviceClient: SupabaseClient;
  requestId: string;
  memories: MemorySearchSourceRecord[];
}): Promise<{
  indexed: number;
}> => {
  const activeMemories = params.memories.filter((memory) =>
    memory.status === "active"
  );
  if (activeMemories.length === 0) {
    return { indexed: 0 };
  }

  const nowIso = new Date().toISOString();
  const rows: Array<Record<string, JsonValue | string | number>> = [];

  for (const memory of activeMemories) {
    const retrievalText = buildMemoryRetrievalText(memory);
    if (!retrievalText) {
      continue;
    }

    const embedding = await llmGateway.embedMemoryRetrievalQuery({
      client: params.serviceClient,
      userId: memory.user_id,
      requestId: params.requestId,
      inputText: retrievalText,
    });

    rows.push({
      memory_id: memory.id,
      user_id: memory.user_id,
      memory_type: memory.memory_type,
      memory_kind: memory.memory_kind,
      status: memory.status,
      confidence: memory.confidence,
      salience: memory.salience,
      retrieval_text: retrievalText,
      embedding: serializeVector(embedding.vector),
      indexed_at: nowIso,
      updated_at: nowIso,
    });
  }

  if (rows.length === 0) {
    return { indexed: 0 };
  }

  const { error } = await params.serviceClient
    .from("memory_search_documents")
    .upsert(rows, { onConflict: "memory_id" });

  if (error) {
    throw new ApiError(
      500,
      "memory_search_upsert_failed",
      "Could not upsert memory retrieval documents",
      error.message,
    );
  }

  return { indexed: rows.length };
};

export const retrieveRelevantMemories = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  prompt: string;
  context: Record<string, JsonValue>;
  limit: number;
}): Promise<MemoryRecord[]> => {
  const queryText = buildMemoryRetrievalQueryText({
    prompt: params.prompt,
    context: params.context,
  });

  if (!queryText) {
    return [];
  }

  const embedding = await llmGateway.embedMemoryRetrievalQuery({
    client: params.serviceClient,
    userId: params.userId,
    requestId: params.requestId,
    inputText: queryText,
  });

  const { data, error } = await params.serviceClient.rpc(
    "hybrid_search_memories",
    {
      p_user_id: params.userId,
      p_query_text: queryText,
      p_query_embedding: serializeVector(embedding.vector),
      p_limit: Math.max(1, Math.min(params.limit, 36)),
    },
  );

  if (error) {
    throw new ApiError(
      500,
      "memory_hybrid_search_failed",
      "Could not retrieve relevant memories",
      error.message,
    );
  }

  const seen = new Set<string>();
  const items: MemoryRecord[] = [];
  for (const raw of Array.isArray(data) ? data as HybridMemoryRpcRow[] : []) {
    if (seen.has(raw.memory_id)) {
      continue;
    }
    seen.add(raw.memory_id);
    items.push({
      id: raw.memory_id,
      memory_type: raw.memory_type,
      memory_kind: raw.memory_kind,
      memory_content: raw.memory_content,
      confidence: clampScore(raw.confidence),
      salience: clampScore(raw.salience),
      status: raw.status,
      source: raw.source ?? undefined,
      created_at: raw.created_at ?? undefined,
      updated_at: raw.updated_at ?? undefined,
    });
  }

  return items;
};

export const backfillMemorySearchDocuments = async (params: {
  serviceClient: SupabaseClient;
  requestId: string;
  userId?: string;
  limit: number;
  missingOnly?: boolean;
}): Promise<{
  scanned: number;
  indexed: number;
  missing: number;
  users: number;
}> => {
  const memories = await fetchActiveMemorySourceRows({
    serviceClient: params.serviceClient,
    userId: params.userId,
    limit: params.limit,
  });

  if (memories.length === 0) {
    return { scanned: 0, indexed: 0, missing: 0, users: 0 };
  }

  let targetMemories = memories;
  if (params.missingOnly !== false) {
    const memoryIds = memories.map((memory) => memory.id);
    const { data, error } = await params.serviceClient
      .from("memory_search_documents")
      .select("memory_id")
      .in("memory_id", memoryIds);

    if (error) {
      throw new ApiError(
        500,
        "memory_search_existing_fetch_failed",
        "Could not load existing memory retrieval documents",
        error.message,
      );
    }

    const existingIds = new Set((data ?? []).map((row) => String(row.memory_id)));
    targetMemories = memories.filter((memory) => !existingIds.has(memory.id));
  }

  const { indexed } = await syncMemorySearchDocuments({
    serviceClient: params.serviceClient,
    requestId: params.requestId,
    memories: targetMemories,
  });

  return {
    scanned: memories.length,
    indexed,
    missing: targetMemories.length,
    users: new Set(targetMemories.map((memory) => memory.user_id)).size,
  };
};

export const rebuildUserMemoryArtifacts = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
}): Promise<{
  active_memory_count: number;
  indexed: number;
  removed: number;
  token_estimate: number;
}> => {
  const memories = await fetchActiveMemorySourceRows({
    serviceClient: params.serviceClient,
    userId: params.userId,
    limit: 5_000,
  });

  const memoryIds = new Set(memories.map((memory) => memory.id));
  const { data: existingDocs, error: existingDocsError } = await params
    .serviceClient
    .from("memory_search_documents")
    .select("memory_id")
    .eq("user_id", params.userId);

  if (existingDocsError) {
    throw new ApiError(
      500,
      "memory_rebuild_existing_docs_failed",
      "Could not load existing memory retrieval documents",
      existingDocsError.message,
    );
  }

  const docsToRemove = (existingDocs ?? [])
    .map((row) => String(row.memory_id))
    .filter((memoryId) => !memoryIds.has(memoryId));

  const { indexed } = await syncMemorySearchDocuments({
    serviceClient: params.serviceClient,
    requestId: params.requestId,
    memories,
  });
  const removed = await removeMemorySearchDocuments({
    serviceClient: params.serviceClient,
    memoryIds: docsToRemove,
  });

  const memorySummary = memories.length === 0
    ? { summary: {}, token_estimate: 0 }
    : await llmGateway.summarizeMemories({
      client: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      memories: memories.map((memory) => ({
        id: memory.id,
        memory_type: memory.memory_type,
        memory_kind: memory.memory_kind,
        memory_content: memory.memory_content,
        confidence: memory.confidence,
        salience: memory.salience,
        status: memory.status,
        source: memory.source,
        created_at: memory.created_at,
        updated_at: memory.updated_at,
      })),
      context: {
        source: "admin_rebuild",
      },
    });

  const { error: snapshotError } = await params.serviceClient
    .from("memory_snapshots")
    .upsert({
      user_id: params.userId,
      summary: memorySummary.summary,
      token_estimate: Number(memorySummary.token_estimate ?? 0),
      updated_at: new Date().toISOString(),
    });

  if (snapshotError) {
    throw new ApiError(
      500,
      "memory_rebuild_snapshot_failed",
      "Could not rebuild the memory snapshot",
      snapshotError.message,
    );
  }

  return {
    active_memory_count: memories.length,
    indexed,
    removed,
    token_estimate: Number(memorySummary.token_estimate ?? 0),
  };
};

export const refreshMemorySearchDocumentsForUser = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  memoryIds: string[];
}): Promise<{
  indexed: number;
  removed: number;
}> => {
  const uniqueMemoryIds = Array.from(
    new Set(params.memoryIds.filter((memoryId) => memoryId.length > 0)),
  );

  const activeMemories = await fetchActiveMemoryRowsByIds({
    serviceClient: params.serviceClient,
    userId: params.userId,
    memoryIds: uniqueMemoryIds,
  });

  const activeIds = new Set(activeMemories.map((memory) => memory.id));
  const removed = await removeMemorySearchDocuments({
    serviceClient: params.serviceClient,
    memoryIds: uniqueMemoryIds.filter((memoryId) => !activeIds.has(memoryId)),
  });
  const { indexed } = await syncMemorySearchDocuments({
    serviceClient: params.serviceClient,
    requestId: params.requestId,
    memories: activeMemories,
  });

  return { indexed, removed };
};
