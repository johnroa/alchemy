"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { STATUS_TONES } from "@/lib/admin-tones";
import { cn } from "@/lib/utils";

type MetadataJob = {
  id: string;
  recipe_id: string;
  recipe_version_id: string;
  recipe_title: string | null;
  status: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  locked_at: string | null;
  locked_by: string | null;
  updated_at: string;
};

const statusConfig: Record<string, { badge: string; dot: string }> = {
  ready: { badge: STATUS_TONES.success, dot: "bg-emerald-400" },
  processing: { badge: STATUS_TONES.info, dot: "bg-sky-400" },
  pending: { badge: STATUS_TONES.warning, dot: "bg-amber-400" },
  failed: { badge: STATUS_TONES.danger, dot: "bg-red-400" }
};

const statusStyle = (status: string): { badge: string; dot: string } => {
  return statusConfig[status] ?? { badge: STATUS_TONES.neutral, dot: "bg-muted-foreground" };
};

export function MetadataJobsTable({ jobs }: { jobs: MetadataJob[] }): React.JSX.Element {
  const [busyJobId, setBusyJobId] = useState<string | null>(null);

  const retry = async (jobId: string): Promise<void> => {
    setBusyJobId(jobId);

    const response = await fetch("/api/admin/metadata/jobs/retry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ job_id: jobId })
    });

    setBusyJobId(null);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      toast.error(payload?.error ?? "Failed to retry metadata job");
      return;
    }

    toast.success("Metadata job re-queued");
    window.location.reload();
  };

  if (jobs.length === 0) {
    return <div className="py-12 text-center text-sm text-muted-foreground">No metadata jobs in queue.</div>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Status</TableHead>
          <TableHead>Recipe</TableHead>
          <TableHead>Attempts</TableHead>
          <TableHead>Next Attempt</TableHead>
          <TableHead>Lock</TableHead>
          <TableHead>Error</TableHead>
          <TableHead className="text-right">Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => {
          const style = statusStyle(job.status);
          return (
            <TableRow key={job.id}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className={cn("h-2 w-2 rounded-full", style.dot)} />
                  <Badge variant="outline" className={style.badge}>
                    {job.status}
                  </Badge>
                </div>
              </TableCell>
              <TableCell>
                <p className="text-sm font-medium">{job.recipe_title ?? "Untitled Recipe"}</p>
                <p className="font-mono text-[11px] text-muted-foreground">{job.recipe_id}</p>
              </TableCell>
              <TableCell>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {job.attempts}/{job.max_attempts}
                </span>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{new Date(job.next_attempt_at).toLocaleString()}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {job.locked_at ? (
                  <div>
                    <p>{new Date(job.locked_at).toLocaleString()}</p>
                    <p className="font-mono text-[10px]">{job.locked_by ?? "unknown"}</p>
                  </div>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell className="max-w-[240px] truncate text-xs text-red-300">
                {job.last_error ?? <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  disabled={busyJobId === job.id || job.status === "ready"}
                  onClick={() => void retry(job.id)}
                >
                  <RefreshCw className={cn("h-3 w-3", busyJobId === job.id && "animate-spin")} />
                  {busyJobId === job.id ? "Retrying..." : "Retry"}
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
