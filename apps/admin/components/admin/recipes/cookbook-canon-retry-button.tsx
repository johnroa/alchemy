"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type CookbookCanonRetryButtonProps = {
  entryId: string;
  disabled?: boolean;
  label?: string;
  size?: "sm" | "default";
  variant?: "outline" | "default" | "secondary";
};

export function CookbookCanonRetryButton({
  entryId,
  disabled = false,
  label = "Retry canon",
  size = "sm",
  variant = "outline",
}: CookbookCanonRetryButtonProps): React.JSX.Element {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const onRetry = (): void => {
    startTransition(async () => {
      const response = await fetch(
        `/api/admin/recipes/cookbook/${encodeURIComponent(entryId)}/canon/retry`,
        { method: "POST" },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        canonical_status?: string;
      };

      if (!response.ok) {
        toast.error(payload.error ?? "Canon retry failed");
        return;
      }

      toast.success(
        payload.canonical_status
          ? `Canon status: ${payload.canonical_status}`
          : "Canon retry queued",
      );
      router.refresh();
    });
  };

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      disabled={disabled || isPending}
      onClick={onRetry}
    >
      {isPending ? "Retrying..." : label}
    </Button>
  );
}
