import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CookbookEntryRow } from "@/lib/admin-data";
import { CookbookCanonRetryButton } from "./cookbook-canon-retry-button";
import { canonicalStatusBadgeClass, formatSourceKindLabel, variantStatusBadgeClass } from "./status";
import { shortId } from "./types";

type PrivateCookbookQueueProps = {
  entries: CookbookEntryRow[];
};

export function PrivateCookbookQueue({
  entries,
}: PrivateCookbookQueueProps): React.JSX.Element | null {
  if (entries.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Private Canon Queue</CardTitle>
        <CardDescription>
          Private cookbook entries that are still deriving, retrying, or failing canonical publication.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Private recipe</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Canon</TableHead>
              <TableHead>Variant</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="max-w-[24rem] align-top">
                  <div className="space-y-1">
                    <p className="font-medium">
                      {entry.private_title ?? "Untitled private recipe"}
                    </p>
                    {entry.private_summary && (
                      <p className="text-xs text-muted-foreground">
                        {entry.private_summary}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="outline" className="font-mono text-[10px]">
                        entry {shortId(entry.id)}
                      </Badge>
                      {entry.source_chat_id && (
                        <Badge variant="outline" className="font-mono text-[10px]">
                          chat {shortId(entry.source_chat_id)}
                        </Badge>
                      )}
                      {entry.preview_image_status && (
                        <Badge variant="secondary" className="text-[10px]">
                          image {entry.preview_image_status}
                        </Badge>
                      )}
                    </div>
                    {entry.canonical_failure_reason && (
                      <p className="text-xs text-red-700">
                        {entry.canonical_failure_reason}
                      </p>
                    )}
                  </div>
                </TableCell>
                <TableCell className="align-top text-xs">
                  {entry.user_email ?? entry.user_id.slice(0, 8)}
                </TableCell>
                <TableCell className="align-top">
                  <div className="space-y-1">
                    <Badge variant="outline" className={canonicalStatusBadgeClass(entry.canonical_status)}>
                      {entry.canonical_status}
                    </Badge>
                    {entry.canonical_recipe_id && (
                      <div>
                        <Link
                          href={`/content/recipes?recipe=${encodeURIComponent(entry.canonical_recipe_id)}`}
                          className="font-mono text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                        >
                          {shortId(entry.canonical_recipe_id)}
                        </Link>
                      </div>
                    )}
                  </div>
                </TableCell>
                <TableCell className="align-top">
                  <div className="space-y-1">
                    <Badge variant="outline" className={variantStatusBadgeClass(entry.variant_status)}>
                      {entry.variant_status ?? "none"}
                    </Badge>
                    {entry.variant_id && (
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {shortId(entry.variant_id)}
                      </p>
                    )}
                  </div>
                </TableCell>
                <TableCell className="align-top">
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p>{formatSourceKindLabel(entry.source_kind)}</p>
                    {entry.seed_origin && <p>seed {entry.seed_origin}</p>}
                    {entry.derivation_kind && <p>{entry.derivation_kind}</p>}
                  </div>
                </TableCell>
                <TableCell className="align-top text-xs text-muted-foreground">
                  {new Date(entry.updated_at).toLocaleString()}
                </TableCell>
                <TableCell className="align-top text-right">
                  <div className="flex justify-end gap-2">
                    <CookbookCanonRetryButton
                      entryId={entry.id}
                      disabled={entry.canonical_status === "processing"}
                    />
                    {entry.canonical_recipe_id && (
                      <Link
                        href={`/content/recipes?recipe=${encodeURIComponent(entry.canonical_recipe_id)}`}
                        className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium"
                      >
                        Open
                      </Link>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
