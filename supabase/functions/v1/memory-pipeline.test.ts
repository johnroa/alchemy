import { scheduleMemoryQueueDrain } from "./lib/background-tasks.ts";
import { processMemoryJobs } from "./lib/context-pack.ts";
import { handleMemoryRoutes } from "./routes/memory.ts";

type MemoryJobState = {
  id: string;
  user_id: string;
  chat_id: string;
  message_id: string;
  status: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  interaction_context: Record<string, unknown>;
  locked_at: string | null;
  locked_by: string | null;
  last_error: string | null;
  updated_at: string;
};

type QueryResult = {
  data?: unknown[];
  error: null;
};

const unused = () => {
  throw new Error("unexpected dependency call");
};

const parseJson = async (response: Response): Promise<Record<string, unknown>> => {
  return await response.json() as Record<string, unknown>;
};

class MemoryJobsQueryBuilder implements PromiseLike<QueryResult> {
  private readonly rows: MemoryJobState[];
  private operation: "select" | "update" = "select";
  private selectedColumns: string[] | null = null;
  private limitValue: number | null = null;
  private orderBy:
    | { column: keyof MemoryJobState; ascending: boolean }
    | null = null;
  private readonly filters: Array<(row: MemoryJobState) => boolean> = [];
  private updatePayload: Partial<MemoryJobState> = {};

  constructor(rows: MemoryJobState[]) {
    this.rows = rows;
  }

  select(columns: string): this {
    this.selectedColumns = columns.split(",").map((column) => column.trim());
    return this;
  }

  update(payload: Partial<MemoryJobState>): this {
    this.operation = "update";
    this.updatePayload = payload;
    return this;
  }

  eq(column: keyof MemoryJobState, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  in(column: keyof MemoryJobState, values: unknown[]): this {
    const valueSet = new Set(values);
    this.filters.push((row) => valueSet.has(row[column]));
    return this;
  }

  lt(column: keyof MemoryJobState, value: string): this {
    this.filters.push((row) => String(row[column] ?? "") < value);
    return this;
  }

  lte(column: keyof MemoryJobState, value: string): this {
    this.filters.push((row) => String(row[column] ?? "") <= value);
    return this;
  }

  order(column: keyof MemoryJobState, options?: { ascending?: boolean }): this {
    this.orderBy = { column, ascending: options?.ascending !== false };
    return this;
  }

  limit(value: number): this {
    this.limitValue = value;
    return this;
  }

  maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: null }> {
    const result = this.execute();
    const first = Array.isArray(result.data) && result.data.length > 0
      ? result.data[0] as Record<string, unknown>
      : null;
    return Promise.resolve({ data: first, error: null });
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute(): QueryResult {
    let matched = this.rows.filter((row) => this.filters.every((filter) => filter(row)));

    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      matched = [...matched].sort((left, right) => {
        const leftValue = String(left[column] ?? "");
        const rightValue = String(right[column] ?? "");
        const comparison = leftValue.localeCompare(rightValue);
        return ascending ? comparison : -comparison;
      });
    }

    if (this.limitValue != null) {
      matched = matched.slice(0, this.limitValue);
    }

    if (this.operation === "update") {
      for (const row of matched) {
        Object.assign(row, this.updatePayload);
      }
    }

    const projected = matched.map((row) => this.project(row));
    return { data: projected, error: null };
  }

  private project(row: MemoryJobState): Record<string, unknown> {
    if (!this.selectedColumns || this.selectedColumns.includes("*")) {
      return { ...row };
    }

    const projected: Record<string, unknown> = {};
    for (const column of this.selectedColumns) {
      projected[column] = row[column as keyof MemoryJobState];
    }
    return projected;
  }
}

const createMemoryJobServiceClient = (rows: MemoryJobState[]) => ({
  from(table: string) {
    if (table !== "memory_jobs") {
      throw new Error(`unexpected table ${table}`);
    }
    return new MemoryJobsQueryBuilder(rows);
  },
});

