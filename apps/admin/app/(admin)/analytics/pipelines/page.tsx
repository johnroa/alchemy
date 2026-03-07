import { AlertTriangle, ArrowDownToLine, Clock3, Database, ImageIcon, Sparkles } from "lucide-react";
import { FilterBar } from "@/components/admin/filter-bar";
import { KpiCard } from "@/components/admin/kpi-card";
import { PageHeader } from "@/components/admin/page-header";
import { PipelineAnalyticsPanels } from "@/components/admin/pipeline-analytics-panels";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PIPELINE_ANALYTICS_QUERY, parseAnalyticsQueryState } from "@/lib/admin-analytics";
import { getPipelineAnalyticsData } from "@/lib/admin-data";
import { timeAgo } from "@/lib/format";

export default async function AnalyticsPipelinesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const query = parseAnalyticsQueryState(params, PIPELINE_ANALYTICS_QUERY);
  const data = await getPipelineAnalyticsData(query);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pipeline Analytics"
        description="Queue health, throughput, and failure hotspots across images, imports, metadata, and memory."
      />

      <FilterBar query={query} showCompare={false} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Image Pending" value={String(data.summary.imagePending)} hint="Awaiting reuse or generation" icon={ImageIcon} variant={data.summary.imagePending > 0 ? "warning" : "success"} />
        <KpiCard label="Image Failed" value={String(data.summary.imageFailed)} hint="Requests requiring intervention" icon={AlertTriangle} variant={data.summary.imageFailed > 0 ? "danger" : "success"} />
        <KpiCard label="Import Failures" value={String(data.summary.importsFailed)} hint="Failed import provenance rows" icon={ArrowDownToLine} variant={data.summary.importsFailed > 0 ? "danger" : "success"} />
        <KpiCard label="Metadata Pending" value={String(data.summary.metadataPending)} hint="Queued canonical enrichment work" icon={Database} variant={data.summary.metadataPending > 0 ? "warning" : "default"} />
        <KpiCard label="Memory Pending" value={String(data.summary.memoryPending)} hint="Queued memory extraction jobs" icon={Sparkles} variant={data.summary.memoryPending > 0 ? "warning" : "default"} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Throughput and queue shape</CardTitle>
          <CardDescription>Bucketed work volume plus current queue-state distribution.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <PipelineAnalyticsPanels throughput={data.series} statusBreakdown={data.statusBreakdown} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
          <div>
            <CardTitle className="text-base">Recent failures</CardTitle>
            <CardDescription>Most recent pipeline rows with failure context.</CardDescription>
          </div>
          <Badge variant="outline" className="font-mono text-xs">
            {data.recentFailures.length} rows
          </Badge>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pipeline</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recentFailures.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                    No recent failures in the selected window.
                  </TableCell>
                </TableRow>
              ) : (
                data.recentFailures.slice(0, 12).map((row, index) => (
                  <TableRow key={`${row.pipeline}-${row.when}-${index}`}>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {row.pipeline}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm font-medium">{row.label}</TableCell>
                    <TableCell className="max-w-[420px] truncate text-sm text-red-700">{row.reason}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      <div className="inline-flex items-center gap-1">
                        <Clock3 className="h-3.5 w-3.5" />
                        {timeAgo(row.when)}
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
