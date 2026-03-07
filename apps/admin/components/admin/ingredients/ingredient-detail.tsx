"use client";

import Link from "next/link";
import { EntityTypeIcon } from "@/components/admin/entity-type-icon";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { STATUS_TONES } from "@/lib/admin-tones";
import { cn } from "@/lib/utils";
import { formatMaybeNumber, metadataValueLabel, shortId, type IngredientDetail as IngredientDetailType } from "./types";

type IngredientDetailProps = {
  activeIngredientId: string | null;
  activeDetail: IngredientDetailType | null;
  loadingId: string | null;
  activeError: string | null;
};

/**
 * Right-hand detail panel showing metadata, ontology links, pair stats, recipe
 * usage, and aliases for the currently selected ingredient. Lazy-loaded data
 * is fetched by the parent orchestrator.
 */
export function IngredientDetail({
  activeIngredientId,
  activeDetail,
  loadingId,
  activeError,
}: IngredientDetailProps): React.JSX.Element {
  return (
    <Card className="xl:sticky xl:top-4">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <EntityTypeIcon entityType="ingredient" className="h-4 w-4" />
          Ingredient Detail
        </CardTitle>
        <CardDescription>
          {activeIngredientId ? "Lazy-loaded metadata, ontology, pair graph, aliases, and recipe usage." : "Select a row to inspect detail."}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {!activeIngredientId ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No ingredient selected.
          </div>
        ) : activeDetail == null ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            {loadingId === activeIngredientId ? "Loading ingredient detail…" : activeError ?? "Select an ingredient."}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg border border-border/80 bg-muted/40 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="inline-flex items-center gap-1.5 text-sm font-semibold">
                    <EntityTypeIcon
                      entityType="ingredient"
                      canonicalName={activeDetail.ingredient.canonical_name}
                      normalizedKey={activeDetail.ingredient.normalized_key}
                      metadata={activeDetail.ingredient.metadata}
                      className="h-4 w-4"
                    />
                    {activeDetail.ingredient.canonical_name}
                  </p>
                  <p className="font-mono text-[11px] text-muted-foreground">{activeDetail.ingredient.normalized_key}</p>
                  <p className="font-mono text-[10px] text-muted-foreground">{shortId(activeDetail.ingredient.id)}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge variant="outline" className="text-[10px]">{activeDetail.aliases.length} aliases</Badge>
                  <Badge variant="outline" className="text-[10px]">{activeDetail.ontology_links.length} ontology</Badge>
                  <Badge variant="outline" className="text-[10px]">{activeDetail.pair_links.length} pairs</Badge>
                  <Badge variant="outline" className="text-[10px]">{activeDetail.usages.length} uses</Badge>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span>Graph edges: {activeDetail.graph.total_edges}</span>
                <span>Updated: {new Date(activeDetail.ingredient.updated_at).toLocaleString()}</span>
              </div>
            </div>

            <Tabs defaultValue="metadata" className="w-full">
              <div className="overflow-x-auto">
                <TabsList className="h-auto min-w-full justify-start gap-1">
                  <TabsTrigger value="metadata">Metadata</TabsTrigger>
                  <TabsTrigger value="ontology">Ontology</TabsTrigger>
                  <TabsTrigger value="pairs">Pairs</TabsTrigger>
                  <TabsTrigger value="usage">Usage</TabsTrigger>
                  <TabsTrigger value="aliases">Aliases</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="metadata" className="space-y-3">
                <div className="grid gap-2">
                  {Object.entries(activeDetail.ingredient.metadata).length === 0 ? (
                    <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No metadata keys persisted.</p>
                  ) : (
                    Object.entries(activeDetail.ingredient.metadata).map(([key, value]) => (
                      <div key={key} className="rounded-md border p-2">
                        <p className="font-mono text-[11px] text-muted-foreground">{key}</p>
                        <p className="mt-1 text-xs">{metadataValueLabel(value)}</p>
                      </div>
                    ))
                  )}
                </div>
              </TabsContent>

              <TabsContent value="ontology">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Term</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Relation</TableHead>
                      <TableHead>Confidence</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeDetail.ontology_links.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                          No ontology links.
                        </TableCell>
                      </TableRow>
                    ) : (
                      activeDetail.ontology_links.slice(0, 80).map((link) => (
                        <TableRow key={link.id}>
                          <TableCell>
                            <p className="text-xs font-medium">{link.term?.label ?? "Unknown term"}</p>
                            <p className="font-mono text-[10px] text-muted-foreground">{link.term?.term_key ?? "n/a"}</p>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{link.term?.term_type ?? "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px]">{link.relation_type}</Badge>
                          </TableCell>
                          <TableCell className="text-xs">{link.confidence.toFixed(2)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TabsContent>

              <TabsContent value="pairs">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ingredient</TableHead>
                      <TableHead>Co-occur</TableHead>
                      <TableHead>Lift</TableHead>
                      <TableHead>PMI</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeDetail.pair_links.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                          No pair stats yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      activeDetail.pair_links.slice(0, 80).map((pair) => (
                        <TableRow key={pair.ingredient_id}>
                          <TableCell>
                            <p className="text-xs font-medium">{pair.canonical_name}</p>
                            <p className="font-mono text-[10px] text-muted-foreground">{pair.normalized_key ?? "—"}</p>
                          </TableCell>
                          <TableCell className="text-xs">{pair.co_occurrence_count}</TableCell>
                          <TableCell className="text-xs">{formatMaybeNumber(pair.lift, 3)}</TableCell>
                          <TableCell className="text-xs">{formatMaybeNumber(pair.pmi, 3)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TabsContent>

              <TabsContent value="usage">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Recipe</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeDetail.usages.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                          No recipe usage rows.
                        </TableCell>
                      </TableRow>
                    ) : (
                      activeDetail.usages.slice(0, 80).map((usage) => (
                        <TableRow key={usage.id}>
                          <TableCell>
                            {usage.recipe_id ? (
                              <Link href={`/content/recipes?recipe=${usage.recipe_id}`} className="inline-flex items-center gap-1.5 text-xs font-medium underline-offset-2 hover:underline">
                                <EntityTypeIcon entityType="recipe" className="h-3.5 w-3.5" />
                                {usage.recipe_title}
                              </Link>
                            ) : (
                              <p className="inline-flex items-center gap-1.5 text-xs font-medium">
                                <EntityTypeIcon entityType="recipe" className="h-3.5 w-3.5" />
                                {usage.recipe_title}
                              </p>
                            )}
                            <p className="font-mono text-[10px] text-muted-foreground">{shortId(usage.recipe_version_id)}</p>
                          </TableCell>
                          <TableCell className="text-xs">
                            {usage.source_name}
                            <p className="text-[10px] text-muted-foreground">
                              {usage.source_amount ?? "?"} {usage.source_unit ?? ""}
                            </p>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px]",
                                usage.normalized_status === "normalized"
                                  ? STATUS_TONES.success
                                  : STATUS_TONES.warning
                              )}
                            >
                              {usage.normalized_status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TabsContent>

              <TabsContent value="aliases">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Alias</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Confidence</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeDetail.aliases.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                          No aliases.
                        </TableCell>
                      </TableRow>
                    ) : (
                      activeDetail.aliases.slice(0, 80).map((alias) => (
                        <TableRow key={alias.id}>
                          <TableCell className="font-mono text-xs">{alias.alias_key}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{alias.source}</TableCell>
                          <TableCell className="text-xs">{alias.confidence.toFixed(2)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
