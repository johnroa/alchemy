import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { EntityTypeIcon } from "@/components/admin/entity-type-icon";
import { IngredientsRegistryExplorer } from "@/components/admin/ingredients-registry-explorer";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { getIngredientsData } from "@/lib/admin-data";

const toPercent = (value: number): string => `${(value * 100).toFixed(1)}%`;

const toDecimal = (value: number | null, digits = 2): string => {
  if (value == null) return "—";
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

const toShortInteger = (value: number): string => value.toLocaleString();

type Delta = {
  absolute: number;
  percent: number | null;
};

const deltaFromWindow = (current: number, previous: number): Delta => {
  const absolute = current - previous;
  if (previous === 0) {
    return { absolute, percent: null };
  }
  return { absolute, percent: (absolute / previous) * 100 };
};

const deltaTone = (delta: Delta): "up" | "down" | "flat" => {
  if (delta.absolute > 0) return "up";
  if (delta.absolute < 0) return "down";
  return "flat";
};

function DeltaBadge({
  delta,
  positiveIsGood = true
}: {
  delta: Delta;
  positiveIsGood?: boolean;
}): React.JSX.Element {
  const tone = deltaTone(delta);
  const effectiveTone =
    tone === "flat"
      ? "flat"
      : positiveIsGood
        ? tone
        : tone === "up"
          ? "down"
          : "up";

  const Icon = effectiveTone === "up" ? ArrowUpRight : effectiveTone === "down" ? ArrowDownRight : null;
  const deltaAbsoluteLabel = `${delta.absolute >= 0 ? "+" : ""}${delta.absolute.toLocaleString()}`;
  const deltaPercentLabel =
    delta.percent == null ? (delta.absolute === 0 ? "0%" : "new") : `${delta.percent >= 0 ? "+" : ""}${delta.percent.toFixed(1)}%`;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium",
        effectiveTone === "up" && "border-emerald-300 bg-emerald-50 text-emerald-700",
        effectiveTone === "down" && "border-red-300 bg-red-50 text-red-700",
        effectiveTone === "flat" && "border-zinc-300 bg-zinc-50 text-zinc-600"
      )}
    >
      {Icon ? <Icon className="h-3 w-3" /> : null}
      <span>{deltaAbsoluteLabel}</span>
      <span className="text-[10px] opacity-80">({deltaPercentLabel})</span>
    </span>
  );
}

export default async function IngredientsPage(): Promise<React.JSX.Element> {
  const data = await getIngredientsData();
  const { totals, rates, averages, windows } = data.summary;

  const ingredientsAddedDelta = deltaFromWindow(windows.ingredients_added.current, windows.ingredients_added.previous);
  const aliasesAddedDelta = deltaFromWindow(windows.aliases_added.current, windows.aliases_added.previous);
  const enrichmentsCompletedDelta = deltaFromWindow(windows.enrichments_completed.current, windows.enrichments_completed.previous);
  const ontologyLinksAddedDelta = deltaFromWindow(windows.ontology_links_added.current, windows.ontology_links_added.previous);
  const pairLinksUpdatedDelta = deltaFromWindow(windows.pair_links_updated.current, windows.pair_links_updated.previous);
  const unresolvedTouchedDelta = deltaFromWindow(windows.unresolved_touched.current, windows.unresolved_touched.previous);

  const metricCards = [
    {
      label: "Canonical Ingredients",
      value: toShortInteger(totals.ingredients),
      hint: `${toShortInteger(totals.mapped_ingredients)} mapped (${toPercent(rates.mapped_coverage)})`,
      progress: rates.mapped_coverage
    },
    {
      label: "Enrichment Coverage",
      value: toPercent(rates.enriched_coverage),
      hint: `${toShortInteger(totals.enriched_ingredients)} enriched ingredients`,
      progress: rates.enriched_coverage
    },
    {
      label: "Avg Confidence",
      value: toDecimal(averages.enrichment_confidence),
      hint: averages.enrichment_confidence == null ? "No confidence scores yet" : `${toPercent(averages.enrichment_confidence)} mean score`,
      progress: averages.enrichment_confidence ?? 0
    },
    {
      label: "Avg Ingredients / Recipe",
      value: toDecimal(averages.ingredients_per_recipe),
      hint: `${toShortInteger(totals.recipes_with_current_version)} recipes with current versions`,
      progress: totals.recipe_ingredient_rows > 0 ? Math.min(1, (averages.ingredients_per_recipe ?? 0) / 20) : 0
    },
    {
      label: "Ontology Coverage",
      value: toPercent(rates.ontology_coverage),
      hint: `${toShortInteger(totals.ontology_links)} ontology links`,
      progress: rates.ontology_coverage
    },
    {
      label: "Needs Retry Rate",
      value: toPercent(rates.unresolved_rate),
      hint: `${toShortInteger(totals.unresolved_rows)} unresolved of ${toShortInteger(totals.recipe_ingredient_rows)} rows`,
      progress: rates.unresolved_rate,
      warning: rates.unresolved_rate > 0.1
    }
  ];

  const totalAliases = totals.aliases;
  const unresolvedCount = totals.unresolved_rows;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Ingredients"
        description="Canonical ingredient registry, enrichment metadata, ontology links, and unresolved normalization rows."
        icon={<EntityTypeIcon entityType="ingredient" className="h-6 w-6 text-emerald-600" />}
      />

      <section className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/70">Coverage Snapshot</p>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {metricCards.map((metric) => (
            <Card
              key={metric.label}
              className={cn(
                "transition-colors",
                metric.warning
                  ? "border-amber-200 bg-amber-50"
                  : metric.progress >= 0.7
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-zinc-200"
              )}
            >
              <CardHeader className="pb-2">
                <CardDescription className="text-[11px] uppercase tracking-wider text-muted-foreground/80">{metric.label}</CardDescription>
                <CardTitle className="text-3xl tabular-nums">{metric.value}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                <p className="text-xs text-muted-foreground">{metric.hint}</p>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200/80">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      metric.warning ? "bg-amber-500" : metric.progress >= 0.7 ? "bg-emerald-500" : "bg-zinc-500"
                    )}
                    style={{ width: `${Math.max(0, Math.min(100, metric.progress * 100))}%` }}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/70">
          Velocity (Last 24h vs Prior 24h)
        </p>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Ingredients Added</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{windows.ingredients_added.current}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <DeltaBadge delta={ingredientsAddedDelta} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Aliases Added</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{windows.aliases_added.current}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <DeltaBadge delta={aliasesAddedDelta} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Enrichments Completed</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{windows.enrichments_completed.current}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <DeltaBadge delta={enrichmentsCompletedDelta} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Ontology Links Added</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{windows.ontology_links_added.current}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <DeltaBadge delta={ontologyLinksAddedDelta} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Pair Links Updated</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{windows.pair_links_updated.current}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <DeltaBadge delta={pairLinksUpdatedDelta} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Unresolved Rows Touched</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{windows.unresolved_touched.current}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <DeltaBadge delta={unresolvedTouchedDelta} positiveIsGood={false} />
            </CardContent>
          </Card>
        </div>
      </section>

      <IngredientsRegistryExplorer ingredients={data.ingredients} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
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
                            <EntityTypeIcon entityType="ingredient" className="h-3.5 w-3.5 text-emerald-600" />
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
          <CardHeader className="flex flex-row items-center justify-between pb-3">
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
                          <EntityTypeIcon entityType="ingredient" className="h-3.5 w-3.5 text-emerald-600" />
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
