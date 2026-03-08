import Link from "next/link";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type HeroTone = "default" | "success" | "warning" | "danger" | "muted";

const HERO_TONE_STYLES: Record<HeroTone, { shell: string; value: string; eyebrow: string }> = {
  default: {
    shell: "border-border/60 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.14),transparent_36%),linear-gradient(180deg,rgba(14,20,32,0.98)_0%,rgba(9,14,24,0.96)_100%)]",
    value: "text-foreground",
    eyebrow: "text-sky-200/80",
  },
  success: {
    shell: "border-emerald-500/20 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.18),transparent_40%),linear-gradient(180deg,rgba(10,20,18,0.98)_0%,rgba(9,14,24,0.96)_100%)]",
    value: "text-emerald-100",
    eyebrow: "text-emerald-200/80",
  },
  warning: {
    shell: "border-amber-500/20 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.18),transparent_40%),linear-gradient(180deg,rgba(20,16,9,0.98)_0%,rgba(12,12,20,0.96)_100%)]",
    value: "text-amber-100",
    eyebrow: "text-amber-200/80",
  },
  danger: {
    shell: "border-rose-500/20 bg-[radial-gradient(circle_at_top_left,rgba(244,63,94,0.18),transparent_40%),linear-gradient(180deg,rgba(24,11,18,0.98)_0%,rgba(12,12,20,0.96)_100%)]",
    value: "text-rose-100",
    eyebrow: "text-rose-200/80",
  },
  muted: {
    shell: "border-border/50 bg-[linear-gradient(180deg,rgba(11,17,28,0.98)_0%,rgba(7,12,20,0.94)_100%)]",
    value: "text-foreground",
    eyebrow: "text-muted-foreground",
  },
};

export type BoardHeroStat = {
  label: string;
  value: string;
  hint: string;
  tone?: HeroTone;
  icon?: LucideIcon;
  href?: string;
};

export function BoardPageHeader({
  eyebrow,
  title,
  description,
  badges,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  badges?: string[];
}): React.JSX.Element {
  return (
    <section className="rounded-[1.9rem] border border-border/60 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.16),transparent_32%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.12),transparent_24%),linear-gradient(180deg,rgba(10,16,26,0.98)_0%,rgba(7,12,20,0.94)_100%)] p-7 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3">
          {eyebrow ? (
            <Badge variant="outline" className="rounded-full">
              {eyebrow}
            </Badge>
          ) : null}
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
          </div>
        </div>
        {badges && badges.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {badges.map((badge) => (
              <Badge key={badge} variant="secondary" className="rounded-full bg-background/60">
                {badge}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function HeroStatGrid({ items }: { items: BoardHeroStat[] }): React.JSX.Element {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
      {items.map((item) => (
        <HeroStatCard key={item.label} item={item} />
      ))}
    </div>
  );
}

export function HeroStatCard({ item }: { item: BoardHeroStat }): React.JSX.Element {
  const tone = HERO_TONE_STYLES[item.tone ?? "default"];
  const Icon = item.icon;
  const content = (
    <Card className={cn("h-full overflow-hidden rounded-[1.6rem] shadow-sm transition-transform duration-200 hover:-translate-y-0.5", tone.shell)}>
      <CardContent className="flex h-full flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className={cn("text-[11px] font-semibold uppercase tracking-[0.22em]", tone.eyebrow)}>{item.label}</p>
            <div className={cn("text-3xl font-semibold tracking-tight tabular-nums", tone.value)}>{item.value}</div>
          </div>
          {Icon ? (
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
              <Icon className="h-4 w-4 text-foreground/80" />
            </div>
          ) : null}
        </div>
        <p className="text-sm leading-6 text-muted-foreground">{item.hint}</p>
      </CardContent>
    </Card>
  );

  if (!item.href) {
    return content;
  }

  return (
    <Link href={item.href} className="block">
      {content}
    </Link>
  );
}

export function BoardChartCard({
  title,
  description,
  action,
  children,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  const hasHeader = Boolean(title || description || action);

  return (
    <Card className="rounded-[1.6rem] border-border/60 bg-[linear-gradient(180deg,rgba(11,17,28,0.98)_0%,rgba(7,12,20,0.94)_100%)] shadow-sm">
      {hasHeader ? (
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              {title ? <CardTitle className="text-base tracking-tight">{title}</CardTitle> : null}
              {description ? <CardDescription>{description}</CardDescription> : null}
            </div>
            {action}
          </div>
        </CardHeader>
      ) : null}
      <CardContent className={hasHeader ? "pt-0" : undefined}>{children}</CardContent>
    </Card>
  );
}

export function BoardTableCard({
  title,
  description,
  href,
  children,
}: {
  title: string;
  description: string;
  href?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Card className="rounded-[1.6rem] border-border/60 bg-card/85 shadow-sm backdrop-blur">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base tracking-tight">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          {href ? (
            <Link href={href}>
              <Badge variant="outline" className="gap-1 rounded-full">
                View analytics
                <ArrowUpRight className="h-3 w-3" />
              </Badge>
            </Link>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  );
}
