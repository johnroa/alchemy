import type { AnalyticsQueryState } from "@/lib/admin-analytics";
import { getHoursForRange } from "@/lib/admin-analytics";
import { getAdminClient, toRecord } from "@/lib/supabase-admin";

type AlgorithmVersionRow = {
  version: string;
  status: string;
  label: string;
  notes: string | null;
  novelty_policy: string;
  config: unknown;
  is_active: boolean;
  activated_at: string | null;
  retired_at: string | null;
};

type FeedServedRow = {
  occurred_at: string | null;
  user_id: string | null;
  session_id: string | null;
  algorithm_version: string | null;
  payload: unknown;
};

type ImpressionOutcomeRow = {
  impression_occurred_at: string | null;
  user_id: string | null;
  feed_id: string | null;
  recipe_id: string | null;
  algorithm_version: string | null;
  profile_state: string | null;
  preset_id: string | null;
  fallback_path: string | null;
  why_tag_1: string | null;
  why_tag_2: string | null;
  opened: boolean | null;
  skipped: boolean | null;
  hidden: boolean | null;
  saved: boolean | null;
  cooked: boolean | null;
};

type TasteProfileRow = {
  user_id: string;
  profile_state: string;
  algorithm_version: string;
  last_built_at: string | null;
};

type AcquisitionProfileRow = {
  user_id: string;
  acquisition_channel: string | null;
  lifecycle_stage: string | null;
  signed_in_at: string | null;
};

export type PersonalizationSeriesPoint = {
  bucketStart: string;
  label: string;
  impressions: number;
  opens: number;
  saves: number;
  cooks: number;
  fallbackFeeds: number;
};

type TimeBucket = {
  key: string;
  label: string;
  startMs: number;
  endMs: number;
};

const PAGE_SIZE = 1000;

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

const buildBuckets = (query: AnalyticsQueryState): { buckets: TimeBucket[]; windowStart: Date } => {
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

  return { buckets, windowStart };
};

const createSeries = (
  buckets: TimeBucket[],
): PersonalizationSeriesPoint[] =>
  buckets.map((bucket) => {
    const row: PersonalizationSeriesPoint = {
      bucketStart: bucket.key,
      label: bucket.label,
      impressions: 0,
      opens: 0,
      saves: 0,
      cooks: 0,
      fallbackFeeds: 0,
    };
    return row;
  });

const incrementSeries = (
  series: PersonalizationSeriesPoint[],
  buckets: TimeBucket[],
  timestamp: string | null | undefined,
  field: keyof Omit<PersonalizationSeriesPoint, "bucketStart" | "label">,
  amount = 1,
): void => {
  if (!timestamp) return;
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) return;
  const bucket = buckets.find((entry) => value >= entry.startMs && value < entry.endMs);
  if (!bucket) return;
  const row = series.find((entry) => entry.bucketStart === bucket.key);
  if (!row) return;
  row[field] += amount;
};

const percentile = (values: number[], pct: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[index] ?? null;
};

const median = (values: number[]): number | null => percentile(values, 50);

const safeRatio = (numerator: number, denominator: number): number => denominator > 0 ? numerator / denominator : 0;

const numberFromPayload = (payload: Record<string, unknown>, key: string): number | null => {
  const value = Number(payload[key]);
  return Number.isFinite(value) ? value : null;
};

const parseConfig = (value: unknown): { explorationRatio: number } => {
  const record = toRecord(value as never);
  const explorationRatio = Number(record["exploration_ratio"]);
  return {
    explorationRatio: Number.isFinite(explorationRatio) ? explorationRatio : 0,
  };
};

const normalizeProfileState = (value: string | null | undefined): string =>
  value === "warm" || value === "established" || value === "cold" ? value : "unknown";

const normalizeLabel = (value: string | null | undefined, fallback: string): string =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;

