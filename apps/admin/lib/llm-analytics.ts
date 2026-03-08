export type ModelUsageActionSort = "total_calls" | "total_tokens" | "total_cost" | "cost_per_call";

export type ModelUsageActionRow = {
  scope: string;
  label: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  avgLatencyMs: number;
  callShare: number;
  tokenShare: number;
};

export const DEFAULT_MODEL_USAGE_ACTION_SORT: ModelUsageActionSort = "total_tokens";

export const MODEL_USAGE_ACTION_SORT_OPTIONS: Array<{ value: ModelUsageActionSort; label: string }> = [
  { value: "total_calls", label: "Calls" },
  { value: "total_tokens", label: "Tokens" },
  { value: "total_cost", label: "Cost" },
  { value: "cost_per_call", label: "Cost / Call" },
];

type SortableActionUsage = Pick<ModelUsageActionRow, "label" | "calls" | "totalTokens" | "costUsd">;

const ACTION_SORT_VALUES = new Set<ModelUsageActionSort>([
  "total_calls",
  "total_tokens",
  "total_cost",
  "cost_per_call",
]);

export const parseModelUsageActionSort = (value: unknown): ModelUsageActionSort => {
  if (typeof value === "string" && ACTION_SORT_VALUES.has(value as ModelUsageActionSort)) {
    return value as ModelUsageActionSort;
  }

  return DEFAULT_MODEL_USAGE_ACTION_SORT;
};

export const getModelUsageActionSortValue = (row: SortableActionUsage, sort: ModelUsageActionSort): number => {
  if (sort === "total_calls") return row.calls;
  if (sort === "total_cost") return row.costUsd;
  if (sort === "cost_per_call") return row.calls > 0 ? row.costUsd / row.calls : 0;
  return row.totalTokens;
};

export const compareModelUsageActionRows = (
  left: SortableActionUsage,
  right: SortableActionUsage,
  sort: ModelUsageActionSort,
): number => {
  const primaryDelta = getModelUsageActionSortValue(right, sort) - getModelUsageActionSortValue(left, sort);
  if (primaryDelta !== 0) {
    return primaryDelta;
  }

  const costDelta = right.costUsd - left.costUsd;
  if (costDelta !== 0) {
    return costDelta;
  }

  const tokenDelta = right.totalTokens - left.totalTokens;
  if (tokenDelta !== 0) {
    return tokenDelta;
  }

  const callDelta = right.calls - left.calls;
  if (callDelta !== 0) {
    return callDelta;
  }

  return left.label.localeCompare(right.label);
};
