import { Network } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getGraphData } from "@/lib/admin-data";

const entityTypeColors: Record<string, string> = {
  ingredient: "border-emerald-300 bg-emerald-50 text-emerald-700",
  technique: "border-blue-300 bg-blue-50 text-blue-700",
  cuisine: "border-violet-300 bg-violet-50 text-violet-700",
  equipment: "border-amber-300 bg-amber-50 text-amber-700"
};

export default async function GraphPage(): Promise<React.JSX.Element> {
  const graph = await getGraphData();

  const entityTypeSet = new Set(graph.entities.map((e) => e.entity_type));
  const avgConfidence =
    graph.edges.length > 0
      ? graph.edges.reduce((sum, e) => sum + e.confidence, 0) / graph.edges.length
      : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Graph Inspector"
        description="Typed relational graph entities and weighted edges connecting recipe knowledge concepts."
      />

      {/* Stats row */}
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
            <p className="mt-1 text-xs text-muted-foreground">relational connections</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Avg Confidence</p>
          </CardHeader>
          <CardContent className="pb-4">
            <p className="text-2xl font-bold tabular-nums">{avgConfidence.toFixed(2)}</p>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${avgConfidence * 100}%` }}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Entity Catalog */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Network className="h-4 w-4 text-muted-foreground" />
              Entity Catalog
            </CardTitle>
            <CardDescription className="mt-0.5">
              Most recently updated entities across all types.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Array.from(entityTypeSet).map((type) => (
              <Badge
                key={type}
                variant="outline"
                className={entityTypeColors[type] ?? "text-xs"}
              >
                {type}
              </Badge>
            ))}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {graph.entities.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                    No graph entities yet.
                  </TableCell>
                </TableRow>
              ) : (
                graph.entities.slice(0, 20).map((entity) => (
                  <TableRow key={entity.id}>
                    <TableCell className="font-medium">{entity.label}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={entityTypeColors[entity.entity_type] ?? "text-xs"}
                      >
                        {entity.entity_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {entity.id.slice(0, 8)}…
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edges — now showing labels instead of raw UUIDs */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base">Edge Snapshot</CardTitle>
            <CardDescription className="mt-0.5">
              Top {Math.min(graph.edges.length, 20)} confidence-weighted edges between graph entities.
            </CardDescription>
          </div>
          <Badge variant="outline" className="font-mono text-xs">
            {graph.edges.length} edges
          </Badge>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Confidence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {graph.edges.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                    No edges yet.
                  </TableCell>
                </TableRow>
              ) : (
                graph.edges.slice(0, 20).map((edge) => (
                  <TableRow key={edge.id}>
                    <TableCell className="font-medium text-sm">{edge.from_label}</TableCell>
                    <TableCell className="font-medium text-sm">{edge.to_label}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-zinc-100">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${edge.confidence * 100}%` }}
                          />
                        </div>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {edge.confidence.toFixed(2)}
                        </span>
                      </div>
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