const pagedSelect = async <T>(input: {
  table: string;
  countColumn: string;
  columns: string;
  windowColumn?: string;
  windowStart?: string;
  eq?: [string, string | boolean];
}): Promise<T[]> => {
  const client = getAdminClient();
  let countQuery = client.from(input.table).select(input.countColumn, { count: "exact", head: true });
  if (input.windowColumn && input.windowStart) {
    countQuery = countQuery.gte(input.windowColumn, input.windowStart);
  }
  if (input.eq) {
    countQuery = countQuery.eq(input.eq[0], input.eq[1]);
  }
  const { count, error: countError } = await countQuery;
  if (countError) throw new Error(countError.message);

  const rows: T[] = [];
  const pageCount = Math.ceil((count ?? 0) / PAGE_SIZE);
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const from = pageIndex * PAGE_SIZE;
    const to = Math.min((pageIndex + 1) * PAGE_SIZE, count ?? 0) - 1;
    let query = client.from(input.table).select(input.columns);
    if (input.windowColumn && input.windowStart) {
      query = query.gte(input.windowColumn, input.windowStart);
    }
    if (input.eq) {
      query = query.eq(input.eq[0], input.eq[1]);
    }
    const { data, error } = await query.range(from, to);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as unknown as T[]));
  }
  return rows;
};

const loadAlgorithmVersions = async (): Promise<AlgorithmVersionRow[]> => {
  const client = getAdminClient();
  const { data, error } = await client
    .from("explore_algorithm_versions")
    .select("version,status,label,notes,novelty_policy,config,is_active,activated_at,retired_at")
    .order("activated_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as AlgorithmVersionRow[];
};

const loadFeedServedRows = async (query: AnalyticsQueryState): Promise<FeedServedRow[]> =>
  await pagedSelect<FeedServedRow>({
    table: "behavior_events",
    countColumn: "event_id",
    columns: "occurred_at,user_id,session_id,algorithm_version,payload",
    windowColumn: "occurred_at",
    windowStart: new Date(Date.now() - getHoursForRange(query.range) * 60 * 60 * 1000).toISOString(),
    eq: ["event_type", "explore_feed_served"],
  });

const loadImpressionOutcomes = async (query: AnalyticsQueryState): Promise<ImpressionOutcomeRow[]> => {
  const client = getAdminClient();
  const windowStart = new Date(Date.now() - getHoursForRange(query.range) * 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await client
    .from("explore_impression_outcomes")
    .select("impression_event_id", { count: "exact", head: true })
    .gte("impression_occurred_at", windowStart);
  if (countError) throw new Error(countError.message);

  const rows: ImpressionOutcomeRow[] = [];
  const pageCount = Math.ceil((count ?? 0) / PAGE_SIZE);
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const from = pageIndex * PAGE_SIZE;
    const to = Math.min((pageIndex + 1) * PAGE_SIZE, count ?? 0) - 1;
    const { data, error } = await client
      .from("explore_impression_outcomes")
      .select(
        [
          "impression_occurred_at",
          "user_id",
          "feed_id",
          "recipe_id",
          "algorithm_version",
          "profile_state",
          "preset_id",
          "fallback_path",
          "why_tag_1",
          "why_tag_2",
          "opened",
          "skipped",
          "hidden",
          "saved",
          "cooked",
        ].join(","),
      )
      .gte("impression_occurred_at", windowStart)
      .range(from, to);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as unknown as ImpressionOutcomeRow[]));
  }
  return rows;
};

const loadTasteProfiles = async (): Promise<TasteProfileRow[]> => {
  const client = getAdminClient();
  const { data, error } = await client
    .from("user_taste_profiles")
    .select("user_id,profile_state,algorithm_version,last_built_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as TasteProfileRow[];
};

const loadAcquisitionProfiles = async (userIds: string[]): Promise<AcquisitionProfileRow[]> => {
  if (userIds.length === 0) return [];
  const client = getAdminClient();
  const rows: AcquisitionProfileRow[] = [];
  for (let index = 0; index < userIds.length; index += 200) {
    const chunk = userIds.slice(index, index + 200);
    const { data, error } = await client
      .from("user_acquisition_profiles")
      .select("user_id,acquisition_channel,lifecycle_stage,signed_in_at")
      .in("user_id", chunk);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as unknown as AcquisitionProfileRow[]));
  }
  return rows;
};

