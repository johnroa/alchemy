import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getModerationData } from "@/lib/admin-data";

export default async function ModerationPage(): Promise<React.JSX.Element> {
  const moderation = await getModerationData();

  return (
    <div className="space-y-6">
      <PageHeader title="Moderation" description="Review publication status, abuse signals, and queue decisions." />
      <Card>
        <CardHeader>
          <CardTitle>Publication Queue</CardTitle>
          <CardDescription>Public-by-default recipes can be hidden or flagged here.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Recipe ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {moderation.queue.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    Moderation queue is empty.
                  </TableCell>
                </TableRow>
              ) : (
                moderation.queue.map((item) => (
                  <TableRow key={item.recipe_id}>
                    <TableCell className="font-mono text-xs">{item.recipe_id}</TableCell>
                    <TableCell>
                      <Badge variant={item.status === "active" ? "default" : "secondary"}>{item.status}</Badge>
                    </TableCell>
                    <TableCell>{item.moderation_notes ?? "n/a"}</TableCell>
                    <TableCell>{new Date(item.updated_at).toLocaleString()}</TableCell>
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
