import { FolderGit2, Link2 } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getVersionCausalityData } from "@/lib/admin-data";

function shortId(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

export default async function VersionCausalityPage(): Promise<React.JSX.Element> {
  const data = await getVersionCausalityData();

  const eventTypeSet = new Set(data.versionEvents.map((e) => e.event_type));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Version Causality"
        description="Trace recipe versions to request-level events and attachment graph links for causal debugging."
      />

      {/* Version Events */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <FolderGit2 className="h-4 w-4 text-muted-foreground" />
              Version Events
            </CardTitle>
            <CardDescription className="mt-0.5">
              Per-version lifecycle events with request traceability.
              {eventTypeSet.size > 0 && (
                <span className="ml-1">{eventTypeSet.size} event type{eventTypeSet.size !== 1 ? "s" : ""}.</span>
              )}
            </CardDescription>
          </div>
          <Badge variant="outline" className="font-mono text-xs">
            {data.versionEvents.length} events
          </Badge>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Version ID</TableHead>
                <TableHead>Event Type</TableHead>
                <TableHead>Request ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.versionEvents.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    No version events yet.
                  </TableCell>
                </TableRow>
              ) : (
                data.versionEvents.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(event.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {shortId(event.recipe_version_id)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-xs">
                        {event.event_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {event.request_id ? shortId(event.request_id) : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Attachment Links */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Link2 className="h-4 w-4 text-muted-foreground" />
              Attachment Links
            </CardTitle>
            <CardDescription className="mt-0.5">
              Parent-child recipe relationships used by the tabbed finalized experience.
            </CardDescription>
          </div>
          <Badge variant="outline" className="font-mono text-xs">
            {data.links.length} links
          </Badge>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Parent Recipe</TableHead>
                <TableHead>Child Recipe</TableHead>
                <TableHead>Position</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.links.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    No recipe attachment links yet.
                  </TableCell>
                </TableRow>
              ) : (
                data.links.map((link) => (
                  <TableRow key={link.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {shortId(link.parent_recipe_id)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {shortId(link.child_recipe_id)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        #{link.position}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(link.updated_at).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
