import { Activity, CheckCircle2, ImageIcon, PlayCircle, XCircle } from "lucide-react";
import { IMAGE_SIMULATION_SCENARIOS } from "@alchemy/shared/image-simulation-catalog";
import { LazyImageSimulationRunnerCard } from "@/components/admin/lazy-image-simulation-runner-card";
import { LazyRecipeSimulationRunnerCard } from "@/components/admin/lazy-recipe-simulation-runner-card";
import { PageHeader } from "@/components/admin/page-header";
import { KpiCard } from "@/components/admin/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getImageSimulationData, getRecipeSimulationData } from "@/lib/admin-data";

export default async function RecipeSimulationsPage(): Promise<React.JSX.Element> {
  const [data, imageData] = await Promise.all([getRecipeSimulationData(), getImageSimulationData()]);

  const started = data.recentRuns.filter((run) => run.event_type === "simulation_run_started").length;
  const completed = data.recentRuns.filter((run) => run.event_type === "simulation_run_completed").length;
  const failed = data.recentRuns.filter((run) => run.event_type === "simulation_run_failed").length;

  const successRate = started > 0 ? Math.round((completed / started) * 100) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Simulations"
        description="Recipe and image simulations for testing prompts, routes, and system behavior end to end."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Runs Started"
          value={String(started)}
          hint="Recipe simulation sessions initiated"
          icon={PlayCircle}
        />
        <KpiCard
          label="Runs Completed"
          value={String(completed)}
          hint="Fully successful recipe simulations"
          icon={CheckCircle2}
          variant={completed > 0 ? "success" : "muted"}
        />
        <KpiCard
          label="Runs Failed"
          value={String(failed)}
          hint="Recipe simulations that hit an error step"
          icon={XCircle}
          variant={failed > 0 ? "danger" : "success"}
        />
      </div>

      <Tabs defaultValue="recipe" className="space-y-4">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="recipe">Recipe Runs</TabsTrigger>
          <TabsTrigger value="image">Image Comparisons</TabsTrigger>
        </TabsList>

        <TabsContent value="recipe" className="space-y-6">
          <LazyRecipeSimulationRunnerCard registryModels={data.registryModels} />

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  Recent Recipe Simulation Events
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
                        No recipe simulations logged yet. Click &ldquo;Run Simulation&rdquo; above to start.
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
        </TabsContent>

        <TabsContent value="image" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <KpiCard
              label="Image Route"
              value={imageData.activeImageRoute ? `${imageData.activeImageRoute.provider}/${imageData.activeImageRoute.model}` : "unconfigured"}
              hint="Active image generation route"
              icon={ImageIcon}
              variant={imageData.activeImageRoute ? "success" : "warning"}
            />
            <KpiCard
              label="Judge Route"
              value={imageData.activeJudgeRoute ? `${imageData.activeJudgeRoute.provider}/${imageData.activeJudgeRoute.model}` : "unconfigured"}
              hint="Active image quality judge route"
              icon={CheckCircle2}
              variant={imageData.activeJudgeRoute ? "success" : "warning"}
            />
          </div>

          <LazyImageSimulationRunnerCard
            scenarios={IMAGE_SIMULATION_SCENARIOS}
            registryModels={imageData.registryModels}
            activeImageRoute={imageData.activeImageRoute}
            activeJudgeRoute={imageData.activeJudgeRoute}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
