"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type MemoryJobsSummary = {
  jobs: Array<{ id: string; status: string }>;
};

export function MemoryPipelineControls(): React.JSX.Element {
  const [processing, setProcessing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [backfilling, setBackfilling] = useState(false);

  const processQueue = async (): Promise<void> => {
    setProcessing(true);
    const response = await fetch("/api/admin/memory/jobs/process", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: 25 })
    });
    const payload = (await response.json().catch(() => null)) as { error?: string; processed?: number; succeeded?: number; failed?: number } | null;
    setProcessing(false);

    if (!response.ok || payload?.error) {
      toast.error(payload?.error ?? "Failed to process memory queue");
      return;
    }

    toast.success(`Processed ${payload?.processed ?? 0} jobs · succeeded ${payload?.succeeded ?? 0}`);
    window.location.reload();
  };

  const retryFailed = async (): Promise<void> => {
    setRetrying(true);
    const listResponse = await fetch("/api/admin/memory/jobs", { method: "GET" });
    const listPayload = (await listResponse.json().catch(() => null)) as MemoryJobsSummary | { error?: string } | null;
    if (!listResponse.ok || !listPayload || !("jobs" in listPayload)) {
      setRetrying(false);
      toast.error("Failed to load memory jobs");
      return;
    }

    const failedIds = listPayload.jobs.filter((job) => job.status === "failed").map((job) => job.id);
    if (failedIds.length === 0) {
      setRetrying(false);
      toast.info("No failed memory jobs to retry");
      return;
    }

    let succeeded = 0;
    for (const jobId of failedIds) {
      const response = await fetch("/api/admin/memory/jobs/retry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ job_id: jobId })
      });
      if (response.ok) {
        succeeded += 1;
      }
    }

    setRetrying(false);
    toast.success(`Retried ${succeeded}/${failedIds.length} failed memory jobs`);
    window.location.reload();
  };

  const backfillMissing = async (): Promise<void> => {
    setBackfilling(true);
    const response = await fetch("/api/admin/memory/search/backfill", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ missing_only: true, limit: 100 }),
    });
    const payload = (await response.json().catch(() => null)) as
      | { error?: string; indexed?: number; missing?: number }
      | null;
    setBackfilling(false);

    if (!response.ok || payload?.error) {
      toast.error(payload?.error ?? "Failed to backfill memory retrieval docs");
      return;
    }

    toast.success(`Indexed ${payload?.indexed ?? 0} memory retrieval docs`);
    window.location.reload();
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => void retryFailed()} disabled={retrying || processing || backfilling}>
        {retrying ? "Retrying..." : "Retry Failed"}
      </Button>
      <Button variant="outline" onClick={() => void backfillMissing()} disabled={backfilling || processing || retrying}>
        {backfilling ? "Backfilling..." : "Backfill Missing Retrieval Docs"}
      </Button>
      <Button onClick={() => void processQueue()} disabled={processing || retrying || backfilling}>
        {processing ? "Processing..." : "Process Memory Queue"}
      </Button>
    </div>
  );
}
