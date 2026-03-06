import { Cpu, ImageIcon, Layers, Loader2, RefreshCw, Scale, Sparkles, XCircle } from "lucide-react";
import { IMAGE_SIMULATION_SCENARIOS } from "@alchemy/shared/image-simulation-catalog";
import { ImageJobsTable } from "@/components/admin/image-jobs-table";
import { ImagePipelineControls } from "@/components/admin/image-pipeline-controls";
import { ImageSimulationRunnerCard } from "@/components/admin/image-simulation-runner-card";
import { KpiCard } from "@/components/admin/kpi-card";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getImagesDashboardData } from "@/lib/admin-data";

const formatLatency = (value: number | null): string => {
  if (value === null) return "n/a";
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(1)}s`;
};

const formatPercent = (value: number): string => `${Math.round(value * 100)}%`;

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
            <TabsTrigger value="quality">Quality</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Pending"
              value={String(data.overview.pendingCount)}
              hint="Waiting for reuse or generation"
              icon={Layers}
              variant={data.overview.pendingCount > 0 ? "warning" : "default"}
            />
            <KpiCard
              label="Processing"
              value={String(data.overview.processingCount)}
              hint="Currently resolving"
              icon={Loader2}
            />
            <KpiCard
              label="Ready"
              value={String(data.overview.readyCount)}
              hint={`${data.overview.generatedCount} generated · ${data.overview.reusedCount} reused`}
              icon={ImageIcon}
              variant={data.overview.readyCount > 0 ? "success" : "muted"}
            />
            <KpiCard
              label="Failure Rate"
              value={formatPercent(data.overview.failureRate)}
              hint={`${data.overview.failedCount} failed requests`}
              icon={XCircle}
              variant={data.overview.failedCount > 0 ? "danger" : "success"}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Binding Mix</CardTitle>
                <CardDescription>Whether image requests currently serve candidates, persisted recipes, or both.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Candidate-only</span>
                  <span className="font-medium">{data.overview.candidateOnlyCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Persisted-only</span>
                  <span className="font-medium">{data.overview.persistedOnlyCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Shared</span>
                  <span className="font-medium">{data.overview.sharedCount}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Throughput</CardTitle>
                <CardDescription>Current resolution speed and queue volume.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Avg time to ready</span>
                  <span className="font-medium">{formatLatency(data.overview.avgReadyLatencyMs)}</span>
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

        <TabsContent value="quality" className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Scale className="h-4 w-4 text-muted-foreground" />
                Quality Assurance
              </CardTitle>
              <CardDescription>Simulation runner plus recent image QA event history.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3 pt-0 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-muted-foreground" />
                <span>Image route</span>
                <Badge variant="outline" className="font-mono text-xs">{routeBadge(data.routes.image)}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-muted-foreground" />
                <span>Reuse eval</span>
                <Badge variant="outline" className="font-mono text-xs">{routeBadge(data.routes.reuse)}</Badge>
              </div>
            </CardContent>
          </Card>

          <ImageSimulationRunnerCard
            scenarios={IMAGE_SIMULATION_SCENARIOS}
            registryModels={data.registryModels}
            activeImageRoute={data.routes.image}
            activeJudgeRoute={data.routes.judge}
          />

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Recent Simulation Events</CardTitle>
              <CardDescription>Latest image simulation runs and failures.</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              {data.recentSimulationEvents.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No simulation events yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Event</TableHead>
                      <TableHead>Scenario</TableHead>
                      <TableHead>Request</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.recentSimulationEvents.map((event, index) => (
                        <TableRow key={`${event.created_at}-${index}`}>
                        <TableCell className="text-sm font-medium">{event.event_type}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {typeof event.event_payload["scenario_id"] === "string"
                            ? event.event_payload["scenario_id"]
                            : "—"}
                        </TableCell>
                        <TableCell className="font-mono text-[11px] text-muted-foreground">
                          {event.request_id ? `${event.request_id.slice(0, 8)}…` : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(event.created_at).toLocaleString()}
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
