import type { AnalyticsGrain, AnalyticsQueryState } from "@/lib/admin-analytics";
import { getHoursForRange } from "@/lib/admin-analytics";
import { getAdminClient, toRecord } from "@/lib/supabase-admin";
import { isSchemaMissingError } from "./shared";

type DemandObservationRow = {
  id: string;
  source_kind: string;
  source_id: string;
  stage: string;
  extractor_scope: string;
  extractor_version: number;
  confidence: number;
  observed_at: string;
  review_status: "pending" | "confirmed" | "rejected";
  sampled_for_review: boolean;
  admin_snippet_redacted: string | null;
  raw_trace_ref: string | null;
  summary_jsonb: Record<string, unknown> | null;
  user_id: string | null;
  chat_session_id: string | null;
  recipe_id: string | null;
  variant_id: string | null;
};

type DemandFactValueRow = {
  observation_id: string;
  facet: string;
  normalized_value: string;
  raw_value: string | null;
  confidence: number;
  rank: number;
  entity_id: string | null;
  metadata_jsonb: Record<string, unknown> | null;
};

type DemandOutcomeRow = {
  id: string;
  observation_id: string;
  origin_observation_id: string | null;
  outcome_type: string;
  source_kind: string;
  source_id: string;
  recipe_id: string | null;
  variant_id: string | null;
  candidate_id: string | null;
  occurred_at: string;
  payload_jsonb: Record<string, unknown> | null;
};

type DemandGraphEdgeRow = {
  id: string;
  from_facet: string;
  from_value: string;
  to_facet: string;
  to_value: string;
  count: number;
  recency_weighted_score: number;
  acceptance_score: number | null;
  segment_jsonb: Record<string, unknown> | null;
  last_observed_at: string;
  time_window: "7d" | "30d";
};

type DemandExtractionJobRow = {
  status: "pending" | "processing" | "completed" | "failed" | "dead_letter";
  observed_at: string;
  updated_at: string;
  next_attempt_at: string;
  last_error: string | null;
};

export type DemandTraceRow = {
  observation: DemandObservationRow;
  facts: DemandFactValueRow[];
  outcomes: DemandOutcomeRow[];
};

export type DemandAnalyticsData = {
  summary: {
    observations: number;
    intents: number;
    feedbackObservations: number;
    outcomes: number;
    sampledForReview: number;
    pendingReview: number;
    queuePending: number;
    queueFailures: number;
    graphEdges: number;
    freshnessMinutes: number | null;
  };
  series: Array<Record<string, number | string>>;
  topIntentRows: Array<{
    facet: string;
    value: string;
    observations: number;
    avgConfidence: number;
  }>;
  risingIntentRows: Array<{
    facet: string;
    value: string;
    recentObservations: number;
    priorObservations: number;
    delta: number;
  }>;
  unmetNeedRows: Array<{
    facet: string;
    value: string;
    observations: number;
    successRate: number;
  }>;
  outcomeRows: Array<{
    outcomeType: string;
    count: number;
    rate: number;
  }>;
  substitutionRows: Array<{
    original: string;
    replacement: string;
    accepted: number;
    reverted: number;
    acceptanceRate: number;
  }>;
  graphRows: Array<{
    fromFacet: string;
    fromValue: string;
    toFacet: string;
    toValue: string;
    count: number;
    recencyWeightedScore: number;
    acceptanceScore: number | null;
    stage: string | null;
    sourceKind: string | null;
    lastObservedAt: string;
    timeWindow: "7d" | "30d";
  }>;
  scopeQualityRows: Array<{
    scope: string;
    version: number;
    observations: number;
    sampled: number;
    pending: number;
    confirmed: number;
    rejected: number;
    precision: number | null;
    factCoverage: number;
  }>;
  recentTraces: DemandTraceRow[];
  reviewQueue: {
    sampled: number;
    pending: number;
    rows: DemandTraceRow[];
  };
};

