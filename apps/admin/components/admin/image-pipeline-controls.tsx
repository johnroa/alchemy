"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function ImagePipelineControls(): React.JSX.Element {
  const [processing, setProcessing] = useState(false);

  const runBatch = async (): Promise<void> => {
    setProcessing(true);

    const response = await fetch("/api/admin/image/jobs/process", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: 10 })
    });

    setProcessing(false);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      toast.error(payload?.error ?? "Failed to process image jobs");
      return;
    }

    const payload = (await response.json()) as { processed?: number; ready?: number; failed?: number; pending?: number };
    toast.success(
      `Processed ${payload.processed ?? 0} jobs · ready ${payload.ready ?? 0} · pending ${payload.pending ?? 0} · failed ${payload.failed ?? 0}`
    );
    window.location.reload();
  };

  return (
    <Button onClick={() => void runBatch()} disabled={processing}>
      {processing ? "Processing..." : "Process Image Queue"}
    </Button>
  );
}

