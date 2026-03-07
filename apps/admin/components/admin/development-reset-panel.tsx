"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, DatabaseZap, RefreshCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  DEVELOPMENT_RESET_PRESETS,
  confirmTextForPreset,
  type DevelopmentResetPresetKey,
} from "@/lib/development-reset";
import { STATUS_TONES } from "@/lib/admin-tones";
import { cn } from "@/lib/utils";

type PreviewPayload = {
  preset: DevelopmentResetPresetKey;
  table_counts: Record<string, number>;
  total_rows: number;
};

type RunRecord = {
  id: string;
  operation_key: string;
  status: string;
  requested_by_email: string | null;
  request_payload: Record<string, unknown>;
  preview_counts: Record<string, number>;
  result_counts: Record<string, number>;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

const labelizePreset = (value: string): string =>
  value
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");

const asNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toDateTime = (value: string): string => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString();
};

const toDuration = (start: string, end: string | null): string => {
  if (!end) return "in progress";
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return "—";
  }
  const seconds = Math.round((endMs - startMs) / 1000);
  return `${seconds}s`;
};

const statusBadgeClass = (status: string): string => {
  if (status === "succeeded" || status === "dry_run") return STATUS_TONES.success;
  if (status === "failed") return STATUS_TONES.danger;
  return STATUS_TONES.warning;
};

