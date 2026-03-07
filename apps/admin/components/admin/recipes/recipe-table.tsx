import Link from "next/link";
import { ImageIcon } from "lucide-react";
import { EntityTypeIcon } from "@/components/admin/entity-type-icon";
import { Badge } from "@/components/ui/badge";
import type { RecipeAuditIndexRow } from "@/lib/admin-data";
import { cn } from "@/lib/utils";
import {
  buildRecipesHref,
  imageStatusBadgeClass,
  type RecipeSortOrder,
  type RecipeStatusFilter,
} from "./types";

type RecipeTableProps = {
  rows: RecipeAuditIndexRow[];
  /** Currently selected recipe id for highlight, if any. */
  selectedRecipeId: string | undefined;
  q: string;
  status: RecipeStatusFilter;
  sort: RecipeSortOrder;
};

/**
 * Scrollable list of recipe rows inside the left-hand sidebar card. Each row is
 * a link that selects the recipe for detail inspection.
 */
export function RecipeTable({ rows, selectedRecipeId, q, status, sort }: RecipeTableProps): React.JSX.Element {
  return (
    <div className="overflow-y-auto" style={{ maxHeight: "calc(100dvh - 260px)" }}>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">No recipes match.</p>
      ) : (
        rows.map((row) => (
          <Link key={row.id} href={buildRecipesHref({ q, recipe: row.id, status, sort })}>
            <div
              className={cn(
                "border-b px-4 py-3 transition-colors hover:bg-zinc-50",
                selectedRecipeId === row.id
                  ? "border-l-2 border-l-primary bg-primary/5"
                  : "border-l-2 border-l-transparent"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="inline-flex max-w-full items-center gap-1.5 truncate text-sm font-semibold">
                    <EntityTypeIcon entityType="recipe" className="h-3.5 w-3.5 flex-none" />
                    <span className="truncate">{row.title}</span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.owner_email ?? "No owner"}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={cn("flex-none text-[10px]", imageStatusBadgeClass(row.image_status))}
                >
                  <ImageIcon className="mr-1 h-2.5 w-2.5" />
                  {row.image_status}
                </Badge>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                <span>{row.version_count} versions</span>
                <span>{row.save_count} saves</span>
                <span>{row.attachment_count} links</span>
                <span className="sm:ml-auto">{new Date(row.updated_at).toLocaleDateString()}</span>
              </div>
            </div>
          </Link>
        ))
      )}
    </div>
  );
}
