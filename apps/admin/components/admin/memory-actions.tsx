"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function MemoryActions({ userId }: { userId: string }): React.JSX.Element {
  const [busy, setBusy] = useState<"rebuild" | "reset" | null>(null);

  const trigger = async (mode: "rebuild" | "reset"): Promise<void> => {
    setBusy(mode);

    const endpoint = mode === "rebuild" ? "/api/admin/memories/rebuild" : "/api/admin/memories/reset";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id: userId })
    });

    setBusy(null);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      toast.error(payload?.error ?? `Failed to ${mode} memory`);
      return;
    }

    toast.success(mode === "rebuild" ? "Memory artifacts rebuilt" : "User memory reset complete");
    window.location.reload();
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void trigger("rebuild")}
        disabled={busy !== null}
      >
        {busy === "rebuild" ? "Rebuilding..." : "Reindex + Snapshot"}
      </Button>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => void trigger("reset")}
        disabled={busy !== null}
      >
        {busy === "reset" ? "Resetting..." : "Reset"}
      </Button>
    </div>
  );
}
