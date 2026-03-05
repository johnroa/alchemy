import { ImageIcon, ImageOff, Layers, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { ImageJobsTable } from "@/components/admin/image-jobs-table";
import { ImagePipelineControls } from "@/components/admin/image-pipeline-controls";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/admin/kpi-card";
import { getImagePipelineData } from "@/lib/admin-data";

export default async function ImagePipelinePage(): Promise<React.JSX.Element> {
  const data = await getImagePipelineData();

  const pending = data.jobs.filter((job) => job.status === "pending").length;
  const processing = data.jobs.filter((job) => job.status === "processing").length;
  const ready = data.jobs.filter((job) => job.status === "ready").length;
  const failed = data.jobs.filter((job) => job.status === "failed").length;
  const total = data.jobs.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Image Pipeline"
        description="AI image generation lifecycle — queue state, retry tracking, and batch processing."
        actions={<ImagePipelineControls />}
      />

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Pending"
          value={String(pending)}
          hint="Queued, not yet started"
          icon={Layers}
          variant={pending > 20 ? "warning" : "default"}
        />
        <KpiCard
          label="Processing"
          value={String(processing)}
          hint="Currently being generated"
          icon={Loader2}
        />
        <KpiCard
          label="Ready"
          value={String(ready)}
          hint="Successfully generated"
          icon={ImageIcon}
          variant={ready > 0 ? "success" : "muted"}
        />
        <KpiCard
          label="Failed"
          value={String(failed)}
          hint="Jobs requiring retry or policy fix"
          icon={ImageOff}
          variant={failed > 0 ? "danger" : "success"}
        />
      </div>

      {/* Pipeline distribution */}
      {total > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pipeline Distribution</CardTitle>
            <CardDescription>{total} total jobs across all statuses</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-zinc-100">
              {pending > 0 && (
                <div
                  style={{ width: `${(pending / total) * 100}%` }}
                  className="bg-amber-400 transition-all"
                  title={`Pending: ${pending}`}
                />
              )}
              {processing > 0 && (
                <div
                  style={{ width: `${(processing / total) * 100}%` }}
                  className="bg-blue-400 transition-all"
                  title={`Processing: ${processing}`}
                />
              )}
              {ready > 0 && (
                <div
                  style={{ width: `${(ready / total) * 100}%` }}
                  className="bg-emerald-400 transition-all"
                  title={`Ready: ${ready}`}
                />
              )}
              {failed > 0 && (
                <div
                  style={{ width: `${(failed / total) * 100}%` }}
                  className="bg-red-400 transition-all"
                  title={`Failed: ${failed}`}
                />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                Pending ({pending})
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-blue-400" />
                Processing ({processing})
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Ready ({ready})
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-red-400" />
                Failed ({failed})
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Job Queue */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
          <div>
            <CardTitle className="text-base">Job Queue</CardTitle>
            <CardDescription className="mt-0.5">Per-recipe image generation retries and terminal errors.</CardDescription>
          </div>
          <Badge variant="outline" className="font-mono text-xs">
            {total} jobs
          </Badge>
        </CardHeader>
        <CardContent className="pt-0">
          <ImageJobsTable jobs={data.jobs} />
        </CardContent>
      </Card>
    </div>
  );
}
