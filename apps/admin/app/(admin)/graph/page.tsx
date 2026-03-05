import Link from "next/link";
import { GraphTablesPanel } from "@/components/admin/graph-tables-panel";
import { GraphVisualizer } from "@/components/admin/graph-visualizer";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getGraphData } from "@/lib/admin-data";

const entityTypeColors: Record<string, string> = {
  recipe: "border-blue-300 bg-blue-50 text-blue-700",
  ingredient: "border-emerald-300 bg-emerald-50 text-emerald-700",
  category: "border-amber-300 bg-amber-50 text-amber-700",
  keyword: "border-rose-300 bg-rose-50 text-rose-700"
};

export default async function GraphPage({
  searchParams
}: {
  searchParams: Promise<{ recipe?: string }>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const recipeId = typeof params.recipe === "string" && params.recipe.trim().length > 0 ? params.recipe.trim() : undefined;
  const graph = await getGraphData(recipeId);

  const entityTypeSet = new Set(graph.entities.map((entity) => entity.entity_type));
  const avgConfidence =
    graph.edges.length > 0
      ? graph.edges.reduce((sum, edge) => sum + edge.confidence, 0) / graph.edges.length
      : 0;
  const activeQueueJobs = graph.metadata_queue.pending + graph.metadata_queue.processing;

  return (
    <div className="min-w-0 space-y-6 overflow-x-hidden">
      <PageHeader
        title="Graph Inspector"
        description="Visual and tabular inspection for recipe, ingredient, category, and keyword graph links."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Entities</p>
          </CardHeader>
          <CardContent className="pb-4">
            <p className="text-2xl font-bold tabular-nums">{graph.entities.length}</p>
            <p className="mt-1 text-xs text-muted-foreground">{entityTypeSet.size} types</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Edges</p>
          </CardHeader>
          <CardContent className="pb-4">
            <p className="text-2xl font-bold tabular-nums">{graph.edges.length}</p>
            <p className="mt-1 text-xs text-muted-foreground">weighted relationships</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Avg Confidence</p>
          </CardHeader>
          <CardContent className="pb-4">
            <p className="text-2xl font-bold tabular-nums">{avgConfidence.toFixed(2)}</p>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
              <div className="h-full rounded-full bg-primary" style={{ width: `${avgConfidence * 100}%` }} />
            </div>
          </CardContent>
        </Card>
      </div>

      {graph.entities.length === 0 && activeQueueJobs > 0 ? (
        <Card>
          <CardContent className="py-4">
            <p className="text-sm">
              Graph is empty because metadata enrichment is still queued:{" "}
              <span className="font-mono">{graph.metadata_queue.pending}</span> pending,{" "}
              <span className="font-mono">{graph.metadata_queue.processing}</span> processing.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {graph.context_recipe_id ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-2 py-3">
            <p className="text-sm">
              Focused on recipe context <span className="font-mono text-xs">{graph.context_recipe_id}</span>
            </p>
            <Link href="/graph">
              <Button variant="outline" size="sm">Clear Context</Button>
            </Link>
          </CardContent>
        </Card>
      ) : null}

      <Tabs defaultValue="visual" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="visual">Visual</TabsTrigger>
          <TabsTrigger value="tables">Tables</TabsTrigger>
        </TabsList>

        <TabsContent value="visual">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Visual Graph</CardTitle>
              <CardDescription>
                Interactive force graph with pan/zoom, drag-to-pull, readable labels, hover tooltips, and fullscreen mode.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <GraphVisualizer graph={graph} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tables">
          <GraphTablesPanel graph={graph} entityTypeColors={entityTypeColors} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
