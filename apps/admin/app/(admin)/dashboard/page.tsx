import {
  Activity,
  ArrowRight,
  Brain,
  CheckCircle2,
  Clock,
  DollarSign,
  Image,
  ImageOff,
  ShieldAlert,
  XCircle,
  Zap
} from "lucide-react";
import Link from "next/link";
import { KpiCard } from "@/components/admin/kpi-card";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDashboardData } from "@/lib/admin-data";

const formatCost = (usd: number): string => {
  if (usd === 0) return "$0.00";
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
};

const actionColor = (action: string): string => {
  if (action === "create") return "border-emerald-300 bg-emerald-50 text-emerald-700";
  if (action === "update" || action === "activate") return "border-blue-300/60 bg-blue-50 text-blue-700";
  if (action === "delete") return "border-red-300 bg-red-50 text-red-700";
  return "";
};

export default async function DashboardPage(): Promise<React.JSX.Element> {
  const data = await getDashboardData();

  const hasErrors = data.safetyIncidentCount > 0 || data.imageFailedCount > 0;
  const hasWarnings = data.emptyOutputCount > 0 || data.imagePendingCount > 5;
  const systemStatus = hasErrors ? "issues" : hasWarnings ? "warnings" : "healthy";

  const imageTotal = data.imageTotalCount;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description="LLM performance, image pipeline health, memory telemetry, and safety events."
        actions={
          systemStatus === "healthy" ? (
            <Badge className="gap-1.5 border-emerald-300 bg-emerald-50 text-emerald-700">
              <CheckCircle2 className="h-3 w-3" />
              All systems healthy
            </Badge>
          ) : systemStatus === "warnings" ? (
            <Badge className="gap-1.5 border-amber-300 bg-amber-50 text-amber-700">
              <Clock className="h-3 w-3" />
              Warnings detected
            </Badge>
          ) : (
            <Badge className="gap-1.5 border-red-300 bg-red-50 text-red-700">
              <XCircle className="h-3 w-3" />
              Issues detected
            </Badge>
          )
        }
      />

      {/* LLM Performance */}
      <section className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/70">LLM Performance</p>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Total Requests"
            value={data.requestCount.toLocaleString()}
            hint="LLM requests in rollup window"
            icon={Activity}
          />
          <KpiCard
            label="Avg Latency"
            value={data.avgLatencyMs > 0 ? `${data.avgLatencyMs.toLocaleString()}ms` : "—"}
            hint="Weighted by request volume"
            icon={Clock}
            variant={data.avgLatencyMs > 5000 ? "warning" : data.avgLatencyMs > 0 ? "default" : "muted"}
          />
          <KpiCard
            label="Total Cost"
            value={formatCost(data.totalCostUsd)}
            hint="Total recorded model cost"
            icon={DollarSign}
          />
          <KpiCard
            label="Empty Outputs"
            value={String(data.emptyOutputCount)}
            hint="Provider responses missing usable text"
            icon={Zap}
            variant={data.emptyOutputCount > 0 ? "warning" : "success"}
          />
        </div>
      </section>

      {/* Safety & Content Health */}
      <section className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/70">Safety & Content</p>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Safety Flags"
            value={String(data.safetyIncidentCount)}
            hint="Abuse/rate-limit flagged events"
            icon={ShieldAlert}
            variant={data.safetyIncidentCount > 0 ? "danger" : "success"}
          />
          <KpiCard
            label="Image Pending"
            value={String(data.imagePendingCount)}
            hint="Recipes waiting for generated image"
            icon={Image}
            variant={data.imagePendingCount > 10 ? "warning" : "default"}
          />
          <KpiCard
            label="Image Failed"
            value={String(data.imageFailedCount)}
            hint="Jobs requiring retry or policy updates"
            icon={ImageOff}
            variant={data.imageFailedCount > 0 ? "danger" : "success"}
          />
          <KpiCard
            label="Active Memory"
            value={String(data.activeMemoryCount)}
            hint="Current active memory records"
            icon={Brain}
          />
        </div>
      </section>

      {/* Two-column: Image pipeline chart + Recent activity */}
      <div className="grid gap-6 xl:grid-cols-2">
        {/* Image Pipeline Distribution */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Image className="h-4 w-4 text-muted-foreground" />
                  Image Pipeline
                </CardTitle>
                <CardDescription className="mt-0.5">
                  {imageTotal > 0 ? `${imageTotal} total jobs` : "No jobs yet"}
                </CardDescription>
              </div>
              <Link href="/image-pipeline">
                <Badge variant="outline" className="gap-1 text-xs hover:bg-zinc-50 cursor-pointer">
                  View all <ArrowRight className="h-3 w-3" />
                </Badge>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {imageTotal === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No image jobs recorded.</p>
            ) : (
              <>
                <div className="flex h-3 w-full overflow-hidden rounded-full bg-zinc-100">
                  {data.imagePendingCount > 0 && (
                    <div style={{ width: `${(data.imagePendingCount / imageTotal) * 100}%` }} className="bg-amber-400" />
                  )}
                  {data.imageProcessingCount > 0 && (
                    <div style={{ width: `${(data.imageProcessingCount / imageTotal) * 100}%` }} className="bg-blue-400" />
                  )}
                  {data.imageReadyCount > 0 && (
                    <div style={{ width: `${(data.imageReadyCount / imageTotal) * 100}%` }} className="bg-emerald-400" />
                  )}
                  {data.imageFailedCount > 0 && (
                    <div style={{ width: `${(data.imageFailedCount / imageTotal) * 100}%` }} className="bg-red-400" />
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                  {[
                    { label: "Pending", count: data.imagePendingCount, color: "bg-amber-400" },
                    { label: "Processing", count: data.imageProcessingCount, color: "bg-blue-400" },
                    { label: "Ready", count: data.imageReadyCount, color: "bg-emerald-400" },
                    { label: "Failed", count: data.imageFailedCount, color: "bg-red-400" }
                  ].map(({ label, count, color }) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className={`h-2 w-2 rounded-full ${color}`} />
                        {label}
                      </span>
                      <span className="text-xs font-medium tabular-nums">{count}</span>
                    </div>
                  ))}
                </div>
                {/* Success rate bar */}
                {imageTotal > 0 && (
                  <div className="space-y-1 border-t pt-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Success rate</span>
                      <span className="font-medium tabular-nums">
                        {Math.round((data.imageReadyCount / imageTotal) * 100)}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                      <div
                        className="h-full rounded-full bg-emerald-400 transition-all"
                        style={{ width: `${(data.imageReadyCount / imageTotal) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  Recent Activity
                </CardTitle>
                <CardDescription className="mt-0.5">Latest platform mutations</CardDescription>
              </div>
              <Link href="/changelog">
                <Badge variant="outline" className="gap-1 text-xs hover:bg-zinc-50 cursor-pointer">
                  Full log <ArrowRight className="h-3 w-3" />
                </Badge>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {data.recentActivity.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                <p className="text-sm font-medium text-emerald-700">No recent mutations</p>
                <p className="text-xs text-muted-foreground">Platform is idle.</p>
              </div>
            ) : (
              <div className="space-y-0">
                {data.recentActivity.map((item, index) => (
                  <div
                    key={`${item.created_at}-${index}`}
                    className="flex items-center gap-3 border-b py-2 last:border-0"
                  >
                    <Badge variant="outline" className={`text-[10px] ${actionColor(item.action)}`}>
                      {item.action}
                    </Badge>
                    <span className="flex-1 text-xs">
                      <span className="font-medium">{item.entity_type}</span>
                      <span className="text-muted-foreground"> · {item.scope}</span>
                    </span>
                    <span className="flex-none text-[10px] text-muted-foreground/60">
                      {new Date(item.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Safety Events */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4 text-muted-foreground" />
            Recent Safety / Rate-limit Events
          </CardTitle>
          <Badge variant="outline" className="font-mono text-xs">
            {data.recentErrors.length} events
          </Badge>
        </CardHeader>
        <CardContent className="pt-0">
          {data.recentErrors.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-400" />
              <p className="text-sm font-medium text-emerald-700">No safety events in current window</p>
              <p className="text-xs text-muted-foreground">All requests are passing safety checks.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentErrors.map((event) => (
                  <TableRow key={`${event.created_at}-${event.reason}`}>
                    <TableCell className="text-muted-foreground">
                      {new Date(event.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{event.scope}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-medium text-red-600">{event.reason}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
