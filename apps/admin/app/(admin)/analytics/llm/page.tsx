import { Activity, BarChart3, Bot, Clock3, Coins, Sparkles } from "lucide-react";
import { BoardChartCard, BoardPageHeader, BoardTableCard, HeroStatGrid, type BoardHeroStat } from "@/components/admin/board-kit";
import { FilterBar } from "@/components/admin/filter-bar";
import { ModelUsageTimeCharts } from "@/components/admin/model-usage-time-charts";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DEFAULT_ANALYTICS_QUERY, getDaysForRange, parseAnalyticsQueryState } from "@/lib/admin-analytics";
import { getModelUsageData } from "@/lib/admin-data";
import { formatCost, formatPercent, formatTokens } from "@/lib/format";

const formatUnitCost = (usd: number): string => {
  if (usd === 0) return "$0.0000";
  if (usd < 0.0001) return `$${usd.toFixed(6)}`;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
};

export default async function ModelUsagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const query = parseAnalyticsQueryState(params, DEFAULT_ANALYTICS_QUERY);
  const data = await getModelUsageData({ rangeDays: getDaysForRange(query.range) });

  const maxActionTokens = Math.max(1, ...data.byAction.map((row) => row.totalTokens));
  const heroStats: BoardHeroStat[] = [
    {
      label: "LLM Calls",
      value: data.totals.calls.toLocaleString(),
      hint: "Within the selected range.",
      icon: Activity,
    },
    {
      label: "Total Tokens",
      value: formatTokens(data.totals.totalTokens),
      hint: `${formatTokens(data.totals.inputTokens)} in / ${formatTokens(data.totals.outputTokens)} out`,
      icon: Sparkles,
    },
    {
      label: "Model Cost",
      value: formatCost(data.totals.totalCostUsd),
      hint: "Estimated from registry pricing.",
      icon: Coins,
    },
    {
      label: "Avg Latency",
      value: data.totals.avgLatencyMs > 0 ? `${data.totals.avgLatencyMs.toLocaleString()}ms` : "—",
      hint: "Across all llm_call events.",
      icon: Clock3,
      tone: data.totals.avgLatencyMs > 7000 ? "warning" : "default",
    },
    {
      label: "Active Models",
      value: String(data.byModel.length),
      hint: "Models seen in event attribution.",
      icon: Bot,
      tone: data.byModel.length > 0 ? "success" : "muted",
    },
  ];

  return (
    <div className="space-y-8">
      <BoardPageHeader
        eyebrow="Analytics"
        title="LLM Performance"
        description="Calls, cost, tokens, provider mix, and model latency across the live LLM pipeline."
        badges={["Cost", "Latency", "Provider mix"]}
      />

      <FilterBar query={query} showCompare={false} />

      <HeroStatGrid items={heroStats} />

      <BoardChartCard
        title="Time-based Usage Graphs"
        description="Area charts for hourly traffic and daily cost patterns."
      >
        <ModelUsageTimeCharts hourly={data.hourly} daily={data.daily} />
      </BoardChartCard>

      <div className="grid gap-6 xl:grid-cols-1">
        <BoardChartCard
          title="Usage by Action"
          description="Generating, chatting, tweaking, images, and other scoped actions."
        >
          {data.byAction.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No action usage to display yet.</p>
          ) : (
            <div className="space-y-4">
              {data.byAction.map((row) => (
                <div key={row.scope} className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{row.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.calls.toLocaleString()} calls · {formatTokens(row.totalTokens)} tokens ·{" "}
                        {formatCost(row.costUsd)} total ·{" "}
                        {formatUnitCost(row.calls > 0 ? row.costUsd / row.calls : 0)}/call ·{" "}
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
                      style={{ width: `${Math.max(2, (row.totalTokens / maxActionTokens) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </BoardChartCard>
      </div>

      <BoardTableCard
        title="Usage by Model"
        description="Attribution uses event payload model/provider when present, otherwise current active route for each scope."
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <BarChart3 className="h-4 w-4" />
            Detailed provider and model mix
          </div>
          <Badge variant="outline" className="font-mono text-xs">
            {new Date(data.windowStart).toLocaleDateString()} - {new Date(data.windowEnd).toLocaleDateString()}
          </Badge>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Actions</TableHead>
              <TableHead className="text-right">Calls</TableHead>
              <TableHead className="text-right">Tokens</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">Avg Latency</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.byModel.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  No model usage events recorded yet.
                </TableCell>
              </TableRow>
            ) : (
              data.byModel.map((row) => (
                <TableRow key={`${row.provider}/${row.model}`}>
                  <TableCell>
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">{row.displayName}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">{row.model}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">
                      {row.provider}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {row.scopes.map((scope) => (
                        <Badge key={scope} variant="outline" className="text-[10px]">
                          {scope}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.calls.toLocaleString()} ({formatPercent(row.callShare)})
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatTokens(row.totalTokens)} ({formatPercent(row.tokenShare)})
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatCost(row.costUsd)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.avgLatencyMs > 0 ? `${row.avgLatencyMs.toLocaleString()}ms` : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </BoardTableCard>
    </div>
  );
}
