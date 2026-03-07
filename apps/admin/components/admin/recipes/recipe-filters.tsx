import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  buildRecipesHref,
  SORT_OPTIONS,
  STATUS_OPTIONS,
  type RecipeSortOrder,
  type RecipeStatusFilter,
} from "./types";

type RecipeFiltersProps = {
  q: string;
  status: RecipeStatusFilter;
  sort: RecipeSortOrder;
};

/**
 * Search form, image-status filter badges, and sort-order badges for the recipe
 * list sidebar. Server component — navigation is link-based via query params.
 */
export function RecipeFilters({ q, status, sort }: RecipeFiltersProps): React.JSX.Element {
  return (
    <CardHeader className="space-y-3 pb-2">
      <form action="/content/recipes" method="get" className="flex flex-wrap gap-2">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search recipes…"
          className="h-8 text-sm"
        />
        <input type="hidden" name="status" value={status} />
        <input type="hidden" name="sort" value={sort} />
        <Button type="submit" size="sm" className="h-8 px-3">
          Search
        </Button>
        {q && (
          <Link href={buildRecipesHref({ status, sort })}>
            <Button type="button" variant="outline" size="sm" className="h-8 px-2">
              ✕
            </Button>
          </Link>
        )}
      </form>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-1">
          {STATUS_OPTIONS.map((option) => (
            <Link
              key={option.value}
              href={buildRecipesHref({ q, status: option.value, sort })}
            >
              <Badge
                variant="outline"
                className={cn(
                  "cursor-pointer text-[10px]",
                  status === option.value && "border-primary/60 bg-primary/10 text-primary"
                )}
              >
                {option.label}
              </Badge>
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {SORT_OPTIONS.map((option) => (
            <Link
              key={option.value}
              href={buildRecipesHref({ q, status, sort: option.value })}
            >
              <Badge
                variant="outline"
                className={cn(
                  "cursor-pointer text-[10px]",
                  sort === option.value && "border-primary/60 bg-primary/10 text-primary"
                )}
              >
                {option.label}
              </Badge>
            </Link>
          ))}
        </div>
      </div>
    </CardHeader>
  );
}
