"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const runProcessRequest = async (limit: number): Promise<{ error?: string; processed?: number; reaped?: number } | null> => {
  const response = await fetch("/api/admin/metadata/jobs/process", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ limit })
  });

  const payload = (await response.json().catch(() => null)) as { error?: string; processed?: number; reaped?: number } | null;
  if (!response.ok) {
    return payload ?? { error: "Metadata job processing failed" };
  }

  return payload;
};

export function MetadataPipelineControls(): React.JSX.Element {
  const [processing, setProcessing] = useState(false);
  const [reaping, setReaping] = useState(false);

  const processQueue = async (): Promise<void> => {
    setProcessing(true);
    const payload = await runProcessRequest(10);
    setProcessing(false);

    if (!payload || payload.error) {
      toast.error(payload?.error ?? "Failed to process metadata queue");
      return;
    }

    toast.success(`Processed ${payload.processed ?? 0} jobs · reaped ${payload.reaped ?? 0} stale locks`);
    window.location.reload();
  };

  const reapStaleLocks = async (): Promise<void> => {
    setReaping(true);
    const payload = await runProcessRequest(0);
    setReaping(false);

    if (!payload || payload.error) {
      toast.error(payload?.error ?? "Failed to reap stale locks");
      return;
    }

    toast.success(`Reaped ${payload.reaped ?? 0} stale metadata locks`);
    window.location.reload();
  };

  return (
    <div className="flex gap-2">
      <Button variant="outline" onClick={() => void reapStaleLocks()} disabled={reaping || processing}>
        {reaping ? "Reaping..." : "Reap Stale Locks"}
      </Button>
      <Button onClick={() => void processQueue()} disabled={processing || reaping}>
        {processing ? "Processing..." : "Process Metadata Queue"}
      </Button>
    </div>
  );
}
