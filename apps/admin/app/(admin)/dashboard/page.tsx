import { KpiCard } from "@/components/admin/kpi-card";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDashboardData } from "@/lib/admin-data";

export default async function DashboardPage(): Promise<React.JSX.Element> {
  const data = await getDashboardData();

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description="LLM cost, latency, and safety telemetry." />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Requests" value={String(data.requestCount)} hint="LLM requests in rollup window" />
        <KpiCard label="Avg Latency" value={`${data.avgLatencyMs}ms`} hint="Weighted by request volume" />
        <KpiCard label="Cost" value={`$${data.totalCostUsd.toFixed(2)}`} hint="Total recorded model cost" />
        <KpiCard label="Safety Flags" value={String(data.safetyIncidentCount)} hint="Abuse/rate-limit flagged events" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Safety/Rate-limit Events</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recentErrors.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-muted-foreground">
                    No events in current window.
                  </TableCell>
                </TableRow>
              ) : (
                data.recentErrors.map((event) => (
                  <TableRow key={`${event.created_at}-${event.reason}`}>
                    <TableCell>{new Date(event.created_at).toLocaleString()}</TableCell>
                    <TableCell>{event.scope}</TableCell>
                    <TableCell>{event.reason}</TableCell>
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
