import type { AnalyticsQueryState } from "@/lib/admin-analytics";
import { getDaysForRange, getHoursForRange } from "@/lib/admin-analytics";
import { getAdminClient, toRecord } from "@/lib/supabase-admin";
import { getImportData } from "./imports";
import { getModelUsageData } from "./llm";
import { getDashboardData } from "./overview";

type BehaviorEventRow = {
  event_type: string | null;
  occurred_at: string | null;
  install_id: string | null;
  user_id: string | null;
  entity_id: string | null;
  session_id: string | null;
  source_surface: string | null;
  payload: unknown;
};

type InstallProfileRow = {
  install_id: string;
  acquisition_channel: string | null;
  campaign_token: string | null;
  provider_token: string | null;
  first_opened_at: string | null;
  last_seen_at: string | null;
  snapshot: unknown;
};

type UserAcquisitionProfileRow = {
  user_id: string;
  install_id: string | null;
  acquisition_channel: string | null;
  lifecycle_stage: string | null;
  signed_in_at: string | null;
  onboarding_started_at: string | null;
  onboarding_completed_at: string | null;
  first_generation_at: string | null;
  first_save_at: string | null;
  first_cook_at: string | null;
  last_seen_at: string | null;
};

type LlmEventRow = {
  created_at: string | null;
  latency_ms: number | null;
  cost_usd: number | null;
  event_payload: unknown;
};

type BoardTimeBucket = {
  key: string;
  label: string;
  startMs: number;
  endMs: number;
};

const BEHAVIOR_EVENTS_PAGE_SIZE = 1000;
const LLM_EVENTS_PAGE_SIZE = 1000;
const INSTALL_PROFILE_PAGE_SIZE = 1000;
const ACQUISITION_PROFILE_PAGE_SIZE = 1000;

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

const normalizeBucketStart = (date: Date, grain: AnalyticsQueryState["grain"]): Date => {
  if (grain === "hour") return startOfHour(date);
  if (grain === "day") return startOfDay(date);
  return startOfWeek(date);
};

const addBucketStep = (date: Date, grain: AnalyticsQueryState["grain"]): Date => {
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

const formatBucketLabel = (date: Date, grain: AnalyticsQueryState["grain"]): string => {
  if (grain === "hour") {
    return date.toLocaleTimeString([], { hour: "numeric" });
  }

  return date.toLocaleDateString([], { month: "short", day: "numeric" });
};

const buildBoardBuckets = (query: AnalyticsQueryState): { buckets: BoardTimeBucket[]; windowStart: Date; windowEnd: Date } => {
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - getHoursForRange(query.range) * 60 * 60 * 1000);
  const buckets: BoardTimeBucket[] = [];

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

const createSeries = (buckets: BoardTimeBucket[], fields: string[]): Array<Record<string, number | string>> =>
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

const incrementSeriesField = (
  series: Array<Record<string, number | string>>,
  buckets: BoardTimeBucket[],
  timestamp: string | null | undefined,
  field: string,
  amount = 1,
): void => {
  if (!timestamp) return;

  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) return;

  const bucket = buckets.find((entry) => value >= entry.startMs && value < entry.endMs);
  if (!bucket) return;

  const row = series.find((entry) => entry["bucketStart"] === bucket.key);
  if (!row) return;

  row[field] = Number(row[field] ?? 0) + amount;
};

const percentile = (values: number[], pct: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
};

const median = (values: number[]): number => percentile(values, 50);
const medianOrNull = (values: number[]): number | null => values.length === 0 ? null : median(values);

const chunkArray = <T>(values: T[], chunkSize: number): T[][] => {
  if (values.length === 0) return [];

  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
};

const parseTimestamp = (timestamp: string | null | undefined): number | null => {
  if (!timestamp) return null;
  const value = Date.parse(timestamp);
  return Number.isFinite(value) ? value : null;
};

const secondsBetween = (
  startTimestamp: string | null | undefined,
  endTimestamp: string | null | undefined,
): number | null => {
  const startMs = parseTimestamp(startTimestamp);
  const endMs = parseTimestamp(endTimestamp);
  if (startMs == null || endMs == null || endMs < startMs) return null;
  return (endMs - startMs) / 1000;
};

const normalizeAcquisitionChannel = (value: string | null | undefined): string => {
  switch (value) {
    case "organic":
      return "organic";
    case "waitlist":
      return "waitlist";
    case "friend_share":
      return "friend_share";
    default:
      return "unknown";
  }
};