export const buildPersonalizationSnapshot = (input: {
  query: AnalyticsQueryState;
  versions: AlgorithmVersionRow[];
  feedServedRows: FeedServedRow[];
  impressionRows: ImpressionOutcomeRow[];
  tasteProfiles: TasteProfileRow[];
  acquisitionProfiles: AcquisitionProfileRow[];
}) => {
  const { buckets } = buildBuckets(input.query);
  const series = createSeries(buckets);
  const activeVersion = input.versions.find((row) => row.is_active) ?? input.versions[0] ?? null;
  const activeVersionKey = activeVersion?.version ?? null;
  const acquisitionByUser = new Map(input.acquisitionProfiles.map((row) => [row.user_id, row]));
  const fallbackReasonCounts = new Map<string, number>();

  const feedRowsByVersion = new Map<string, FeedServedRow[]>();
  for (const row of input.feedServedRows) {
    const version = row.algorithm_version ?? "unknown";
    const rows = feedRowsByVersion.get(version) ?? [];
    rows.push(row);
    feedRowsByVersion.set(version, rows);
    const payload = toRecord(row.payload as never);
    if (payload["fallback_path"]) {
      incrementSeries(series, buckets, row.occurred_at, "fallbackFeeds");
      fallbackReasonCounts.set(
        String(payload["fallback_path"]),
        (fallbackReasonCounts.get(String(payload["fallback_path"])) ?? 0) + 1,
      );
    }
  }

  const impressionsByVersion = new Map<string, ImpressionOutcomeRow[]>();
  const whyTagCounts = new Map<string, number>();
  const profileStateBreakdown = new Map<string, { impressions: number; saves: number; cooks: number }>();
  const presetBreakdown = new Map<string, { impressions: number; saves: number; cooks: number }>();
  const lifecycleBreakdown = new Map<string, { impressions: number; saves: number; cooks: number }>();
  const acquisitionBreakdown = new Map<string, { impressions: number; saves: number; cooks: number }>();

  for (const row of input.impressionRows) {
    const version = row.algorithm_version ?? "unknown";
    const rows = impressionsByVersion.get(version) ?? [];
    rows.push(row);
    impressionsByVersion.set(version, rows);

    incrementSeries(series, buckets, row.impression_occurred_at, "impressions");
    if (row.opened) incrementSeries(series, buckets, row.impression_occurred_at, "opens");
    if (row.saved) incrementSeries(series, buckets, row.impression_occurred_at, "saves");
    if (row.cooked) incrementSeries(series, buckets, row.impression_occurred_at, "cooks");

    for (const tag of [row.why_tag_1, row.why_tag_2]) {
      if (!tag) continue;
      whyTagCounts.set(tag, (whyTagCounts.get(tag) ?? 0) + 1);
    }
    const profileKey = normalizeProfileState(row.profile_state);
    const profileEntry = profileStateBreakdown.get(profileKey) ?? { impressions: 0, saves: 0, cooks: 0 };
    profileEntry.impressions += 1;
    profileEntry.saves += row.saved ? 1 : 0;
    profileEntry.cooks += row.cooked ? 1 : 0;
    profileStateBreakdown.set(profileKey, profileEntry);

    const presetKey = normalizeLabel(row.preset_id, "for_you");
    const presetEntry = presetBreakdown.get(presetKey) ?? { impressions: 0, saves: 0, cooks: 0 };
    presetEntry.impressions += 1;
    presetEntry.saves += row.saved ? 1 : 0;
    presetEntry.cooks += row.cooked ? 1 : 0;
    presetBreakdown.set(presetKey, presetEntry);

    const acquisition = row.user_id ? acquisitionByUser.get(row.user_id) : null;
    const lifecycleKey = normalizeLabel(acquisition?.lifecycle_stage, "unknown");
    const lifecycleEntry = lifecycleBreakdown.get(lifecycleKey) ?? { impressions: 0, saves: 0, cooks: 0 };
    lifecycleEntry.impressions += 1;
    lifecycleEntry.saves += row.saved ? 1 : 0;
    lifecycleEntry.cooks += row.cooked ? 1 : 0;
    lifecycleBreakdown.set(lifecycleKey, lifecycleEntry);

    const acquisitionKey = normalizeLabel(acquisition?.acquisition_channel, "unknown");
    const acquisitionEntry = acquisitionBreakdown.get(acquisitionKey) ?? { impressions: 0, saves: 0, cooks: 0 };
    acquisitionEntry.impressions += 1;
    acquisitionEntry.saves += row.saved ? 1 : 0;
    acquisitionEntry.cooks += row.cooked ? 1 : 0;
    acquisitionBreakdown.set(acquisitionKey, acquisitionEntry);
  }

  const buildVersionRow = (versionKey: string, label: string, isActive: boolean) => {
    const impressionRows = impressionsByVersion.get(versionKey) ?? [];
    const feedRows = feedRowsByVersion.get(versionKey) ?? [];
    const saves = impressionRows.filter((row) => row.saved).length;
    const cooks = impressionRows.filter((row) => row.cooked).length;
    const opens = impressionRows.filter((row) => row.opened).length;
    const negative = impressionRows.filter((row) => row.skipped || row.hidden).length;
    const latencies = feedRows
      .map((row) => numberFromPayload(toRecord(row.payload as never), "feed_latency_ms"))
      .filter((value): value is number => value != null);
    const fallbacks = feedRows.filter((row) => Boolean(toRecord(row.payload as never)["fallback_path"])).length;
    const cold = impressionRows.filter((row) => normalizeProfileState(row.profile_state) === "cold").length;

    return {
      version: versionKey,
      label,
      isActive,
      impressions: impressionRows.length,
      openRate: safeRatio(opens, impressionRows.length),
      saveRate: safeRatio(saves, impressionRows.length),
      cookRate: safeRatio(cooks, impressionRows.length),
      negativeFeedbackRate: safeRatio(negative, impressionRows.length),
      medianLatencyMs: median(latencies),
      fallbackRate: safeRatio(fallbacks, feedRows.length),
      coldStartShare: safeRatio(cold, impressionRows.length),
    };
  };

  const versionRows = input.versions.map((version) =>
    buildVersionRow(version.version, version.label, version.is_active)
  );
  const activeMetrics = activeVersion
    ? versionRows.find((row) => row.version === activeVersion.version) ?? null
    : null;
  const baselineRows = versionRows.filter((row) => !row.isActive && row.impressions > 0);
  const baselineImpressions = baselineRows.reduce((sum, row) => sum + row.impressions, 0);
  const baselineSaveRate = baselineImpressions > 0
    ? baselineRows.reduce((sum, row) => sum + row.saveRate * row.impressions, 0) / baselineImpressions
    : null;
  const baselineCookRate = baselineImpressions > 0
    ? baselineRows.reduce((sum, row) => sum + row.cookRate * row.impressions, 0) / baselineImpressions
    : null;

  const activeFeedRows = activeVersionKey ? (feedRowsByVersion.get(activeVersionKey) ?? []) : [];
  const coldFeedCount = activeFeedRows.filter((row) => {
    const payload = toRecord(row.payload as never);
    return normalizeProfileState(typeof payload["profile_state"] === "string" ? payload["profile_state"] : null) === "cold";
  }).length;
  const personalizedFilterFeeds = activeFeedRows.filter((row) => {
    const payload = toRecord(row.payload as never);
    return typeof payload["preset_id"] === "string" && payload["preset_id"].trim().length > 0;
  }).length;
  const learningVelocityHours = median(
    input.tasteProfiles.flatMap((profile) => {
      if (profile.profile_state === "cold") return [];
      const acquisition = acquisitionByUser.get(profile.user_id);
      if (!acquisition?.signed_in_at || !profile.last_built_at) return [];
      const start = Date.parse(acquisition.signed_in_at);
      const end = Date.parse(profile.last_built_at);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
      return [(end - start) / 3_600_000];
    }),
  );

  const activeConfig = parseConfig(activeVersion?.config);
  const coldStartComparison = [
    {
      profileState: "Cold",
      saveRate: safeRatio(profileStateBreakdown.get("cold")?.saves ?? 0, profileStateBreakdown.get("cold")?.impressions ?? 0),
      cookRate: safeRatio(profileStateBreakdown.get("cold")?.cooks ?? 0, profileStateBreakdown.get("cold")?.impressions ?? 0),
    },
    {
      profileState: "Established",
      saveRate: safeRatio(
        (profileStateBreakdown.get("warm")?.saves ?? 0) + (profileStateBreakdown.get("established")?.saves ?? 0),
        (profileStateBreakdown.get("warm")?.impressions ?? 0) + (profileStateBreakdown.get("established")?.impressions ?? 0),
      ),
      cookRate: safeRatio(
        (profileStateBreakdown.get("warm")?.cooks ?? 0) + (profileStateBreakdown.get("established")?.cooks ?? 0),
        (profileStateBreakdown.get("warm")?.impressions ?? 0) + (profileStateBreakdown.get("established")?.impressions ?? 0),
      ),
    },
  ];

  return {
    activeVersion,
    summary: {
      currentAlgorithmVersion: activeVersion?.label ?? "No active version",
      currentAlgorithmKey: activeVersion?.version ?? "unknown",
      saveLiftVsBaseline: activeMetrics && baselineSaveRate != null
        ? activeMetrics.saveRate - baselineSaveRate
        : null,
      cookLiftVsBaseline: activeMetrics && baselineCookRate != null
        ? activeMetrics.cookRate - baselineCookRate
        : null,
      negativeFeedbackRate: activeMetrics?.negativeFeedbackRate ?? 0,
      noveltyShare: activeConfig.explorationRatio,
      preferenceLearningVelocityHours: learningVelocityHours,
      coldStartCoverage: safeRatio(coldFeedCount, activeFeedRows.length),
      fallbackRate: activeMetrics?.fallbackRate ?? 0,
      personalizedFilterCoverage: safeRatio(personalizedFilterFeeds, activeFeedRows.length),
      medianFeedLatencyMs: activeMetrics?.medianLatencyMs ?? null,
    },
    versionRows,
    series,
    funnelRows: versionRows.map((row) => ({
      version: row.label,
      impressions: row.impressions,
      openRate: row.openRate,
      saveRate: row.saveRate,
      cookRate: row.cookRate,
    })),
    whyTagRows: [...whyTagCounts.entries()]
      .map(([tag, impressions]) => ({ tag, impressions }))
      .sort((left, right) => right.impressions - left.impressions)
      .slice(0, 10),
    fallbackReasonRows: [...fallbackReasonCounts.entries()]
      .map(([reason, feeds]) => ({ reason, feeds }))
      .sort((left, right) => right.feeds - left.feeds)
      .slice(0, 10),
    profileStateRows: [...profileStateBreakdown.entries()]
      .map(([profileState, value]) => ({
        profileState,
        impressions: value.impressions,
        saveRate: safeRatio(value.saves, value.impressions),
        cookRate: safeRatio(value.cooks, value.impressions),
      }))
      .sort((left, right) => right.impressions - left.impressions),
    presetRows: [...presetBreakdown.entries()]
      .map(([preset, value]) => ({
        preset,
        impressions: value.impressions,
        saveRate: safeRatio(value.saves, value.impressions),
        cookRate: safeRatio(value.cooks, value.impressions),
      }))
      .sort((left, right) => right.impressions - left.impressions),
    lifecycleRows: [...lifecycleBreakdown.entries()]
      .map(([lifecycleStage, value]) => ({
        lifecycleStage,
        impressions: value.impressions,
        saveRate: safeRatio(value.saves, value.impressions),
        cookRate: safeRatio(value.cooks, value.impressions),
      }))
      .sort((left, right) => right.impressions - left.impressions),
    acquisitionRows: [...acquisitionBreakdown.entries()]
      .map(([acquisitionChannel, value]) => ({
        acquisitionChannel,
        impressions: value.impressions,
        saveRate: safeRatio(value.saves, value.impressions),
        cookRate: safeRatio(value.cooks, value.impressions),
      }))
      .sort((left, right) => right.impressions - left.impressions),
    coldStartComparison,
  };
};

export const getPersonalizationBoardData = async (query: AnalyticsQueryState) => {
  const [versions, feedServedRows, impressionRows, tasteProfiles] = await Promise.all([
    loadAlgorithmVersions(),
    loadFeedServedRows(query),
    loadImpressionOutcomes(query),
    loadTasteProfiles(),
  ]);
  const userIds = [...new Set([
    ...feedServedRows.map((row) => row.user_id).filter((value): value is string => Boolean(value)),
    ...impressionRows.map((row) => row.user_id).filter((value): value is string => Boolean(value)),
    ...tasteProfiles.map((row) => row.user_id),
  ])];
  const acquisitionProfiles = await loadAcquisitionProfiles(userIds);
  return buildPersonalizationSnapshot({
    query,
    versions,
    feedServedRows,
    impressionRows,
    tasteProfiles,
    acquisitionProfiles,
  });
};
