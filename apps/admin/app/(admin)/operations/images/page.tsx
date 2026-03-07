import { Cpu, ImageIcon } from "lucide-react";
import { AnalyticsMovedNotice } from "@/components/admin/analytics-moved-notice";
import { ImageJobsTable } from "@/components/admin/image-jobs-table";
import { ImagePipelineControls } from "@/components/admin/image-pipeline-controls";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getImagesDashboardData } from "@/lib/admin-data";
import { formatMs, formatPercent } from "@/lib/format";

const routeBadge = (route: { provider: string; model: string } | null): string =>
  route ? `${route.provider}/${route.model}` : "unconfigured";

export default async function ImagesPage(
  { searchParams }: { searchParams: Promise<{ tab?: string }> },
): Promise<React.JSX.Element> {
  const params = await searchParams;
  const data = await getImagesDashboardData();
  const currentTab = typeof params?.tab === "string"
    ? params.tab
    : "overview";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Images"
        description="Candidate-time recipe image resolution, shared asset reuse, queue operations, and quality assurance."
        actions={<ImagePipelineControls />}
      />

      <Tabs defaultValue={currentTab} className="space-y-4">
        <div className="overflow-x-auto">
          <TabsList className="h-auto min-w-full justify-start gap-1">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
            <TabsTrigger value="assets">Assets</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="space-y-6">
          <AnalyticsMovedNotice
            title="Image pipeline telemetry moved to Analytics"
            description={`Use Analytics / Pipelines for queue trends, failure rate, and throughput. This page stays focused on live requests, active routes, and asset inspection. Current failure rate is ${formatPercent(data.overview.failureRate)}.`}
            href="/analytics/pipelines"
            cta="Open pipeline analytics"
          />

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Queue Status</CardTitle>
                <CardDescription>Current request state and resolver backlog.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Pending</span>
                  <span className="font-medium">{data.overview.pendingCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Processing</span>
                  <span className="font-medium">{data.overview.processingCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Ready</span>
                  <span className="font-medium">{data.overview.readyCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Failed</span>
                  <span className="font-medium">{data.overview.failedCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Avg time to ready</span>
                  <span className="font-medium">{formatMs(data.overview.avgReadyLatencyMs)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Requests tracked</span>
                  <span className="font-medium">{data.overview.totalCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Queue rows</span>
                  <span className="font-medium">{data.jobs.length}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Cpu className="h-4 w-4 text-muted-foreground" />
                  Active Routes
                </CardTitle>
                <CardDescription>Current image, judge, and reuse evaluator routes.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Image</span>
                  <Badge variant="outline" className="font-mono text-xs">{routeBadge(data.routes.image)}</Badge>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Quality Judge</span>
                  <Badge variant="outline" className="font-mono text-xs">{routeBadge(data.routes.judge)}</Badge>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Reuse Eval</span>
                  <Badge variant="outline" className="font-mono text-xs">{routeBadge(data.routes.reuse)}</Badge>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="pipeline" className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Live Requests</CardTitle>
              <CardDescription>Recent image requests with candidate and persisted binding counts.</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              {data.requests.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No image requests yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Recipe</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Bindings</TableHead>
                      <TableHead>Error</TableHead>
                      <TableHead>Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.requests.map((request) => (
                      <TableRow key={request.id}>
                        <TableCell>
                          <div className="space-y-0.5">
                            <p className="text-sm font-medium">{request.normalized_title || "Untitled request"}</p>
                            <p className="font-mono text-[11px] text-muted-foreground">{request.id.slice(0, 8)}…</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{request.status}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {request.resolution_source ?? "unresolved"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {request.candidate_binding_count} candidate · {request.persisted_assignment_count} persisted
                        </TableCell>
                        <TableCell className="max-w-[240px] truncate text-xs text-red-600">
                          {request.last_error ?? <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(request.updated_at).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
              <div>
                <CardTitle className="text-base">Job Queue</CardTitle>
                <CardDescription>Retryable work items for unresolved image requests.</CardDescription>
              </div>
              <Badge variant="outline" className="font-mono text-xs">
                {data.jobs.length} jobs
              </Badge>
            </CardHeader>
            <CardContent className="pt-0">
              <ImageJobsTable jobs={data.jobs} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="assets" className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Canonical Assets</CardTitle>
              <CardDescription>Generated assets, usage counts, and latest provenance.</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              {data.assets.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No generated assets yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Asset</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>QA</TableHead>
                      <TableHead>Usage</TableHead>
                      <TableHead>Latest Source</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.assets.map((asset) => (
                      <TableRow key={asset.id}>
                        <TableCell>
                          <div className="space-y-0.5">
                            <a href={asset.image_url} target="_blank" rel="noreferrer" className="text-sm font-medium text-primary hover:underline">
                              Open asset
                            </a>
                            <p className="font-mono text-[11px] text-muted-foreground">{asset.id.slice(0, 8)}…</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {asset.source_provider}/{asset.source_model}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{asset.qa_status}</Badge>
                        </TableCell>
                        <TableCell className="text-sm font-medium">{asset.usage_count}</TableCell>
                        <TableCell className="max-w-[260px] text-xs text-muted-foreground">
                          {asset.latest_request ? (
                            <div className="space-y-0.5">
                              <p>{asset.latest_request.normalized_title || "Untitled request"}</p>
                              <p>{asset.latest_request.resolution_source ?? "unresolved"}</p>
                            </div>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(asset.created_at).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>
    </div>
  );
}