const acquisitionChannelLabel = (value: string): string => {
  switch (value) {
    case "friend_share":
      return "Friend share";
    case "waitlist":
      return "Waitlist";
    case "organic":
      return "Organic";
    default:
      return "Unknown";
  }
};

const uniqueUsers = (rows: Array<{ user_id: string | null }>): Set<string> =>
  new Set(rows.map((row) => row.user_id).filter((value): value is string => typeof value === "string" && value.length > 0));

const getPayload = (row: { payload?: unknown; event_payload?: unknown }): Record<string, unknown> =>
  toRecord((row.payload ?? row.event_payload ?? null) as never) as Record<string, unknown>;

const asNumber = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const isTruthy = (value: unknown): boolean => value === true || value === "true" || value === 1;

const loadBehaviorEvents = async (query: AnalyticsQueryState): Promise<BehaviorEventRow[]> => {
  const client = getAdminClient();
  const windowStart = new Date(Date.now() - getHoursForRange(query.range) * 60 * 60 * 1000);

  const { count, error: countError } = await client
    .from("behavior_events")
    .select("event_id", { count: "exact", head: true })
    .gte("occurred_at", windowStart.toISOString());

  if (countError) {
    throw new Error(countError.message);
  }

  const rows: BehaviorEventRow[] = [];
  const pageCount = Math.ceil((count ?? 0) / BEHAVIOR_EVENTS_PAGE_SIZE);
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const from = pageIndex * BEHAVIOR_EVENTS_PAGE_SIZE;
    const to = Math.min((pageIndex + 1) * BEHAVIOR_EVENTS_PAGE_SIZE, count ?? 0) - 1;
    const { data, error } = await client
      .from("behavior_events")
      .select("event_type,occurred_at,install_id,user_id,entity_id,session_id,source_surface,payload")
      .gte("occurred_at", windowStart.toISOString())
      .order("occurred_at", { ascending: false })
      .range(from, to);

    if (error) {
      throw new Error(error.message);
    }

    rows.push(...((data ?? []) as BehaviorEventRow[]));
  }

  return rows;
};

const loadInstallProfiles = async (query: AnalyticsQueryState): Promise<InstallProfileRow[]> => {
  const client = getAdminClient();
  const windowStart = new Date(Date.now() - getHoursForRange(query.range) * 60 * 60 * 1000);

  const { count, error: countError } = await client
    .from("install_profiles")
    .select("install_id", { count: "exact", head: true })
    .gte("first_opened_at", windowStart.toISOString());

  if (countError) {
    throw new Error(countError.message);
  }

  const rows: InstallProfileRow[] = [];
  const pageCount = Math.ceil((count ?? 0) / INSTALL_PROFILE_PAGE_SIZE);
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const from = pageIndex * INSTALL_PROFILE_PAGE_SIZE;
    const to = Math.min((pageIndex + 1) * INSTALL_PROFILE_PAGE_SIZE, count ?? 0) - 1;
    const { data, error } = await client
      .from("install_profiles")
      .select("install_id,acquisition_channel,campaign_token,provider_token,first_opened_at,last_seen_at,snapshot")
      .gte("first_opened_at", windowStart.toISOString())
      .order("first_opened_at", { ascending: false })
      .range(from, to);

    if (error) {
      throw new Error(error.message);
    }

    rows.push(...((data ?? []) as unknown as InstallProfileRow[]));
  }

  return rows;
};

const loadUserAcquisitionProfiles = async (installIds: string[]): Promise<UserAcquisitionProfileRow[]> => {
  if (installIds.length === 0) return [];

  const client = getAdminClient();
  const rows: UserAcquisitionProfileRow[] = [];

  for (const installIdChunk of chunkArray(installIds, 200)) {
    const { count, error: countError } = await client
      .from("user_acquisition_profiles")
      .select("user_id", { count: "exact", head: true })
      .in("install_id", installIdChunk);

    if (countError) {
      throw new Error(countError.message);
    }

    const pageCount = Math.ceil((count ?? 0) / ACQUISITION_PROFILE_PAGE_SIZE);
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const from = pageIndex * ACQUISITION_PROFILE_PAGE_SIZE;
      const to = Math.min((pageIndex + 1) * ACQUISITION_PROFILE_PAGE_SIZE, count ?? 0) - 1;
      const { data, error } = await client
        .from("user_acquisition_profiles")
        .select(
          [
            "user_id",
            "install_id",
            "acquisition_channel",
            "lifecycle_stage",
            "signed_in_at",
            "onboarding_started_at",
            "onboarding_completed_at",
            "first_generation_at",
            "first_save_at",
            "first_cook_at",
            "last_seen_at",
          ].join(","),
        )
        .in("install_id", installIdChunk)
        .order("signed_in_at", { ascending: false, nullsFirst: false })
        .range(from, to);

      if (error) {
        throw new Error(error.message);
      }

      rows.push(...((data ?? []) as unknown as UserAcquisitionProfileRow[]));
    }
  }

  return rows;
};

