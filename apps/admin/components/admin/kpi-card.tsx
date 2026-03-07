import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KPI_TONES } from "@/lib/admin-tones";

type KpiVariant = "default" | "success" | "warning" | "danger" | "muted";

const variantStyles: Record<KpiVariant, { card: string; icon: string; value: string }> = KPI_TONES;

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
