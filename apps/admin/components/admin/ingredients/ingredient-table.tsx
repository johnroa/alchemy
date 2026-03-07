"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { EntityTypeIcon } from "@/components/admin/entity-type-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { IngredientRow } from "./types";

type IngredientTableProps = {
  /** Current page of ingredient rows to display. */
  ingredients: IngredientRow[];
  activeIngredientId: string | null;
  onSelectIngredient: (ingredientId: string) => void;
  /** 1-indexed current page number. */
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** 0-indexed start of current page window within the filtered result set. */
  startIndex: number;
  /** Items per page. */
  itemsPerPage: number;
  /** Total number of rows matching current search/filter (not just current page). */
  filteredCount: number;
};

/**
 * Ingredient data table with pagination controls. Highlights the currently
 * selected row and delegates selection to the parent orchestrator.
 */
export function IngredientTable({
  ingredients,
  activeIngredientId,
  onSelectIngredient,
  page,
  pageCount,
  onPageChange,
  startIndex,
  itemsPerPage,
  filteredCount,
}: IngredientTableProps): React.JSX.Element {
  return (
    <CardContent className="space-y-3 pt-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Confidence</TableHead>
            <TableHead>Usage</TableHead>
            <TableHead>Ontology</TableHead>
            <TableHead>Pairs</TableHead>
            <TableHead>Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ingredients.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                No ingredients match current search/filter settings.
              </TableCell>
            </TableRow>
          ) : (
            ingredients.map((ingredient) => {
              const isActive = activeIngredientId === ingredient.id;
              return (
                <TableRow
                  key={ingredient.id}
                  onClick={() => onSelectIngredient(ingredient.id)}
                  className={cn("cursor-pointer", isActive && "bg-primary/5")}
                >
                  <TableCell>
                    <p className="inline-flex items-center gap-1.5 text-sm font-medium">
                      <EntityTypeIcon
                        entityType="ingredient"
                        canonicalName={ingredient.canonical_name}
                        normalizedKey={ingredient.normalized_key}
                        metadata={ingredient.metadata}
                        className="h-3.5 w-3.5"
                      />
                      {ingredient.canonical_name}
                    </p>
                    <p className="font-mono text-[10px] text-muted-foreground">{ingredient.normalized_key}</p>
                  </TableCell>
                  <TableCell>
                    {ingredient.enrichment_confidence == null ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        {ingredient.enrichment_confidence.toFixed(2)}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-[10px]">
                      {ingredient.usage_count}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">
                      {ingredient.ontology_link_count}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">
                      {ingredient.pair_link_count}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(ingredient.updated_at).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <p className="text-xs text-muted-foreground">
          Showing {filteredCount === 0 ? 0 : startIndex + 1}–
          {Math.min(startIndex + itemsPerPage, filteredCount)} of {filteredCount}
        </p>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Badge variant="outline" className="font-mono text-xs">
            {page}/{pageCount}
          </Badge>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onPageChange(Math.min(pageCount, page + 1))}
            disabled={page >= pageCount}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </CardContent>
  );
}