const EMPTY_DEMAND_ANALYTICS: DemandAnalyticsData = {
  summary: {
    observations: 0,
    intents: 0,
    feedbackObservations: 0,
    outcomes: 0,
    sampledForReview: 0,
    pendingReview: 0,
    queuePending: 0,
    queueFailures: 0,
    graphEdges: 0,
    freshnessMinutes: null,
  },
  series: [],
  topIntentRows: [],
  risingIntentRows: [],
  unmetNeedRows: [],
  outcomeRows: [],
  substitutionRows: [],
  graphRows: [],
  scopeQualityRows: [],
  recentTraces: [],
  reviewQueue: {
    sampled: 0,
    pending: 0,
    rows: [],
  },
};

type TimeBucket = {
  key: string;
  label: string;
  startMs: number;
  endMs: number;
};

const TREND_FACT_FACETS = new Set([
  "goal",
  "dish",
  "cuisine",
  "ingredient_want",
  "health_goal",
  "occasion",
  "requested_substitution",
]);

const SUCCESS_OUTCOME_TYPES = new Set([
  "candidate_selected",
  "recipe_committed",
  "recipe_saved",
  "variant_refreshed",
  "cook_inferred",
  "repeat_cook",
]);

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

const normalizeBucketStart = (date: Date, grain: AnalyticsGrain): Date => {
  if (grain === "hour") return startOfHour(date);
  if (grain === "day") return startOfDay(date);
  return startOfWeek(date);
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
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
};

const buildBuckets = (query: AnalyticsQueryState): {
  buckets: TimeBucket[];
  windowStart: Date;
  windowEnd: Date;
} => {
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

const incrementBucket = (
  series: Array<Record<string, number | string>>,
  buckets: TimeBucket[],
  timestamp: string,
  field: string,
): void => {
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) {
    return;
  }

  const bucket = buckets.find((entry) => value >= entry.startMs && value < entry.endMs);
  if (!bucket) {
    return;
  }

  const row = series.find((entry) => entry["bucketStart"] === bucket.key);
  if (!row) {
    return;
  }

  row[field] = Number(row[field] ?? 0) + 1;
};

const makeFactKey = (facet: string, value: string): string => `${facet}::${value}`;

const loadDemandTraceRows = async (
  observations: DemandObservationRow[],
): Promise<DemandTraceRow[]> => {
  if (observations.length === 0) {
    return [];
  }

  const client = getAdminClient();
  const observationIds = observations.map((observation) => observation.id);

  const [factsResult, observationOutcomesResult, originOutcomesResult] = await Promise.all([
    client
      .from("demand_fact_values")
      .select("observation_id,facet,normalized_value,raw_value,confidence,rank,entity_id,metadata_jsonb")
      .in("observation_id", observationIds)
      .order("rank", { ascending: true }),
    client
      .from("demand_outcomes")
      .select("id,observation_id,origin_observation_id,outcome_type,source_kind,source_id,recipe_id,variant_id,candidate_id,occurred_at,payload_jsonb")
      .in("observation_id", observationIds)
      .order("occurred_at", { ascending: false }),
    client
      .from("demand_outcomes")
      .select("id,observation_id,origin_observation_id,outcome_type,source_kind,source_id,recipe_id,variant_id,candidate_id,occurred_at,payload_jsonb")
      .in("origin_observation_id", observationIds)
      .order("occurred_at", { ascending: false }),
  ]);

  if (factsResult.error && !isSchemaMissingError(factsResult.error)) {
    throw new Error(factsResult.error.message);
  }
  if (observationOutcomesResult.error && !isSchemaMissingError(observationOutcomesResult.error)) {
    throw new Error(observationOutcomesResult.error.message);
  }
  if (originOutcomesResult.error && !isSchemaMissingError(originOutcomesResult.error)) {
    throw new Error(originOutcomesResult.error.message);
  }

  const factsByObservation = new Map<string, DemandFactValueRow[]>();
  for (const row of (factsResult.data ?? []) as DemandFactValueRow[]) {
    const current = factsByObservation.get(row.observation_id) ?? [];
    current.push(row);
    factsByObservation.set(row.observation_id, current);
  }

  const outcomesByObservation = new Map<string, DemandOutcomeRow[]>();
  const seenOutcomeIds = new Set<string>();
  for (const row of [
    ...((observationOutcomesResult.data ?? []) as DemandOutcomeRow[]),
    ...((originOutcomesResult.data ?? []) as DemandOutcomeRow[]),
  ]) {
    if (seenOutcomeIds.has(row.id)) {
      continue;
    }
    seenOutcomeIds.add(row.id);

    const observationKey = row.origin_observation_id ?? row.observation_id;
    const current = outcomesByObservation.get(observationKey) ?? [];
    current.push(row);
    outcomesByObservation.set(observationKey, current);
  }

  return observations.map((observation) => ({
    observation,
    facts: factsByObservation.get(observation.id) ?? [],
    outcomes: outcomesByObservation.get(observation.id) ?? [],
  }));
};

