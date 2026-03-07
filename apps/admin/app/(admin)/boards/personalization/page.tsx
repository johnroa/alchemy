import { Sparkles } from "lucide-react";
import { BoardPageHeader } from "@/components/admin/board-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function PersonalizationBoardPlaceholderPage(): React.JSX.Element {
  return (
    <div className="space-y-8">
      <BoardPageHeader
        eyebrow="Queued board"
        title="Personalization"
        description="This board is reserved for Explore lift, preference-learning velocity, and ranking-quality signals once the ranking-ready rollups are fully stabilized."
        badges={["Explore lift", "Preference learning", "Negative feedback"]}
      />

      <Card className="rounded-[1.6rem] border-border/60 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.12),transparent_34%),linear-gradient(180deg,rgba(11,17,28,0.98)_0%,rgba(7,12,20,0.94)_100%)]">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
              <Sparkles className="h-4 w-4 text-foreground/80" />
            </div>
            <CardTitle className="text-lg tracking-tight">Waiting on the ranking foundation</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="max-w-3xl text-sm leading-6 text-muted-foreground">
          The telemetry substrate is being laid down first so this board can show real save lift, cook lift, preference convergence, and negative-feedback pressure without falling back to hand-built heuristics.
        </CardContent>
      </Card>
    </div>
  );
}
