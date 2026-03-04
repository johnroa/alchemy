"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { EntityTypeIcon } from "@/components/admin/entity-type-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type IngredientRow = {
  id: string;
  canonical_name: string;
  normalized_key: string;
  alias_count: number;
  usage_count: number;
  metadata: Record<string, unknown>;
  metadata_key_count: number;
  enrichment_confidence: number | null;
  ontology_link_count: number;
  pair_link_count: number;
  updated_at: string;
};

type IngredientDetail = {
  ingredient: {
    id: string;
    canonical_name: string;
    normalized_key: string;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  };
  aliases: Array<{
    id: string;
    alias_key: string;
    source: string;
    confidence: number;
    created_at: string;
    updated_at: string;
  }>;
  ontology_links: Array<{
    id: string;
    relation_type: string;
    source: string;
    confidence: number;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
    term: {
      id: string;
      term_type: string;
      term_key: string;
      label: string;
      source: string;
      metadata: Record<string, unknown>;
    } | null;
  }>;
  pair_links: Array<{
    ingredient_id: string;
    canonical_name: string;
    normalized_key: string | null;
    co_occurrence_count: number;
    recipe_count: number;
    pmi: number | null;
    lift: number | null;
    updated_at: string;
  }>;
  usages: Array<{
    id: string;
    recipe_id: string | null;
    recipe_title: string;
    recipe_visibility: string | null;
    recipe_image_status: string | null;
    recipe_version_id: string;
    source_name: string;
    source_amount: number | null;
    source_unit: string | null;
    normalized_amount_si: number | null;
    normalized_unit: string | null;
    normalized_status: string;
    category: string | null;
    component: string | null;
    position: number;
    updated_at: string;
  }>;
  graph: {
    entity_id: string | null;
    outgoing_edges: number;
    incoming_edges: number;
    total_edges: number;
  };
};

type FilterValue =
  | "all"
  | "enriched"
  | "unenriched"
  | "mapped"
  | "unmapped"
  | "ontology"
  | "pairs"
  | "high_confidence";

type SortValue =
  | "updated_desc"
  | "updated_asc"
  | "name_asc"
  | "name_desc"
  | "confidence_desc"
  | "usage_desc"
  | "ontology_desc"
  | "pairs_desc"
  | "aliases_desc";

type PageSizeValue = "20" | "40" | "80";

const FILTER_OPTIONS: Array<{ value: FilterValue; label: string }> = [
  { value: "all", label: "All" },
  { value: "enriched", label: "Enriched" },
  { value: "unenriched", label: "Unenriched" },
  { value: "mapped", label: "Mapped" },
  { value: "unmapped", label: "Unmapped" },
  { value: "ontology", label: "Has Ontology" },
  { value: "pairs", label: "Has Pair Stats" },
  { value: "high_confidence", label: "Confidence ≥ 0.85" }
];

const SORT_OPTIONS: Array<{ value: SortValue; label: string }> = [
  { value: "updated_desc", label: "Updated (Newest)" },
  { value: "updated_asc", label: "Updated (Oldest)" },
  { value: "name_asc", label: "Name (A-Z)" },
  { value: "name_desc", label: "Name (Z-A)" },
  { value: "confidence_desc", label: "Confidence (High-Low)" },
  { value: "usage_desc", label: "Usage (High-Low)" },
  { value: "ontology_desc", label: "Ontology Links (High-Low)" },
  { value: "pairs_desc", label: "Pair Links (High-Low)" },
  { value: "aliases_desc", label: "Aliases (High-Low)" }
];

const PAGE_SIZE_OPTIONS: Array<{ value: PageSizeValue; label: string }> = [
  { value: "20", label: "20 / page" },
  { value: "40", label: "40 / page" },
  { value: "80", label: "80 / page" }
];

const formatMaybeNumber = (value: number | null, digits = 2): string => {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
};