export const buildDemandAnalyticsSnapshot = (params: {
  query: AnalyticsQueryState;
  observations: DemandObservationRow[];
  facts: DemandFactValueRow[];
  outcomes: DemandOutcomeRow[];
  graphRows: DemandGraphEdgeRow[];
  jobs: DemandExtractionJobRow[];
  observationTotal: number;
  graphTotal: number;
  pendingReviewCount: number;
  reviewQueueRows: DemandTraceRow[];
}): DemandAnalyticsData => {
  const { buckets, windowStart, windowEnd } = buildBuckets(params.query);
  const series = createSeries(buckets, [
    "observations",
    "intent",
    "iteration",
    "feedback",
    "commit",
    "outcomes",
    "commits",
    "saved",
    "cooks",
  ]);

  const factsByObservation = new Map<string, DemandFactValueRow[]>();
  for (const fact of params.facts) {
    const current = factsByObservation.get(fact.observation_id) ?? [];
    current.push(fact);
    factsByObservation.set(fact.observation_id, current);
  }

  const outcomesByOrigin = new Map<string, DemandOutcomeRow[]>();
  for (const outcome of params.outcomes) {
    const originKey = outcome.origin_observation_id ?? outcome.observation_id;
    const originRows = outcomesByOrigin.get(originKey) ?? [];
    originRows.push(outcome);
    outcomesByOrigin.set(originKey, originRows);
  }

  for (const observation of params.observations) {
    incrementBucket(series, buckets, observation.observed_at, "observations");
    incrementBucket(series, buckets, observation.observed_at, observation.stage);
  }

  for (const outcome of params.outcomes) {
    incrementBucket(series, buckets, outcome.occurred_at, "outcomes");
    if (outcome.outcome_type === "recipe_committed") {
      incrementBucket(series, buckets, outcome.occurred_at, "commits");
    }
    if (outcome.outcome_type === "recipe_saved") {
      incrementBucket(series, buckets, outcome.occurred_at, "saved");
    }
    if (outcome.outcome_type === "cook_inferred" || outcome.outcome_type === "repeat_cook") {
      incrementBucket(series, buckets, outcome.occurred_at, "cooks");
    }
  }

  const factStats = new Map<string, {
    facet: string;
    value: string;
    observations: number;
    confidenceTotal: number;
    recentObservations: number;
    priorObservations: number;
    successfulObservations: number;
  }>();
  const midpointMs = windowStart.getTime() + Math.floor((windowEnd.getTime() - windowStart.getTime()) / 2);

  for (const observation of params.observations) {
    const observationFacts = factsByObservation.get(observation.id) ?? [];
    const observationOutcomes = outcomesByOrigin.get(observation.id) ?? [];
    const hasSuccess = observationOutcomes.some((row) => SUCCESS_OUTCOME_TYPES.has(row.outcome_type));
    const observedMs = Date.parse(observation.observed_at);

    const seenFactKeys = new Set<string>();
    for (const fact of observationFacts) {
      if (!TREND_FACT_FACETS.has(fact.facet)) {
        continue;
      }
      const key = makeFactKey(fact.facet, fact.normalized_value);
      if (seenFactKeys.has(key)) {
        continue;
      }
      seenFactKeys.add(key);

      const current = factStats.get(key) ?? {
        facet: fact.facet,
        value: fact.normalized_value,
        observations: 0,
        confidenceTotal: 0,
        recentObservations: 0,
        priorObservations: 0,
        successfulObservations: 0,
      };
      current.observations += 1;
      current.confidenceTotal += Number(fact.confidence ?? 0);
      if (Number.isFinite(observedMs) && observedMs >= midpointMs) {
        current.recentObservations += 1;
      } else {
        current.priorObservations += 1;
      }
      if (hasSuccess) {
        current.successfulObservations += 1;
      }
      factStats.set(key, current);
    }
  }

  const topIntentRows = Array.from(factStats.values())
    .sort((left, right) =>
      right.observations - left.observations ||
      (right.confidenceTotal / Math.max(1, right.observations)) - (left.confidenceTotal / Math.max(1, left.observations))
    )
    .slice(0, 12)
    .map((row) => ({
      facet: row.facet,
      value: row.value,
      observations: row.observations,
      avgConfidence: row.confidenceTotal / Math.max(1, row.observations),
    }));

  const risingIntentRows = Array.from(factStats.values())
    .map((row) => ({
      facet: row.facet,
      value: row.value,
      recentObservations: row.recentObservations,
      priorObservations: row.priorObservations,
      delta: row.recentObservations - row.priorObservations,
    }))
    .filter((row) => row.recentObservations >= 2 && row.delta > 0)
    .sort((left, right) =>
      right.delta - left.delta ||
      right.recentObservations - left.recentObservations ||
      left.priorObservations - right.priorObservations
    )
    .slice(0, 12);

  const unmetNeedRows = Array.from(factStats.values())
    .map((row) => ({
      facet: row.facet,
      value: row.value,
      observations: row.observations,
      successRate: row.successfulObservations / Math.max(1, row.observations),
    }))
    .filter((row) => row.observations >= 2)
    .sort((left, right) =>
      (right.observations * (1 - right.successRate)) - (left.observations * (1 - left.successRate)) ||
      right.observations - left.observations
    )
    .slice(0, 12);

  const outcomeCounts = new Map<string, number>();
  for (const outcome of params.outcomes) {
    outcomeCounts.set(outcome.outcome_type, (outcomeCounts.get(outcome.outcome_type) ?? 0) + 1);
  }

  const outcomeRows = Array.from(outcomeCounts.entries())
    .map(([outcomeType, count]) => ({
      outcomeType,
      count,
      rate: count / Math.max(1, params.observations.length),
    }))
    .sort((left, right) => right.count - left.count);

  const substitutionRows = Array.from(params.outcomes.reduce((accumulator, outcome) => {
    if (
      outcome.outcome_type !== "substitution_accepted" &&
      outcome.outcome_type !== "substitution_reverted"
    ) {
      return accumulator;
    }

    const payload = toRecord((outcome.payload_jsonb ?? {}) as never);
    const original = typeof payload["original"] === "string" ? payload["original"] : "unknown";
    const replacement = typeof payload["replacement"] === "string" ? payload["replacement"] : "unknown";
    const key = `${original}::${replacement}`;
    const current = accumulator.get(key) ?? {
      original,
      replacement,
      accepted: 0,
      reverted: 0,
    };
    if (outcome.outcome_type === "substitution_accepted") {
      current.accepted += 1;
    } else {
      current.reverted += 1;
    }
    accumulator.set(key, current);
    return accumulator;
  }, new Map<string, { original: string; replacement: string; accepted: number; reverted: number }>()).values())
    .map((row) => ({
      ...row,
      acceptanceRate: row.accepted / Math.max(1, row.accepted + row.reverted),
    }))
    .sort((left, right) => (right.accepted + right.reverted) - (left.accepted + left.reverted))
    .slice(0, 12);

  const scopeQualityRows = Array.from(params.observations.reduce((accumulator, observation) => {
    const key = `${observation.extractor_scope}::${observation.extractor_version}`;
    const current = accumulator.get(key) ?? {
      scope: observation.extractor_scope,
      version: observation.extractor_version,
      observations: 0,
      sampled: 0,
      pending: 0,
      confirmed: 0,
      rejected: 0,
      observationsWithFacts: 0,
    };
    current.observations += 1;
    if (observation.sampled_for_review) {
      current.sampled += 1;
    }
    if (observation.review_status === "confirmed") {
      current.confirmed += 1;
    } else if (observation.review_status === "rejected") {
      current.rejected += 1;
    } else {
      current.pending += 1;
    }
    if ((factsByObservation.get(observation.id) ?? []).length > 0) {
      current.observationsWithFacts += 1;
    }
    accumulator.set(key, current);
    return accumulator;
  }, new Map<string, {
    scope: string;
    version: number;
    observations: number;
    sampled: number;
    pending: number;
    confirmed: number;
    rejected: number;
    observationsWithFacts: number;
  }>()).values())
    .map((row) => ({
      scope: row.scope,
      version: row.version,
      observations: row.observations,
      sampled: row.sampled,
      pending: row.pending,
      confirmed: row.confirmed,
      rejected: row.rejected,
      precision: row.confirmed + row.rejected > 0
        ? row.confirmed / (row.confirmed + row.rejected)
        : null,
      factCoverage: row.observationsWithFacts / Math.max(1, row.observations),
    }))
    .sort((left, right) => right.observations - left.observations);

  const graphRows = params.graphRows
    .map((row) => {
      const segment = toRecord((row.segment_jsonb ?? {}) as never);
      return {
        fromFacet: row.from_facet,
        fromValue: row.from_value,
        toFacet: row.to_facet,
        toValue: row.to_value,
        count: row.count,
        recencyWeightedScore: row.recency_weighted_score,
        acceptanceScore: row.acceptance_score,
        stage: typeof segment["stage"] === "string" ? segment["stage"] : null,
        sourceKind: typeof segment["source_kind"] === "string" ? segment["source_kind"] : null,
        lastObservedAt: row.last_observed_at,
        timeWindow: row.time_window,
      };
    })
    .slice(0, 20);

  const queuePending = params.jobs.filter((job) => job.status === "pending" || job.status === "processing").length;
  const queueFailures = params.jobs.filter((job) => job.status === "failed" || job.status === "dead_letter").length;

  const freshnessCandidates = [
    ...params.observations.map((row) => Date.parse(row.observed_at)),
    ...params.jobs.map((row) => Date.parse(row.updated_at)),
  ].filter((value) => Number.isFinite(value));
  const freshestTimestamp = freshnessCandidates.length > 0 ? Math.max(...freshnessCandidates) : null;

  const recentTraces = params.observations
    .slice(0, 15)
    .map((observation) => ({
      observation,
      facts: factsByObservation.get(observation.id) ?? [],
      outcomes: outcomesByOrigin.get(observation.id) ?? [],
    }));

  const sampledForReview = params.observations.filter((row) => row.sampled_for_review).length;

  return {
    summary: {
      observations: params.observationTotal,
      intents: params.observations.filter((row) => row.stage === "intent" || row.stage === "import").length,
      feedbackObservations: params.observations.filter((row) =>
        row.stage === "feedback" || row.stage === "consumption" || row.stage === "selection"
      ).length,
      outcomes: params.outcomes.length,
      sampledForReview,
      pendingReview: params.pendingReviewCount,
      queuePending,
      queueFailures,
      graphEdges: params.graphTotal,
      freshnessMinutes: freshestTimestamp == null
        ? null
        : Math.max(0, Math.round((Date.now() - freshestTimestamp) / 60_000)),
    },
    series,
    topIntentRows,
    risingIntentRows,
    unmetNeedRows,
    outcomeRows,
    substitutionRows,
    graphRows,
    scopeQualityRows,
    recentTraces,
    reviewQueue: {
      sampled: sampledForReview,
      pending: params.pendingReviewCount,
      rows: params.reviewQueueRows,
    },
  };
};

