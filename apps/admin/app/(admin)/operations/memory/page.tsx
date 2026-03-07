import { AnalyticsMovedNotice } from "@/components/admin/analytics-moved-notice";
import { MemoryJobsTable } from "@/components/admin/memory-jobs-table";
import { PageHeader } from "@/components/admin/page-header";
import { MemoryActions } from "@/components/admin/memory-actions";
import { MemoryPipelineControls } from "@/components/admin/memory-pipeline-controls";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getMemoryData } from "@/lib/admin-data";

export default async function MemoryPage(): Promise<React.JSX.Element> {
  const data = await getMemoryData();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Memory"
        description="Operational view for memory extraction jobs, stored records, and per-user snapshots."
      />

      <AnalyticsMovedNotice
        title="Memory telemetry moved to Analytics"
        description="Use Analytics / Pipelines for queue trends, throughput, and failure counts. This page stays focused on the actual memory records and extraction queue."
        href="/analytics/pipelines"
        cta="Open pipeline analytics"
      />

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
          <div>
            <CardTitle className="text-base">Memory Extraction Queue</CardTitle>
            <CardDescription>Async per-turn memory jobs with retry controls.</CardDescription>
          </div>
          <MemoryPipelineControls />
        </CardHeader>
        <CardContent className="pt-0">
          <MemoryJobsTable jobs={data.jobs} />
        </CardContent>
      </Card>

      {/* Memory Records — the actual content */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
          <div>
            <CardTitle className="text-base">Memory Records</CardTitle>
            <CardDescription className="mt-0.5">
              What each user&apos;s AI actually remembers — type, content, and quality signals.
            </CardDescription>
          </div>
          <Badge variant="outline" className="font-mono text-xs">{data.memories.length} records</Badge>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Type / Kind</TableHead>
                <TableHead>Content</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Conf / Sal</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.memories.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No memory entries yet. Memories are created when users interact with the AI.
                  </TableCell>
                </TableRow>
              ) : (
                data.memories.map((memory) => {
                  const conf = Number(memory.confidence);
                  const sal = Number(memory.salience);
                  return (
                    <TableRow key={memory.id}>
                      <TableCell>
                        <p className="text-sm font-medium">{memory.email ?? "Unknown"}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">{memory.user_id.slice(0, 8)}…</p>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium text-sm">{memory.memory_type}</p>
                        <p className="text-xs text-muted-foreground">{memory.memory_kind}</p>
                      </TableCell>
                      <TableCell className="max-w-[300px]">
                        {memory.content ? (
                          <p className="text-xs text-zinc-700 leading-relaxed">
                            {memory.content.length > 180 ? `${memory.content.slice(0, 180)}…` : memory.content}
                          </p>
                        ) : (
                          <span className="text-xs italic text-muted-foreground/60">No content stored</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={memory.status === "active" ? "default" : "secondary"}
                          className={memory.status === "active" ? "border-emerald-300 bg-emerald-50 text-emerald-700" : undefined}
                        >
                          {memory.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1.5">
                            <div className="h-1 w-12 overflow-hidden rounded-full bg-zinc-100">
                              <div className="h-full rounded-full bg-primary" style={{ width: `${conf * 100}%` }} />
                            </div>
                            <span className="text-[10px] tabular-nums text-muted-foreground">{conf.toFixed(2)}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="h-1 w-12 overflow-hidden rounded-full bg-zinc-100">
                              <div className="h-full rounded-full bg-violet-400" style={{ width: `${sal * 100}%` }} />
                            </div>
                            <span className="text-[10px] tabular-nums text-muted-foreground">{sal.toFixed(2)}</span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(memory.updated_at).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Snapshots */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
          <div>
            <CardTitle className="text-base">Memory Snapshots</CardTitle>
            <CardDescription className="mt-0.5">Compact context packs injected into chat flows per user.</CardDescription>
          </div>
          <Badge variant="outline" className="font-mono text-xs">{data.snapshots.length} snapshots</Badge>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Token Estimate</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.snapshots.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    No memory snapshots yet.
                  </TableCell>
                </TableRow>
              ) : (
                data.snapshots.map((snapshot) => (
                  <TableRow key={`${snapshot.user_id}-${snapshot.updated_at}`}>
                    <TableCell>
                      <p className="text-sm font-medium">{snapshot.email ?? "Unknown user"}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">{snapshot.user_id.slice(0, 8)}…</p>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-100">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${Math.min((snapshot.token_estimate / 2000) * 100, 100)}%` }}
                          />
                        </div>
                        <span className="font-medium tabular-nums">{snapshot.token_estimate.toLocaleString()}</span>
                        <span className="text-xs text-muted-foreground">tokens</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(snapshot.updated_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <MemoryActions userId={snapshot.user_id} />
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
