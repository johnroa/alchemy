import Link from "next/link";
import { MemoryJobsTable } from "@/components/admin/memory-jobs-table";
import { PageHeader } from "@/components/admin/page-header";
import { MemoryActions } from "@/components/admin/memory-actions";
import { MemoryPipelineControls } from "@/components/admin/memory-pipeline-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getMemoryData } from "@/lib/admin-data";

const formatTimestamp = (value: string | null): string => {
  if (!value) {
    return "—";
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    return "—";
  }
  return new Date(time).toLocaleString();
};

export default async function MemoryPage(): Promise<React.JSX.Element> {
  const data = await getMemoryData();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Memory"
        description="Operate the live memory pipeline, track retrieval coverage, and repair per-user memory artifacts from one place."
      />

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-3">
          <div>
            <CardTitle className="text-base">Memory Operations</CardTitle>
            <CardDescription>
              Queue controls, retrieval coverage, and per-user repair workflows. Broader cross-pipeline trends remain in Analytics.
            </CardDescription>
          </div>
          <Button asChild variant="outline">
            <Link href="/analytics/pipelines">Open pipeline analytics</Link>
          </Button>
        </CardHeader>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pending Jobs</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{data.summary.queue.pending}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Oldest due job: {formatTimestamp(data.summary.queue.oldest_due_job_at)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Failed Jobs</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{data.summary.queue.failed}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Stale locks: {data.summary.queue.stale_locked_jobs}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Indexed Retrieval Docs</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{data.summary.retrieval.indexed_document_count}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Coverage: {data.summary.retrieval.coverage_percent.toFixed(2)}%
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Affected Users</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{data.summary.retrieval.affected_user_count}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Missing docs: {data.summary.retrieval.missing_document_count}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr,0.85fr]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Queue Health</CardTitle>
            <CardDescription>
              Current queue pressure and the last {data.summary.queue.recent_activity.length} hourly buckets of processed vs failed jobs.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-lg border p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Processing</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{data.summary.queue.processing}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Ready</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{data.summary.queue.ready}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Pending</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{data.summary.queue.pending}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Failed</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{data.summary.queue.failed}</p>
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bucket</TableHead>
                  <TableHead>Processed</TableHead>
                  <TableHead>Failed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.summary.queue.recent_activity.map((bucket) => (
                  <TableRow key={bucket.label}>
                    <TableCell>{bucket.label}</TableCell>
                    <TableCell className="tabular-nums">{bucket.processed}</TableCell>
                    <TableCell className="tabular-nums">{bucket.failed}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Retrieval Coverage</CardTitle>
            <CardDescription>
              Memory retrieval docs, current indexing gaps, and the latest rebuild/backfill activity.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-0 text-sm">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-muted-foreground">Active memories</span>
              <span className="font-semibold tabular-nums">{data.summary.retrieval.active_memory_count}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-muted-foreground">Indexed docs</span>
              <span className="font-semibold tabular-nums">{data.summary.retrieval.indexed_document_count}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-muted-foreground">Missing docs</span>
              <span className="font-semibold tabular-nums">{data.summary.retrieval.missing_document_count}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-muted-foreground">Coverage</span>
              <span className="font-semibold tabular-nums">{data.summary.retrieval.coverage_percent.toFixed(2)}%</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-muted-foreground">Last reindex activity</span>
              <span className="font-medium">{formatTimestamp(data.summary.retrieval.last_reindex_at)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
          <div>
            <CardTitle className="text-base">Memory Queue</CardTitle>
            <CardDescription>Drain the queue, retry failed jobs, and inspect job metadata.</CardDescription>
          </div>
          <MemoryPipelineControls />
        </CardHeader>
        <CardContent className="pt-0">
          <MemoryJobsTable jobs={data.jobs} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
          <div>
            <CardTitle className="text-base">Per-User Health</CardTitle>
            <CardDescription>
              Users with the highest queue pressure or retrieval coverage gaps, with direct repair actions.
            </CardDescription>
          </div>
          <Badge variant="outline" className="font-mono text-xs">{data.users.length} users</Badge>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Active Memories</TableHead>
                <TableHead>Indexed Docs</TableHead>
                <TableHead>Missing Docs</TableHead>
                <TableHead>Snapshot</TableHead>
                <TableHead>Queue</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No user memory activity yet.
                  </TableCell>
                </TableRow>
              ) : (
                data.users.map((user) => (
                  <TableRow key={user.user_id}>
                    <TableCell>
                      <p className="text-sm font-medium">{user.email ?? "Unknown user"}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">{user.user_id.slice(0, 8)}…</p>
                    </TableCell>
                    <TableCell className="tabular-nums">{user.active_memory_count}</TableCell>
                    <TableCell className="tabular-nums">{user.indexed_document_count}</TableCell>
                    <TableCell className="tabular-nums">
                      {user.missing_document_count > 0 ? (
                        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
                          {user.missing_document_count}
                        </Badge>
                      ) : (
                        0
                      )}
                    </TableCell>
                    <TableCell>
                      <p className="tabular-nums">{user.snapshot_token_estimate}</p>
                      <p className="text-xs text-muted-foreground">{formatTimestamp(user.snapshot_updated_at)}</p>
                    </TableCell>
                    <TableCell>
                      <p className="tabular-nums">pending {user.pending_job_count}</p>
                      <p className="tabular-nums text-xs text-muted-foreground">failed {user.failed_job_count}</p>
                    </TableCell>
                    <TableCell className="text-right">
                      <MemoryActions userId={user.user_id} />
                    </TableCell>
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
            <CardTitle className="text-base">Memory Records</CardTitle>
            <CardDescription>
              Current memory content plus whether each record has a retrieval doc and when it was last indexed.
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
                <TableHead>Retrieval</TableHead>
                <TableHead>Conf / Sal</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.memories.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    No memory entries yet.
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
                      <TableCell className="max-w-[320px]">
                        {memory.content ? (
                          <p className="text-xs leading-relaxed text-zinc-700">
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
                        <Badge
                          variant="outline"
                          className={memory.retrieval_status === "indexed"
                            ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                            : "border-amber-300 bg-amber-50 text-amber-700"}
                        >
                          {memory.retrieval_status}
                        </Badge>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatTimestamp(memory.retrieval_indexed_at)}
                        </p>
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
                        {formatTimestamp(memory.updated_at)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
