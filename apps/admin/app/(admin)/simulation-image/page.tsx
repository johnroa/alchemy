import { ImageIcon, PlayCircle, Scale, XCircle } from "lucide-react";
import { IMAGE_SIMULATION_SCENARIOS } from "@alchemy/shared/image-simulation-catalog";
import { ImageSimulationRunnerCard } from "@/components/admin/image-simulation-runner-card";
import { KpiCard } from "@/components/admin/kpi-card";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getImageSimulationData } from "@/lib/admin-data";

export default async function ImageSimulationsPage(): Promise<React.JSX.Element> {
  const data = await getImageSimulationData();

  const started = data.recentRuns.filter((run) => run.event_type === "image_simulation_run_started").length;
  const completed = data.recentRuns.filter((run) => run.event_type === "image_simulation_run_completed").length;
  const failed = data.recentRuns.filter((run) => run.event_type === "image_simulation_run_failed").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Image Simulations"
        description="Ephemeral A/B image comparisons for curated recipe titles, with server-side judging and per-lane cost and latency metrics."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Runs Started"
          value={String(started)}
          hint="Image simulation requests initiated"
          icon={PlayCircle}
        />
        <KpiCard
          label="Runs Completed"
          value={String(completed)}
          hint="Compare runs that returned two lane outputs"
          icon={ImageIcon}
          variant={completed > 0 ? "success" : "muted"}
        />
        <KpiCard
          label="Runs Failed"
          value={String(failed)}
          hint="Admin compare requests that failed before completion"
          icon={XCircle}
          variant={failed > 0 ? "danger" : "success"}
        />
      </div>

      <ImageSimulationRunnerCard
        scenarios={IMAGE_SIMULATION_SCENARIOS}
        registryModels={data.registryModels}
        activeImageRoute={data.activeImageRoute}
        activeJudgeRoute={data.activeJudgeRoute}
      />

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Scale className="h-4 w-4 text-muted-foreground" />
              Recent Image Simulation Events
            </CardTitle>
            <CardDescription className="mt-0.5">
              Admin run metadata only. Rendered image bytes are never persisted in event logs.
            </CardDescription>
          </div>
          <Badge variant="outline" className="font-mono text-xs">
            {data.recentRuns.length} events
          </Badge>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Request</TableHead>
                <TableHead>Payload</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recentRuns.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    No image simulation runs logged yet. Run a compare above to seed the first event.
                  </TableCell>
                </TableRow>
              ) : (
                data.recentRuns.map((run, index) => (
                  <TableRow key={`${run.created_at}-${index}`}>
                    <TableCell className="text-muted-foreground">
                      {new Date(run.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          run.event_type === "image_simulation_run_completed"
                            ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                            : run.event_type === "image_simulation_run_failed"
                              ? "border-red-300 bg-red-50 text-red-700"
                              : undefined
                        }
                      >
                        {run.event_type.replace("image_simulation_run_", "")}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {run.request_id ?? "n/a"}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                      {JSON.stringify(run.event_payload)}
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