const loadCookBehaviorEventsForInstalls = async (
  installIds: string[],
  occurredAfter: string | null,
): Promise<BehaviorEventRow[]> => {
  if (installIds.length === 0) return [];

  const client = getAdminClient();
  const rows: BehaviorEventRow[] = [];

  for (const installIdChunk of chunkArray(installIds, 200)) {
    let countQuery = client
      .from("behavior_events")
      .select("event_id", { count: "exact", head: true })
      .eq("event_type", "recipe_cooked_inferred")
      .in("install_id", installIdChunk);

    if (occurredAfter) {
      countQuery = countQuery.gte("occurred_at", occurredAfter);
    }

    const { count, error: countError } = await countQuery;
    if (countError) {
      throw new Error(countError.message);
    }

    const pageCount = Math.ceil((count ?? 0) / BEHAVIOR_EVENTS_PAGE_SIZE);
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const from = pageIndex * BEHAVIOR_EVENTS_PAGE_SIZE;
      const to = Math.min((pageIndex + 1) * BEHAVIOR_EVENTS_PAGE_SIZE, count ?? 0) - 1;
      let queryBuilder = client
        .from("behavior_events")
        .select("event_type,occurred_at,install_id,user_id,entity_id,session_id,source_surface,payload")
        .eq("event_type", "recipe_cooked_inferred")
        .in("install_id", installIdChunk);

      if (occurredAfter) {
        queryBuilder = queryBuilder.gte("occurred_at", occurredAfter);
      }

      const { data, error } = await queryBuilder
        .order("occurred_at", { ascending: false })
        .range(from, to);

      if (error) {
        throw new Error(error.message);
      }

      rows.push(...((data ?? []) as unknown as BehaviorEventRow[]));
    }
  }

  return rows;
};

const loadLlmEvents = async (query: AnalyticsQueryState): Promise<LlmEventRow[]> => {
  const client = getAdminClient();
  const windowStart = new Date(Date.now() - getHoursForRange(query.range) * 60 * 60 * 1000);

  const { count, error: countError } = await client
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "llm_call")
    .gte("created_at", windowStart.toISOString());

  if (countError) {
    throw new Error(countError.message);
  }

  const rows: LlmEventRow[] = [];
  const pageCount = Math.ceil((count ?? 0) / LLM_EVENTS_PAGE_SIZE);
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const from = pageIndex * LLM_EVENTS_PAGE_SIZE;
    const to = Math.min((pageIndex + 1) * LLM_EVENTS_PAGE_SIZE, count ?? 0) - 1;
    const { data, error } = await client
      .from("events")
      .select("created_at,latency_ms,cost_usd,event_payload")
      .eq("event_type", "llm_call")
      .gte("created_at", windowStart.toISOString())
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      throw new Error(error.message);
    }

    rows.push(...((data ?? []) as LlmEventRow[]));
  }

  return rows;
};