const demandWindow = (query: AnalyticsQueryState): "7d" | "30d" =>
  query.range === "24h" || query.range === "7d" ? "7d" : "30d";

export const getDemandAnalyticsData = async (
  query: AnalyticsQueryState,
): Promise<DemandAnalyticsData> => {
  const client = getAdminClient();
  const hours = getHoursForRange(query.range);
  const windowStartIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const observationLimit = query.range === "90d" ? 1800 : 1200;

  try {
    const [
      observationsResult,
      observationCountResult,
      outcomesResult,
      graphResult,
      graphCountResult,
      jobsResult,
      pendingReviewCountResult,
      reviewObservationResult,
    ] = await Promise.all([
      client
        .from("demand_observations")
        .select("id,source_kind,source_id,stage,extractor_scope,extractor_version,confidence,observed_at,review_status,sampled_for_review,admin_snippet_redacted,raw_trace_ref,summary_jsonb,user_id,chat_session_id,recipe_id,variant_id")
        .gte("observed_at", windowStartIso)
        .order("observed_at", { ascending: false })
        .limit(observationLimit),
      client
        .from("demand_observations")
        .select("id", { count: "exact", head: true })
        .gte("observed_at", windowStartIso),
      client
        .from("demand_outcomes")
        .select("id,observation_id,origin_observation_id,outcome_type,source_kind,source_id,recipe_id,variant_id,candidate_id,occurred_at,payload_jsonb")
        .gte("occurred_at", windowStartIso)
        .order("occurred_at", { ascending: false })
        .limit(4000),
      client
        .from("demand_graph_edges")
        .select("id,from_facet,from_value,to_facet,to_value,count,recency_weighted_score,acceptance_score,segment_jsonb,last_observed_at,time_window")
        .eq("time_window", demandWindow(query))
        .order("recency_weighted_score", { ascending: false })
        .limit(80),
      client
        .from("demand_graph_edges")
        .select("id", { count: "exact", head: true })
        .eq("time_window", demandWindow(query)),
      client
        .from("demand_extraction_jobs")
        .select("status,observed_at,updated_at,next_attempt_at,last_error")
        .order("updated_at", { ascending: false })
        .limit(400),
      client
        .from("demand_observations")
        .select("id", { count: "exact", head: true })
        .eq("sampled_for_review", true)
        .eq("review_status", "pending"),
      client
        .from("demand_observations")
        .select("id,source_kind,source_id,stage,extractor_scope,extractor_version,confidence,observed_at,review_status,sampled_for_review,admin_snippet_redacted,raw_trace_ref,summary_jsonb,user_id,chat_session_id,recipe_id,variant_id")
        .eq("sampled_for_review", true)
        .eq("review_status", "pending")
        .order("observed_at", { ascending: false })
        .limit(8),
    ]);

    const results = [
      observationsResult,
      observationCountResult,
      outcomesResult,
      graphResult,
      graphCountResult,
      jobsResult,
      pendingReviewCountResult,
      reviewObservationResult,
    ];
    const hardError = results.find((result) => result.error && !isSchemaMissingError(result.error))?.error;
    if (hardError) {
      throw new Error(hardError.message);
    }

    const observations = (observationsResult.data ?? []) as DemandObservationRow[];
    const reviewObservations = (reviewObservationResult.data ?? []) as DemandObservationRow[];
    const observationIds = observations.map((row) => row.id);

    const factsResult = observationIds.length > 0
      ? await client
        .from("demand_fact_values")
        .select("observation_id,facet,normalized_value,raw_value,confidence,rank,entity_id,metadata_jsonb")
        .in("observation_id", observationIds)
        .order("rank", { ascending: true })
      : { data: [], error: null };

    if (factsResult.error && !isSchemaMissingError(factsResult.error)) {
      throw new Error(factsResult.error.message);
    }

    const reviewQueueRows = await loadDemandTraceRows(reviewObservations);

    return buildDemandAnalyticsSnapshot({
      query,
      observations,
      facts: (factsResult.data ?? []) as DemandFactValueRow[],
      outcomes: (outcomesResult.data ?? []) as DemandOutcomeRow[],
      graphRows: (graphResult.data ?? []) as DemandGraphEdgeRow[],
      jobs: (jobsResult.data ?? []) as DemandExtractionJobRow[],
      observationTotal: observationCountResult.count ?? observations.length,
      graphTotal: graphCountResult.count ?? ((graphResult.data ?? []) as DemandGraphEdgeRow[]).length,
      pendingReviewCount: pendingReviewCountResult.count ?? 0,
      reviewQueueRows,
    });
  } catch (error) {
    if (isSchemaMissingError(error)) {
      return EMPTY_DEMAND_ANALYTICS;
    }
    throw error;
  }
};