const createMemoryRouteContext = (input: {
  path: string;
  method: string;
  body?: unknown;
}) => {
  const url = new URL(`https://api.cookwithalchemy.com/v1${input.path}`);
  const request = new Request(url, {
    method: input.method,
    headers: { "content-type": "application/json" },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });

  return {
    request,
    url,
    segments: input.path.split("/").filter(Boolean),
    method: input.method,
    requestId: "request-1",
    auth: {
      userId: "auth-user",
      authHeader: "Bearer test-token",
      email: null,
      fullName: null,
      avatarUrl: null,
    },
    client: {},
    serviceClient: {},
    respond(status: number, body: unknown) {
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    },
  };
};

Deno.test("scheduleMemoryQueueDrain clamps the limit and swallows worker failures", async () => {
  let observedLimit = 0;
  let waitedTask: Promise<void> | null = null;
  const originalRuntime = (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime;
  const originalConsoleError = console.error;
  const consoleCalls: unknown[] = [];
  console.error = (...args: unknown[]) => {
    consoleCalls.push(args);
  };
  (globalThis as { EdgeRuntime?: { waitUntil: (task: Promise<void>) => void } }).EdgeRuntime = {
    waitUntil(task: Promise<void>) {
      waitedTask = task;
    },
  };

  try {
    scheduleMemoryQueueDrain({
      serviceClient: {} as never,
      actorUserId: "user-1",
      requestId: "request-1",
      limit: 999,
      processor: async (input) => {
        observedLimit = input.limit;
        throw new Error("boom");
      },
    });

    if (!(waitedTask instanceof Promise)) {
      throw new Error("expected background waitUntil task");
    }

    await waitedTask;

    if (observedLimit !== 10) {
      throw new Error(`expected clamped limit 10, received ${observedLimit}`);
    }
    if (consoleCalls.length !== 1) {
      throw new Error("expected one logged background failure");
    }
  } finally {
    console.error = originalConsoleError;
    if (originalRuntime === undefined) {
      delete (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime;
    } else {
      (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime = originalRuntime;
    }
  }
});

Deno.test("processMemoryJobs requeues stale work and retries failed jobs without leaking locks", async () => {
  const now = Date.now();
  const rows: MemoryJobState[] = [
    {
      id: "job-stale",
      user_id: "user-1",
      chat_id: "chat-1",
      message_id: "message-1",
      status: "processing",
      attempts: 0,
      max_attempts: 5,
      next_attempt_at: new Date(now - 60_000).toISOString(),
      interaction_context: {},
      locked_at: new Date(now - (10 * 60_000)).toISOString(),
      locked_by: "worker-old",
      last_error: null,
      updated_at: new Date(now - (10 * 60_000)).toISOString(),
    },
    {
      id: "job-failed",
      user_id: "user-2",
      chat_id: "chat-2",
      message_id: "message-2",
      status: "failed",
      attempts: 1,
      max_attempts: 4,
      next_attempt_at: new Date(now - 1_000).toISOString(),
      interaction_context: { prompt: "remember lemons" },
      locked_at: null,
      locked_by: null,
      last_error: "timeout",
      updated_at: new Date(now - 5_000).toISOString(),
    },
  ];

  const serviceClient = createMemoryJobServiceClient(rows);
  const processedUserIds: string[] = [];

  const result = await processMemoryJobs({
    serviceClient: serviceClient as never,
    actorUserId: "admin-user",
    requestId: "request-2",
    limit: 5,
    processInteraction: async (input) => {
      processedUserIds.push(input.userId);
      throw new Error("extract failed");
    },
  });

  const processedSet = new Set(processedUserIds);
  if (processedSet.size !== 2 || !processedSet.has("user-1") || !processedSet.has("user-2")) {
    throw new Error(`expected stale and failed jobs to be processed, received ${processedUserIds.join(",")}`);
  }
  if (result.processed !== 2 || result.failed !== 2 || result.succeeded !== 0) {
    throw new Error(`unexpected process summary ${JSON.stringify(result)}`);
  }
  if (result.queue.pending !== 2 || result.queue.processing !== 0 || result.queue.ready !== 0 || result.queue.failed !== 0) {
    throw new Error(`unexpected queue summary ${JSON.stringify(result.queue)}`);
  }

  const staleJob = rows.find((row) => row.id === "job-stale");
  const retriedJob = rows.find((row) => row.id === "job-failed");
  if (!staleJob || staleJob.status !== "pending" || staleJob.locked_at !== null || staleJob.locked_by !== null || staleJob.attempts !== 1) {
    throw new Error("expected stale job to be requeued and unlocked");
  }
  if (!retriedJob || retriedJob.status !== "pending" || retriedJob.attempts !== 2) {
    throw new Error("expected failed job to be retried with incremented attempts");
  }
  if (retriedJob.locked_at !== null || retriedJob.locked_by !== null) {
    throw new Error("expected retried job lock to be cleared");
  }
  if (!retriedJob.last_error?.includes("extract failed")) {
    throw new Error("expected failed job error to be persisted");
  }
});

Deno.test("POST /memory-search/backfill defaults to missing_only and logs the action", async () => {
  let backfillInput: Record<string, unknown> | null = null;
  let changelogAction = "";

  const response = await handleMemoryRoutes(
    createMemoryRouteContext({
      path: "/memory-search/backfill",
      method: "POST",
      body: { user_id: "user-2", limit: 999 },
    }) as never,
    {
      getActiveMemories: unused,
      getMemorySnapshot: unused,
      getLimit: unused,
      parseUuid: (value: string) => value,
      logChangelog: async (input) => {
        changelogAction = input.action;
      },
      processMemoryJobs: unused,
      backfillMemorySearchDocuments: async (input) => {
        backfillInput = input as unknown as Record<string, unknown>;
        return { scanned: 10, indexed: 6, missing: 4, users: 2 };
      },
      rebuildUserMemoryArtifacts: unused,
    } as never,
  );

  if (!response || response.status !== 200) {
    throw new Error("expected memory-search/backfill response");
  }

  const body = await parseJson(response);
  if (body.indexed !== 6 || changelogAction !== "backfill") {
    throw new Error(`unexpected backfill response ${JSON.stringify(body)}`);
  }
  if (!backfillInput || backfillInput.userId !== "user-2" || backfillInput.missingOnly !== true || backfillInput.limit !== 200) {
    throw new Error(`unexpected backfill input ${JSON.stringify(backfillInput)}`);
  }
});

Deno.test("POST /memory-search/rebuild defaults to the authenticated user", async () => {
  let rebuildInput: Record<string, unknown> | null = null;

  const response = await handleMemoryRoutes(
    createMemoryRouteContext({
      path: "/memory-search/rebuild",
      method: "POST",
      body: {},
    }) as never,
    {
      getActiveMemories: unused,
      getMemorySnapshot: unused,
      getLimit: unused,
      parseUuid: (value: string) => value,
      logChangelog: async () => undefined,
      processMemoryJobs: unused,
      backfillMemorySearchDocuments: unused,
      rebuildUserMemoryArtifacts: async (input) => {
        rebuildInput = input as unknown as Record<string, unknown>;
        return {
          active_memory_count: 12,
          indexed: 12,
          removed: 1,
          token_estimate: 321,
        };
      },
    } as never,
  );

  if (!response || response.status !== 200) {
    throw new Error("expected memory-search/rebuild response");
  }

  const body = await parseJson(response);
  if (body.user_id !== "auth-user" || body.token_estimate !== 321) {
    throw new Error(`unexpected rebuild response ${JSON.stringify(body)}`);
  }
  if (!rebuildInput || rebuildInput.userId !== "auth-user") {
    throw new Error(`unexpected rebuild input ${JSON.stringify(rebuildInput)}`);
  }
});
