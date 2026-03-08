import { AlertTriangle, CheckCircle2, Clock3, Coins, ShieldAlert, Siren, Sparkles } from "lucide-react";
import { BoardChartCard, BoardPageHeader, BoardTableCard, HeroStatGrid, type BoardHeroStat } from "@/components/admin/board-kit";
import { FilterBar } from "@/components/admin/filter-bar";
import { OperationsBoardTrendChart } from "@/components/admin/operations-board-trend-chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DEFAULT_ANALYTICS_QUERY, parseAnalyticsQueryState } from "@/lib/admin-analytics";
import { getOperationsBoardData, getPersonalizationBoardData } from "@/lib/admin-data";
import { formatCost, formatMs, formatPercent, toShortInteger } from "@/lib/format";

export default async function OperationsBoardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const query = parseAnalyticsQueryState(params, DEFAULT_ANALYTICS_QUERY);
  const [{ snapshot, llmDaily, byAction, recentErrors }, personalization] = await Promise.all([
    getOperationsBoardData(query),
    getPersonalizationBoardData(query),
  ]);

  const heroStats: BoardHeroStat[] = [
    {
      label: "Generation Latency (P50)",
      value: formatMs(snapshot.summary.generationLatencyP50Ms),
      hint: `P95 ${formatMs(snapshot.summary.generationLatencyP95Ms)} across recipe-generation scopes.`,
      icon: Clock3,
      tone: snapshot.summary.generationLatencyP95Ms > 4000 ? "warning" : "default",
    },
    {
      label: "Immediate Regeneration Rate",
      value: formatPercent(snapshot.summary.immediateRegenerationRate, 1),
      hint: "Iteration requests divided by generated candidate turns.",
      icon: Sparkles,
      tone: snapshot.summary.immediateRegenerationRate > 0.3 ? "warning" : "success",
    },
    {
      label: "Structured Defect Rate",
      value: formatPercent(snapshot.summary.structuredRecipeDefectRate, 1),
      hint: "Schema-invalid and empty-output failures across generation scopes.",
      icon: AlertTriangle,
      tone: snapshot.summary.structuredRecipeDefectRate > 0.05 ? "danger" : "success",
    },
    {
      label: "Crash-Free Sessions",
      value: snapshot.summary.crashFreeSessions == null ? "Pending" : formatPercent(snapshot.summary.crashFreeSessions, 2),
      hint: snapshot.summary.crashFreeSessions == null
        ? "Sentry is wired. This fills once the DSN is configured and traffic arrives."
        : "Derived from Sentry mobile sessions.",
      icon: CheckCircle2,
      tone: snapshot.summary.crashFreeSessions == null ? "muted" : "success",
    },
    {
      label: "Cost / Accepted Recipe",
      value: formatCost(snapshot.summary.costPerAcceptedRecipeUsd),
      hint: `Backlog ${toShortInteger(snapshot.summary.pipelineFailureBacklog)} · pipeline success ${formatPercent(snapshot.summary.pipelineSuccessRate, 1)}`,
      icon: Coins,
      tone: snapshot.summary.costPerAcceptedRecipeUsd > 0.1 ? "warning" : "default",
    },
  ];

  const supportingStats: BoardHeroStat[] = [
    {
      label: "Cost / Recipe",
      value: formatCost(snapshot.summary.costPerRecipeUsd),
      hint: "Generation-scope cost divided by generation-scope requests.",
      tone: "muted",
    },
    {
      label: "Provider Failure Rate",
      value: formatPercent(snapshot.summary.providerFailureRate, 1),
      hint: "Any generation-scope llm_call row with an error code.",
      tone: "muted",
    },
    {
      label: "Stale Variant Backlog",
      value: toShortInteger(snapshot.summary.staleVariantBacklog),
      hint: "Variants still waiting on re-materialization or review.",
      tone: snapshot.summary.staleVariantBacklog > 0 ? "warning" : "muted",
    },
    {
      label: "Safety-Flagged Response Rate",
      value: formatPercent(snapshot.summary.safetyFlaggedResponseRate, 1),
      hint: "Current safety or rate-limit incidents divided by request volume.",
      icon: ShieldAlert,
      tone: "muted",
    },
    {
      label: "Pipeline Failure Backlog",
      value: toShortInteger(snapshot.summary.pipelineFailureBacklog),
      hint: "Pending images, failed images, stale variants, and failed imports.",
      icon: Siren,
      tone: snapshot.summary.pipelineFailureBacklog > 0 ? "warning" : "muted",
    },
    {
      label: "Explore Feed Latency",
      value: formatMs(personalization.summary.medianFeedLatencyMs),
      hint: "Median personalized Explore feed latency. Drill into Personalization for version splits.",
      tone: personalization.summary.medianFeedLatencyMs != null && personalization.summary.medianFeedLatencyMs > 2000
        ? "warning"
        : "muted",
      href: "/analytics/personalization",
    },
    {
      label: "Explore Fallback Rate",
      value: formatPercent(personalization.summary.fallbackRate, 1),
      hint: "Feed serves that degraded from profile or rerank logic.",
      tone: personalization.summary.fallbackRate > 0.1 ? "warning" : "muted",
      href: "/analytics/personalization",
    },
  ];

  return (
    <div className="space-y-8">
      <BoardPageHeader
        eyebrow="Executive board"
        title="Operations"
        description="The operations board keeps the product honest: model responsiveness, failure pressure, cost discipline, and the queues that actually break trust."
        badges={["Latency", "Defects", "Cost", "Queue health"]}
      />

      <FilterBar query={query} showCompare={false} />

      <HeroStatGrid items={heroStats} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <BoardChartCard
          title="LLM Call and Cost Trend"
          description="Daily call volume and recorded cost from the live LLM event stream."
        >
          <OperationsBoardTrendChart data={llmDaily} />
        </BoardChartCard>

        <BoardTableCard
          title="Recent Alerts"
          description="Most recent operational error signals surfaced by the current system telemetry."
          href="/analytics/llm"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Scope</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentErrors.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="py-10 text-center text-muted-foreground">
                    No recent errors recorded.
                  </TableCell>
                </TableRow>
              ) : (
                recentErrors.map((row) => (
                  <TableRow key={`${row.created_at}-${row.scope}`}>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">{row.scope}</TableCell>
                    <TableCell>{row.reason}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </BoardTableCard>
      </div>

      <HeroStatGrid items={supportingStats} />

      <BoardTableCard
        title="Scope Pressure"
        description="Highest-usage model scopes in the selected window."
        href="/analytics/llm"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Scope</TableHead>
              <TableHead className="text-right">Calls</TableHead>
              <TableHead className="text-right">Tokens</TableHead>
              <TableHead className="text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {byAction.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  No LLM activity recorded yet.
                </TableCell>
              </TableRow>
            ) : (
              byAction.slice(0, 8).map((row) => (
                <TableRow key={row.scope}>
                  <TableCell>{row.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{toShortInteger(row.calls)}</TableCell>
                  <TableCell className="text-right tabular-nums">{toShortInteger(row.totalTokens)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCost(row.costUsd)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </BoardTableCard>
    </div>
  );
}
