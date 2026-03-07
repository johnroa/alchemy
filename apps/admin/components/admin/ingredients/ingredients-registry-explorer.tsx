"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { IngredientDetail } from "./ingredient-detail";
import { IngredientFilters } from "./ingredient-filters";
import { IngredientTable } from "./ingredient-table";
import {
  applyFilter,
  compareIngredients,
  type FilterValue,
  type IngredientDetail as IngredientDetailType,
  type IngredientRow,
  type PageSizeValue,
  type SortValue,
} from "./types";

/**
 * Main orchestrator for the ingredient registry explorer. Owns all client state
 * (search, filter, sort, pagination, selection, lazy-loaded detail cache) and
 * composes the filter header, data table, and detail panel sub-components.
 */
export function IngredientsRegistryExplorer({
  ingredients
}: {
  ingredients: IngredientRow[];
}): React.JSX.Element {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterValue>("all");
  const [sort, setSort] = useState<SortValue>("updated_desc");
  const [pageSize, setPageSize] = useState<PageSizeValue>("40");
  const [page, setPage] = useState(1);
  const [selectedIngredientId, setSelectedIngredientId] = useState<string | null>(ingredients[0]?.id ?? null);
  const [detailById, setDetailById] = useState<Record<string, IngredientDetailType>>({});
  const [errorById, setErrorById] = useState<Record<string, string>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const requestedIdsRef = useRef<Set<string>>(new Set());

  const filteredIngredients = useMemo(() => {
    const query = search.trim().toLowerCase();
    return ingredients
      .filter((row) => {
        if (!applyFilter(row, filter)) return false;
        if (!query) return true;
        return (
          row.canonical_name.toLowerCase().includes(query) ||
          row.normalized_key.toLowerCase().includes(query) ||
          row.id.toLowerCase().includes(query)
        );
      })
      .sort((a, b) => compareIngredients(a, b, sort));
  }, [filter, ingredients, search, sort]);

  const selectedInFiltered = selectedIngredientId
    ? filteredIngredients.some((row) => row.id === selectedIngredientId)
    : false;

  const activeIngredientId = selectedInFiltered ? selectedIngredientId : (filteredIngredients[0]?.id ?? null);

  const itemsPerPage = Number(pageSize);
  const pageCount = Math.max(1, Math.ceil(filteredIngredients.length / itemsPerPage));
  const safePage = Math.min(page, pageCount);
  const startIndex = (safePage - 1) * itemsPerPage;
  const pagedIngredients = filteredIngredients.slice(startIndex, startIndex + itemsPerPage);

  const activeDetail = activeIngredientId ? detailById[activeIngredientId] ?? null : null;
  const activeError = activeIngredientId ? errorById[activeIngredientId] ?? null : null;

  const loadIngredientDetail = useCallback(async (ingredientId: string) => {
    if (requestedIdsRef.current.has(ingredientId)) {
      return;
    }

    requestedIdsRef.current.add(ingredientId);
    setLoadingId(ingredientId);

    try {
      const response = await fetch(`/api/admin/ingredients/${ingredientId}`, { cache: "no-store" });
      const payload = (await response.json()) as IngredientDetailType | { error?: string };

      if (!response.ok) {
        const errorMessage =
          typeof payload === "object" && payload && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "Failed to load ingredient detail";
        throw new Error(errorMessage);
      }

      setDetailById((prev) => ({
        ...prev,
        [ingredientId]: payload as IngredientDetailType
      }));
      setErrorById((prev) => {
        const next = { ...prev };
        delete next[ingredientId];
        return next;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load ingredient detail";
      setErrorById((prev) => ({ ...prev, [ingredientId]: message }));
      requestedIdsRef.current.delete(ingredientId);
    } finally {
      setLoadingId((current) => (current === ingredientId ? null : current));
    }
  }, []);

  const handleSelectIngredient = useCallback(
    (ingredientId: string) => {
      setSelectedIngredientId(ingredientId);
      void loadIngredientDetail(ingredientId);
    },
    [loadIngredientDetail]
  );

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  const handleFilterChange = useCallback((value: FilterValue) => {
    setFilter(value);
    setPage(1);
  }, []);

  const handleSortChange = useCallback((value: SortValue) => {
    setSort(value);
    setPage(1);
  }, []);

  const handlePageSizeChange = useCallback((value: PageSizeValue) => {
    setPageSize(value);
    setPage(1);
  }, []);

  useEffect(() => {
    if (safePage !== page) {
      setPage(safePage);
    }
  }, [page, safePage]);

  useEffect(() => {
    if (selectedInFiltered) {
      return;
    }
    setSelectedIngredientId(filteredIngredients[0]?.id ?? null);
  }, [filteredIngredients, selectedInFiltered]);

  useEffect(() => {
    if (!activeIngredientId) {
      return;
    }
    if (detailById[activeIngredientId] || errorById[activeIngredientId] || loadingId === activeIngredientId) {
      return;
    }
    void loadIngredientDetail(activeIngredientId);
  }, [activeIngredientId, detailById, errorById, loadIngredientDetail, loadingId]);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Card>
        <IngredientFilters
          search={search}
          onSearchChange={handleSearchChange}
          filter={filter}
          onFilterChange={handleFilterChange}
          sort={sort}
          onSortChange={handleSortChange}
          pageSize={pageSize}
          onPageSizeChange={handlePageSizeChange}
          filteredCount={filteredIngredients.length}
          totalCount={ingredients.length}
        />
        <IngredientTable
          ingredients={pagedIngredients}
          activeIngredientId={activeIngredientId}
          onSelectIngredient={handleSelectIngredient}
          page={safePage}
          pageCount={pageCount}
          onPageChange={setPage}
          startIndex={startIndex}
          itemsPerPage={itemsPerPage}
          filteredCount={filteredIngredients.length}
        />
      </Card>

      <IngredientDetail
        activeIngredientId={activeIngredientId}
        activeDetail={activeDetail}
        loadingId={loadingId}
        activeError={activeError}
      />
    </div>
  );
}
