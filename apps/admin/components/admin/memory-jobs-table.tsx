"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type MemoryJob = {
  id: string;
  user_id: string;
  user_email: string | null;
  chat_id: string;
  message_id: string;
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
  ready: { badge: "border-emerald-300 bg-emerald-50 text-emerald-700", dot: "bg-emerald-400" },
  processing: { badge: "border-blue-300 bg-blue-50 text-blue-700", dot: "bg-blue-400" },
  pending: { badge: "border-amber-300 bg-amber-50 text-amber-700", dot: "bg-amber-400" },
  failed: { badge: "border-red-300 bg-red-50 text-red-700", dot: "bg-red-400" }
};

const statusStyle = (status: string): { badge: string; dot: string } => {
  return statusConfig[status] ?? { badge: "", dot: "bg-zinc-400" };
};

const shortId = (value: string): string => {
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
};

export function MemoryJobsTable({ jobs }: { jobs: MemoryJob[] }): React.JSX.Element {
  const [busyJobId, setBusyJobId] = useState<string | null>(null);

  const retry = async (jobId: string): Promise<void> => {
    setBusyJobId(jobId);

    const response = await fetch("/api/admin/memory/jobs/retry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ job_id: jobId })
    });

    setBusyJobId(null);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      toast.error(payload?.error ?? "Failed to retry memory job");
      return;
    }

    toast.success("Memory job re-queued");
    window.location.reload();
  };

  if (jobs.length === 0) {
    return <div className="py-8 text-center text-sm text-muted-foreground">No memory jobs in queue.</div>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Status</TableHead>
          <TableHead>User</TableHead>
          <TableHead>Context</TableHead>
          <TableHead>Attempts</TableHead>
          <TableHead>Next Attempt</TableHead>
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
                <p className="text-sm font-medium">{job.user_email ?? "Unknown user"}</p>
                <p className="font-mono text-[11px] text-muted-foreground">{shortId(job.user_id)}</p>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                <p>chat {shortId(job.chat_id)}</p>
                <p>msg {shortId(job.message_id)}</p>
              </TableCell>
              <TableCell className="text-xs tabular-nums text-muted-foreground">{job.attempts}/{job.max_attempts}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{new Date(job.next_attempt_at).toLocaleString()}</TableCell>
              <TableCell className="max-w-[280px] truncate text-xs text-red-600">
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