export const buildEngagementBoardSnapshot = (
  rows: BehaviorEventRow[],
  query: AnalyticsQueryState,
): {
  summary: {
    recipesCookedPerUserPerWeek: number;
    recipeAcceptanceRate: number;
    recipeCompletionRate: number;
    weeklyReturningCooks: number;
    repeatCookingRate: number;
    generationToSaveTimeP50Seconds: number;
    promptIterationDepth: number;
    weeklyCookingSessionsPerActiveCook: number;
    cookbookRevisitRate: number;
    chatCandidateCommitRate: number;
  };
  totals: {
    generatedRecipes: number;
    acceptedRecipes: number;
    savedRecipes: number;
    cookedRecipes: number;
    cookbookViews: number;
  };
  series: Array<Record<string, number | string>>;
  topRecipes: Array<{ recipeId: string; saves: number; cooks: number; repeatCooks: number }>;
} => {
  const { buckets } = buildBoardBuckets(query);
  const series = createSeries(buckets, ["cooks", "saves", "generations", "cookbookViews"]);
  const weeksInWindow = Math.max(1, getDaysForRange(query.range) / 7);

  const cookedRows = rows.filter((row) => row.event_type === "recipe_cooked_inferred");
  const savedRows = rows.filter((row) => row.event_type === "recipe_saved");
  const cookbookViewedRows = rows.filter((row) => row.event_type === "cookbook_viewed");
  const generatedRows = rows.filter((row) => {
    if (row.event_type !== "chat_turn_resolved") return false;
    const payload = getPayload(row);
    return isTruthy(payload["triggered_recipe"]) || asNumber(payload["candidate_component_count"]) > 0;
  });
  const commitRows = rows.filter((row) => row.event_type === "chat_commit_completed");
  const turnRows = rows.filter((row) => row.event_type === "chat_turn_submitted");

  for (const row of cookedRows) {
    incrementSeriesField(series, buckets, row.occurred_at, "cooks");
  }
  for (const row of savedRows) {
    incrementSeriesField(series, buckets, row.occurred_at, "saves");
  }
  for (const row of generatedRows) {
    incrementSeriesField(
      series,
      buckets,
      row.occurred_at,
      "generations",
      Math.max(1, asNumber(getPayload(row)["candidate_component_count"])),
    );
  }
  for (const row of cookbookViewedRows) {
    incrementSeriesField(series, buckets, row.occurred_at, "cookbookViews");
  }

  const cookedUsers = uniqueUsers(cookedRows);
  const generatedRecipes = generatedRows.reduce((sum, row) => sum + Math.max(1, asNumber(getPayload(row)["candidate_component_count"])), 0);
  const acceptedRecipes = commitRows.reduce((sum, row) => sum + Math.max(1, asNumber(getPayload(row)["committed_count"])), 0);

  const currentWeekCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).getTime();
  const previousWeekCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).getTime();
  const currentWeekUsers = new Set<string>();
  const previousWeekUsers = new Set<string>();
  for (const row of cookedRows) {
    const timestamp = Date.parse(row.occurred_at ?? "");
    if (!Number.isFinite(timestamp) || !row.user_id) continue;
    if (timestamp >= currentWeekCutoff) {
      currentWeekUsers.add(row.user_id);
    } else if (timestamp >= previousWeekCutoff) {
      previousWeekUsers.add(row.user_id);
    }
  }

  let weeklyReturningCooks = 0;
  for (const userId of currentWeekUsers) {
    if (previousWeekUsers.has(userId)) {
      weeklyReturningCooks += 1;
    }
  }

  const repeatCookCounts = new Map<string, number>();
  for (const row of cookedRows) {
    if (!row.user_id || !row.entity_id) continue;
    const key = `${row.user_id}::${row.entity_id}`;
    repeatCookCounts.set(key, (repeatCookCounts.get(key) ?? 0) + 1);
  }
  const repeatCooks = [...repeatCookCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);

  const latestGeneratedAtBySession = new Map<string, number>();
  for (const row of generatedRows) {
    if (!row.session_id) continue;
    const timestamp = Date.parse(row.occurred_at ?? "");
    if (!Number.isFinite(timestamp)) continue;
    const previous = latestGeneratedAtBySession.get(row.session_id) ?? 0;
    if (timestamp > previous) {
      latestGeneratedAtBySession.set(row.session_id, timestamp);
    }
  }

  const generationToSaveDurationsSeconds = commitRows.flatMap((row) => {
    if (!row.session_id) return [];
    const generatedAt = latestGeneratedAtBySession.get(row.session_id);
    const committedAt = Date.parse(row.occurred_at ?? "");
    if (!generatedAt || !Number.isFinite(committedAt) || committedAt < generatedAt) return [];
    return [(committedAt - generatedAt) / 1000];
  });

  const cookbookViewerCounts = new Map<string, number>();
  for (const row of cookbookViewedRows) {
    if (!row.user_id) continue;
    cookbookViewerCounts.set(row.user_id, (cookbookViewerCounts.get(row.user_id) ?? 0) + 1);
  }
  const cookbookViewerTotal = cookbookViewerCounts.size;
  const cookbookRevisitors = [...cookbookViewerCounts.values()].filter((count) => count >= 2).length;

  const recipeAggregate = new Map<string, { saves: number; cooks: number; repeatCooks: number }>();
  for (const row of savedRows) {
    if (!row.entity_id) continue;
    const entry = recipeAggregate.get(row.entity_id) ?? { saves: 0, cooks: 0, repeatCooks: 0 };
    entry.saves += 1;
    recipeAggregate.set(row.entity_id, entry);
  }
  for (const row of cookedRows) {
    if (!row.entity_id) continue;
    const entry = recipeAggregate.get(row.entity_id) ?? { saves: 0, cooks: 0, repeatCooks: 0 };
    entry.cooks += 1;
    recipeAggregate.set(row.entity_id, entry);
  }
  for (const [key, count] of repeatCookCounts.entries()) {
    if (count < 2) continue;
    const recipeId = key.split("::")[1] ?? "";
    if (!recipeId) continue;
    const entry = recipeAggregate.get(recipeId) ?? { saves: 0, cooks: 0, repeatCooks: 0 };
    entry.repeatCooks += count - 1;
    recipeAggregate.set(recipeId, entry);
  }

  const topRecipes = [...recipeAggregate.entries()]
    .map(([recipeId, value]) => ({ recipeId, ...value }))
    .sort((left, right) => right.cooks - left.cooks || right.saves - left.saves)
    .slice(0, 8);

  return {
    summary: {
      recipesCookedPerUserPerWeek: cookedRows.length === 0 ? 0 : cookedRows.length / Math.max(1, cookedUsers.size) / weeksInWindow,
      recipeAcceptanceRate: generatedRecipes > 0 ? acceptedRecipes / generatedRecipes : 0,
      recipeCompletionRate: savedRows.length > 0 ? cookedRows.length / savedRows.length : 0,
      weeklyReturningCooks,
      repeatCookingRate: cookedRows.length > 0 ? repeatCooks / cookedRows.length : 0,
      generationToSaveTimeP50Seconds: median(generationToSaveDurationsSeconds),
      promptIterationDepth: commitRows.length > 0 ? turnRows.length / commitRows.length : 0,
      weeklyCookingSessionsPerActiveCook: cookedRows.length === 0 ? 0 : cookedRows.length / Math.max(1, cookedUsers.size) / weeksInWindow,
      cookbookRevisitRate: cookbookViewerTotal > 0 ? cookbookRevisitors / cookbookViewerTotal : 0,
      chatCandidateCommitRate: generatedRows.length > 0 ? commitRows.length / generatedRows.length : 0,
    },
    totals: {
      generatedRecipes,
      acceptedRecipes,
      savedRecipes: savedRows.length,
      cookedRecipes: cookedRows.length,
      cookbookViews: cookbookViewedRows.length,
    },
    series,
    topRecipes,
  };
};

