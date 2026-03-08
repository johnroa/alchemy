"use client";

import { useEffect, useMemo, useState } from "react";
import { BoardChartCard } from "@/components/admin/board-kit";
import { LlmActionSortControl } from "@/components/admin/llm-action-sort-control";
import { Badge } from "@/components/ui/badge";
import { formatCost, formatPercent, formatTokens } from "@/lib/format";
import {
  compareModelUsageActionRows,
  getModelUsageActionSortValue,
  type ModelUsageActionRow,
  type ModelUsageActionSort,
} from "@/lib/llm-analytics";

const formatUnitCost = (usd: number): string => {
  if (usd === 0) return "$0.0000";
  if (usd < 0.0001) return `$${usd.toFixed(6)}`;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
};

const syncActionSortQuery = (nextValue: ModelUsageActionSort): void => {
  const nextUrl = new URL(window.location.href);
  if (nextValue === "total_tokens") {
    nextUrl.searchParams.delete("actionSort");
  } else {
    nextUrl.searchParams.set("actionSort", nextValue);
  }

  const nextSearch = nextUrl.searchParams.toString();
  const nextPath = nextSearch.length > 0 ? `${nextUrl.pathname}?${nextSearch}` : nextUrl.pathname;
  window.history.replaceState(null, "", nextPath);
};

export function LlmUsageByActionCard({
  initialRows,
  initialSort,
}: {
  initialRows: ModelUsageActionRow[];
  initialSort: ModelUsageActionSort;
}): React.JSX.Element {
  const [sort, setSort] = useState<ModelUsageActionSort>(initialSort);

  useEffect(() => {
    setSort(initialSort);
  }, [initialSort]);

  const rows = useMemo(
    () => [...initialRows].sort((left, right) => compareModelUsageActionRows(left, right, sort)),
    [initialRows, sort],
  );
  const maxActionMetric = Math.max(1, ...rows.map((row) => getModelUsageActionSortValue(row, sort)));

  const handleSortChange = (nextValue: ModelUsageActionSort): void => {
    setSort(nextValue);
    syncActionSortQuery(nextValue);
  };

  return (
    <BoardChartCard
      title="Usage by Action"
      description="Generating, chatting, tweaking, images, and other scoped actions."
    >
      <div className="mb-4 flex justify-end">
        <LlmActionSortControl value={sort} onChange={handleSortChange} />
      </div>
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No action usage to display yet.</p>
      ) : (
        <div className="space-y-4">
          {rows.map((row) => (
            <div key={row.scope} className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{row.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.calls.toLocaleString()} calls · {formatTokens(row.totalTokens)} tokens ·{" "}
                    {formatCost(row.costUsd)} total · {formatUnitCost(row.calls > 0 ? row.costUsd / row.calls : 0)}/call ·{" "}
                    {formatUnitCost(row.totalTokens > 0 ? (row.costUsd / row.totalTokens) * 1000 : 0)}/1K tok
                  </p>
                </div>
                <Badge variant="outline" className="font-mono text-[11px]">
                  {formatPercent(row.callShare)} calls
                </Badge>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/70">
                <div
                  className="h-full rounded-full bg-emerald-400/90"
                  style={{ width: `${Math.max(2, (getModelUsageActionSortValue(row, sort) / maxActionMetric) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </BoardChartCard>
  );
}
