import type { AnalyticsGrain, AnalyticsQueryState } from "@/lib/admin-analytics";
import { getHoursForRange } from "@/lib/admin-analytics";
import { getAdminClient } from "@/lib/supabase-admin";
import { getGraphData } from "./graph";
import { getImagesDashboardData } from "./images";
import { getImportData } from "./imports";
import { getIngredientsData } from "./ingredients";
import { getMetadataPipelineData } from "./pipelines";
import { getRecipeAuditIndexData, getVariantStats } from "./recipes";
import { COUNTABLE_TABLE_COLUMNS, isSchemaMissingError } from "./shared";
import { getMemoryData } from "./memory";
import { getDashboardData } from "./overview";

type TimeBucket = {
  key: string;
  label: string;
  startMs: number;
  endMs: number;
};

type CountQueryResult<Row = unknown> = {
  data?: Row[] | null;
  count?: number | null;
  error?: { message: string } | null;
};

const startOfHour = (date: Date): Date => {
  const next = new Date(date);
  next.setMinutes(0, 0, 0);
  return next;
};

const startOfDay = (date: Date): Date => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const startOfWeek = (date: Date): Date => {
  const next = startOfDay(date);
  const day = next.getDay();
  const diff = day === 0 ? 6 : day - 1;
  next.setDate(next.getDate() - diff);
  return next;
};

const addBucketStep = (date: Date, grain: AnalyticsGrain): Date => {
  const next = new Date(date);
  if (grain === "hour") {
    next.setHours(next.getHours() + 1);
  } else if (grain === "day") {
    next.setDate(next.getDate() + 1);
  } else {
    next.setDate(next.getDate() + 7);
  }
  return next;
};

const formatBucketLabel = (date: Date, grain: AnalyticsGrain): string => {
  if (grain === "hour") {
    return date.toLocaleTimeString([], { hour: "numeric" });
  }
  if (grain === "day") {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
};

const normalizeBucketStart = (date: Date, grain: AnalyticsGrain): Date => {
  if (grain === "hour") return startOfHour(date);
  if (grain === "day") return startOfDay(date);
  return startOfWeek(date);
};

const buildBuckets = (query: AnalyticsQueryState): { buckets: TimeBucket[]; windowStart: Date; windowEnd: Date } => {
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - getHoursForRange(query.range) * 60 * 60 * 1000);
  const buckets: TimeBucket[] = [];

  let cursor = normalizeBucketStart(windowStart, query.grain);
  while (cursor.getTime() <= windowEnd.getTime()) {
    const nextCursor = addBucketStep(cursor, query.grain);
    buckets.push({
      key: cursor.toISOString(),
      label: formatBucketLabel(cursor, query.grain),
      startMs: cursor.getTime(),
      endMs: nextCursor.getTime(),
    });
    cursor = nextCursor;
  }

  return { buckets, windowStart, windowEnd };
};

const incrementBucket = (
  series: Array<Record<string, number | string>>,
  buckets: TimeBucket[],
  timestamp: string | null | undefined,
  field: string,
): void => {
  if (!timestamp) return;
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) return;
  const bucket = buckets.find((entry) => value >= entry.startMs && value < entry.endMs);
  if (!bucket) return;
  const row = series.find((entry) => entry["bucketStart"] === bucket.key);
  if (!row) return;
  row[field] = Number(row[field] ?? 0) + 1;
};

const createSeries = (buckets: TimeBucket[], fields: string[]): Array<Record<string, number | string>> =>
  buckets.map((bucket) => {
    const row: Record<string, number | string> = {
      bucketStart: bucket.key,
      label: bucket.label,
    };
    for (const field of fields) {
      row[field] = 0;
    }
    return row;
  });

const getResultCount = <Row>(result: CountQueryResult<Row>): number => result.count ?? result.data?.length ?? 0;

const throwIfQueryError = (...results: CountQueryResult[]): void => {
  const error = results.find((result) => result.error)?.error;
  if (error) {
    throw new Error(error.message);
  }
};

