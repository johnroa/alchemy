import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { ADMIN_SECTIONS, getLandingCardsForSection } from "@/lib/admin-navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function SectionLanding({
  sectionKey,
  eyebrow,
  children,
}: {
  sectionKey: (typeof ADMIN_SECTIONS)[number]["key"];
  eyebrow?: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  const section = ADMIN_SECTIONS.find((entry) => entry.key === sectionKey) ?? ADMIN_SECTIONS[0]!;
  const cards = getLandingCardsForSection(section.key);
  const Icon = section.icon;

  return (
    <div className="space-y-8">
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4 rounded-[1.75rem] border border-border/60 bg-[radial-gradient(circle_at_top_left,rgba(22,163,74,0.18),transparent_42%),linear-gradient(180deg,rgba(11,17,28,0.98)_0%,rgba(7,12,20,0.94)_100%)] p-7 shadow-sm">
          {eyebrow ? (
            <Badge variant="outline" className="rounded-full">
              {eyebrow}
            </Badge>
          ) : null}
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <Icon className="h-5 w-5" />
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight">{section.title}</h1>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{section.description}</p>
            </div>
          </div>
        </div>

        <Card className="border-border/60 bg-card/80 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-base">What lives here</CardTitle>
            <CardDescription>{cards.length} primary workflows in this section.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {cards.map((card) => (
              <div key={card.key} className="flex items-start gap-3 rounded-2xl border border-border/50 bg-background/80 p-3">
                <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl bg-muted">
                  <card.icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{card.title}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{card.description}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      {children}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => {
          const CardIcon = card.icon;
          return (
            <Link key={card.key} href={card.href} className="group block">
              <Card className="h-full border-border/60 bg-card/80 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:shadow-md">
                <CardHeader className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-muted/80">
                      <CardIcon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </div>
                  <div className="space-y-1">
                    <CardTitle className="text-lg">{card.title}</CardTitle>
                    <CardDescription>{card.description}</CardDescription>
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
