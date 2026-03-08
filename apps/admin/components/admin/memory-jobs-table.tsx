"use client";

import { useState } from "react";
import { Eye, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
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

type MemoryJobMetadata = {
  id: string;
  interaction_context: Record<string, unknown>;
  metadata: Record<string, unknown>;
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
  const [openMetadataJobId, setOpenMetadataJobId] = useState<string | null>(null);
  const [loadingMetadataJobId, setLoadingMetadataJobId] = useState<string | null>(null);
  const [metadataByJobId, setMetadataByJobId] = useState<Record<string, MemoryJobMetadata>>({});
  const [metadataErrorByJobId, setMetadataErrorByJobId] = useState<Record<string, string>>({});
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "processing" | "ready" | "failed">("all");

  const loadMetadata = async (jobId: string): Promise<void> => {
    setOpenMetadataJobId(jobId);
    if (metadataByJobId[jobId] || loadingMetadataJobId === jobId) {
      return;
    }

    setLoadingMetadataJobId(jobId);
    setMetadataErrorByJobId((current) => ({ ...current, [jobId]: "" }));

    const response = await fetch(`/api/admin/memory/jobs/${jobId}`, { method: "GET" });
    const payload = (await response.json().catch(() => null)) as
      | MemoryJobMetadata
      | { error?: string }
      | null;

    setLoadingMetadataJobId(null);

    if (!response.ok || !payload || !("interaction_context" in payload)) {
      setMetadataErrorByJobId((current) => ({
        ...current,
        [jobId]:
          payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "Failed to load job metadata"
      }));
      return;
    }

    setMetadataByJobId((current) => ({ ...current, [jobId]: payload }));
  };

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

  const filteredJobs = statusFilter === "all"
    ? jobs
    : jobs.filter((job) => job.status === statusFilter);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {(["all", "pending", "processing", "ready", "failed"] as const).map((status) => (
          <Button
            key={status}
            size="sm"
            variant={statusFilter === status ? "default" : "outline"}
            onClick={() => setStatusFilter(status)}
          >
            {status === "all" ? "All" : status}
          </Button>
        ))}
      </div>
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
          {filteredJobs.map((job) => {
          const style = statusStyle(job.status);
          const lockedMs = job.locked_at ? Date.parse(job.locked_at) : NaN;
          const isStaleLock = job.status === "processing" &&
            Number.isFinite(lockedMs) &&
            (Date.now() - lockedMs) > (5 * 60 * 1000);
          return (
            <TableRow key={job.id}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className={cn("h-2 w-2 rounded-full", style.dot)} />
                  <Badge variant="outline" className={style.badge}>
                    {job.status}
                  </Badge>
                  {isStaleLock ? (
                    <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700">
                      stale lock
                    </Badge>
                  ) : null}
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
              <TableCell className="text-xs text-muted-foreground">
                <p>{new Date(job.next_attempt_at).toLocaleString()}</p>
                {job.locked_at ? (
                  <p className={cn("mt-1", isStaleLock ? "text-red-600" : "text-muted-foreground")}>
                    locked {new Date(job.locked_at).toLocaleString()}
                  </p>
                ) : null}
              </TableCell>
              <TableCell className="max-w-[280px] truncate text-xs text-red-600">
                {job.last_error ?? <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Dialog
                    open={openMetadataJobId === job.id}
                    onOpenChange={(open) => setOpenMetadataJobId(open ? job.id : null)}
                  >
                    <DialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="gap-1.5"
                        onClick={() => void loadMetadata(job.id)}
                      >
                        <Eye className="h-3 w-3" />
                        Metadata
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-3xl">
                      <DialogHeader>
                        <DialogTitle>Memory Job Metadata</DialogTitle>
                        <DialogDescription className="font-mono text-[11px]">
                          {job.id}
                        </DialogDescription>
                      </DialogHeader>
                      {loadingMetadataJobId === job.id ? (
                        <p className="text-sm text-muted-foreground">Loading metadata…</p>
                      ) : metadataErrorByJobId[job.id] ? (
                        <p className="text-sm text-red-600">{metadataErrorByJobId[job.id]}</p>
                      ) : (
                        <div className="space-y-4">
                          <div className="space-y-1.5">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Interaction Context
                            </p>
                            <pre className="max-h-[220px] overflow-auto rounded-md bg-zinc-950 p-3 text-[11px] text-zinc-100">
                              {JSON.stringify(metadataByJobId[job.id]?.interaction_context ?? {}, null, 2)}
                            </pre>
                          </div>
                          <div className="space-y-1.5">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Metadata
                            </p>
                            <pre className="max-h-[220px] overflow-auto rounded-md bg-zinc-950 p-3 text-[11px] text-zinc-100">
                              {JSON.stringify(metadataByJobId[job.id]?.metadata ?? {}, null, 2)}
                            </pre>
                          </div>
                        </div>
                      )}
                    </DialogContent>
                  </Dialog>
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
                </div>
              </TableCell>
            </TableRow>
          );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
