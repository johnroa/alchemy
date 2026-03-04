import { AlertTriangle, Link2, Scale, SearchCheck } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiCard } from "@/components/admin/kpi-card";
import { getIngredientsData } from "@/lib/admin-data";

export default async function IngredientsPage(): Promise<React.JSX.Element> {
  const data = await getIngredientsData();

  const totalIngredients = data.ingredients.length;
  const totalAliases = data.aliases.length;
  const unresolvedCount = data.unresolved_rows.length;
  const mappedIngredients = data.ingredients.filter((ingredient) => ingredient.usage_count > 0).length;
  const enrichedIngredients = data.ingredients.filter((ingredient) => ingredient.enrichment_confidence != null).length;
  const ontologyLinkTotal = data.ingredients.reduce((sum, ingredient) => sum + ingredient.ontology_link_count, 0);
  const pairLinkTotal = data.ingredients.reduce((sum, ingredient) => sum + ingredient.pair_link_count, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ingredients"
        description="Canonical ingredient registry, enrichment metadata, ontology links, and unresolved normalization rows."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <KpiCard label="Ingredients" value={String(totalIngredients)} hint="Canonical rows" icon={Scale} variant={totalIngredients > 0 ? "success" : "muted"} />
        <KpiCard label="Aliases" value={String(totalAliases)} hint="Alias keys mapped" icon={Link2} variant={totalAliases > 0 ? "default" : "muted"} />
        <KpiCard label="Enriched" value={String(enrichedIngredients)} hint="Confidence-scored metadata" icon={SearchCheck} variant={enrichedIngredients > 0 ? "success" : "muted"} />
        <KpiCard label="Ontology Links" value={String(ontologyLinkTotal)} hint="Ingredient taxonomy links" icon={SearchCheck} variant={ontologyLinkTotal > 0 ? "success" : "muted"} />
        <KpiCard label="Pair Links" value={String(pairLinkTotal)} hint="Ingredient pair graph degree sum" icon={SearchCheck} variant={pairLinkTotal > 0 ? "default" : "muted"} />
        <KpiCard label="Mapped" value={String(mappedIngredients)} hint="Used in recipe ingredients" icon={SearchCheck} variant={mappedIngredients > 0 ? "success" : "muted"} />
        <KpiCard label="Needs Retry" value={String(unresolvedCount)} hint="Unresolved normalization" icon={AlertTriangle} variant={unresolvedCount > 0 ? "warning" : "success"} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base">Canonical Ingredient Registry</CardTitle>
            <CardDescription>Normalized ingredient identities with LLM enrichment + graph coverage stats.</CardDescription>
          </div>
          <Badge variant="outline" className="font-mono text-xs">{totalIngredients} rows</Badge>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Normalized Key</TableHead>
                <TableHead>Enrichment</TableHead>
                <TableHead>Ontology</TableHead>
                <TableHead>Pairs</TableHead>
                <TableHead>Aliases</TableHead>
                <TableHead>Usage</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.ingredients.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">No canonical ingredients found.</TableCell>
                </TableRow>
              ) : (
                data.ingredients.map((ingredient) => (
                  <TableRow key={ingredient.id}>
                    <TableCell>
                      <p className="font-medium">{ingredient.canonical_name}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">{ingredient.id}</p>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{ingredient.normalized_key}</TableCell>
                    <TableCell>
                      {ingredient.enrichment_confidence != null ? (
                        <Badge variant="outline" className="text-[10px]">
                          {ingredient.enrichment_confidence.toFixed(2)}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                      <p className="mt-1 text-[11px] text-muted-foreground">{ingredient.metadata_key_count} keys</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">{ingredient.ontology_link_count}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">{ingredient.pair_link_count}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">{ingredient.alias_count}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-[10px]">{ingredient.usage_count}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(ingredient.updated_at).toLocaleString()}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Aliases</CardTitle>
            <CardDescription>Alias keys linked to canonical ingredient IDs.</CardDescription>
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
                      <TableCell className="text-xs">{alias.canonical_name ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{alias.confidence.toFixed(2)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Unresolved Rows</CardTitle>
            <CardDescription>Recipe ingredient rows that still need normalization retries.</CardDescription>
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
                        <p className="text-sm font-medium">{row.source_name}</p>
                        <p className="font-mono text-[11px] text-muted-foreground">{row.recipe_version_id.slice(0, 8)}…</p>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.source_amount ?? "?"} {row.source_unit ?? ""}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="border-amber-300/60 bg-amber-50 text-amber-700 text-[10px]">
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
