"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CookbookEntryRow } from "@/lib/admin-data/recipes";
import {
  RECIPE_RENDER_GROUP_BY,
  RECIPE_RENDER_TEMPERATURE_UNITS,
  RECIPE_RENDER_UNITS,
  RECIPE_RENDER_VERBOSITIES,
  type RecipeRenderGroupBy,
  type RecipeRenderInspectorResponse,
  type RecipeRenderIngredient,
  type RecipeRenderPreview,
  type RecipeRenderTemperatureUnit,
  type RecipeRenderUnits,
  type RecipeRenderVerbosity,
} from "@/lib/recipe-render-preview";
import { canonicalStatusBadgeClass, formatSourceKindLabel, variantStatusBadgeClass } from "./status";

type RecipeRenderInspectorProps = {
  recipeId: string;
  cookbookEntries: CookbookEntryRow[];
};

const VERBOSITY_LABELS: Record<RecipeRenderVerbosity, string> = {
  concise: "Concise",
  balanced: "Balanced",
  detailed: "Detailed",
};

const GROUP_BY_LABELS: Record<RecipeRenderGroupBy, string> = {
  component: "By component",
  category: "By category",
  flat: "Flat list",
};

const TEMPERATURE_LABELS: Record<RecipeRenderTemperatureUnit, string> = {
  fahrenheit: "Fahrenheit",
  celsius: "Celsius",
};

const UNITS_LABELS: Record<RecipeRenderUnits, string> = {
  imperial: "U.S.",
  metric: "Metric",
};

const formatQuantity = (ingredient: RecipeRenderIngredient): string => {
  const amount =
    ingredient.display_amount ??
    (typeof ingredient.amount === "number" || typeof ingredient.amount === "string"
      ? String(ingredient.amount)
      : "");
  const unit = ingredient.unit?.trim() ?? "";
  return [amount, unit].filter((value) => value.length > 0).join(" ").trim();
};

const buildIngredientMeta = (ingredient: RecipeRenderIngredient): string | null => {
  const parts = [
    ingredient.preparation,
    ingredient.category,
    ingredient.component,
  ].filter((value): value is string => Boolean(value && value.trim()));
  return parts.length > 0 ? parts.join(" · ") : null;
};

const buildFallbackGroups = (
  preview: RecipeRenderPreview | null,
): Array<{ key: string; label: string; ingredients: RecipeRenderIngredient[] }> => {
  if (!preview) return [];
  if (preview.ingredient_groups.length > 0) {
    return preview.ingredient_groups;
  }
  return [{
    key: "ingredients",
    label: "Ingredients",
    ingredients: preview.ingredients,
  }];
};

const formatCookbookOptionLabel = (entry: CookbookEntryRow): string => {
  const identity = entry.user_email ?? entry.user_id.slice(0, 8);
  return `Private · ${identity} · ${entry.canonical_status}`;
};

