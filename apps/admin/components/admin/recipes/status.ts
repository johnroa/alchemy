import { cn } from "@/lib/utils";

export const canonicalStatusBadgeClass = (status: string | null | undefined): string => cn(
  "text-xs",
  status === "ready" && "border-emerald-300 bg-emerald-50 text-emerald-700",
  status === "processing" && "border-blue-300 bg-blue-50 text-blue-700",
  status === "failed" && "border-red-300 bg-red-50 text-red-700",
  status === "pending" && "border-amber-300 bg-amber-50 text-amber-700",
  !status && "text-muted-foreground",
);

export const variantStatusBadgeClass = (status: string | null | undefined): string => cn(
  "text-xs",
  status === "current" && "border-emerald-300 bg-emerald-50 text-emerald-700",
  status === "stale" && "border-amber-300 bg-amber-50 text-amber-700",
  status === "processing" && "border-blue-300 bg-blue-50 text-blue-700",
  status === "failed" && "border-red-300 bg-red-50 text-red-700",
  status === "needs_review" && "border-purple-300 bg-purple-50 text-purple-700",
  !status && "text-muted-foreground",
);

export const formatSourceKindLabel = (value: string | null | undefined): string => {
  if (!value) return "unknown";
  return value.replace(/_/g, " ");
};
