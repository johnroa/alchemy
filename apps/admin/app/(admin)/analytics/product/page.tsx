import { BookOpen, Sparkles, UserRoundPlus, Users } from "lucide-react";
import { FilterBar } from "@/components/admin/filter-bar";
import { KpiCard } from "@/components/admin/kpi-card";
import { PageHeader } from "@/components/admin/page-header";
import { ProductAnalyticsPanels } from "@/components/admin/product-analytics-panels";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_ANALYTICS_QUERY, parseAnalyticsQueryState } from "@/lib/admin-analytics";
import { getProductAnalyticsData } from "@/lib/admin-data";

export default async function AnalyticsProductPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const query = parseAnalyticsQueryState(params, DEFAULT_ANALYTICS_QUERY);
  const data = await getProductAnalyticsData(query);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Product Analytics"
        description="Users, cookbook growth, and variant adoption signals from current platform data."
      />

      <FilterBar query={query} showCompare={false} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Users" value={data.summary.users.toLocaleString()} hint={`${data.summary.newUsers} new in range`} icon={Users} />
        <KpiCard label="Cookbook Entries" value={data.summary.cookbookEntries.toLocaleString()} hint={`${data.summary.newCookbookEntries} added in range`} icon={BookOpen} />
        <KpiCard label="Variants" value={data.summary.variants.toLocaleString()} hint={`${data.summary.newVariants} materialized in range`} icon={Sparkles} />
        <KpiCard label="Stale Backlog" value={String(data.summary.staleVariants)} hint="Variants waiting on refresh or review" icon={UserRoundPlus} variant={data.summary.staleVariants > 0 ? "warning" : "success"} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Growth trend</CardTitle>
          <CardDescription>Users, cookbook entries, and variants over the selected window.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <ProductAnalyticsPanels data={data.series} />
        </CardContent>
      </Card>
    </div>
  );
}
