"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type Job = {
  id: string;
  recipe_id: string;
  status: string;
  attempt: number;
  max_attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  updated_at: string;
};

const statusConfig: Record<string, { badge: string; dot: string }> = {
  ready: { badge: "border-emerald-300 bg-emerald-50 text-emerald-700", dot: "bg-emerald-400" },
  processing: { badge: "border-blue-300 bg-blue-50 text-blue-700", dot: "bg-blue-400" },
  pending: { badge: "border-amber-300 bg-amber-50 text-amber-700", dot: "bg-amber-400" },
  failed: { badge: "border-red-300 bg-red-50 text-red-700", dot: "bg-red-400" }
};

function statusStyle(status: string): { badge: string; dot: string } {
  return statusConfig[status] ?? { badge: "", dot: "bg-zinc-400" };
}

export function ImageJobsTable({ jobs }: { jobs: Job[] }): React.JSX.Element {
  const [busyJobId, setBusyJobId] = useState<string | null>(null);

  const retry = async (jobId: string): Promise<void> => {
    setBusyJobId(jobId);

    const res = await fetch("/api/admin/image/jobs/retry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ job_id: jobId })
    });

    setBusyJobId(null);

    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { error?: string } | null;
      toast.error(payload?.error ?? "Failed to retry image job");
      return;
    }

    toast.success("Image job queued for retry");
    window.location.reload();
  };

  if (jobs.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">No image jobs in queue.</div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Status</TableHead>
          <TableHead>Recipe</TableHead>
          <TableHead>Attempts</TableHead>
          <TableHead>Next Attempt</TableHead>
          <TableHead>Error</TableHead>
          <TableHead>Updated</TableHead>
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
              <TableCell className="font-mono text-xs text-muted-foreground">
                {job.recipe_id.slice(0, 8)}…
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-100">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        job.attempt >= job.max_attempts ? "bg-red-400" : "bg-primary"
                      )}
                      style={{ width: `${(job.attempt / job.max_attempts) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {job.attempt}/{job.max_attempts}
                  </span>
                </div>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {new Date(job.next_attempt_at).toLocaleString()}
              </TableCell>
              <TableCell className="max-w-[200px] truncate text-xs text-red-600">
                {job.last_error ?? <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {new Date(job.updated_at).toLocaleString()}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={busyJobId === job.id || job.status === "ready"}
                  onClick={() => void retry(job.id)}
                >
                  <RefreshCw className={cn("h-3 w-3", busyJobId === job.id && "animate-spin")} />
                  {busyJobId === job.id ? "Retrying…" : "Retry"}
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
