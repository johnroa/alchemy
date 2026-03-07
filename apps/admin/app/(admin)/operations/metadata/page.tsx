import { AlertCircle, CheckCircle2, Clock3, Loader2 } from "lucide-react";
import { KpiCard } from "@/components/admin/kpi-card";
import { MetadataJobsTable } from "@/components/admin/metadata-jobs-table";
import { MetadataPipelineControls } from "@/components/admin/metadata-pipeline-controls";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getMetadataPipelineData } from "@/lib/admin-data";

export default async function MetadataPipelinePage(): Promise<React.JSX.Element> {
  const data = await getMetadataPipelineData();

  const pending = data.jobs.filter((job) => job.status === "pending").length;
  const processing = data.jobs.filter((job) => job.status === "processing").length;
  const ready = data.jobs.filter((job) => job.status === "ready").length;
  const failed = data.jobs.filter((job) => job.status === "failed").length;
  const total = data.jobs.length;
  const recentErrors = data.jobs.filter((job) => Boolean(job.last_error)).slice(0, 15);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Metadata Pipeline"
        description="Canonical ingredient enrichment queue with self-healing retries and lock recovery controls."
        actions={<MetadataPipelineControls />}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Pending" value={String(pending)} hint="Waiting for processing" icon={Clock3} variant={pending > 20 ? "warning" : "default"} />
        <KpiCard label="Processing" value={String(processing)} hint="Currently locked by processor" icon={Loader2} />
        <KpiCard label="Ready" value={String(ready)} hint="Metadata and graph links completed" icon={CheckCircle2} variant={ready > 0 ? "success" : "muted"} />
        <KpiCard label="Failed" value={String(failed)} hint="Requires retry" icon={AlertCircle} variant={failed > 0 ? "danger" : "success"} />
      </div>

      {total > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Queue Distribution</CardTitle>
            <CardDescription>{total} total metadata jobs</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-zinc-100">
              {pending > 0 && <div style={{ width: `${(pending / total) * 100}%` }} className="bg-amber-400" title={`Pending: ${pending}`} />}
              {processing > 0 && <div style={{ width: `${(processing / total) * 100}%` }} className="bg-blue-400" title={`Processing: ${processing}`} />}
              {ready > 0 && <div style={{ width: `${(ready / total) * 100}%` }} className="bg-emerald-400" title={`Ready: ${ready}`} />}
              {failed > 0 && <div style={{ width: `${(failed / total) * 100}%` }} className="bg-red-400" title={`Failed: ${failed}`} />}
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400" />Pending ({pending})</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-blue-400" />Processing ({processing})</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400" />Ready ({ready})</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-400" />Failed ({failed})</span>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
          <div>
            <CardTitle className="text-base">Metadata Jobs</CardTitle>
            <CardDescription>Queue state, lock ownership, and retry controls.</CardDescription>
          </div>
          <Badge variant="outline" className="font-mono text-xs">{total} jobs</Badge>
        </CardHeader>
        <CardContent className="pt-0">
          <MetadataJobsTable jobs={data.jobs} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Errors</CardTitle>
          <CardDescription>Latest metadata jobs with error payloads.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Recipe</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Error</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentErrors.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">No recent metadata errors.</TableCell>
                </TableRow>
              ) : (
                recentErrors.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>
                      <p className="text-sm font-medium">{job.recipe_title ?? "Untitled Recipe"}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">{job.recipe_id}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">{job.status}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[420px] truncate text-xs text-red-600">{job.last_error}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(job.updated_at).toLocaleString()}</TableCell>
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
