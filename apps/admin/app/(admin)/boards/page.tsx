import Link from "next/link";
import { Activity, ArrowUpRight, Sparkles, Target } from "lucide-react";
import { BoardPageHeader } from "@/components/admin/board-kit";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const BOARD_LINKS = [
  {
    href: "/boards/engagement",
    title: "Engagement",
    description: "North-star usage, acceptance, cookbook behavior, and return-to-cook signals.",
    icon: Target,
  },
  {
    href: "/boards/operations",
    title: "Operations",
    description: "Generation latency, defect pressure, cost discipline, and queue health.",
    icon: Activity,
  },
  {
    href: "/boards/personalization",
    title: "Personalization",
    description: "Reserved for ranking lift, preference learning velocity, and negative-feedback loops.",
    icon: Sparkles,
  },
];

export default function BoardsLandingPage(): React.JSX.Element {
  return (
    <div className="space-y-8">
      <BoardPageHeader
        eyebrow="Executive boards"
        title="Boards"
        description="Curated operating views for Alchemy. These pages stay opinionated on purpose: fixed KPIs, stronger visual hierarchy, and direct drill-down paths into the deeper analytics surfaces."
        badges={["Executive KPIs", "Curated drill-downs", "First-party telemetry"]}
      />

      <section className="grid gap-4 xl:grid-cols-3">
        {BOARD_LINKS.map((board) => {
          const Icon = board.icon;
          return (
            <Link key={board.href} href={board.href} className="group block">
              <Card className="h-full rounded-[1.6rem] border-border/60 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.12),transparent_34%),linear-gradient(180deg,rgba(11,17,28,0.98)_0%,rgba(7,12,20,0.94)_100%)] transition-transform duration-200 group-hover:-translate-y-0.5">
                <CardHeader className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
                      <Icon className="h-4 w-4 text-foreground/80" />
                    </div>
                    <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </div>
                  <div className="space-y-1">
                    <CardTitle className="text-lg tracking-tight">{board.title}</CardTitle>
                    <CardDescription>{board.description}</CardDescription>
                  </div>
                </CardHeader>
              </Card>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
