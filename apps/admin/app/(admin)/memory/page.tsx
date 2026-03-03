import { Brain, Sparkles, Trash2 } from "lucide-react";
import { MemoryJobsTable } from "@/components/admin/memory-jobs-table";
import { PageHeader } from "@/components/admin/page-header";
import { KpiCard } from "@/components/admin/kpi-card";
import { MemoryActions } from "@/components/admin/memory-actions";
import { MemoryPipelineControls } from "@/components/admin/memory-pipeline-controls";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getMemoryData } from "@/lib/admin-data";

const memoryTypeColors: string[] = [
  "bg-blue-400",
  "bg-emerald-400",
  "bg-violet-400",
  "bg-amber-400",
  "bg-rose-400",
  "bg-cyan-400"
];

export default async function MemoryPage(): Promise<React.JSX.Element> {
  const data = await getMemoryData();

  const activeCount = data.memories.filter((row) => row.status === "active").length;
  const supersededCount = data.memories.filter((row) => row.status === "superseded").length;
  const avgConfidence =
    data.memories.length > 0
      ? data.memories.reduce((sum, m) => sum + Number(m.confidence), 0) / data.memories.length
      : 0;
  const avgSalience =
    data.memories.length > 0
      ? data.memories.reduce((sum, m) => sum + Number(m.salience), 0) / data.memories.length
      : 0;
  const pendingJobs = data.jobs.filter((job) => job.status === "pending").length;
  const processingJobs = data.jobs.filter((job) => job.status === "processing").length;
  const readyJobs = data.jobs.filter((job) => job.status === "ready").length;
  const failedJobs = data.jobs.filter((job) => job.status === "failed").length;

  // Memory type distribution
  const typeCounts: Record<string, number> = {};
  for (const m of data.memories) {
    typeCounts[m.memory_type] = (typeCounts[m.memory_type] ?? 0) + 1;
  }
  const sortedTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  const maxTypeCount = sortedTypes[0]?.[1] ?? 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Memory"
        description="User memory snapshots, quality signals, and the actual content stored per user."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Active Snapshots"
          value={String(data.snapshots.length)}
          hint="Users with memory context packs"
          icon={Brain}
          variant={data.snapshots.length > 0 ? "default" : "muted"}
        />
        <KpiCard
          label="Active Memories"
          value={String(activeCount)}
          hint="Live records influencing generation"
          icon={Sparkles}
          variant="success"
        />
        <KpiCard
          label="Superseded"
          value={String(supersededCount)}
          hint="Retired — no longer applied"
          icon={Trash2}
          variant={supersededCount > activeCount * 2 ? "warning" : "muted"}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Queue Pending" value={String(pendingJobs)} hint="Waiting for extraction" variant={pendingJobs > 50 ? "warning" : "default"} />
        <KpiCard label="Queue Processing" value={String(processingJobs)} hint="Locked by worker" />
        <KpiCard label="Queue Ready" value={String(readyJobs)} hint="Completed turns" variant={readyJobs > 0 ? "success" : "muted"} />
        <KpiCard label="Queue Failed" value={String(failedJobs)} hint="Needs retry" variant={failedJobs > 0 ? "danger" : "success"} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
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

      {/* Quality charts */}
      {data.memories.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Avg Confidence</p>
            </CardHeader>
            <CardContent className="pb-4 space-y-2">
              <p className="text-2xl font-bold tabular-nums">{avgConfidence.toFixed(2)}</p>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${avgConfidence * 100}%` }} />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Avg Salience</p>
            </CardHeader>
            <CardContent className="pb-4 space-y-2">
              <p className="text-2xl font-bold tabular-nums">{avgSalience.toFixed(2)}</p>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                <div className="h-full rounded-full bg-violet-400 transition-all" style={{ width: `${avgSalience * 100}%` }} />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Active vs Superseded</p>
            </CardHeader>
            <CardContent className="pb-4 space-y-2">
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-zinc-100">
                {activeCount > 0 && (
                  <div className="bg-emerald-400 transition-all" style={{ width: `${(activeCount / data.memories.length) * 100}%` }} />
                )}
                {supersededCount > 0 && (
                  <div className="bg-zinc-300 transition-all" style={{ width: `${(supersededCount / data.memories.length) * 100}%` }} />
                )}
              </div>
              <div className="flex gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-400" />Active ({activeCount})</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-zinc-300" />Superseded ({supersededCount})</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Memory type distribution */}
      {sortedTypes.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Memory Type Breakdown</CardTitle>
            <CardDescription>{sortedTypes.length} distinct type{sortedTypes.length !== 1 ? "s" : ""} — what users have learned</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {sortedTypes.map(([type, count], index) => (
              <div key={type} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">{type}</span>
                  <span className="tabular-nums text-muted-foreground">{count}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className={`h-full rounded-full transition-all ${memoryTypeColors[index % memoryTypeColors.length]}`}
                    style={{ width: `${(count / maxTypeCount) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Memory Records — the actual content */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
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
        <CardHeader className="flex flex-row items-center justify-between pb-3">
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