export const getDemandObservationsData = async (params?: {
  limit?: number;
  stage?: string;
  reviewStatus?: "pending" | "confirmed" | "rejected";
  sampledOnly?: boolean;
}): Promise<{ items: DemandTraceRow[] }> => {
  const client = getAdminClient();
  const limit = Math.max(1, Math.min(100, Number(params?.limit ?? 25)));

  try {
    let query = client
      .from("demand_observations")
      .select("id,source_kind,source_id,stage,extractor_scope,extractor_version,confidence,observed_at,review_status,sampled_for_review,admin_snippet_redacted,raw_trace_ref,summary_jsonb,user_id,chat_session_id,recipe_id,variant_id")
      .order("observed_at", { ascending: false })
      .limit(limit);

    if (params?.stage) {
      query = query.eq("stage", params.stage);
    }
    if (params?.reviewStatus) {
      query = query.eq("review_status", params.reviewStatus);
    }
    if (params?.sampledOnly) {
      query = query.eq("sampled_for_review", true);
    }

    const result = await query;
    if (result.error) {
      if (isSchemaMissingError(result.error)) {
        return { items: [] };
      }
      throw new Error(result.error.message);
    }

    return {
      items: await loadDemandTraceRows((result.data ?? []) as DemandObservationRow[]),
    };
  } catch (error) {
    if (isSchemaMissingError(error)) {
      return { items: [] };
    }
    throw error;
  }
};