export function DevelopmentResetPanel(): React.JSX.Element {
  const [selectedPreset, setSelectedPreset] = useState<DevelopmentResetPresetKey>("full_food_reset");
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [runsLoading, setRunsLoading] = useState(false);
  const [executeLoading, setExecuteLoading] = useState(false);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [confirmText, setConfirmText] = useState("");
  const [reason, setReason] = useState("");

  const expectedConfirmText = useMemo(() => confirmTextForPreset(selectedPreset), [selectedPreset]);

  const refreshRuns = async (): Promise<void> => {
    setRunsLoading(true);
    const response = await fetch("/api/admin/development/runs?limit=50", {
      method: "GET",
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; runs?: RunRecord[]; error?: string }
      | null;
    setRunsLoading(false);

    if (!response.ok || !payload?.ok) {
      toast.error(payload?.error ?? "Failed to load development operation runs");
      return;
    }
    setRuns(payload.runs ?? []);
  };

  useEffect(() => {
    void refreshRuns();
  }, []);

  const runPreview = async (): Promise<void> => {
    setPreviewLoading(true);
    const response = await fetch("/api/admin/development/reset/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preset: selectedPreset }),
    });
    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; preview?: PreviewPayload; error?: string }
      | null;
    setPreviewLoading(false);

    if (!response.ok || !payload?.ok || !payload.preview) {
      toast.error(payload?.error ?? "Failed to load reset preview");
      return;
    }

    setPreview({
      preset: selectedPreset,
      table_counts: payload.preview.table_counts ?? {},
      total_rows: asNumber(payload.preview.total_rows),
    });
    toast.success("Preview loaded");
  };

  const runExecute = async (): Promise<void> => {
    if (confirmText.trim() !== expectedConfirmText) {
      toast.error("Confirmation text mismatch");
      return;
    }

    setExecuteLoading(true);
    const response = await fetch("/api/admin/development/reset/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        preset: selectedPreset,
        confirm_text: confirmText.trim(),
        reason: reason.trim(),
      }),
    });
    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; result?: { run_id?: string }; error?: string; details?: string }
      | null;
    setExecuteLoading(false);

    if (!response.ok || !payload?.ok) {
      const details = payload?.details ? ` (${payload.details})` : "";
      toast.error(`${payload?.error ?? "Reset execution failed"}${details}`);
      return;
    }

    toast.success(`Reset executed${payload.result?.run_id ? ` · run ${payload.result.run_id}` : ""}`);
    setConfirmText("");
    setReason("");
    await Promise.all([refreshRuns(), runPreview()]);
  };

  const previewRows = Object.entries(preview?.table_counts ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Development"
        description="Destructive data reset operations for development environments. Always dry-run preview before execution."
        icon={<DatabaseZap className="h-6 w-6" />}
        actions={
          <Button variant="outline" onClick={() => void refreshRuns()} disabled={runsLoading}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            {runsLoading ? "Refreshing..." : "Refresh Runs"}
          </Button>
        }
      />

      <Alert className="border-amber-500/30 bg-amber-500/10">
        <AlertTriangle className="h-4 w-4 text-amber-300" />
        <AlertTitle className="text-amber-200">Destructive Operations</AlertTitle>
        <AlertDescription className="text-amber-300">
          Execute only with explicit intent. These actions wipe food-domain tables and cannot be undone.
        </AlertDescription>
      </Alert>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {DEVELOPMENT_RESET_PRESETS.map((preset) => (
          <Card
            key={preset.key}
            className={cn(
              "cursor-pointer border transition-colors",
              selectedPreset === preset.key ? "border-red-500/30 bg-red-500/10" : "border-border/80 bg-card/60",
            )}
            onClick={() => setSelectedPreset(preset.key)}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{preset.label}</CardTitle>
              <CardDescription>{preset.description}</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <Badge variant="outline" className="font-mono text-[10px]">
                {confirmTextForPreset(preset.key)}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Dry-Run Preview</CardTitle>
            <CardDescription>
              Current row counts for the selected preset before wipe execution.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-xs">
                {labelizePreset(selectedPreset)}
              </Badge>
              <Button size="sm" onClick={() => void runPreview()} disabled={previewLoading}>
                {previewLoading ? "Loading..." : "Run Preview"}
              </Button>
            </div>

            {preview ? (
              <>
                <div className="rounded-md border border-border/80 bg-muted/40 p-3">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Total rows affected</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{preview.total_rows.toLocaleString()}</p>
                </div>
                <div className="max-h-72 overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Table</TableHead>
                        <TableHead className="text-right">Rows</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={2} className="py-4 text-center text-muted-foreground">
                            No rows found.
                          </TableCell>
                        </TableRow>
                      ) : (
                        previewRows.map(([table, count]) => (
                          <TableRow key={table}>
                            <TableCell className="font-mono text-xs">{table}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{count.toLocaleString()}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Run preview to inspect affected rows.</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-red-500/30 bg-red-500/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-red-200">Execute Reset</CardTitle>
            <CardDescription className="text-red-300">
              Requires exact confirmation phrase. This executes a single transactional wipe RPC.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wider text-red-300/80">Expected confirmation text</p>
              <p className="rounded-md border border-red-500/30 bg-background/70 px-3 py-2 font-mono text-xs">{expectedConfirmText}</p>
            </div>

            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wider text-red-300/80">Type confirmation text</p>
              <Input
                value={confirmText}
                onChange={(event) => setConfirmText(event.target.value)}
                placeholder={expectedConfirmText}
                className="bg-background/70"
              />
            </div>

            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wider text-red-300/80">Reason</p>
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Why this reset is being executed"
                className="min-h-[96px] bg-background/70"
              />
            </div>

            <Button
              variant="destructive"
              onClick={() => void runExecute()}
              disabled={executeLoading || confirmText.trim() !== expectedConfirmText}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {executeLoading ? "Executing..." : "Execute Reset"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Operation Runs</CardTitle>
          <CardDescription>Audit log of development reset requests and outcomes.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Operation</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Requested By</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                    No operation runs yet.
                  </TableCell>
                </TableRow>
              ) : (
                runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>
                      <p className="text-sm font-medium">{labelizePreset(run.operation_key)}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">{run.id}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("text-[10px]", statusBadgeClass(run.status))}>
                        {run.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {run.requested_by_email ?? "unknown"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{toDateTime(run.created_at)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {toDuration(run.created_at, run.completed_at)}
                    </TableCell>
                    <TableCell className="max-w-[340px] truncate text-xs text-red-300">
                      {run.error ?? "—"}
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
