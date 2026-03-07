import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  eventCount: 0,
  eventRows: [] as Array<Record<string, unknown>>,
  eventRanges: [] as Array<[number, number]>,
  routes: [] as Array<Record<string, unknown>>,
  registry: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/supabase-admin", () => {
  type QueryState = {
    table: string;
    options?: { count?: string; head?: boolean };
    range: { from: number; to: number } | null;
  };

  const resolveQuery = (state: QueryState): { data?: unknown[]; count?: number; error: null } => {
    if (state.table === "events") {
      if (state.options?.head) {
        return { count: mockState.eventCount, error: null };
      }

      const from = state.range?.from ?? 0;
      const to = state.range?.to ?? Math.max(0, mockState.eventRows.length - 1);
      mockState.eventRanges.push([from, to]);
      return { data: mockState.eventRows.slice(from, to + 1), error: null };
    }

    if (state.table === "llm_model_routes") {
      return { data: mockState.routes, error: null };
    }

    if (state.table === "llm_model_registry") {
      return { data: mockState.registry, error: null };
    }

    throw new Error(`Unexpected table ${state.table}`);
  };

  class QueryBuilder implements PromiseLike<{ data?: unknown[]; count?: number; error: null }> {
    private readonly state: QueryState;

    constructor(table: string) {
      this.state = {
        table,
        range: null,
      };
    }

    select(_columns: string, options?: { count?: string; head?: boolean }): this {
      this.state.options = options;
      return this;
    }

    eq(_column: string, _value: unknown): this {
      return this;
    }

    gte(_column: string, _value: unknown): this {
      return this;
    }

    order(_column: string, _options?: { ascending?: boolean }): this {
      return this;
    }

    range(from: number, to: number): this {
      this.state.range = { from, to };
      return this;
    }

    then<TResult1 = { data?: unknown[]; count?: number; error: null }, TResult2 = never>(
      onfulfilled?: ((value: { data?: unknown[]; count?: number; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      return Promise.resolve(resolveQuery(this.state)).then(onfulfilled, onrejected);
    }
  }

  return {
    getAdminClient: () => ({
      from: (table: string) => new QueryBuilder(table),
    }),
    toRecord: (value: unknown) => (value && typeof value === "object" ? (value as Record<string, unknown>) : {}),
  };
});

import { getModelUsageData } from "./llm";

describe("getModelUsageData", () => {
  beforeEach(() => {
    mockState.eventCount = 1001;
    mockState.eventRanges = [];
    mockState.routes = [{ scope: "generate", provider: "openai", model: "gpt-4.1", is_active: true }];
    mockState.registry = [{ provider: "openai", model: "gpt-4.1", display_name: "GPT-4.1" }];
    mockState.eventRows = Array.from({ length: 1001 }, (_, index) => ({
      id: `event-${index}`,
      created_at: new Date(Date.now() - index * 60_000).toISOString(),
      token_input: 10,
      token_output: 5,
      token_total: 15,
      cost_usd: 0.001,
      latency_ms: 400,
      event_payload: { scope: "generate" },
    }));
  });

  it("paginates llm_call events beyond the first 1000 rows", async () => {
    const result = await getModelUsageData({ rangeDays: 30 });

    expect(result.totals.calls).toBe(1001);
    expect(result.byAction).toHaveLength(1);
    expect(result.byAction[0]?.calls).toBe(1001);
    expect(result.byModel).toHaveLength(1);
    expect(result.byModel[0]?.calls).toBe(1001);
    expect(mockState.eventRanges).toEqual([
      [0, 999],
      [1000, 1000],
    ]);
  });
});
