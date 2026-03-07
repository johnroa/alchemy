import { BookOpen, Layers3, Sparkles, UserRoundPlus, Users } from "lucide-react";
import { BoardChartCard, BoardPageHeader, HeroStatGrid, type BoardHeroStat } from "@/components/admin/board-kit";
import { FilterBar } from "@/components/admin/filter-bar";
import { ProductAnalyticsPanels } from "@/components/admin/product-analytics-panels";
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
  const heroStats: BoardHeroStat[] = [
    {
      label: "Users",
      value: data.summary.users.toLocaleString(),
      hint: `${data.summary.newUsers} joined in the selected range.`,
      icon: Users,
    },
    {
      label: "Cookbook Saves",
      value: data.summary.cookbookEntries.toLocaleString(),
      hint: `${data.summary.newCookbookEntries} new saves in selected range.`,
      icon: BookOpen,
      tone: "success",
    },
    {
      label: "Variants",
      value: data.summary.variants.toLocaleString(),
      hint: `${data.summary.newVariants} materialized in selected range.`,
      icon: Sparkles,
    },
    {
      label: "Stale Backlog",
      value: String(data.summary.staleVariants),
      hint: "Variants waiting on refresh or review.",
      icon: UserRoundPlus,
      tone: data.summary.staleVariants > 0 ? "warning" : "success",
    },
    {
      label: "Catalog Footprint",
      value: `${data.summary.recipes.toLocaleString()} / ${data.summary.ingredients.toLocaleString()}`,
      hint: `${data.summary.recipeUpdates} recipe updates · ${data.summary.ingredientUpdates} ingredient updates`,
      icon: Layers3,
      tone: "muted",
    },
  ];

  return (
    <div className="space-y-8">
      <BoardPageHeader
        eyebrow="Analytics"
        title="Product Analytics"
        description="User adoption, saves, variants, and catalog footprint from current platform data."
        badges={["Adoption", "Catalog", "Variant health"]}
      />

      <FilterBar query={query} showCompare={false} />

      <HeroStatGrid items={heroStats} />

      <BoardChartCard
        title="Adoption trend"
        description="Users, cookbook saves, and variants over the selected window."
      >
          <ProductAnalyticsPanels data={data.series} />
      </BoardChartCard>
    </div>
  );
}
