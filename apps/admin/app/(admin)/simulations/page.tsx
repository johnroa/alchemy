import { Activity, CheckCircle2, PlayCircle, XCircle } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { KpiCard } from "@/components/admin/kpi-card";
import { SimulationRunnerCard } from "@/components/admin/simulation-runner-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getSimulationData } from "@/lib/admin-data";

export default async function SimulationsPage(): Promise<React.JSX.Element> {
  const data = await getSimulationData();

  const started = data.recentRuns.filter((run) => run.event_type === "simulation_run_started").length;
  const completed = data.recentRuns.filter((run) => run.event_type === "simulation_run_completed").length;
  const failed = data.recentRuns.filter((run) => run.event_type === "simulation_run_failed").length;

  const successRate = started > 0 ? Math.round((completed / started) * 100) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Simulation Runner"
        description="Live end-to-end simulation runs with seeded natural prompts, real-time trace streaming, and per-step latency breakdowns."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Runs Started"
          value={String(started)}
          hint="Simulation sessions initiated"
          icon={PlayCircle}
        />
        <KpiCard
          label="Runs Completed"
          value={String(completed)}
          hint="Fully successful simulations"
          icon={CheckCircle2}
          variant={completed > 0 ? "success" : "muted"}
        />
        <KpiCard
          label="Runs Failed"
          value={String(failed)}
          hint="Simulations that hit an error step"
          icon={XCircle}
          variant={failed > 0 ? "danger" : "success"}
        />
      </div>

      <SimulationRunnerCard registryModels={data.registryModels} />

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-muted-foreground" />
              Recent Simulation Events
            </CardTitle>
            <CardDescription className="mt-0.5">
              Lifecycle entries with request ids and payload metadata.
              {successRate !== null && (
                <span className="ml-1 font-medium">{successRate}% success rate.</span>
              )}
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
                    No simulation runs logged yet. Click &ldquo;Run Simulation&rdquo; above to start.
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
                          run.event_type === "simulation_run_completed"
                            ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                            : run.event_type === "simulation_run_failed"
                              ? "border-red-300 bg-red-50 text-red-700"
                              : undefined
                        }
                      >
                        {run.event_type.replace("simulation_run_", "")}
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