export const getDemandGraphData = async (params?: {
  window?: "7d" | "30d";
  limit?: number;
}): Promise<{ items: DemandAnalyticsData["graphRows"] }> => {
  const client = getAdminClient();
  const tw = params?.window ?? "30d";
  const limit = Math.max(1, Math.min(200, Number(params?.limit ?? 50)));

  try {
    const result = await client
      .from("demand_graph_edges")
      .select("id,from_facet,from_value,to_facet,to_value,count,recency_weighted_score,acceptance_score,segment_jsonb,last_observed_at,time_window")
      .eq("time_window", tw)
      .order("recency_weighted_score", { ascending: false })
      .limit(limit);

    if (result.error) {
      if (isSchemaMissingError(result.error)) {
        return { items: [] };
      }
      throw new Error(result.error.message);
    }

    return {
      items: (result.data ?? []).map((row) => {
        const value = row as DemandGraphEdgeRow;
        const segment = toRecord((value.segment_jsonb ?? {}) as never);
        return {
          fromFacet: value.from_facet,
          fromValue: value.from_value,
          toFacet: value.to_facet,
          toValue: value.to_value,
          count: value.count,
          recencyWeightedScore: value.recency_weighted_score,
          acceptanceScore: value.acceptance_score,
          stage: typeof segment["stage"] === "string" ? segment["stage"] : null,
          sourceKind: typeof segment["source_kind"] === "string" ? segment["source_kind"] : null,
          lastObservedAt: value.last_observed_at,
          timeWindow: value.time_window,
        };
      }),
    };
  } catch (error) {
    if (isSchemaMissingError(error)) {
      return { items: [] };
    }
    throw error;
  }
};

