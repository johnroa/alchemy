"use client";

import { Search } from "lucide-react";
import { EntityTypeIcon } from "@/components/admin/entity-type-icon";
import { Badge } from "@/components/ui/badge";
import { CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FILTER_OPTIONS,
  PAGE_SIZE_OPTIONS,
  SORT_OPTIONS,
  type FilterValue,
  type PageSizeValue,
  type SortValue,
} from "./types";

type IngredientFiltersProps = {
  search: string;
  onSearchChange: (value: string) => void;
  filter: FilterValue;
  onFilterChange: (value: FilterValue) => void;
  sort: SortValue;
  onSortChange: (value: SortValue) => void;
  pageSize: PageSizeValue;
  onPageSizeChange: (value: PageSizeValue) => void;
  filteredCount: number;
  totalCount: number;
};

/**
 * Search bar, filter/sort/page-size select controls, and summary badge for
 * the ingredient registry table header.
 */
export function IngredientFilters({
  search,
  onSearchChange,
  filter,
  onFilterChange,
  sort,
  onSortChange,
  pageSize,
  onPageSizeChange,
  filteredCount,
  totalCount,
}: IngredientFiltersProps): React.JSX.Element {
  return (
    <CardHeader className="space-y-3 pb-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <EntityTypeIcon entityType="ingredient" className="h-4 w-4" />
            Canonical Ingredient Registry
          </CardTitle>
          <CardDescription>Search, filter, sort, and inspect ingredient enrichment coverage.</CardDescription>
        </div>
        <Badge variant="outline" className="font-mono text-xs">
          {filteredCount.toLocaleString()} / {totalCount.toLocaleString()} rows
        </Badge>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_180px_200px_130px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search ingredient, key, or id"
            className="pl-8"
          />
        </div>

        <Select
          value={filter}
          onValueChange={(value) => {
            const next = FILTER_OPTIONS.find((option) => option.value === value)?.value ?? "all";
            onFilterChange(next);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Filter" />
          </SelectTrigger>
          <SelectContent>
            {FILTER_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={sort}
          onValueChange={(value) => {
            const next = SORT_OPTIONS.find((option) => option.value === value)?.value ?? "updated_desc";
            onSortChange(next);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={pageSize}
          onValueChange={(value) => {
            const next = PAGE_SIZE_OPTIONS.find((option) => option.value === value)?.value ?? "40";
            onPageSizeChange(next);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Page size" />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </CardHeader>
  );
}
