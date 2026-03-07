import { BookOpen, Clock3, Repeat2, Save, Target, Users } from "lucide-react";
import { BoardChartCard, BoardPageHeader, BoardTableCard, HeroStatGrid, type BoardHeroStat } from "@/components/admin/board-kit";
import { EngagementBoardTrendChart } from "@/components/admin/engagement-board-trend-chart";
import { FilterBar } from "@/components/admin/filter-bar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DEFAULT_ANALYTICS_QUERY, parseAnalyticsQueryState } from "@/lib/admin-analytics";
import { getEngagementBoardData } from "@/lib/admin-data";
import { formatPercent, formatMs, toDecimal, toShortInteger } from "@/lib/format";

export default async function EngagementBoardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const query = parseAnalyticsQueryState(params, DEFAULT_ANALYTICS_QUERY);
  const { snapshot } = await getEngagementBoardData(query);

  const heroStats: BoardHeroStat[] = [
    {
      label: "Recipes Cooked / User / Week",
      value: toDecimal(snapshot.summary.recipesCookedPerUserPerWeek, 2),
      hint: "North-star value. Real cooking behavior, normalized by active cooks and time window.",
      icon: Target,
      tone: snapshot.summary.recipesCookedPerUserPerWeek >= 1 ? "success" : "default",
    },
    {
      label: "Acceptance Rate",
      value: formatPercent(snapshot.summary.recipeAcceptanceRate, 1),
      hint: "Committed recipes divided by generated candidates.",
      icon: Save,
      tone: snapshot.summary.recipeAcceptanceRate >= 0.4 ? "success" : "warning",
    },
    {
      label: "Completion Rate",
      value: formatPercent(snapshot.summary.recipeCompletionRate, 1),
      hint: "Cooked recipes divided by saved recipes.",
      icon: BookOpen,
      tone: snapshot.summary.recipeCompletionRate >= 0.25 ? "success" : "default",
    },
    {
      label: "Weekly Returning Cooks",
      value: toShortInteger(snapshot.summary.weeklyReturningCooks),
      hint: "Users who cooked in the last 7 days and the previous 7 days.",
      icon: Users,
      tone: snapshot.summary.weeklyReturningCooks > 0 ? "default" : "muted",
    },
    {
      label: "Repeat Cooking Rate",
      value: formatPercent(snapshot.summary.repeatCookingRate, 1),
      hint: "Share of cook events that are repeat cooks of the same recipe.",
      icon: Repeat2,
      tone: snapshot.summary.repeatCookingRate >= 0.1 ? "success" : "default",
    },
  ];

  const supportingStats: BoardHeroStat[] = [
    {
      label: "Generation-to-Save Time (P50)",
      value: formatMs(snapshot.summary.generationToSaveTimeP50Seconds * 1000),
      hint: "Latest generated turn to candidate commit in the same chat session.",
      icon: Clock3,
      tone: "muted",
    },
    {
      label: "Prompt Iteration Depth",
      value: toDecimal(snapshot.summary.promptIterationDepth, 2),
      hint: "Submitted chat turns per committed candidate set.",
      tone: "muted",
    },
    {
      label: "Cooking Sessions / Active Cook / Week",
      value: toDecimal(snapshot.summary.weeklyCookingSessionsPerActiveCook, 2),
      hint: "Cook sessions normalized by active cooks and time window.",
      tone: "muted",
    },
    {
      label: "Cookbook Revisit Rate",
      value: formatPercent(snapshot.summary.cookbookRevisitRate, 1),
      hint: "Users with two or more cookbook visits divided by all cookbook viewers.",
      tone: "muted",
    },
    {
      label: "Chat Candidate Commit Rate",
      value: formatPercent(snapshot.summary.chatCandidateCommitRate, 1),
      hint: "Committed candidate sets divided by generated candidate turns.",
      tone: "muted",
    },
  ];

  return (
    <div className="space-y-8">
      <BoardPageHeader
        eyebrow="Executive board"
        title="Engagement"
        description="The engagement board stays focused on whether Alchemy is crossing the line from interesting generation to trusted cooking behavior."
        badges={["North-star: cooking", "First-party behavior telemetry", "Curated KPIs"]}
      />

      <FilterBar query={query} showCompare={false} />

      <HeroStatGrid items={heroStats} />

      <div className="grid gap-4 xl:grid-cols-2">
        <BoardChartCard
          title="Cooking and Save Momentum"
          description="Engagement trend by bucket across cooks, saves, and generated candidates."
        >
          <EngagementBoardTrendChart data={snapshot.series as Array<{ bucketStart: string; label: string; cooks: number; saves: number; generations: number; cookbookViews: number }>} />
        </BoardChartCard>

        <BoardTableCard
          title="Funnel Snapshot"
          description="Executive checkpoint counts for the current window."
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
                { label: "Generated candidates", value: snapshot.totals.generatedRecipes },
                { label: "Accepted commits", value: snapshot.totals.acceptedRecipes },
                { label: "Saved recipes", value: snapshot.totals.savedRecipes },
                { label: "Cooked recipes", value: snapshot.totals.cookedRecipes },
                { label: "Cookbook visits", value: snapshot.totals.cookbookViews },
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

      <BoardTableCard
        title="Top Repeat-Cook Recipes"
        description="Highest repeat-cook pressure from the behavior ledger. Recipe title joins can layer on later without changing the KPI source."
        href="/analytics/product"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Recipe</TableHead>
              <TableHead className="text-right">Saves</TableHead>
              <TableHead className="text-right">Cooks</TableHead>
              <TableHead className="text-right">Repeat cooks</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {snapshot.topRecipes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  No cook behavior recorded yet.
                </TableCell>
              </TableRow>
            ) : (
              snapshot.topRecipes.map((row) => (
                <TableRow key={row.recipeId}>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">{row.recipeId}</TableCell>
                  <TableCell className="text-right tabular-nums">{toShortInteger(row.saves)}</TableCell>
                  <TableCell className="text-right tabular-nums">{toShortInteger(row.cooks)}</TableCell>
                  <TableCell className="text-right tabular-nums">{toShortInteger(row.repeatCooks)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </BoardTableCard>
    </div>
  );
}
