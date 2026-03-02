"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";

export function RevertVersionDialog({ recipeId, versionId }: { recipeId: string; versionId: string }): React.JSX.Element {
  const [loading, setLoading] = useState(false);

  const onRevert = async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/recipes/revert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recipe_id: recipeId, version_id: versionId })
      });

      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Failed to revert version");
      }

      toast.success("Recipe reverted to selected version");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to revert version");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Revert
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revert Recipe Version</DialogTitle>
          <DialogDescription>
            This sets the selected version as current for the recipe.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => void onRevert()} disabled={loading}>
            {loading ? "Reverting..." : "Confirm Revert"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