export const buildOperationsBoardSnapshot = (
  behaviorRows: BehaviorEventRow[],
  llmRows: LlmEventRow[],
  dashboard: Awaited<ReturnType<typeof getDashboardData>>,
  imports: Awaited<ReturnType<typeof getImportData>>,
): {
  summary: {
    generationLatencyP50Ms: number;
    generationLatencyP95Ms: number;
    immediateRegenerationRate: number;
    structuredRecipeDefectRate: number;
    crashFreeSessions: number | null;
    costPerAcceptedRecipeUsd: number;
    pipelineSuccessRate: number;
    pipelineFailureBacklog: number;
    costPerRecipeUsd: number;
    providerFailureRate: number;
    staleVariantBacklog: number;
    safetyFlaggedResponseRate: number;
  };
} => {
  const generationScopes = new Set([
    "generate",
    "chat_generation",
    "chat_iteration",
    "recipe_personalize",
    "recipe_canonicalize",
    "recipe_canon_match",
  ]);

  const generationRows = llmRows.filter((row) => {
    const payload = getPayload(row);
    const scope = String(payload["scope"] ?? "");
    return generationScopes.has(scope);
  });
  const generationLatencies = generationRows
    .map((row) => Number(row.latency_ms ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0);

  const generationErrorCodes = generationRows
    .map((row) => String(getPayload(row)["error_code"] ?? ""))
    .filter((value) => value.length > 0);
  const defectCodes = new Set([
    "llm_empty_output",
    "chat_schema_invalid",
    "recipe_schema_invalid",
    "personalize_invalid_output",
  ]);
  const defectCount = generationErrorCodes.filter((code) => defectCodes.has(code)).length;
  const failureCount = generationErrorCodes.length;

  const generatedTurnCount = behaviorRows.filter((row) => {
    if (row.event_type !== "chat_turn_resolved") return false;
    const payload = getPayload(row);
    return isTruthy(payload["triggered_recipe"]) || asNumber(payload["candidate_component_count"]) > 0;
  }).length;
  const iterationCount = behaviorRows.filter((row) => row.event_type === "chat_iteration_requested").length;
  const acceptedRecipes = behaviorRows
    .filter((row) => row.event_type === "chat_commit_completed")
    .reduce((sum, row) => sum + Math.max(1, asNumber(getPayload(row)["committed_count"])), 0);
  const totalGenerationCost = generationRows.reduce((sum, row) => sum + Number(row.cost_usd ?? 0), 0);
  const pipelineFailureBacklog =
    dashboard.imagePendingCount +
    dashboard.imageFailedCount +
    dashboard.staleVariantCount +
    imports.failedImports;
  const importSuccessRate = imports.totalImports > 0 ? imports.completedImports / imports.totalImports : 1;
  const pipelineSuccessRate = pipelineFailureBacklog > 0
    ? Math.max(0, importSuccessRate - pipelineFailureBacklog / Math.max(1, imports.totalImports + pipelineFailureBacklog))
    : importSuccessRate;

  return {
    summary: {
      generationLatencyP50Ms: percentile(generationLatencies, 50),
      generationLatencyP95Ms: percentile(generationLatencies, 95),
      immediateRegenerationRate: generatedTurnCount > 0 ? iterationCount / generatedTurnCount : 0,
      structuredRecipeDefectRate: generationRows.length > 0 ? defectCount / generationRows.length : 0,
      crashFreeSessions: null,
      costPerAcceptedRecipeUsd: acceptedRecipes > 0 ? totalGenerationCost / acceptedRecipes : 0,
      pipelineSuccessRate,
      pipelineFailureBacklog,
      costPerRecipeUsd: generationRows.length > 0 ? totalGenerationCost / generationRows.length : 0,
      providerFailureRate: generationRows.length > 0 ? failureCount / generationRows.length : 0,
      staleVariantBacklog: dashboard.staleVariantCount,
      safetyFlaggedResponseRate: dashboard.requestCount > 0 ? dashboard.safetyIncidentCount / dashboard.requestCount : 0,
    },
  };
};

export const buildAcquisitionBoardSnapshot = (
  installRows: InstallProfileRow[],
  acquisitionRows: UserAcquisitionProfileRow[],
  cookRows: BehaviorEventRow[],
  query: AnalyticsQueryState,
): {
  summary: {
    firstOpens: number;
    signInRate: number;
    onboardingCompletionRate: number;
    firstGenerationRate: number;
    firstSaveRate: number;
    firstCookWithin7dRate: number;
    medianTimeToSignInSeconds: number | null;
    medianTimeToFirstRecipeSeconds: number | null;
    medianTimeToFirstSaveSeconds: number | null;
    medianTimeToFirstCookSeconds: number | null;
    returningCooks7dRate: number;
  };
  totals: {
    signIns: number;
    onboardingCompleted: number;
    firstGenerations: number;
    firstSaves: number;
    firstCooksWithin7d: number;
    eligibleReturningInstalls: number;
    returningCookInstalls: number;
  };
  series: Array<Record<string, number | string>>;
  sourceMix: Array<{ channel: string; label: string; installs: number; signIns: number; firstCooksWithin7d: number }>;
  cohortRetention: Array<{ cohortLabel: string; installs: number; returningCookInstalls: number; returningCookRate: number }>;
} => {
  const { buckets } = buildBoardBuckets(query);
  const series = createSeries(buckets, [
    "firstOpens",
    "signIns",
    "onboardingCompleted",
    "firstRecipes",
    "firstSaves",
    "firstCooks",
  ]);
  const nowMs = Date.now();
  const installById = new Map(installRows.map((row) => [row.install_id, row]));
  const acquisitionByInstallId = new Map<string, UserAcquisitionProfileRow>();

  for (const row of acquisitionRows) {
    if (row.install_id && !acquisitionByInstallId.has(row.install_id)) {
      acquisitionByInstallId.set(row.install_id, row);
    }
  }

  for (const row of installRows) {
    incrementSeriesField(series, buckets, row.first_opened_at, "firstOpens");
  }
  for (const row of acquisitionRows) {
    incrementSeriesField(series, buckets, row.signed_in_at, "signIns");
    incrementSeriesField(series, buckets, row.onboarding_completed_at, "onboardingCompleted");
    incrementSeriesField(series, buckets, row.first_generation_at, "firstRecipes");
    incrementSeriesField(series, buckets, row.first_save_at, "firstSaves");
    incrementSeriesField(series, buckets, row.first_cook_at, "firstCooks");
  }

  const signInDurations: number[] = [];
  const firstRecipeDurations: number[] = [];
  const firstSaveDurations: number[] = [];
  const firstCookDurations: number[] = [];
  let signIns = 0;
  let onboardingCompleted = 0;
  let firstGenerations = 0;
  let firstSaves = 0;
  let firstCooksWithin7d = 0;

  const sourceMix = new Map<string, { channel: string; label: string; installs: number; signIns: number; firstCooksWithin7d: number }>();

  for (const install of installRows) {
    const channel = normalizeAcquisitionChannel(
      acquisitionByInstallId.get(install.install_id)?.acquisition_channel ?? install.acquisition_channel,
    );
    const sourceEntry = sourceMix.get(channel) ?? {
      channel,
      label: acquisitionChannelLabel(channel),
      installs: 0,
      signIns: 0,
      firstCooksWithin7d: 0,
    };
    sourceEntry.installs += 1;
    sourceMix.set(channel, sourceEntry);

    const profile = acquisitionByInstallId.get(install.install_id);
    if (!profile) continue;

    if (profile.signed_in_at) {
      signIns += 1;
      sourceEntry.signIns += 1;
    }
    if (profile.onboarding_completed_at) {
      onboardingCompleted += 1;
    }
    if (profile.first_generation_at) {
      firstGenerations += 1;
    }
    if (profile.first_save_at) {
      firstSaves += 1;
    }

    const signInSeconds = secondsBetween(install.first_opened_at, profile.signed_in_at);
    if (signInSeconds != null) {
      signInDurations.push(signInSeconds);
    }

    const firstRecipeSeconds = secondsBetween(install.first_opened_at, profile.first_generation_at);
    if (firstRecipeSeconds != null) {
      firstRecipeDurations.push(firstRecipeSeconds);
    }

    const firstSaveSeconds = secondsBetween(install.first_opened_at, profile.first_save_at);
    if (firstSaveSeconds != null) {
      firstSaveDurations.push(firstSaveSeconds);
    }

    const firstCookSeconds = secondsBetween(install.first_opened_at, profile.first_cook_at);
    if (firstCookSeconds != null) {
      firstCookDurations.push(firstCookSeconds);
    }

    const firstOpenMs = parseTimestamp(install.first_opened_at);
    const firstCookMs = parseTimestamp(profile.first_cook_at);
    if (firstOpenMs != null && firstCookMs != null && firstCookMs <= firstOpenMs + 7 * 24 * 60 * 60 * 1000) {
      firstCooksWithin7d += 1;
      sourceEntry.firstCooksWithin7d += 1;
    }
  }

  const cookTimestampsByInstallId = new Map<string, number[]>();
  for (const row of cookRows) {
    if (!row.install_id) continue;
    const occurredAtMs = parseTimestamp(row.occurred_at);
    if (occurredAtMs == null) continue;
    const timestamps = cookTimestampsByInstallId.get(row.install_id) ?? [];
    timestamps.push(occurredAtMs);
    cookTimestampsByInstallId.set(row.install_id, timestamps);
  }

  const cohortRetention = new Map<string, { cohortKey: string; cohortLabel: string; installs: number; returningCookInstalls: number }>();
  let eligibleReturningInstalls = 0;
  let returningCookInstalls = 0;

  for (const install of installRows) {
    const firstOpenMs = parseTimestamp(install.first_opened_at);
    if (firstOpenMs == null) continue;

    if (firstOpenMs > nowMs - 14 * 24 * 60 * 60 * 1000) {
      continue;
    }

    const cohortStart = startOfWeek(new Date(firstOpenMs));
    const cohortKey = cohortStart.toISOString();
    const cohortLabel = cohortStart.toLocaleDateString([], { month: "short", day: "numeric" });
    const cohortEntry = cohortRetention.get(cohortKey) ?? {
      cohortKey,
      cohortLabel,
      installs: 0,
      returningCookInstalls: 0,
    };
    cohortEntry.installs += 1;
    cohortRetention.set(cohortKey, cohortEntry);

    eligibleReturningInstalls += 1;
    const cookTimestamps = cookTimestampsByInstallId.get(install.install_id) ?? [];
    const hasReturningCook = cookTimestamps.some((timestamp) =>
      timestamp >= firstOpenMs + 7 * 24 * 60 * 60 * 1000 &&
      timestamp < firstOpenMs + 14 * 24 * 60 * 60 * 1000
    );

    if (hasReturningCook) {
      returningCookInstalls += 1;
      cohortEntry.returningCookInstalls += 1;
    }
  }

  return {
    summary: {
      firstOpens: installRows.length,
      signInRate: installRows.length > 0 ? signIns / installRows.length : 0,
      onboardingCompletionRate: installRows.length > 0 ? onboardingCompleted / installRows.length : 0,
      firstGenerationRate: installRows.length > 0 ? firstGenerations / installRows.length : 0,
      firstSaveRate: installRows.length > 0 ? firstSaves / installRows.length : 0,
      firstCookWithin7dRate: installRows.length > 0 ? firstCooksWithin7d / installRows.length : 0,
      medianTimeToSignInSeconds: medianOrNull(signInDurations),
      medianTimeToFirstRecipeSeconds: medianOrNull(firstRecipeDurations),
      medianTimeToFirstSaveSeconds: medianOrNull(firstSaveDurations),
      medianTimeToFirstCookSeconds: medianOrNull(firstCookDurations),
      returningCooks7dRate: eligibleReturningInstalls > 0 ? returningCookInstalls / eligibleReturningInstalls : 0,
    },
    totals: {
      signIns,
      onboardingCompleted,
      firstGenerations,
      firstSaves,
      firstCooksWithin7d,
      eligibleReturningInstalls,
      returningCookInstalls,
    },
    series,
    sourceMix: [...sourceMix.values()]
      .sort((left, right) => right.installs - left.installs || left.channel.localeCompare(right.channel)),
    cohortRetention: [...cohortRetention.values()]
      .sort((left, right) => left.cohortKey.localeCompare(right.cohortKey))
      .map((entry) => ({
        cohortLabel: entry.cohortLabel,
        installs: entry.installs,
        returningCookInstalls: entry.returningCookInstalls,
        returningCookRate: entry.installs > 0 ? entry.returningCookInstalls / entry.installs : 0,
      })),
  };
};

export const getEngagementBoardData = async (query: AnalyticsQueryState): Promise<{
  snapshot: ReturnType<typeof buildEngagementBoardSnapshot>;
}> => {
  const behaviorRows = await loadBehaviorEvents(query);
  return {
    snapshot: buildEngagementBoardSnapshot(behaviorRows, query),
  };
};

export const getOperationsBoardData = async (query: AnalyticsQueryState): Promise<{
  snapshot: ReturnType<typeof buildOperationsBoardSnapshot>;
  llmDaily: Awaited<ReturnType<typeof getModelUsageData>>["daily"];
  byAction: Awaited<ReturnType<typeof getModelUsageData>>["byAction"];
  recentErrors: Awaited<ReturnType<typeof getDashboardData>>["recentErrors"];
}> => {
  const [behaviorRows, llmRows, dashboard, imports, llmUsage] = await Promise.all([
    loadBehaviorEvents(query),
    loadLlmEvents(query),
    getDashboardData(),
    getImportData(),
    getModelUsageData({ rangeDays: getDaysForRange(query.range) }),
  ]);

  return {
    snapshot: buildOperationsBoardSnapshot(behaviorRows, llmRows, dashboard, imports),
    llmDaily: llmUsage.daily,
    byAction: llmUsage.byAction,
    recentErrors: dashboard.recentErrors,
  };
};

export const getAcquisitionBoardData = async (query: AnalyticsQueryState): Promise<{
  snapshot: ReturnType<typeof buildAcquisitionBoardSnapshot>;
}> => {
  const installRows = await loadInstallProfiles(query);
  const installIds = installRows.map((row) => row.install_id);
  const earliestFirstOpenAt = installRows
    .map((row) => row.first_opened_at)
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort()[0] ?? null;

  const [acquisitionRows, cookRows] = await Promise.all([
    loadUserAcquisitionProfiles(installIds),
    loadCookBehaviorEventsForInstalls(installIds, earliestFirstOpenAt),
  ]);

  return {
    snapshot: buildAcquisitionBoardSnapshot(installRows, acquisitionRows, cookRows, query),
  };
};
