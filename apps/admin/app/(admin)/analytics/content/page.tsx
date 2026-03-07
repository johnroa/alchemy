import { Layers3, Network, RefreshCcw, Sparkles } from "lucide-react";
import { ContentAnalyticsPanels } from "@/components/admin/content-analytics-panels";
import { FilterBar } from "@/components/admin/filter-bar";
import { KpiCard } from "@/components/admin/kpi-card";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_ANALYTICS_QUERY, parseAnalyticsQueryState } from "@/lib/admin-analytics";
import { getContentAnalyticsData } from "@/lib/admin-data";

export default async function AnalyticsContentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const query = parseAnalyticsQueryState(params, DEFAULT_ANALYTICS_QUERY);
  const data = await getContentAnalyticsData(query);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Content Health"
        description="Recipe, ingredient, graph, and variant health in one place."
      />

      <FilterBar query={query} showCompare={false} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Recipes" value={data.summary.recipes.toLocaleString()} hint={`${data.summary.recipeUpdates} updated in range`} icon={Layers3} />
        <KpiCard label="Ingredients" value={data.summary.ingredients.toLocaleString()} hint={`${data.summary.ingredientUpdates} touched in range`} icon={Layers3} />
        <KpiCard label="Graph Entities" value={data.summary.graphEntities.toLocaleString()} hint={`${data.summary.graphEdges.toLocaleString()} total edges`} icon={Network} />
        <KpiCard label="Stale Variants" value={String(data.summary.variants.variants_stale)} hint={`${data.summary.variants.variants_needs_review} need review`} icon={RefreshCcw} variant={data.summary.variants.variants_stale > 0 ? "warning" : "success"} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent content activity</CardTitle>
          <CardDescription>Bucketed recipe and ingredient updates for the selected window.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <ContentAnalyticsPanels data={data.series} />
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Current Variants" value={String(data.summary.variants.variants_current)} hint={`${data.summary.variants.variants_total} total personalized variants`} icon={Sparkles} variant="success" />
        <KpiCard label="Processing" value={String(data.summary.variants.variants_processing)} hint="Currently being rematerialized" icon={RefreshCcw} />
        <KpiCard label="Failed" value={String(data.summary.variants.variants_failed)} hint="Retryable personalization failures" icon={RefreshCcw} variant={data.summary.variants.variants_failed > 0 ? "danger" : "success"} />
        <KpiCard label="Image Coverage" value={String(data.summary.imageReadyRecipes)} hint={`${data.summary.imagePendingRecipes} recently pending recipes`} icon={Layers3} />
      </div>
    </div>
  );
}
