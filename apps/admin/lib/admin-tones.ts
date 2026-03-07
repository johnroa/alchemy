export const STATUS_TONES = {
  success: "border-emerald-500/30 bg-emerald-500/12 text-emerald-300",
  info: "border-sky-500/30 bg-sky-500/12 text-sky-300",
  warning: "border-amber-500/30 bg-amber-500/12 text-amber-300",
  danger: "border-red-500/30 bg-red-500/12 text-red-300",
  accent: "border-violet-500/30 bg-violet-500/12 text-violet-300",
  neutral: "border-border/80 bg-muted/45 text-foreground/80",
} as const;

export const KPI_TONES = {
  default: { card: "", icon: "text-muted-foreground", value: "text-foreground" },
  success: {
    card: "border-emerald-500/30 bg-emerald-500/10",
    icon: "text-emerald-300",
    value: "text-emerald-200",
  },
  warning: {
    card: "border-amber-500/30 bg-amber-500/10",
    icon: "text-amber-300",
    value: "text-amber-200",
  },
  danger: {
    card: "border-red-500/30 bg-red-500/10",
    icon: "text-red-300",
    value: "text-red-200",
  },
  muted: {
    card: "border-border/80 bg-muted/45",
    icon: "text-muted-foreground",
    value: "text-foreground/85",
  },
} as const;
