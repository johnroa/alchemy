import { EntityTypeIcon } from "@/components/admin/entity-type-icon";
import { AnalyticsMovedNotice } from "@/components/admin/analytics-moved-notice";
import { IngredientsRegistryExplorer } from "@/components/admin/ingredients-registry-explorer";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { getIngredientsData } from "@/lib/admin-data";

export default async function IngredientsPage(): Promise<React.JSX.Element> {
  const data = await getIngredientsData();
  const { totals } = data.summary;

  const totalAliases = totals.aliases;
  const unresolvedCount = totals.unresolved_rows;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Ingredients"
        description="Canonical ingredient registry, enrichment metadata, ontology links, and unresolved normalization rows."
        icon={<EntityTypeIcon entityType="ingredient" className="h-6 w-6" />}
      />

      <AnalyticsMovedNotice
        title="Coverage and velocity moved to Analytics"
        description="Use Analytics / Content for ingredient coverage, enrichment velocity, and graph-linked health trends. This page stays focused on registry inspection and unresolved rows."
        href="/analytics/content"
        cta="Open content analytics"
      />

      <IngredientsRegistryExplorer ingredients={data.ingredients} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
            <div>
              <CardTitle className="text-base">Aliases</CardTitle>
              <CardDescription>Alias keys linked to canonical ingredient IDs.</CardDescription>
            </div>
            <Badge variant="outline" className="font-mono text-xs">{totalAliases} rows</Badge>
          </CardHeader>
          <CardContent className="pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Alias</TableHead>
                  <TableHead>Canonical</TableHead>
                  <TableHead>Confidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.aliases.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">No aliases yet.</TableCell>
                  </TableRow>
                ) : (
                  data.aliases.slice(0, 100).map((alias) => (
                    <TableRow key={alias.id}>
                      <TableCell className="font-mono text-xs">{alias.alias_key}</TableCell>
                      <TableCell className="text-xs">
                        {alias.canonical_name ? (
                          <span className="inline-flex items-center gap-1.5">
                            <EntityTypeIcon
                              entityType="ingredient"
                              canonicalName={alias.canonical_name}
                              className="h-3.5 w-3.5"
                            />
                            {alias.canonical_name}
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{alias.confidence.toFixed(2)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
            <div>
              <CardTitle className="text-base">Unresolved Rows</CardTitle>
              <CardDescription>Recipe ingredient rows that still need normalization retries.</CardDescription>
            </div>
            <Badge
              variant="outline"
              className={cn(
                "font-mono text-xs",
                unresolvedCount > 0 && "border-amber-300 bg-amber-50 text-amber-700"
              )}
            >
              {unresolvedCount} rows
            </Badge>
          </CardHeader>
          <CardContent className="pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.unresolved_rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">No unresolved rows.</TableCell>
                  </TableRow>
                ) : (
                  data.unresolved_rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <p className="inline-flex items-center gap-1.5 text-sm font-medium">
                          <EntityTypeIcon
                            entityType="ingredient"
                            canonicalName={row.source_name}
                            className="h-3.5 w-3.5"
                          />
                          {row.source_name}
                        </p>
                        <p className="font-mono text-[11px] text-muted-foreground">{row.recipe_version_id.slice(0, 8)}…</p>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.source_amount ?? "?"} {row.source_unit ?? ""}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700 text-[10px]">
                          {row.normalized_status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(row.updated_at).toLocaleString()}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
