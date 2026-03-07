import { ArrowDownToLine, CheckCircle2, XCircle, Clock, Zap, RefreshCw, Globe, Camera, Type } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { KpiCard } from "@/components/admin/kpi-card";
import { getImportData } from "@/lib/admin-data/imports";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const kindIcons: Record<string, typeof Globe> = {
  url: Globe,
  text: Type,
  photo: Camera,
};

const kindColors: Record<string, string> = {
  url: "bg-blue-100 text-blue-800",
  text: "bg-purple-100 text-purple-800",
  photo: "bg-amber-100 text-amber-800",
};

const statusColors: Record<string, string> = {
  completed: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
  pending: "bg-zinc-100 text-zinc-800",
};

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default async function ImportsPage() {
  const data = await getImportData();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Imports"
        description="Recipe import pipeline telemetry — URL scraping, text parsing, and cookbook photo extraction."
        icon={<ArrowDownToLine className="h-5 w-5" />}
      />

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          label="Total Imports"
          value={String(data.totalImports)}
          hint={`${data.completedImports} completed, ${data.failedImports} failed`}
          icon={ArrowDownToLine}
        />
        <KpiCard
          label="Success Rate"
          value={formatPercent(data.successRate)}
          hint={`${data.completedImports} of ${data.totalImports}`}
          icon={CheckCircle2}
          variant={data.successRate >= 0.8 ? "success" : data.successRate >= 0.5 ? "warning" : "danger"}
        />
        <KpiCard
          label="Avg Total Latency"
          value={formatMs(data.avgTotalLatencyMs)}
          hint={`Extract: ${formatMs(data.avgExtractLatencyMs)} · Transform: ${formatMs(data.avgTransformLatencyMs)}`}
          icon={Clock}
        />
        <KpiCard
          label="Cache Hit Rate"
          value={formatPercent(data.cacheHitRate)}
          hint={`${data.cacheHitCount} fingerprint cache hits`}
          icon={Zap}
        />
        <KpiCard
          label="By Source"
          value={data.byKind.map((k) => `${k.kind}: ${k.count}`).join(", ") || "—"}
          hint="URL / Text / Photo breakdown"
          icon={RefreshCw}
          variant="muted"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Source Kind Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Source Kind Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {data.byKind.length === 0 ? (
              <p className="text-sm text-muted-foreground">No imports yet</p>
            ) : (
              <div className="space-y-3">
                {data.byKind.map((item) => {
                  const pct = data.totalImports > 0 ? (item.count / data.totalImports) * 100 : 0;
                  return (
                    <div key={item.kind} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium capitalize">{item.kind}</span>
                        <span className="text-muted-foreground">{item.count} ({pct.toFixed(0)}%)</span>
                      </div>
                      <div className="h-2 rounded-full bg-zinc-100">
                        <div
                          className="h-2 rounded-full bg-primary transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Extraction Strategy Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Extraction Strategy Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {data.byStrategy.length === 0 ? (
              <p className="text-sm text-muted-foreground">No extractions yet</p>
            ) : (
              <div className="space-y-3">
                {data.byStrategy.map((item) => {
                  const total = data.byStrategy.reduce((s, i) => s + i.count, 0);
                  const pct = total > 0 ? (item.count / total) * 100 : 0;
                  return (
                    <div key={item.kind} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{item.kind.replace(/_/g, " ")}</span>
                        <span className="text-muted-foreground">{item.count} ({pct.toFixed(0)}%)</span>
                      </div>
                      <div className="h-2 rounded-full bg-zinc-100">
                        <div
                          className="h-2 rounded-full bg-blue-500 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Imports Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Recent Imports</CardTitle>
        </CardHeader>
        <CardContent>
          {data.recentImports.length === 0 ? (
            <p className="text-sm text-muted-foreground">No imports yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Origin</TableHead>
                  <TableHead>Strategy</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>URL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentImports.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {timeAgo(row.created_at)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={kindColors[row.source_kind] ?? ""}>
                        {row.source_kind}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{row.source_origin ?? "—"}</TableCell>
                    <TableCell className="text-xs">{row.extraction_strategy?.replace(/_/g, " ") ?? "—"}</TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {row.extraction_confidence != null ? formatPercent(row.extraction_confidence) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={statusColors[row.status] ?? ""}>
                        {row.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                      {row.source_url ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Recent Failures */}
      {data.recentFailures.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-red-700">Recent Failures</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Error Code</TableHead>
                  <TableHead>Error Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentFailures.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {timeAgo(row.created_at)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={kindColors[row.source_kind] ?? ""}>
                        {row.source_kind}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs font-mono">{row.error_code ?? "—"}</TableCell>
                    <TableCell className="max-w-[300px] truncate text-xs text-muted-foreground">
                      {row.error_message ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
