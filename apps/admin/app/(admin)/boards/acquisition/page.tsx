import { Clock3, LogIn, Sparkles, Target, UserPlus, UtensilsCrossed } from "lucide-react";
import { AcquisitionBoardTrendChart } from "@/components/admin/acquisition-board-trend-chart";
import { BoardChartCard, BoardPageHeader, BoardTableCard, HeroStatGrid, type BoardHeroStat } from "@/components/admin/board-kit";
import { FilterBar } from "@/components/admin/filter-bar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DEFAULT_ANALYTICS_QUERY, parseAnalyticsQueryState } from "@/lib/admin-analytics";
import { getAcquisitionBoardData } from "@/lib/admin-data";
import { formatMs, formatPercent, toShortInteger } from "@/lib/format";

const formatSecondsAsDuration = (value: number | null): string =>
  value == null ? "n/a" : formatMs(value * 1000);

export default async function AcquisitionBoardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const query = parseAnalyticsQueryState(params, DEFAULT_ANALYTICS_QUERY);
  const { snapshot } = await getAcquisitionBoardData(query);

  const heroStats: BoardHeroStat[] = [
    {
      label: "First Opens",
      value: toShortInteger(snapshot.summary.firstOpens),
      hint: "Distinct install profiles first seen in the selected window.",
      icon: UserPlus,
      tone: snapshot.summary.firstOpens > 0 ? "default" : "muted",
    },
    {
      label: "Sign-In Rate",
      value: formatPercent(snapshot.summary.signInRate, 1),
      hint: "Install cohort members who completed Sign in with Apple.",
      icon: LogIn,
      tone: snapshot.summary.signInRate >= 0.5 ? "success" : "warning",
    },
    {
      label: "Onboarding Completion Rate",
      value: formatPercent(snapshot.summary.onboardingCompletionRate, 1),
      hint: "Install cohort members who completed onboarding.",
      icon: Sparkles,
      tone: snapshot.summary.onboardingCompletionRate >= 0.4 ? "success" : "default",
    },
    {
      label: "First Recipe Rate",
      value: formatPercent(snapshot.summary.firstGenerationRate, 1),
      hint: "Install cohort members who reached their first recipe generation.",
      icon: Target,
      tone: snapshot.summary.firstGenerationRate >= 0.35 ? "success" : "default",
    },
    {
      label: "First Save Rate",
      value: formatPercent(snapshot.summary.firstSaveRate, 1),
      hint: "Install cohort members who saved a recipe for later.",
      icon: Target,
      tone: snapshot.summary.firstSaveRate >= 0.2 ? "success" : "default",
    },
    {
      label: "First Cook Within 7 Days",
      value: formatPercent(snapshot.summary.firstCookWithin7dRate, 1),
      hint: "Install cohort members who reached a dwell-inferred cook within 7 days.",
      icon: UtensilsCrossed,
      tone: snapshot.summary.firstCookWithin7dRate >= 0.1 ? "success" : "default",
    },
  ];

  const supportingStats: BoardHeroStat[] = [
    {
      label: "Median Time to Sign-In",
      value: formatSecondsAsDuration(snapshot.summary.medianTimeToSignInSeconds),
      hint: "From first open to successful auth for converted installs.",
      icon: Clock3,
      tone: "muted",
    },
    {
      label: "Median Time to First Recipe",
      value: formatSecondsAsDuration(snapshot.summary.medianTimeToFirstRecipeSeconds),
      hint: "From first open to first generated recipe.",
      tone: "muted",
    },
    {
      label: "Median Time to First Save",
      value: formatSecondsAsDuration(snapshot.summary.medianTimeToFirstSaveSeconds),
      hint: "From first open to first save event.",
      tone: "muted",
    },
    {
      label: "Median Time to First Cook",
      value: formatSecondsAsDuration(snapshot.summary.medianTimeToFirstCookSeconds),
      hint: "From first open to first dwell-inferred cook.",
      tone: "muted",
    },
    {
      label: "7d Returning Cooks",
      value: formatPercent(snapshot.summary.returningCooks7dRate, 1),
      hint: `Eligible installs ${toShortInteger(snapshot.totals.eligibleReturningInstalls)} · cooks between days 7 and 14 after first open.`,
      tone: snapshot.summary.returningCooks7dRate >= 0.08 ? "success" : "muted",
    },
  ];

  return (
    <div className="space-y-8">
      <BoardPageHeader
        eyebrow="Executive board"
        title="Acquisition"
        description="This board keeps launch traffic honest: first opens, sign-in conversion, onboarding completion, and the path from install to first real cooking behavior."
        badges={["Install cohorts", "First-party funnel truth", "No MMP required"]}
      />

      <FilterBar query={query} showCompare={false} />

      <HeroStatGrid items={heroStats} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <BoardChartCard
          title="Install to First-Cook Momentum"
          description="Windowed counts for first opens, sign-ins, and first cooks."
        >
          <AcquisitionBoardTrendChart
            data={snapshot.series as Array<{
              bucketStart: string;
              label: string;
              firstOpens: number;
              signIns: number;
              onboardingCompleted: number;
              firstRecipes: number;
              firstSaves: number;
              firstCooks: number;
            }>}
          />
        </BoardChartCard>

        <BoardTableCard
          title="Funnel Snapshot"
          description="Cohort counts behind the hero conversion rates."
          href="/analytics/product"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Count</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { label: "First opens", value: snapshot.summary.firstOpens },
                { label: "Signed in", value: snapshot.totals.signIns },
                { label: "Onboarding completed", value: snapshot.totals.onboardingCompleted },
                { label: "First recipe", value: snapshot.totals.firstGenerations },
                { label: "First save", value: snapshot.totals.firstSaves },
                { label: "First cook within 7d", value: snapshot.totals.firstCooksWithin7d },
              ].map((row) => (
                <TableRow key={row.label}>
                  <TableCell>{row.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{toShortInteger(row.value)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </BoardTableCard>
      </div>

      <HeroStatGrid items={supportingStats} />

      <div className="grid gap-4 xl:grid-cols-2">
        <BoardTableCard
          title="Source Mix"
          description="Launch channels kept intentionally coarse until PMF."
          href="/boards/engagement"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead className="text-right">Installs</TableHead>
                <TableHead className="text-right">Sign-ins</TableHead>
                <TableHead className="text-right">Cook within 7d</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshot.sourceMix.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                    No install profiles recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                snapshot.sourceMix.map((row) => (
                  <TableRow key={row.channel}>
                    <TableCell>{row.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{toShortInteger(row.installs)}</TableCell>
                    <TableCell className="text-right tabular-nums">{toShortInteger(row.signIns)}</TableCell>
                    <TableCell className="text-right tabular-nums">{toShortInteger(row.firstCooksWithin7d)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </BoardTableCard>

        <BoardTableCard
          title="Install-Week Retention"
          description="Share of install cohorts that returned to cook during days 7–14."
          href="/boards/engagement"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cohort</TableHead>
                <TableHead className="text-right">Installs</TableHead>
                <TableHead className="text-right">Returning cooks</TableHead>
                <TableHead className="text-right">Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshot.cohortRetention.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                    No eligible install cohorts yet.
                  </TableCell>
                </TableRow>
              ) : (
                snapshot.cohortRetention.map((row) => (
                  <TableRow key={row.cohortLabel}>
                    <TableCell>{row.cohortLabel}</TableCell>
                    <TableCell className="text-right tabular-nums">{toShortInteger(row.installs)}</TableCell>
                    <TableCell className="text-right tabular-nums">{toShortInteger(row.returningCookInstalls)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPercent(row.returningCookRate, 1)}</TableCell>
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
