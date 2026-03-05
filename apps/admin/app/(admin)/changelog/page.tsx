import { History } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { ChangelogTable } from "@/components/admin/changelog-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getChangelogData } from "@/lib/admin-data";

const actionColors: Record<string, string> = {
  create: "bg-emerald-400",
  update: "bg-blue-400",
  activate: "bg-violet-400",
  delete: "bg-red-400"
};

export default async function ChangelogPage(): Promise<React.JSX.Element> {
  const data = await getChangelogData();

  const scopeSet = new Set(data.items.map((item) => item.scope));
  const actionSet = new Set(data.items.map((item) => item.action));

  // Action distribution counts
  const actionCounts: Record<string, number> = {};
  for (const item of data.items) {
    actionCounts[item.action] = (actionCounts[item.action] ?? 0) + 1;
  }
  const sortedActions = Object.entries(actionCounts).sort((a, b) => b[1] - a[1]);
  const maxActionCount = sortedActions[0]?.[1] ?? 1;

  // Scope distribution counts
  const scopeCounts: Record<string, number> = {};
  for (const item of data.items) {
    scopeCounts[item.scope] = (scopeCounts[item.scope] ?? 0) + 1;
  }
  const sortedScopes = Object.entries(scopeCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxScopeCount = sortedScopes[0]?.[1] ?? 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Changelog"
        description="Immutable mutation log across all platform operations — every write tracked with scope, actor, entity, and request ID."
      />

      {/* Distribution charts */}
      {data.items.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Action distribution */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">By Action</CardTitle>
              <CardDescription>{actionSet.size} action type{actionSet.size !== 1 ? "s" : ""}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {sortedActions.map(([action, count]) => (
                <div key={action} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{action}</span>
                    <span className="tabular-nums text-muted-foreground">{count}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                    <div
                      className={`h-full rounded-full transition-all ${actionColors[action] ?? "bg-zinc-400"}`}
                      style={{ width: `${(count / maxActionCount) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Scope distribution */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">By Scope</CardTitle>
              <CardDescription>{scopeSet.size} scope{scopeSet.size !== 1 ? "s" : ""} active</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {sortedScopes.map(([scope, count]) => (
                <div key={scope} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{scope}</span>
                    <span className="tabular-nums text-muted-foreground">{count}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${(count / maxScopeCount) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4 text-muted-foreground" />
              Recent Changes
            </CardTitle>
            <CardDescription className="mt-0.5">
              {data.items.length} events across {scopeSet.size} scope{scopeSet.size !== 1 ? "s" : ""} and{" "}
              {actionSet.size} action type{actionSet.size !== 1 ? "s" : ""}.
            </CardDescription>
          </div>
          <Badge variant="outline" className="font-mono text-xs">
            {data.items.length} events
          </Badge>
        </CardHeader>
        <CardContent className="pt-0">
          <ChangelogTable items={data.items} />
        </CardContent>
      </Card>
    </div>
  );
}