export const getProductAnalyticsData = async (query: AnalyticsQueryState): Promise<{
  summary: {
    users: number;
    newUsers: number;
    cookbookEntries: number;
    newCookbookEntries: number;
    variants: number;
    newVariants: number;
    staleVariants: number;
    recipes: number;
    recipeUpdates: number;
    ingredients: number;
    ingredientUpdates: number;
  };
  series: Array<Record<string, number | string>>;
}> => {
  const client = getAdminClient();
  const { buckets, windowStart } = buildBuckets(query);

  const [userTotalResult, cookbookTotalResult, variantTotalResult, staleVariantTotalResult, recipeTotalResult, ingredientTotalResult, cookbookSeriesResult, variantSeriesResult, userSeriesResult, recipeUpdatesResult, ingredientUpdatesResult] = await Promise.all([
    client.from("users").select("id", { count: "exact", head: true }),
    client.from("cookbook_entries").select(COUNTABLE_TABLE_COLUMNS.cookbook_entries, { count: "exact", head: true }),
    client.from("user_recipe_variants").select("id", { count: "exact", head: true }),
    client
      .from("user_recipe_variants")
      .select("id", { count: "exact", head: true })
      .in("stale_status", ["stale", "needs_review"]),
    client.from("recipes").select("id", { count: "exact", head: true }),
    client.from("ingredients").select("id", { count: "exact", head: true }),
    client.from("cookbook_entries").select("saved_at", { count: "exact" }).gte("saved_at", windowStart.toISOString()).limit(4000),
    client
      .from("user_recipe_variants")
      .select("created_at", { count: "exact" })
      .gte("created_at", windowStart.toISOString())
      .limit(4000),
    client.from("users").select("created_at", { count: "exact" }).gte("created_at", windowStart.toISOString()).limit(4000),
    client.from("recipes").select("id", { count: "exact", head: true }).gte("updated_at", windowStart.toISOString()),
    client.from("ingredients").select("id", { count: "exact", head: true }).gte("updated_at", windowStart.toISOString()),
  ]);

  throwIfQueryError(
    userTotalResult,
    cookbookTotalResult,
    variantTotalResult,
    staleVariantTotalResult,
    recipeTotalResult,
    ingredientTotalResult,
    cookbookSeriesResult,
    variantSeriesResult,
    userSeriesResult,
    recipeUpdatesResult,
    ingredientUpdatesResult,
  );

  const series = createSeries(buckets, ["users", "cookbook", "variants"]);
  for (const row of userSeriesResult.data ?? []) {
    incrementBucket(series, buckets, String(row.created_at ?? ""), "users");
  }
  for (const row of cookbookSeriesResult.data ?? []) {
    incrementBucket(series, buckets, String(row.saved_at ?? ""), "cookbook");
  }
  for (const row of variantSeriesResult.data ?? []) {
    incrementBucket(series, buckets, String(row.created_at ?? ""), "variants");
  }

  return {
    summary: {
      users: getResultCount(userTotalResult),
      newUsers: getResultCount(userSeriesResult),
      cookbookEntries: getResultCount(cookbookTotalResult),
      newCookbookEntries: getResultCount(cookbookSeriesResult),
      variants: getResultCount(variantTotalResult),
      newVariants: getResultCount(variantSeriesResult),
      staleVariants: getResultCount(staleVariantTotalResult),
      recipes: getResultCount(recipeTotalResult),
      recipeUpdates: getResultCount(recipeUpdatesResult),
      ingredients: getResultCount(ingredientTotalResult),
      ingredientUpdates: getResultCount(ingredientUpdatesResult),
    },
    series,
  };
};

export const getContentAnalyticsData = async (query: AnalyticsQueryState): Promise<{
  summary: {
    recipes: number;
    recipeUpdates: number;
    ingredients: number;
    ingredientUpdates: number;
    graphEntities: number;
    graphEdges: number;
    imageReadyRecipes: number;
    imagePendingRecipes: number;
    variants: Awaited<ReturnType<typeof getVariantStats>>;
  };
  series: Array<Record<string, number | string>>;
}> => {
  const client = getAdminClient();
  const { buckets, windowStart } = buildBuckets(query);
  const [recipeIndex, ingredients, graph, variants, recipeWindowResult, ingredientWindowResult] = await Promise.all([
    getRecipeAuditIndexData(),
    getIngredientsData(),
    getGraphData(),
    getVariantStats(),
    client.from("recipes").select("updated_at,image_status").gte("updated_at", windowStart.toISOString()).limit(4000),
    client.from("ingredients").select("updated_at").gte("updated_at", windowStart.toISOString()).limit(4000),
  ]);

  const series = createSeries(buckets, ["recipes", "ingredients"]);
  for (const row of recipeWindowResult.data ?? []) {
    incrementBucket(series, buckets, String(row.updated_at ?? ""), "recipes");
  }
  for (const row of ingredientWindowResult.data ?? []) {
    incrementBucket(series, buckets, String(row.updated_at ?? ""), "ingredients");
  }

  const imageReadyRecipes = (recipeWindowResult.data ?? []).filter((row) => row.image_status === "ready").length;
  const imagePendingRecipes = (recipeWindowResult.data ?? []).filter((row) => row.image_status === "pending").length;

  return {
    summary: {
      recipes: recipeIndex.totals.recipes,
      recipeUpdates: (recipeWindowResult.data ?? []).length,
      ingredients: ingredients.summary.totals.ingredients,
      ingredientUpdates: (ingredientWindowResult.data ?? []).length,
      graphEntities: graph.entities.length,
      graphEdges: graph.edges.length,
      imageReadyRecipes,
      imagePendingRecipes,
      variants,
    },
    series,
  };
};