export const getDemandTrendsData = async (
  query: AnalyticsQueryState,
): Promise<Pick<DemandAnalyticsData, "topIntentRows" | "risingIntentRows" | "unmetNeedRows">> => {
  const data = await getDemandAnalyticsData(query);
  return {
    topIntentRows: data.topIntentRows,
    risingIntentRows: data.risingIntentRows,
    unmetNeedRows: data.unmetNeedRows,
  };
};

export const getDemandOutcomeData = async (
  query: AnalyticsQueryState,
): Promise<Pick<DemandAnalyticsData, "outcomeRows" | "substitutionRows">> => {
  const data = await getDemandAnalyticsData(query);
  return {
    outcomeRows: data.outcomeRows,
    substitutionRows: data.substitutionRows,
  };
};

export const reviewDemandObservation = async (params: {
  observationId: string;
  reviewStatus: "confirmed" | "rejected";
  reviewer: string;
  reviewNotes?: string | null;
}): Promise<{ ok: true }> => {
  const client = getAdminClient();

  const result = await client
    .from("demand_observations")
    .update({
      review_status: params.reviewStatus,
      review_notes: params.reviewNotes ?? null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: params.reviewer,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.observationId);

  if (result.error) {
    if (isSchemaMissingError(result.error)) {
      throw new Error("Demand graph schema is not available in this environment yet.");
    }
    throw new Error(result.error.message);
  }

  return { ok: true };
};
