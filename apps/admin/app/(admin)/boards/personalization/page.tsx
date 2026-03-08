import { ArrowUpRight, Compass, Gauge, HeartHandshake, Layers3, Radar, Shuffle, TimerReset } from "lucide-react";
import Link from "next/link";
import { BoardChartCard, BoardPageHeader, BoardTableCard, HeroStatGrid, type BoardHeroStat } from "@/components/admin/board-kit";
import { FilterBar } from "@/components/admin/filter-bar";
import { PersonalizationBoardTrendChart } from "@/components/admin/personalization-board-trend-chart";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DEFAULT_ANALYTICS_QUERY, parseAnalyticsQueryState } from "@/lib/admin-analytics";
import { getPersonalizationBoardData } from "@/lib/admin-data";
import { formatMs, formatPercent, toDecimal, toShortInteger } from "@/lib/format";

export default async function PersonalizationBoardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const query = parseAnalyticsQueryState(params, DEFAULT_ANALYTICS_QUERY);
  const data = await getPersonalizationBoardData(query);

  const heroStats: BoardHeroStat[] = [
    {
      label: "Current Algorithm",
      value: data.summary.currentAlgorithmVersion,
      hint: data.summary.currentAlgorithmKey,
      icon: Radar,
      tone: "default",
      href: "/analytics/personalization",
    },
    {
      label: "Save Lift vs Baseline",
      value: data.summary.saveLiftVsBaseline == null ? "Pending" : formatPercent(data.summary.saveLiftVsBaseline, 1),
      hint: "Impression-to-save rate against older tracked versions in range.",
      icon: HeartHandshake,
      tone: data.summary.saveLiftVsBaseline != null && data.summary.saveLiftVsBaseline < 0 ? "warning" : "success",
    },
    {
      label: "Cook Lift vs Baseline",
      value: data.summary.cookLiftVsBaseline == null ? "Pending" : formatPercent(data.summary.cookLiftVsBaseline, 1),
      hint: "Impression-to-cook rate against older tracked versions in range.",
      icon: Compass,
      tone: data.summary.cookLiftVsBaseline != null && data.summary.cookLiftVsBaseline < 0 ? "warning" : "success",
    },
    {
      label: "Negative Feedback Rate",
      value: formatPercent(data.summary.negativeFeedbackRate, 1),
      hint: "Skipped or hidden impressions on the active version.",
      icon: Gauge,
      tone: data.summary.negativeFeedbackRate > 0.2 ? "warning" : "default",
    },
    {
      label: "Novelty Budget",
      value: formatPercent(data.summary.noveltyShare, 0),
      hint: "Configured exploration share for page-one recommendations.",
      icon: Shuffle,
      tone: "muted",
    },
  ];

  const supportingStats: BoardHeroStat[] = [
    {
      label: "Preference Learning Velocity",
      value: data.summary.preferenceLearningVelocityHours == null
        ? "Pending"
        : `${toDecimal(data.summary.preferenceLearningVelocityHours, 1)}h`,
      hint: "Proxy: median time from sign-in to a non-cold taste profile.",
      icon: TimerReset,
      tone: "muted",
    },
    {
      label: "Cold-Start Coverage",
      value: formatPercent(data.summary.coldStartCoverage, 1),
      hint: "Active-version feed serves where the user profile is still cold.",
      tone: "muted",
    },
    {
      label: "Fallback Rate",
      value: formatPercent(data.summary.fallbackRate, 1),
      hint: "Feed serves that fell back from profile or rerank logic.",
      tone: data.summary.fallbackRate > 0.1 ? "warning" : "muted",
    },
    {
      label: "Personalized Filter Coverage",
      value: formatPercent(data.summary.personalizedFilterCoverage, 1),
      hint: "Share of feed serves using a filter chip while keeping personalized ranking.",
      tone: "muted",
    },
    {
      label: "Median Feed Latency",
      value: formatMs(data.summary.medianFeedLatencyMs),
      hint: "Server-side latency recorded on explore_feed_served.",
      icon: Layers3,
      tone: data.summary.medianFeedLatencyMs != null && data.summary.medianFeedLatencyMs > 2000 ? "warning" : "muted",
    },
  ];

  return (
    <div className="space-y-8">
      <BoardPageHeader
        eyebrow="Executive board"
        title="Personalization"
        description="The personalization board tracks whether Explore is actually getting smarter: version lift, feed quality, cold-start coverage, and the operational health of the recommender itself."
        badges={["For You", "Version lift", "Cold start", "Fallbacks"]}
      />

      <FilterBar query={query} showCompare={false} />

      <HeroStatGrid items={heroStats} />

      <BoardChartCard
        title="Feed Funnel Trend"
        description="Impressions, saves, cooks, and fallback feed serves over the selected window."
        action={(
          <Link href="/analytics/personalization">
            <Badge variant="outline" className="gap-1 rounded-full">
              Version diagnostics
              <ArrowUpRight className="h-3 w-3" />
            </Badge>
          </Link>
        )}
      >
        <PersonalizationBoardTrendChart data={data.series} />
      </BoardChartCard>

      <HeroStatGrid items={supportingStats} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <BoardTableCard
          title="Version Performance"
          description="Per-version impression funnel and fallback diagnostics."
          href="/analytics/personalization"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead className="text-right">Impr.</TableHead>
                <TableHead className="text-right">Save</TableHead>
                <TableHead className="text-right">Cook</TableHead>
                <TableHead className="text-right">Fallback</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.versionRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    No For You traffic recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                data.versionRows.map((row) => (
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
                    <TableCell className="text-right tabular-nums">{toShortInteger(row.impressions)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPercent(row.saveRate, 1)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPercent(row.cookRate, 1)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPercent(row.fallbackRate, 1)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </BoardTableCard>

        <BoardTableCard
          title="Why Tags"
          description="Most common user-facing rationale tags currently surfacing in Explore."
          href="/analytics/personalization"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tag</TableHead>
                <TableHead className="text-right">Impr.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.whyTagRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="py-10 text-center text-muted-foreground">
                    No why-tag telemetry yet.
                  </TableCell>
                </TableRow>
              ) : (
                data.whyTagRows.map((row) => (
                  <TableRow key={row.tag}>
                    <TableCell>{row.tag}</TableCell>
                    <TableCell className="text-right tabular-nums">{toShortInteger(row.impressions)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </BoardTableCard>
      </div>
    </div>
  );
}
