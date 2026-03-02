import { PageHeader } from "@/components/admin/page-header";
import { RevertVersionDialog } from "@/components/admin/revert-version-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getRecipeAuditData } from "@/lib/admin-data";

export default async function RecipesPage(): Promise<React.JSX.Element> {
  const rows = await getRecipeAuditData();

  return (
    <div className="space-y-6">
      <PageHeader title="Recipes Audit" description="Version history metadata and reversible operations." />
      <Card>
        <CardHeader>
          <CardTitle>Recipe Versions</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead>Recipe</TableHead>
                <TableHead>Diff Summary</TableHead>
                <TableHead>Counts</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No versions found.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.version_id}>
                    <TableCell className="font-mono text-xs">{row.version_id}</TableCell>
                    <TableCell className="font-mono text-xs">{row.recipe_id}</TableCell>
                    <TableCell>{row.diff_summary ?? "n/a"}</TableCell>
                    <TableCell>{row.ingredient_count} ingredients / {row.step_count} steps</TableCell>
                    <TableCell className="text-right">
                      <RevertVersionDialog recipeId={row.recipe_id} versionId={row.version_id} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
