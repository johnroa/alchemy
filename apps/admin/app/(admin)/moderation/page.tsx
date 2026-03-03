import { ExternalLink, Info, ShieldOff } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function ModerationPage(): Promise<React.JSX.Element> {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Moderation"
        description="Content moderation controls and publication queue management."
      />

      {/* Status card */}
      <Card className="border-zinc-200 bg-zinc-50/60">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldOff className="h-4 w-4 text-zinc-500" />
            Moderation Queue Inactive
          </CardTitle>
          <CardDescription>
            The Explore feed has been removed from v1. There is no publication queue to approve — all user-generated
            recipes remain private to their owners.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-center">
            <ShieldOff className="mx-auto mb-3 h-10 w-10 text-zinc-300" />
            <p className="text-sm font-medium text-zinc-500">No moderation queue is active.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              When a public recipe feed is re-enabled, this queue will populate with submission reviews.
            </p>
          </div>

          <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50/60 p-4">
            <Info className="mt-0.5 h-4 w-4 flex-none text-blue-600" />
            <div className="space-y-2">
              <p className="text-sm font-medium text-blue-900">Safety monitoring is still active</p>
              <p className="text-xs text-blue-700">
                LLM safety flags, rate-limit events, and abuse detection remain operational and are visible on the
                Dashboard. Use the Request Trace and Changelog tools to investigate any flagged activity.
              </p>
              <div className="flex gap-2 pt-1">
                <Link href="/dashboard">
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                    <ExternalLink className="h-3 w-3" />
                    View Safety Events
                  </Button>
                </Link>
                <Link href="/request-trace">
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                    <ExternalLink className="h-3 w-3" />
                    Request Trace
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
