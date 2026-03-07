import { ArrowDownToLine } from "lucide-react";
import { AnalyticsMovedNotice } from "@/components/admin/analytics-moved-notice";
import { PageHeader } from "@/components/admin/page-header";
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
import { formatPercent, formatMs, timeAgo } from "@/lib/format";

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

export default async function ImportsPage() {
  const data = await getImportData();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Imports"
        description="Operational view for import provenance, recent failures, and source records."
        icon={<ArrowDownToLine className="h-5 w-5" />}
      />

      <AnalyticsMovedNotice
        title="Import telemetry moved to Analytics"
        description={`Use Analytics / Pipelines for success rate, latency, source mix, and throughput. This page stays focused on recent provenance rows and failures. Current average latency is ${formatMs(data.avgTotalLatencyMs)} with a ${formatPercent(data.successRate, 1)} success rate.`}
        href="/analytics/pipelines"
        cta="Open pipeline analytics"
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Recent Imports</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
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
                        {row.extraction_confidence != null ? formatPercent(row.extraction_confidence, 1) : "—"}
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

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Operational Snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Recent rows</span>
              <span className="font-medium">{data.recentImports.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Failures</span>
              <span className="font-medium">{data.recentFailures.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Avg extract latency</span>
              <span className="font-medium">{formatMs(data.avgExtractLatencyMs)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Avg transform latency</span>
              <span className="font-medium">{formatMs(data.avgTransformLatencyMs)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Source mix</span>
              <span className="font-medium">{data.byKind.map((item) => item.kind).join(" / ") || "—"}</span>
            </div>
          </CardContent>
        </Card>
      </div>

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