export const getPipelineAnalyticsData = async (query: AnalyticsQueryState): Promise<{
  summary: {
    imagePending: number;
    imageFailed: number;
    importsFailed: number;
    metadataPending: number;
    memoryPending: number;
  };
  statusBreakdown: Array<{ pipeline: string; pending: number; processing: number; ready: number; failed: number }>;
  series: Array<Record<string, number | string>>;
  recentFailures: Array<{ pipeline: string; label: string; when: string; reason: string }>;
}> => {
  const { buckets, windowStart } = buildBuckets(query);
  const [images, imports, metadata, memory] = await Promise.all([
    getImagesDashboardData(),
    getImportData(),
    getMetadataPipelineData(),
    getMemoryData(),
  ]);

  const importRows = imports.recentImports.filter((row) => Date.parse(row.created_at) >= windowStart.getTime());
  const imageRows = images.requests.filter((row) => Date.parse(row.created_at) >= windowStart.getTime());
  const metadataRows = metadata.jobs.filter((row) => Date.parse(row.updated_at) >= windowStart.getTime());
  const memoryRows = memory.jobs.filter((row) => Date.parse(row.updated_at) >= windowStart.getTime());

  const series = createSeries(buckets, ["images", "imports", "metadata", "memory"]);
  for (const row of imageRows) incrementBucket(series, buckets, row.created_at, "images");
  for (const row of importRows) incrementBucket(series, buckets, row.created_at, "imports");
  for (const row of metadataRows) incrementBucket(series, buckets, row.updated_at, "metadata");
  for (const row of memoryRows) incrementBucket(series, buckets, row.updated_at, "memory");

  const countStatuses = <T extends { status: string }>(rows: T[]) => ({
    pending: rows.filter((row) => row.status === "pending").length,
    processing: rows.filter((row) => row.status === "processing").length,
    ready: rows.filter((row) => row.status === "ready" || row.status === "completed" || row.status === "active").length,
    failed: rows.filter((row) => row.status === "failed" || row.status === "needs_retry").length,
  });

  const imageStatus = {
    pending: images.overview.pendingCount,
    processing: images.overview.processingCount,
    ready: images.overview.readyCount,
    failed: images.overview.failedCount,
  };
  const importStatus = countStatuses(imports.recentImports);
  const metadataStatus = countStatuses(metadata.jobs);
  const memoryStatus = countStatuses(memory.jobs);

  return {
    summary: {
      imagePending: imageStatus.pending,
      imageFailed: imageStatus.failed,
      importsFailed: imports.failedImports,
      metadataPending: metadataStatus.pending,
      memoryPending: memoryStatus.pending,
    },
    statusBreakdown: [
      { pipeline: "Images", ...imageStatus },
      { pipeline: "Imports", ...importStatus },
      { pipeline: "Metadata", ...metadataStatus },
      { pipeline: "Memory", ...memoryStatus },
    ],
    series,
    recentFailures: [
      ...images.requests
        .filter((row) => row.status === "failed")
        .slice(0, 5)
        .map((row) => ({
          pipeline: "Images",
          label: row.normalized_title,
          when: row.updated_at,
          reason: row.last_error ?? "Request failed",
        })),
      ...imports.recentFailures.slice(0, 5).map((row) => ({
        pipeline: "Imports",
        label: row.source_kind,
        when: row.created_at,
        reason: row.error_message ?? row.error_code ?? "Import failed",
      })),
      ...metadata.jobs
        .filter((row) => row.status === "failed")
        .slice(0, 5)
        .map((row) => ({
          pipeline: "Metadata",
          label: row.recipe_title ?? row.recipe_id,
          when: row.updated_at,
          reason: row.last_error ?? "Metadata job failed",
        })),
      ...memory.jobs
        .filter((row) => row.status === "failed")
        .slice(0, 5)
        .map((row) => ({
          pipeline: "Memory",
          label: row.user_email ?? row.user_id,
          when: row.updated_at,
          reason: row.last_error ?? "Memory job failed",
        })),
    ].sort((left, right) => Date.parse(right.when) - Date.parse(left.when)),
  };
};

export const getAnalyticsOverviewData = async (): Promise<{
  summary: {
    llmCalls: number;
    totalCost: number;
    imports: number;
    importSuccessRate: number;
    imageFailures: number;
    staleVariants: number;
  };
}> => {
  const [dashboard, imports] = await Promise.all([getDashboardData(), getImportData()]);

  return {
    summary: {
      llmCalls: dashboard.requestCount,
      totalCost: dashboard.totalCostUsd,
      imports: imports.totalImports,
      importSuccessRate: imports.successRate,
      imageFailures: dashboard.imageFailedCount,
      staleVariants: dashboard.staleVariantCount,
    },
  };
};
