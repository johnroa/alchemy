import { Compass, Radar, TimerReset, TriangleAlert } from "lucide-react";
import { BoardChartCard, BoardPageHeader, BoardTableCard, HeroStatGrid, type BoardHeroStat } from "@/components/admin/board-kit";
import { FilterBar } from "@/components/admin/filter-bar";
import { PersonalizationBoardTrendChart } from "@/components/admin/personalization-board-trend-chart";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DEFAULT_ANALYTICS_QUERY, parseAnalyticsQueryState } from "@/lib/admin-analytics";
import { getPersonalizationBoardData } from "@/lib/admin-data";
import { formatMs, formatPercent, toDecimal, toShortInteger } from "@/lib/format";

export default async function AnalyticsPersonalizationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const query = parseAnalyticsQueryState(params, DEFAULT_ANALYTICS_QUERY);
  const data = await getPersonalizationBoardData(query);

  const heroStats: BoardHeroStat[] = [
    {
      label: "Champion Version",
      value: data.summary.currentAlgorithmVersion,
      hint: data.summary.currentAlgorithmKey,
      icon: Radar,
    },
    {
      label: "Median Feed Latency",
      value: formatMs(data.summary.medianFeedLatencyMs),
      hint: "Explore feed latency from server-side feed-served telemetry.",
      icon: TimerReset,
      tone: data.summary.medianFeedLatencyMs != null && data.summary.medianFeedLatencyMs > 2000 ? "warning" : "default",
    },
    {
      label: "Fallback Rate",
      value: formatPercent(data.summary.fallbackRate, 1),
      hint: "Share of feed serves that degraded from profile or rerank logic.",
      icon: TriangleAlert,
      tone: data.summary.fallbackRate > 0.1 ? "warning" : "default",
    },
    {
      label: "Cold vs Established",
      value: `${formatPercent(data.coldStartComparison[0]?.saveRate ?? 0, 1)} / ${formatPercent(data.coldStartComparison[1]?.saveRate ?? 0, 1)}`,
      hint: "Save-rate proxy for cold and non-cold profile states.",
      icon: Compass,
      tone: "muted",
    },
    {
      label: "Learning Velocity",
      value: data.summary.preferenceLearningVelocityHours == null
        ? "Pending"
        : `${toDecimal(data.summary.preferenceLearningVelocityHours, 1)}h`,
      hint: "Median sign-in to non-cold profile build time.",
      icon: TimerReset,
      tone: "muted",
    },
  ];

  return (
    <div className="space-y-8">
      <BoardPageHeader
        eyebrow="Analytics"
        title="Personalization Analytics"
        description="Per-version Explore serving diagnostics, funnel performance, and the user-state breakouts that tell you whether For You is improving because the algorithm is better or because the audience changed."
        badges={["Version history", "Feed funnel", "Profile states", "Fallback reasons"]}
      />

      <FilterBar query={query} showCompare={false} />

      <HeroStatGrid items={heroStats} />

      <BoardChartCard
        title="Feed Funnel Trend"
        description="Item-level funnel movement for the Explore recommender."
      >
        <PersonalizationBoardTrendChart data={data.series} />
      </BoardChartCard>

      <div className="grid gap-4 xl:grid-cols-2">
        <BoardTableCard
          title="Version Timeline"
          description="Current and historical algorithm versions with funnel outcomes."
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead className="text-right">Open</TableHead>
                <TableHead className="text-right">Save</TableHead>
                <TableHead className="text-right">Cook</TableHead>
                <TableHead className="text-right">Latency</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.versionRows.map((row) => (
                <TableRow key={row.version}>
                  <TableCell>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{row.label}</span>
                        {row.isActive ? <Badge variant="secondary">Champion</Badge> : null}
                      </div>
                      <p className="font-mono text-[11px] text-muted-foreground">{row.version}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatPercent(row.openRate, 1)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPercent(row.saveRate, 1)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPercent(row.cookRate, 1)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMs(row.medianLatencyMs)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </BoardTableCard>

        <BoardTableCard
          title="Fallback Reasons"
          description="Most common degraded paths recorded on Explore feed serves."
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Feeds</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.fallbackReasonRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="py-10 text-center text-muted-foreground">
                    No fallback reasons recorded in this window.
                  </TableCell>
                </TableRow>
              ) : (
                data.fallbackReasonRows.map((row) => (
                  <TableRow key={row.reason}>
                    <TableCell>{row.reason}</TableCell>
                    <TableCell className="text-right tabular-nums">{toShortInteger(row.feeds)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </BoardTableCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <BoardTableCard
          title="Breakdown by Profile State"
          description="How cold, warm, and established profiles behave in the Explore funnel."
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Profile state</TableHead>
                <TableHead className="text-right">Impr.</TableHead>
                <TableHead className="text-right">Save</TableHead>
                <TableHead className="text-right">Cook</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.profileStateRows.map((row) => (
                <TableRow key={row.profileState}>
                  <TableCell>{row.profileState}</TableCell>
                  <TableCell className="text-right tabular-nums">{toShortInteger(row.impressions)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPercent(row.saveRate, 1)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPercent(row.cookRate, 1)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </BoardTableCard>

        <BoardTableCard
          title="Breakdown by Explore Filter"
          description="Preset chips still use personalized ranking; this shows how those filtered feeds perform."
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Preset</TableHead>
                <TableHead className="text-right">Impr.</TableHead>
                <TableHead className="text-right">Save</TableHead>
                <TableHead className="text-right">Cook</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.presetRows.map((row) => (
                <TableRow key={row.preset}>
                  <TableCell>{row.preset}</TableCell>
                  <TableCell className="text-right tabular-nums">{toShortInteger(row.impressions)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPercent(row.saveRate, 1)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPercent(row.cookRate, 1)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </BoardTableCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <BoardTableCard
          title="Breakdown by Lifecycle Stage"
          description="Saved and cooked rates split by current lifecycle segment."
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lifecycle</TableHead>
                <TableHead className="text-right">Impr.</TableHead>
                <TableHead className="text-right">Save</TableHead>
                <TableHead className="text-right">Cook</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.lifecycleRows.map((row) => (
                <TableRow key={row.lifecycleStage}>
                  <TableCell>{row.lifecycleStage}</TableCell>
                  <TableCell className="text-right tabular-nums">{toShortInteger(row.impressions)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPercent(row.saveRate, 1)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPercent(row.cookRate, 1)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </BoardTableCard>

        <BoardTableCard
          title="Breakdown by Acquisition Channel"
          description="Shows whether Explore is performing differently by the users’ originating channel."
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead className="text-right">Impr.</TableHead>
                <TableHead className="text-right">Save</TableHead>
                <TableHead className="text-right">Cook</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.acquisitionRows.map((row) => (
                <TableRow key={row.acquisitionChannel}>
                  <TableCell>{row.acquisitionChannel}</TableCell>
                  <TableCell className="text-right tabular-nums">{toShortInteger(row.impressions)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPercent(row.saveRate, 1)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPercent(row.cookRate, 1)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </BoardTableCard>
      </div>
    </div>
  );
}