export function RecipeRenderInspector({
  recipeId,
  cookbookEntries,
}: RecipeRenderInspectorProps): React.JSX.Element {
  const privateEntries = cookbookEntries;
  const [sourceKey, setSourceKey] = useState<string>("canonical");
  const [units, setUnits] = useState<RecipeRenderUnits>("imperial");
  const [groupBy, setGroupBy] = useState<RecipeRenderGroupBy>("component");
  const [inlineMeasurements, setInlineMeasurements] = useState(true);
  const [temperatureUnit, setTemperatureUnit] =
    useState<RecipeRenderTemperatureUnit>("fahrenheit");
  const [payload, setPayload] = useState<RecipeRenderInspectorResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    if (
      sourceKey !== "canonical" &&
      !privateEntries.some((entry) => entry.id === sourceKey)
    ) {
      setSourceKey("canonical");
    }
  }, [sourceKey, privateEntries]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    const load = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const query = new URLSearchParams({
          units,
          group_by: groupBy,
          inline_measurements: inlineMeasurements ? "true" : "false",
          temperature_unit: temperatureUnit,
        });
        if (sourceKey !== "canonical") {
          query.set("cookbook_entry_id", sourceKey);
        }

        const response = await fetch(
          `/api/admin/recipes/${encodeURIComponent(recipeId)}/render?${query.toString()}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );

        const nextPayload = (await response.json()) as
          | RecipeRenderInspectorResponse
          | { error?: string };
        if (!response.ok) {
          throw new Error(
            "error" in nextPayload && typeof nextPayload.error === "string"
              ? nextPayload.error
              : "Failed to load render preview",
          );
        }

        if (!cancelled) {
          setPayload(nextPayload as RecipeRenderInspectorResponse);
        }
      } catch (loadError) {
        if (controller.signal.aborted || cancelled) {
          return;
        }
        setPayload(null);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load render preview",
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    recipeId,
    sourceKey,
    units,
    groupBy,
    inlineMeasurements,
    temperatureUnit,
    reloadNonce,
  ]);

  const balancedPreview = payload?.previews.balanced ?? null;
  const ingredientGroups = buildFallbackGroups(balancedPreview);
  const source = payload?.source ?? null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Render Inspector</CardTitle>
              <CardDescription>
                Live recipe projection from the API. Compare concise, balanced,
                and detailed instructions without changing canonical data.
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => setReloadNonce((value) => value + 1)}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Source
              </p>
              <Select value={sourceKey} onValueChange={setSourceKey}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="canonical">Canonical</SelectItem>
                  {privateEntries.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {formatCookbookOptionLabel(entry)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Units
              </p>
              <Select
                value={units}
                onValueChange={(value) => setUnits(value as RecipeRenderUnits)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RECIPE_RENDER_UNITS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {UNITS_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Grouping
              </p>
              <Select
                value={groupBy}
                onValueChange={(value) => setGroupBy(value as RecipeRenderGroupBy)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RECIPE_RENDER_GROUP_BY.map((value) => (
                    <SelectItem key={value} value={value}>
                      {GROUP_BY_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Temperature
              </p>
              <Select
                value={temperatureUnit}
                onValueChange={(value) =>
                  setTemperatureUnit(value as RecipeRenderTemperatureUnit)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RECIPE_RENDER_TEMPERATURE_UNITS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {TEMPERATURE_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Inline measurements
            </p>
            <Button
              type="button"
              size="sm"
              variant={inlineMeasurements ? "default" : "outline"}
              className="h-7 px-2 text-xs"
              onClick={() => setInlineMeasurements(true)}
            >
              On
            </Button>
            <Button
              type="button"
              size="sm"
              variant={!inlineMeasurements ? "default" : "outline"}
              className="h-7 px-2 text-xs"
              onClick={() => setInlineMeasurements(false)}
            >
              Off
            </Button>
            {source && (
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {source.label}
                </Badge>
                {source.kind === "cookbook_entry" && source.canonical_status && (
                  <Badge variant="outline" className={canonicalStatusBadgeClass(source.canonical_status)}>
                    canon {source.canonical_status}
                  </Badge>
                )}
                {source.kind === "cookbook_entry" && source.variant_status && (
                  <Badge variant="outline" className={variantStatusBadgeClass(source.variant_status)}>
                    {source.variant_status}
                  </Badge>
                )}
                {source.kind === "cookbook_entry" && source.source_kind && (
                  <Badge variant="secondary" className="text-xs">
                    {formatSourceKindLabel(source.source_kind)}
                  </Badge>
                )}
                <Badge variant="outline" className="text-xs">
                  {UNITS_LABELS[units]} · {GROUP_BY_LABELS[groupBy]} · {TEMPERATURE_LABELS[temperatureUnit]}
                </Badge>
              </div>
            )}
          </div>

          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {source?.kind === "cookbook_entry" && source.canonical_failure_reason && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              Canon failed: {source.canonical_failure_reason}
            </div>
          )}

          {source?.kind === "cookbook_entry" && source.adaptation_summary && (
            <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {source.adaptation_summary}
            </div>
          )}

          {balancedPreview && (
            <div className="rounded-md border bg-muted/20 px-3 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{balancedPreview.title}</p>
                  {balancedPreview.summary && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {balancedPreview.summary}
                    </p>
                  )}
                  {balancedPreview.description && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {balancedPreview.description}
                    </p>
                  )}
                </div>
                {balancedPreview.servings != null && (
                  <Badge variant="secondary">
                    {balancedPreview.servings} servings
                  </Badge>
                )}
              </div>
            </div>
          )}

          {loading && !payload && (
            <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading live render preview…
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(320px,360px)_minmax(0,1fr)]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Grouped Ingredients</CardTitle>
            <CardDescription>
              Uses the same read-time grouping and units projection as the app.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            {ingredientGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No ingredients available for this render.
              </p>
            ) : (
              ingredientGroups.map((group) => (
                <div key={group.key} className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{group.label}</p>
                    <Badge variant="outline" className="text-[10px]">
                      {group.ingredients.length} items
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    {group.ingredients.map((ingredient) => {
                      const quantity = formatQuantity(ingredient);
                      const meta = buildIngredientMeta(ingredient);
                      return (
                        <div
                          key={`${group.key}-${ingredient.name}-${quantity}`}
                          className="rounded-md border px-3 py-2"
                        >
                          <div className="flex items-start justify-between gap-3 text-sm">
                            <div>
                              <p className="font-medium">{ingredient.name}</p>
                              {meta && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {meta}
                                </p>
                              )}
                            </div>
                            <span className="text-right font-mono text-xs text-muted-foreground">
                              {quantity || "—"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 2xl:grid-cols-3">
          {RECIPE_RENDER_VERBOSITIES.map((verbosity) => {
            const preview = payload?.previews[verbosity] ?? null;
            return (
              <Card key={verbosity}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-sm">
                      {VERBOSITY_LABELS[verbosity]}
                    </CardTitle>
                    <Badge
                      variant={verbosity === "balanced" ? "default" : "outline"}
                      className={verbosity === "balanced" ? "bg-black text-[10px] text-white" : "text-[10px]"}
                    >
                      {verbosity}
                    </Badge>
                  </div>
                  <CardDescription>
                    Instruction rendering with current units, temperature, and
                    inline settings applied.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  {!preview ? (
                    <p className="text-sm text-muted-foreground">
                      {loading ? "Loading…" : "No preview available."}
                    </p>
                  ) : preview.steps.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No steps available for this render.
                    </p>
                  ) : (
                    preview.steps.map((step) => (
                      <div
                        key={`${verbosity}-${step.index}`}
                        className="rounded-md border px-3 py-3"
                      >
                        <div className="mb-2 flex items-center gap-2">
                          <Badge variant="secondary">Step {step.index}</Badge>
                          {step.title && (
                            <span className="text-xs font-medium text-muted-foreground">
                              {step.title}
                            </span>
                          )}
                        </div>
                        <p className="text-sm leading-6">{step.instruction}</p>
                        {step.notes && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            {step.notes}
                          </p>
                        )}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
