import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type Delta = {
  absolute: number;
  percent: number | null;
};

export const deltaFromWindow = (
  current: number,
  previous: number
): { current: number; previous: number } & Delta => {
  const absolute = current - previous;
  if (previous === 0) {
    return { current, previous, absolute, percent: null };
  }
  return { current, previous, absolute, percent: (absolute / previous) * 100 };
};

const deltaTone = (delta: Delta): "up" | "down" | "flat" => {
  if (delta.absolute > 0) return "up";
  if (delta.absolute < 0) return "down";
  return "flat";
};

export function DeltaBadge({
  delta,
  positiveIsGood = true
}: {
  delta: Delta;
  positiveIsGood?: boolean;
}): React.JSX.Element {
  const tone = deltaTone(delta);
  const effectiveTone =
    tone === "flat"
      ? "flat"
      : positiveIsGood
        ? tone
        : tone === "up"
          ? "down"
          : "up";

  const Icon = effectiveTone === "up" ? ArrowUpRight : effectiveTone === "down" ? ArrowDownRight : null;
  const deltaAbsoluteLabel = `${delta.absolute >= 0 ? "+" : ""}${delta.absolute.toLocaleString()}`;
  const deltaPercentLabel =
    delta.percent == null ? (delta.absolute === 0 ? "0%" : "new") : `${delta.percent >= 0 ? "+" : ""}${delta.percent.toFixed(1)}%`;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium",
        effectiveTone === "up" && "border-emerald-300 bg-emerald-50 text-emerald-700",
        effectiveTone === "down" && "border-red-300 bg-red-50 text-red-700",
        effectiveTone === "flat" && "border-zinc-300 bg-zinc-50 text-zinc-600"
      )}
    >
      {Icon ? <Icon className="h-3 w-3" /> : null}
      <span>{deltaAbsoluteLabel}</span>
      <span className="text-[10px] opacity-80">({deltaPercentLabel})</span>
    </span>
  );
}