const metadataValueLabel = (value: unknown): string => {
  if (value == null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[${value.slice(0, 4).map((item) => metadataValueLabel(item)).join(", ")}${value.length > 4 ? ", …" : ""}]`;
  }
  if (typeof value === "object") return "{…}";
  return String(value);
};

const shortId = (value: string): string => {
  if (value.length < 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
};

const applyFilter = (row: IngredientRow, filter: FilterValue): boolean => {
  if (filter === "all") return true;
  if (filter === "enriched") return row.enrichment_confidence != null;
  if (filter === "unenriched") return row.enrichment_confidence == null;
  if (filter === "mapped") return row.usage_count > 0;
  if (filter === "unmapped") return row.usage_count === 0;
  if (filter === "ontology") return row.ontology_link_count > 0;
  if (filter === "pairs") return row.pair_link_count > 0;
  if (filter === "high_confidence") return (row.enrichment_confidence ?? 0) >= 0.85;
  return true;
};

const compareIngredients = (a: IngredientRow, b: IngredientRow, sort: SortValue): number => {
  if (sort === "updated_desc") return Date.parse(b.updated_at) - Date.parse(a.updated_at);
  if (sort === "updated_asc") return Date.parse(a.updated_at) - Date.parse(b.updated_at);
  if (sort === "name_asc") return a.canonical_name.localeCompare(b.canonical_name);
  if (sort === "name_desc") return b.canonical_name.localeCompare(a.canonical_name);
  if (sort === "confidence_desc") return (b.enrichment_confidence ?? -1) - (a.enrichment_confidence ?? -1);
  if (sort === "usage_desc") return b.usage_count - a.usage_count;
  if (sort === "ontology_desc") return b.ontology_link_count - a.ontology_link_count;
  if (sort === "pairs_desc") return b.pair_link_count - a.pair_link_count;
  if (sort === "aliases_desc") return b.alias_count - a.alias_count;
  return 0;
};

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
  const [detailById, setDetailById] = useState<Record<string, IngredientDetail>>({});
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
      const payload = (await response.json()) as IngredientDetail | { error?: string };

      if (!response.ok) {
        const errorMessage =
          typeof payload === "object" && payload && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "Failed to load ingredient detail";
        throw new Error(errorMessage);
      }

      setDetailById((prev) => ({
        ...prev,
        [ingredientId]: payload as IngredientDetail
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
        <CardHeader className="space-y-3 pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <EntityTypeIcon entityType="ingredient" className="h-4 w-4 text-emerald-600" />
                Canonical Ingredient Registry
              </CardTitle>
              <CardDescription>Search, filter, sort, and inspect ingredient enrichment coverage.</CardDescription>
            </div>
            <Badge variant="outline" className="font-mono text-xs">
              {filteredIngredients.length.toLocaleString()} / {ingredients.length.toLocaleString()} rows
            </Badge>
          </div>

          <div className="grid gap-2 md:grid-cols-[1fr_180px_200px_130px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Search ingredient, key, or id"
                className="pl-8"
              />
            </div>

            <Select
              value={filter}
              onValueChange={(value) => {
                const next = FILTER_OPTIONS.find((option) => option.value === value)?.value ?? "all";
                setFilter(next);
                setPage(1);
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
                setSort(next);
                setPage(1);
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
                setPageSize(next);
                setPage(1);
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
              {pagedIngredients.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No ingredients match current search/filter settings.
                  </TableCell>
                </TableRow>
              ) : (
                pagedIngredients.map((ingredient) => {
                  const isActive = activeIngredientId === ingredient.id;
                  return (
                    <TableRow
                      key={ingredient.id}
                      onClick={() => handleSelectIngredient(ingredient.id)}
                      className={cn("cursor-pointer", isActive && "bg-primary/5")}
                    >
                      <TableCell>
                        <p className="inline-flex items-center gap-1.5 text-sm font-medium">
                          <EntityTypeIcon entityType="ingredient" className="h-3.5 w-3.5 text-emerald-600" />
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

          <div className="flex items-center justify-between gap-2 border-t pt-3">
            <p className="text-xs text-muted-foreground">
              Showing {filteredIngredients.length === 0 ? 0 : startIndex + 1}–
              {Math.min(startIndex + itemsPerPage, filteredIngredients.length)} of {filteredIngredients.length}
            </p>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={safePage <= 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Badge variant="outline" className="font-mono text-xs">
                {safePage}/{pageCount}
              </Badge>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
                disabled={safePage >= pageCount}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="xl:sticky xl:top-4">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <EntityTypeIcon entityType="ingredient" className="h-4 w-4 text-emerald-600" />
            Ingredient Detail
          </CardTitle>
          <CardDescription>
            {activeIngredientId ? "Lazy-loaded metadata, ontology, pair graph, aliases, and recipe usage." : "Select a row to inspect detail."}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {!activeIngredientId ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No ingredient selected.
            </div>
          ) : activeDetail == null ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              {loadingId === activeIngredientId ? "Loading ingredient detail…" : activeError ?? "Select an ingredient."}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border bg-zinc-50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="inline-flex items-center gap-1.5 text-sm font-semibold">
                      <EntityTypeIcon entityType="ingredient" className="h-4 w-4 text-emerald-600" />
                      {activeDetail.ingredient.canonical_name}
                    </p>
                    <p className="font-mono text-[11px] text-muted-foreground">{activeDetail.ingredient.normalized_key}</p>
                    <p className="font-mono text-[10px] text-muted-foreground">{shortId(activeDetail.ingredient.id)}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="outline" className="text-[10px]">{activeDetail.aliases.length} aliases</Badge>
                    <Badge variant="outline" className="text-[10px]">{activeDetail.ontology_links.length} ontology</Badge>
                    <Badge variant="outline" className="text-[10px]">{activeDetail.pair_links.length} pairs</Badge>
                    <Badge variant="outline" className="text-[10px]">{activeDetail.usages.length} uses</Badge>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>Graph edges: {activeDetail.graph.total_edges}</span>
                  <span>Updated: {new Date(activeDetail.ingredient.updated_at).toLocaleString()}</span>
                </div>
              </div>

              <Tabs defaultValue="metadata" className="w-full">
                <TabsList className="grid w-full grid-cols-5">
                  <TabsTrigger value="metadata">Metadata</TabsTrigger>
                  <TabsTrigger value="ontology">Ontology</TabsTrigger>
                  <TabsTrigger value="pairs">Pairs</TabsTrigger>
                  <TabsTrigger value="usage">Usage</TabsTrigger>
                  <TabsTrigger value="aliases">Aliases</TabsTrigger>
                </TabsList>

                <TabsContent value="metadata" className="space-y-3">
                  <div className="grid gap-2">
                    {Object.entries(activeDetail.ingredient.metadata).length === 0 ? (
                      <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No metadata keys persisted.</p>
                    ) : (
                      Object.entries(activeDetail.ingredient.metadata).map(([key, value]) => (
                        <div key={key} className="rounded-md border p-2">
                          <p className="font-mono text-[11px] text-muted-foreground">{key}</p>
                          <p className="mt-1 text-xs">{metadataValueLabel(value)}</p>
                        </div>
                      ))
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="ontology">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Term</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Relation</TableHead>
                        <TableHead>Confidence</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeDetail.ontology_links.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                            No ontology links.
                          </TableCell>
                        </TableRow>
                      ) : (
                        activeDetail.ontology_links.slice(0, 80).map((link) => (
                          <TableRow key={link.id}>
                            <TableCell>
                              <p className="text-xs font-medium">{link.term?.label ?? "Unknown term"}</p>
                              <p className="font-mono text-[10px] text-muted-foreground">{link.term?.term_key ?? "n/a"}</p>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{link.term?.term_type ?? "—"}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-[10px]">{link.relation_type}</Badge>
                            </TableCell>
                            <TableCell className="text-xs">{link.confidence.toFixed(2)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </TabsContent>

                <TabsContent value="pairs">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ingredient</TableHead>
                        <TableHead>Co-occur</TableHead>
                        <TableHead>Lift</TableHead>
                        <TableHead>PMI</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeDetail.pair_links.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                            No pair stats yet.
                          </TableCell>
                        </TableRow>
                      ) : (
                        activeDetail.pair_links.slice(0, 80).map((pair) => (
                          <TableRow key={pair.ingredient_id}>
                            <TableCell>
                              <p className="text-xs font-medium">{pair.canonical_name}</p>
                              <p className="font-mono text-[10px] text-muted-foreground">{pair.normalized_key ?? "—"}</p>
                            </TableCell>
                            <TableCell className="text-xs">{pair.co_occurrence_count}</TableCell>
                            <TableCell className="text-xs">{formatMaybeNumber(pair.lift, 3)}</TableCell>
                            <TableCell className="text-xs">{formatMaybeNumber(pair.pmi, 3)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </TabsContent>

                <TabsContent value="usage">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Recipe</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeDetail.usages.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                            No recipe usage rows.
                          </TableCell>
                        </TableRow>
                      ) : (
                        activeDetail.usages.slice(0, 80).map((usage) => (
                          <TableRow key={usage.id}>
                            <TableCell>
                              {usage.recipe_id ? (
                                <Link href={`/recipes?recipe=${usage.recipe_id}`} className="inline-flex items-center gap-1.5 text-xs font-medium underline-offset-2 hover:underline">
                                  <EntityTypeIcon entityType="recipe" className="h-3.5 w-3.5 text-blue-600" />
                                  {usage.recipe_title}
                                </Link>
                              ) : (
                                <p className="inline-flex items-center gap-1.5 text-xs font-medium">
                                  <EntityTypeIcon entityType="recipe" className="h-3.5 w-3.5 text-blue-600" />
                                  {usage.recipe_title}
                                </p>
                              )}
                              <p className="font-mono text-[10px] text-muted-foreground">{shortId(usage.recipe_version_id)}</p>
                            </TableCell>
                            <TableCell className="text-xs">
                              {usage.source_name}
                              <p className="text-[10px] text-muted-foreground">
                                {usage.source_amount ?? "?"} {usage.source_unit ?? ""}
                              </p>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[10px]",
                                  usage.normalized_status === "normalized"
                                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                                    : "border-amber-300 bg-amber-50 text-amber-700"
                                )}
                              >
                                {usage.normalized_status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </TabsContent>

                <TabsContent value="aliases">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Alias</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Confidence</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeDetail.aliases.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                            No aliases.
                          </TableCell>
                        </TableRow>
                      ) : (
                        activeDetail.aliases.slice(0, 80).map((alias) => (
                          <TableRow key={alias.id}>
                            <TableCell className="font-mono text-xs">{alias.alias_key}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{alias.source}</TableCell>
                            <TableCell className="text-xs">{alias.confidence.toFixed(2)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
