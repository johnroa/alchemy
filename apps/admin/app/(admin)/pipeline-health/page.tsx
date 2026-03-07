"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw, AlertTriangle, CheckCircle2, Clock, Zap } from "lucide-react";

type ScopeStats = {
  scope: string;
  total_calls: number;
  success_count: number;
  error_count: number;
  error_rate_pct: number;
  avg_latency_ms: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  max_latency_ms: number;
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
};

type VariantHealth = {
  total_variants: number;
  stale_count: number;
  processing_count: number;
  failed_count: number;
  needs_review_count: number;
  current_count: number;
};

type GraphActivity = {
  edges_created: number;
  aggregation_edges: number;
};

type PipelineStats = {
  window_hours: number;
  computed_at: string;
  scopes: ScopeStats[];
  variant_health: VariantHealth;
  graph_activity: GraphActivity;
};

export default function PipelineHealthPage(): React.JSX.Element {
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hours, setHours] = useState("24");

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/observability/pipeline?hours=${hours}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as PipelineStats;
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stats");
    } finally {
      setLoading(false);
    }
  }, [hours]);

  useEffect(() => { void fetchStats(); }, [fetchStats]);

  const formatMs = (ms: number): string => {
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.round(ms)}ms`;
  };

  const formatCost = (usd: number): string => {
    if (usd < 0.01) return `$${usd.toFixed(4)}`;
    return `$${usd.toFixed(2)}`;
  };

  const formatTokens = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  const totalCalls = stats?.scopes.reduce((s, sc) => s + sc.total_calls, 0) ?? 0;
  const totalErrors = stats?.scopes.reduce((s, sc) => s + sc.error_count, 0) ?? 0;
  const totalCost = stats?.scopes.reduce((s, sc) => s + sc.total_cost_usd, 0) ?? 0;
  const avgLatency = totalCalls > 0
    ? (stats?.scopes.reduce((s, sc) => s + sc.avg_latency_ms * sc.total_calls, 0) ?? 0) / totalCalls
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader
          title="Pipeline Health"
          description="LLM pipeline observability — latency, cost, error rates, variant health, and graph activity."
        />
        <div className="flex items-center gap-2">
          <Select value={hours} onValueChange={setHours}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Last hour</SelectItem>
              <SelectItem value="6">Last 6h</SelectItem>
              <SelectItem value="24">Last 24h</SelectItem>
              <SelectItem value="72">Last 3d</SelectItem>
              <SelectItem value="168">Last 7d</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => void fetchStats()} disabled={loading}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-4">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Total Calls</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalCalls.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              {stats?.scopes.length ?? 0} scopes
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" /> Avg Latency
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatMs(avgLatency)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Errors
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalErrors}</div>
            <p className="text-xs text-muted-foreground">
              {totalCalls > 0 ? `${((totalErrors / totalCalls) * 100).toFixed(1)}% rate` : "—"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Zap className="h-3 w-3" /> Total Cost
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCost(totalCost)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Scope breakdown table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Scope Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Scope</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Errors</TableHead>
                <TableHead className="text-right">Error %</TableHead>
                <TableHead className="text-right">p50</TableHead>
                <TableHead className="text-right">p95</TableHead>
                <TableHead className="text-right">Max</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats?.scopes.map((sc) => (
                <TableRow key={sc.scope}>
                  <TableCell className="font-mono text-xs">{sc.scope}</TableCell>
                  <TableCell className="text-right">{sc.total_calls}</TableCell>
                  <TableCell className="text-right">
                    {sc.error_count > 0 ? (
                      <Badge variant="destructive" className="text-xs">{sc.error_count}</Badge>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={sc.error_rate_pct > 5 ? "text-destructive font-medium" : ""}>
                      {sc.error_rate_pct}%
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">{formatMs(sc.p50_latency_ms)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{formatMs(sc.p95_latency_ms)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{formatMs(sc.max_latency_ms)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{formatTokens(sc.total_tokens)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{formatCost(sc.total_cost_usd)}</TableCell>
                </TableRow>
              ))}
              {(!stats?.scopes.length) && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground">
                    No LLM calls in the selected window
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Variant Health + Graph Activity */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Variant Health</CardTitle>
          </CardHeader>
          <CardContent>
            {stats?.variant_health ? (
              <div className="grid grid-cols-3 gap-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <div>
                    <div className="text-lg font-bold">{stats.variant_health.current_count}</div>
                    <div className="text-xs text-muted-foreground">Current</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  <div>
                    <div className="text-lg font-bold">{stats.variant_health.stale_count}</div>
                    <div className="text-xs text-muted-foreground">Stale</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 text-blue-500" />
                  <div>
                    <div className="text-lg font-bold">{stats.variant_health.processing_count}</div>
                    <div className="text-xs text-muted-foreground">Processing</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                  <div>
                    <div className="text-lg font-bold">{stats.variant_health.failed_count}</div>
                    <div className="text-xs text-muted-foreground">Failed</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-orange-500" />
                  <div>
                    <div className="text-lg font-bold">{stats.variant_health.needs_review_count}</div>
                    <div className="text-xs text-muted-foreground">Needs Review</div>
                  </div>
                </div>
                <div>
                  <div className="text-lg font-bold">{stats.variant_health.total_variants}</div>
                  <div className="text-xs text-muted-foreground">Total</div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Loading...</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Graph Activity ({hours}h)</CardTitle>
          </CardHeader>
          <CardContent>
            {stats?.graph_activity ? (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-2xl font-bold">{stats.graph_activity.edges_created}</div>
                  <div className="text-xs text-muted-foreground">Edges created</div>
                </div>
                <div>
                  <div className="text-2xl font-bold">{stats.graph_activity.aggregation_edges}</div>
                  <div className="text-xs text-muted-foreground">From aggregation</div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Loading...</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
