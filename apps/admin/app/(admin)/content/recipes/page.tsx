import { AlertCircle } from "lucide-react";
import { AnalyticsMovedNotice } from "@/components/admin/analytics-moved-notice";
import { EntityTypeIcon } from "@/components/admin/entity-type-icon";
import { PageHeader } from "@/components/admin/page-header";
import {
  PrivateCookbookQueue,
  RecipeDetailPanel,
  RecipeFilters,
  RecipeTable,
  parseStatusFilter,
  parseSortOrder,
} from "@/components/admin/recipes";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  getPendingCookbookEntries,
  getRecipeAuditDetail,
  getRecipeAuditIndexData,
  getRecipeCookbookEntries,
} from "@/lib/admin-data";

type RecipesPageSearchParams = {
  q?: string;
  recipe?: string;
  status?: string;
  sort?: string;
};

export default async function RecipesPage({
  searchParams
}: {
  searchParams: Promise<RecipesPageSearchParams>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const requestedRecipeId = typeof params.recipe === "string" ? params.recipe : "";
  const status = parseStatusFilter(typeof params.status === "string" ? params.status : undefined);
  const sort = parseSortOrder(typeof params.sort === "string" ? params.sort : undefined);

  const { rows, totals } = await getRecipeAuditIndexData(q);
  const filteredRows = rows.filter((row) => (status === "all" ? true : row.image_status === status));
  const sortedRows = [...filteredRows].sort((left, right) => {
    if (sort === "updated_desc") return Date.parse(right.updated_at) - Date.parse(left.updated_at);
    if (sort === "updated_asc") return Date.parse(left.updated_at) - Date.parse(right.updated_at);
    if (sort === "title_asc") return left.title.localeCompare(right.title);
    if (sort === "title_desc") return right.title.localeCompare(left.title);
    if (sort === "versions_desc") return right.version_count - left.version_count;
    if (sort === "saves_desc") return right.save_count - left.save_count;
    return 0;
  });

  const selectedRecipeId = sortedRows.some((row) => row.id === requestedRecipeId)
    ? requestedRecipeId
    : sortedRows[0]?.id;
  const [detail, cookbookEntries, pendingCookbookEntries] = await Promise.all([
    selectedRecipeId ? getRecipeAuditDetail(selectedRecipeId) : Promise.resolve(null),
    selectedRecipeId ? getRecipeCookbookEntries(selectedRecipeId) : Promise.resolve([]),
    getPendingCookbookEntries(),
  ]);
  const unresolvedOwners = sortedRows.filter((row) => !row.owner_email).length;
  const shownRecipeCount = sortedRows.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recipes Console"
        description="Inventory, version lineage, prompt trail, attachment graph, and changelog."
        icon={<EntityTypeIcon entityType="recipe" className="h-6 w-6" />}
        actions={
          <Badge variant="outline" className="font-mono text-xs">
            Showing {shownRecipeCount} / {totals.recipes}
          </Badge>
        }
      />

      <AnalyticsMovedNotice
        title="Coverage and recipe health moved to Analytics"
        description="Use Analytics / Content for recipe coverage, image health, variant status, and velocity trends. This console stays focused on direct recipe inspection and audit history."
        href="/analytics/content"
        cta="Open content analytics"
      />

      {unresolvedOwners > 0 && (
        <Alert className="border-amber-300 bg-amber-50">
          <AlertCircle className="h-4 w-4 text-amber-700" />
          <AlertTitle className="text-amber-900">Owner profiles need backfill</AlertTitle>
          <AlertDescription className="text-amber-800">
            {unresolvedOwners} recipes have user IDs with no email metadata in `users`.
          </AlertDescription>
        </Alert>
      )}

      <PrivateCookbookQueue entries={pendingCookbookEntries} />

      {/* Two-column split layout */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(420px,38%)_minmax(0,1fr)] 2xl:grid-cols-[minmax(460px,40%)_minmax(0,1fr)]">
        {/* Recipe List — sticky scrollable */}
        <Card className="lg:sticky lg:top-4">
          <RecipeFilters q={q} status={status} sort={sort} />
          <RecipeTable
            rows={sortedRows}
            selectedRecipeId={detail?.recipe.id}
            q={q}
            status={status}
            sort={sort}
          />
        </Card>

        {/* Deep Audit Panel */}
        <div>
          <RecipeDetailPanel detail={detail} cookbookEntries={cookbookEntries} />
        </div>
      </div>
    </div>
  );
}
