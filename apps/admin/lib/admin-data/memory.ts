import { getAdminClient } from "@/lib/supabase-admin";
import { isSchemaMissingError } from "./shared";

type MemorySnapshotRow = {
  user_id: string;
  token_estimate: number;
  updated_at: string;
};

type MemoryRow = {
  id: string;
  user_id: string;
  memory_type: string;
  memory_kind: string;
  status: string;
  confidence: number;
  salience: number;
  memory_content: unknown;
  updated_at: string;
};

type MemoryJobRow = {
  id: string;
  user_id: string;
  chat_id: string;
  message_id: string;
  status: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  locked_at: string | null;
  locked_by: string | null;
  updated_at: string;
};

type MemorySearchDocRow = {
  memory_id: string;
  user_id: string;
  indexed_at: string;
  updated_at: string;
};

type MemoryChangelogRow = {
  action: string;
  created_at: string;
};

type CountQueryResult = {
  count: number | null;
  error: { message: string } | null;
};

const HOURS_OF_ACTIVITY = 8;

const stringifyContent = (value: unknown): string | null => {
  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const buildActivityBuckets = (
  jobs: MemoryJobRow[],
): Array<{ label: string; processed: number; failed: number }> => {
  const buckets = Array.from({ length: HOURS_OF_ACTIVITY }, (_, index) => {
    const start = new Date();
    start.setMinutes(0, 0, 0);
    start.setHours(start.getHours() - (HOURS_OF_ACTIVITY - index - 1));
    const end = new Date(start);
    end.setHours(end.getHours() + 1);
    return {
      label: start.toLocaleTimeString([], { hour: "numeric" }),
      startMs: start.getTime(),
      endMs: end.getTime(),
      processed: 0,
      failed: 0,
    };
  });

  for (const job of jobs) {
    const updatedMs = Date.parse(job.updated_at);
    if (!Number.isFinite(updatedMs)) {
      continue;
    }
    const bucket = buckets.find((entry) =>
      updatedMs >= entry.startMs && updatedMs < entry.endMs
    );
    if (!bucket) {
      continue;
    }
    if (job.status === "ready") {
      bucket.processed += 1;
    }
    if (job.status === "failed") {
      bucket.failed += 1;
    }
  }

  return buckets.map(({ label, processed, failed }) => ({
    label,
    processed,
    failed,
  }));
};

export type MemoryOperationsData = {
  summary: {
    queue: {
      pending: number;
      processing: number;
      ready: number;
      failed: number;
      oldest_due_job_at: string | null;
      stale_locked_jobs: number;
      recent_activity: Array<{ label: string; processed: number; failed: number }>;
    };
    retrieval: {
      active_memory_count: number;
      indexed_document_count: number;
      missing_document_count: number;
      coverage_percent: number;
      affected_user_count: number;
      last_reindex_at: string | null;
    };
  };
  users: Array<{
    user_id: string;
    email: string | null;
    active_memory_count: number;
    indexed_document_count: number;
    missing_document_count: number;
    snapshot_token_estimate: number;
    snapshot_updated_at: string | null;
    pending_job_count: number;
    failed_job_count: number;
  }>;
  snapshots: Array<{ user_id: string; email: string | null; token_estimate: number; updated_at: string }>;
  memories: Array<{
    id: string;
    user_id: string;
    email: string | null;
    memory_type: string;
    memory_kind: string;
    status: string;
    confidence: number;
    salience: number;
    content: string | null;
    retrieval_indexed_at: string | null;
    retrieval_status: "indexed" | "missing";
    updated_at: string;
  }>;
  jobs: Array<{
    id: string;
    user_id: string;
    user_email: string | null;
    chat_id: string;
    message_id: string;
    status: string;
    attempts: number;
    max_attempts: number;
    next_attempt_at: string;
    last_error: string | null;
    locked_at: string | null;
    locked_by: string | null;
    updated_at: string;
  }>;
};

export const buildMemoryOperationsViewModel = (params: {
  snapshots: MemorySnapshotRow[];
  memories: MemoryRow[];
  jobs: MemoryJobRow[];
  searchDocs: MemorySearchDocRow[];
  changelog: MemoryChangelogRow[];
  users: Array<{ id: string; email: string | null }>;
  counts: {
    pending: number;
    processing: number;
    ready: number;
    failed: number;
    staleLockedJobs: number;
    activeMemoryCount: number;
    indexedDocumentCount: number;
  };
  oldestDueJobAt: string | null;
}): MemoryOperationsData => {
  const emailByUserId = new Map(
    params.users.map((user) => [String(user.id), user.email as string | null]),
  );
  const retrievalDocByMemoryId = new Map(
    params.searchDocs.map((doc) => [String(doc.memory_id), doc]),
  );

  const perUser = new Map<string, {
    user_id: string;
    email: string | null;
    active_memory_count: number;
    indexed_document_count: number;
    missing_document_count: number;
    snapshot_token_estimate: number;
    snapshot_updated_at: string | null;
    pending_job_count: number;
    failed_job_count: number;
  }>();

  const ensureUserRow = (userId: string) => {
    const existing = perUser.get(userId);
    if (existing) {
      return existing;
    }

    const next = {
      user_id: userId,
      email: emailByUserId.get(userId) ?? null,
      active_memory_count: 0,
      indexed_document_count: 0,
      missing_document_count: 0,
      snapshot_token_estimate: 0,
      snapshot_updated_at: null as string | null,
      pending_job_count: 0,
      failed_job_count: 0,
    };
    perUser.set(userId, next);
    return next;
  };

  for (const snapshot of params.snapshots) {
    const row = ensureUserRow(snapshot.user_id);
    row.snapshot_token_estimate = Number(snapshot.token_estimate ?? 0);
    row.snapshot_updated_at = snapshot.updated_at;
  }
  for (const memory of params.memories) {
    if (memory.status !== "active") {
      continue;
    }
    const row = ensureUserRow(memory.user_id);
    row.active_memory_count += 1;
    if (!retrievalDocByMemoryId.has(memory.id)) {
      row.missing_document_count += 1;
    }
  }
  for (const doc of params.searchDocs) {
    const row = ensureUserRow(doc.user_id);
    row.indexed_document_count += 1;
  }
  for (const job of params.jobs) {
    const row = ensureUserRow(job.user_id);
    if (job.status === "pending") {
      row.pending_job_count += 1;
    }
    if (job.status === "failed") {
      row.failed_job_count += 1;
    }
  }

  const affectedUserCount = Array.from(perUser.values())
    .filter((row) => row.missing_document_count > 0)
    .length;
  const missingDocumentCount = Math.max(
    0,
    params.counts.activeMemoryCount - params.counts.indexedDocumentCount,
  );

  return {
    summary: {
      queue: {
        pending: params.counts.pending,
        processing: params.counts.processing,
        ready: params.counts.ready,
        failed: params.counts.failed,
        oldest_due_job_at: params.oldestDueJobAt,
        stale_locked_jobs: params.counts.staleLockedJobs,
        recent_activity: buildActivityBuckets(params.jobs),
      },
      retrieval: {
        active_memory_count: params.counts.activeMemoryCount,
        indexed_document_count: params.counts.indexedDocumentCount,
        missing_document_count: missingDocumentCount,
        coverage_percent: params.counts.activeMemoryCount > 0
          ? Math.round(
            (params.counts.indexedDocumentCount / params.counts.activeMemoryCount) *
              10_000,
          ) / 100
          : 100,
        affected_user_count: affectedUserCount,
        last_reindex_at: params.changelog[0]?.created_at ??
          params.searchDocs[0]?.indexed_at ??
          null,
      },
    },
    users: Array.from(perUser.values())
      .sort((left, right) =>
        (right.pending_job_count + right.failed_job_count + right.missing_document_count) -
        (left.pending_job_count + left.failed_job_count + left.missing_document_count)
      ),
    snapshots: params.snapshots.map((snapshot) => ({
      user_id: String(snapshot.user_id),
      email: emailByUserId.get(String(snapshot.user_id)) ?? null,
      token_estimate: Number(snapshot.token_estimate ?? 0),
      updated_at: String(snapshot.updated_at),
    })),
    memories: params.memories.map((memory) => {
      const retrievalDoc = retrievalDocByMemoryId.get(memory.id);
      return {
        id: String(memory.id),
        user_id: String(memory.user_id),
        email: emailByUserId.get(String(memory.user_id)) ?? null,
        memory_type: String(memory.memory_type ?? ""),
        memory_kind: String(memory.memory_kind ?? ""),
        status: String(memory.status ?? ""),
        confidence: Number(memory.confidence ?? 0),
        salience: Number(memory.salience ?? 0),
        content: stringifyContent(memory.memory_content),
        retrieval_indexed_at: retrievalDoc?.indexed_at ?? null,
        retrieval_status: retrievalDoc ? "indexed" as const : "missing" as const,
        updated_at: String(memory.updated_at),
      };
    }),
    jobs: params.jobs.map((job) => ({
      id: String(job.id),
      user_id: String(job.user_id),
      user_email: emailByUserId.get(String(job.user_id)) ?? null,
      chat_id: String(job.chat_id),
      message_id: String(job.message_id),
      status: String(job.status ?? "pending"),
      attempts: Number(job.attempts ?? 0),
      max_attempts: Number(job.max_attempts ?? 0),
      next_attempt_at: String(job.next_attempt_at),
      last_error: job.last_error ? String(job.last_error) : null,
      locked_at: job.locked_at ? String(job.locked_at) : null,
      locked_by: job.locked_by ? String(job.locked_by) : null,
      updated_at: String(job.updated_at),
    })),
  };
};

const countOrZero = (result: CountQueryResult, schemaMayBeMissing = false): number => {
  if (result.error) {
    if (schemaMayBeMissing && isSchemaMissingError(result.error)) {
      return 0;
    }
    throw new Error(result.error.message);
  }
  return result.count ?? 0;
};

export const getMemoryData = async (): Promise<MemoryOperationsData> => {
  const client = getAdminClient();
  const staleCutoffIso = new Date(Date.now() - (5 * 60 * 1000)).toISOString();

  const [
    { data: snapshots, error: snapshotsError },
    { data: memoriesRaw, error: memoriesError },
    { data: jobsRaw, error: jobsError },
    { data: searchDocsRaw, error: searchDocsError },
    pendingCountResult,
    processingCountResult,
    readyCountResult,
    failedCountResult,
    activeMemoryCountResult,
    indexedDocumentCountResult,
    oldestDueResult,
    staleLockedResult,
    { data: changelogRows, error: changelogError },
  ] = await Promise.all([
    client
      .from("memory_snapshots")
      .select("user_id,token_estimate,updated_at")
      .order("updated_at", { ascending: false })
      .limit(200),
    client
      .from("memories")
      .select("id,user_id,memory_type,memory_kind,status,confidence,salience,memory_content,updated_at")
      .order("updated_at", { ascending: false })
      .limit(1_000),
    client
      .from("memory_jobs")
      .select("id,user_id,chat_id,message_id,status,attempts,max_attempts,next_attempt_at,last_error,locked_at,locked_by,updated_at")
      .order("updated_at", { ascending: false })
      .limit(500),
    client
      .from("memory_search_documents")
      .select("memory_id,user_id,indexed_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(1_000),
    client
      .from("memory_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    client
      .from("memory_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "processing"),
    client
      .from("memory_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "ready"),
    client
      .from("memory_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed"),
    client
      .from("memories")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    client
      .from("memory_search_documents")
      .select("memory_id", { count: "exact", head: true }),
    client
      .from("memory_jobs")
      .select("next_attempt_at")
      .in("status", ["pending", "failed"])
      .order("next_attempt_at", { ascending: true })
      .limit(1),
    client
      .from("memory_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "processing")
      .lt("locked_at", staleCutoffIso),
    client
      .from("changelog_events")
      .select("action,created_at")
      .eq("scope", "memory")
      .in("action", ["backfill", "rebuild_artifacts"])
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const schemaErrors = [
    jobsError,
    searchDocsError,
    changelogError,
  ].filter((error) => error && !isSchemaMissingError(error));
  if (snapshotsError || memoriesError || schemaErrors.length > 0) {
    throw new Error(
      snapshotsError?.message ??
        memoriesError?.message ??
        schemaErrors[0]?.message ??
        "Unable to load memory operations data",
    );
  }

  if (oldestDueResult.error) {
    throw new Error(oldestDueResult.error.message);
  }

  const memories = (memoriesRaw ?? []) as MemoryRow[];
  const jobs = (jobsRaw ?? []) as MemoryJobRow[];
  const searchDocs = isSchemaMissingError(searchDocsError)
    ? [] as MemorySearchDocRow[]
    : (searchDocsRaw ?? []) as MemorySearchDocRow[];
  const snapshotRows = (snapshots ?? []) as MemorySnapshotRow[];
  const changelog = isSchemaMissingError(changelogError)
    ? [] as MemoryChangelogRow[]
    : (changelogRows ?? []) as MemoryChangelogRow[];

  const userIds = Array.from(
    new Set([
      ...snapshotRows.map((snapshot) => snapshot.user_id),
      ...memories.map((memory) => memory.user_id),
      ...jobs.map((job) => job.user_id),
      ...searchDocs.map((doc) => doc.user_id),
    ]),
  );

  const { data: users, error: usersError } =
    userIds.length > 0
      ? await client.from("users").select("id,email").in("id", userIds)
      : { data: [] as Array<{ id: string; email: string | null }>, error: null };

  if (usersError) {
    throw new Error(usersError.message);
  }

  return buildMemoryOperationsViewModel({
    snapshots: snapshotRows,
    memories,
    jobs,
    searchDocs,
    changelog,
    users: (users ?? []) as Array<{ id: string; email: string | null }>,
    counts: {
      pending: countOrZero(pendingCountResult as CountQueryResult),
      processing: countOrZero(processingCountResult as CountQueryResult),
      ready: countOrZero(readyCountResult as CountQueryResult),
      failed: countOrZero(failedCountResult as CountQueryResult),
      staleLockedJobs: countOrZero(staleLockedResult as CountQueryResult),
      activeMemoryCount: countOrZero(activeMemoryCountResult as CountQueryResult),
      indexedDocumentCount: countOrZero(
        indexedDocumentCountResult as CountQueryResult,
        true,
      ),
    },
    oldestDueJobAt: oldestDueResult.data?.[0]?.next_attempt_at
      ? String(oldestDueResult.data[0].next_attempt_at)
      : null,
  });
};
