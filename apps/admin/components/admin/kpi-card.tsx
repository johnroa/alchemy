import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type KpiVariant = "default" | "success" | "warning" | "danger" | "muted";

const variantStyles: Record<KpiVariant, { card: string; icon: string; value: string }> = {
  default: { card: "", icon: "text-muted-foreground", value: "text-foreground" },
  success: {
    card: "border-emerald-200 bg-emerald-50",
    icon: "text-emerald-600",
    value: "text-emerald-700"
  },
  warning: {
    card: "border-amber-200 bg-amber-50",
    icon: "text-amber-600",
    value: "text-amber-700"
  },
  danger: {
    card: "border-red-200 bg-red-50",
    icon: "text-red-600",
    value: "text-red-700"
  },
  muted: {
    card: "border-zinc-200 bg-zinc-50",
    icon: "text-zinc-400",
    value: "text-zinc-600"
  }
};

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  variant = "default"
}: {
  label: string;
  value: string;
  hint: string;
  icon?: LucideIcon;
  variant?: KpiVariant;
}): React.JSX.Element {
  const styles = variantStyles[variant];

  return (
    <Card className={cn("transition-colors", styles.card)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4">
        <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</CardTitle>
        {Icon && <Icon className={cn("h-4 w-4", styles.icon)} />}
      </CardHeader>
      <CardContent className="pb-4">
        <div className={cn("text-2xl font-bold tabular-nums", styles.value)}>{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}
