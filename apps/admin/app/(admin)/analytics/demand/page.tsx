import { BrainCircuit, GitBranch, Radar, ShieldCheck, TimerReset } from "lucide-react";
import { DemandAnalyticsPanels } from "@/components/admin/demand-analytics-panels";
import { DemandReviewQueue } from "@/components/admin/demand-review-queue";
import { BoardChartCard, BoardPageHeader, BoardTableCard, HeroStatGrid, type BoardHeroStat } from "@/components/admin/board-kit";
import { FilterBar } from "@/components/admin/filter-bar";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DEFAULT_ANALYTICS_QUERY, parseAnalyticsQueryState } from "@/lib/admin-analytics";
import { getDemandAnalyticsData } from "@/lib/admin-data";
import { formatPercent, timeAgo } from "@/lib/format";

export default async function AnalyticsDemandPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const query = parseAnalyticsQueryState(params, DEFAULT_ANALYTICS_QUERY);
  const data = await getDemandAnalyticsData(query);

  const heroStats: BoardHeroStat[] = [
    {
      label: "Demand Observations",
      value: data.summary.observations.toLocaleString(),
      hint: `${data.summary.intents.toLocaleString()} intent-bearing asks in the selected window.`,
      icon: BrainCircuit,
    },
    {
      label: "Outcome Signals",
      value: data.summary.outcomes.toLocaleString(),
      hint: `${data.summary.feedbackObservations.toLocaleString()} feedback or consumption observations linked to the graph.`,
      icon: Radar,
      tone: data.summary.outcomes > 0 ? "success" : "muted",
    },
    {
      label: "Review Backlog",
      value: data.summary.pendingReview.toLocaleString(),
      hint: `${data.summary.sampledForReview.toLocaleString()} sampled observations need precision review.`,
      icon: ShieldCheck,
      tone: data.summary.pendingReview > 0 ? "warning" : "success",
    },
    {
      label: "Queue Health",
      value: `${data.summary.queuePending} / ${data.summary.queueFailures}`,
      hint: "Pending + processing jobs / failed + dead-letter jobs.",
      icon: GitBranch,
      tone: data.summary.queueFailures > 0 ? "warning" : "default",
    },
    {
      label: "Freshness",
      value: data.summary.freshnessMinutes == null ? "Pending" : `${data.summary.freshnessMinutes}m`,
      hint: `${data.summary.graphEdges.toLocaleString()} demand graph edges in the active window.`,
      icon: TimerReset,
      tone: data.summary.freshnessMinutes != null && data.summary.freshnessMinutes > 60 ? "warning" : "default",
    },
  ];

  return (
    <div className="space-y-8">
      <BoardPageHeader
        eyebrow="Analytics"
        title="Demand Graph"
        description="Creation-primary intent, outcome, and graph telemetry derived from chat, import, save, variant, and cook flows. This is the internal operating surface for the enterprise demand graph."
        badges={["Intent", "Outcomes", "Review queue", "Graph edges"]}
      />

      <FilterBar query={query} showCompare={false} />

      <HeroStatGrid items={heroStats} />

      <BoardChartCard
        title="Demand Activity Trend"
        description="Observation and outcome volume over the selected window."
      >
        <DemandAnalyticsPanels data={data.series} />
      </BoardChartCard>

      <div className="grid gap-4 xl:grid-cols-2">
        <BoardTableCard
          title="Top Intents"
          description="Most frequent normalized demand facts extracted from creation sessions."
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Facet</TableHead>
                <TableHead>Value</TableHead>
                <TableHead className="text-right">Obs.</TableHead>
                <TableHead className="text-right">Avg Conf.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.topIntentRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                    No extracted intent facts in this window yet.
                  </TableCell>
                </TableRow>
              ) : (
                data.topIntentRows.map((row) => (
                  <TableRow key={`${row.facet}-${row.value}`}>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {row.facet}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{row.value}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.observations.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPercent(row.avgConfidence, 0)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </BoardTableCard>

        <BoardTableCard
          title="Rising Intents"
          description="Facts gaining momentum in the most recent half of the selected window."
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Facet</TableHead>
                <TableHead>Value</TableHead>
                <TableHead className="text-right">Recent</TableHead>
                <TableHead className="text-right">Delta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.risingIntentRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                    No rising intent clusters yet.
                  </TableCell>
                </TableRow>
              ) : (
                data.risingIntentRows.map((row) => (
                  <TableRow key={`${row.facet}-${row.value}`}>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {row.facet}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{row.value}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.recentObservations.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">+{row.delta.toLocaleString()}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </BoardTableCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <BoardTableCard
          title="Outcome Funnel"
          description="How often demand observations convert into downstream actions."
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Outcome</TableHead>
                <TableHead className="text-right">Count</TableHead>
                <TableHead className="text-right">Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.outcomeRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                    No linked outcomes recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                data.outcomeRows.map((row) => (
                  <TableRow key={row.outcomeType}>
                    <TableCell className="font-medium">{row.outcomeType}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.count.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPercent(row.rate, 1)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </BoardTableCard>

        <BoardTableCard
          title="Substitution Acceptance"
          description="Observed accepted and reverted substitution pairs from variant behavior."
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pair</TableHead>
                <TableHead className="text-right">Accepted</TableHead>
                <TableHead className="text-right">Reverted</TableHead>
                <TableHead className="text-right">Acceptance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.substitutionRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                    No substitution feedback recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                data.substitutionRows.map((row) => (
                  <TableRow key={`${row.original}-${row.replacement}`}>
                    <TableCell className="font-medium">
                      {row.original} → {row.replacement}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.accepted.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.reverted.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPercent(row.acceptanceRate, 0)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </BoardTableCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <BoardTableCard
          title="Graph Highlights"
          description="Highest-scoring demand graph edges for the active analytics window."
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Edge</TableHead>
                <TableHead className="text-right">Count</TableHead>
                <TableHead className="text-right">Acceptance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.graphRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                    No graph edges materialized yet.
                  </TableCell>
                </TableRow>
              ) : (
                data.graphRows.map((row) => (
                  <TableRow key={`${row.fromFacet}-${row.fromValue}-${row.toFacet}-${row.toValue}`}>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-medium">
                          {row.fromValue} → {row.toValue}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {row.fromFacet} to {row.toFacet} · {row.stage ?? "all stages"}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.count.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.acceptanceScore == null ? "—" : formatPercent(row.acceptanceScore, 1)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </BoardTableCard>

        <BoardTableCard
          title="Review Queue"
          description="Sampled observations for extraction QA and prompt iteration."
        >
          <DemandReviewQueue rows={data.reviewQueue.rows} />
        </BoardTableCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <BoardTableCard
          title="Unmet Demand Clusters"
          description="Frequent normalized asks with weak downstream success signals."
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Facet</TableHead>
                <TableHead>Value</TableHead>
                <TableHead className="text-right">Obs.</TableHead>
                <TableHead className="text-right">Success</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.unmetNeedRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                    No unmet-demand clusters surfaced yet.
                  </TableCell>
                </TableRow>
              ) : (
                data.unmetNeedRows.map((row) => (
                  <TableRow key={`${row.facet}-${row.value}`}>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {row.facet}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{row.value}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.observations.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPercent(row.successRate, 0)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </BoardTableCard>

        <BoardTableCard
          title="Extraction Quality"
          description="Scope-level review sampling, precision, and fact coverage."
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Scope</TableHead>
                <TableHead className="text-right">Obs.</TableHead>
                <TableHead className="text-right">Precision</TableHead>
                <TableHead className="text-right">Coverage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.scopeQualityRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                    No extraction quality rows available yet.
                  </TableCell>
                </TableRow>
              ) : (
                data.scopeQualityRows.map((row) => (
                  <TableRow key={`${row.scope}-${row.version}`}>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-medium">{row.scope}</p>
                        <p className="text-[11px] text-muted-foreground">v{row.version}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.observations.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.precision == null ? "—" : formatPercent(row.precision, 0)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatPercent(row.factCoverage, 0)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </BoardTableCard>
      </div>

      <BoardTableCard
        title="Recent Traces"
        description="Redacted trace rows with extracted facts and linked outcomes."
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Trace</TableHead>
              <TableHead>Snippet</TableHead>
              <TableHead>Facts</TableHead>
              <TableHead>Outcomes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.recentTraces.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  No recent traces available.
                </TableCell>
              </TableRow>
            ) : (
              data.recentTraces.map((row) => (
                <TableRow key={row.observation.id}>
                  <TableCell>
                    <div className="space-y-1">
                      <Badge variant="secondary" className="text-[10px] uppercase">
                        {row.observation.stage}
                      </Badge>
                      <p className="font-mono text-[11px] text-muted-foreground">{row.observation.extractor_scope}</p>
                      <p className="text-[11px] text-muted-foreground">{timeAgo(row.observation.observed_at)}</p>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[18rem] align-top text-sm text-muted-foreground">
                    {row.observation.admin_snippet_redacted ?? "Derived-only observation"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {row.facts.slice(0, 6).map((fact) => (
                        <Badge key={`${row.observation.id}-${fact.facet}-${fact.normalized_value}`} variant="outline" className="text-[10px]">
                          {fact.facet}: {fact.normalized_value}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {row.outcomes.slice(0, 5).map((outcome) => (
                        <Badge key={outcome.id} variant="secondary" className="text-[10px]">
                          {outcome.outcome_type}
                        </Badge>
                      ))}
                    </div>
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
