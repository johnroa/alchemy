import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../../../_shared/errors.ts";
import type { JsonValue } from "../../../_shared/types.ts";
import { attachOutcomeOriginIds, extractDemandJob, type DemandJobRow } from "./extractors.ts";
import {
  shouldSampleDemandObservation,
  toIsoString,
  type DemandFactRecord,
  type DemandObservationRecord,
  type DemandStage,
} from "./types.ts";

const DEFAULT_MAX_ATTEMPTS = 5;
const STALE_LOCK_WINDOW_MS = 10 * 60 * 1000;

const toBackoffIso = (attempts: number): string => {
  const baseDelayMs = 30_000;
  const nextDelayMs = Math.min(baseDelayMs * Math.max(1, 2 ** Math.max(0, attempts - 1)), 6 * 60 * 60 * 1000);
  return new Date(Date.now() + nextDelayMs).toISOString();
};

const queueStatusSnapshot = async (serviceClient: SupabaseClient): Promise<{
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  dead_letter: number;
}> => {
  const { data, error } = await serviceClient
    .from("demand_extraction_jobs")
    .select("status");

  if (error) {
    throw new ApiError(
      500,
      "demand_queue_snapshot_failed",
      "Could not inspect demand queue",
      error.message,
    );
  }

  const rows = data ?? [];
  return {
    pending: rows.filter((row) => row.status === "pending").length,
    processing: rows.filter((row) => row.status === "processing").length,
    completed: rows.filter((row) => row.status === "completed").length,
    failed: rows.filter((row) => row.status === "failed").length,
    dead_letter: rows.filter((row) => row.status === "dead_letter").length,
  };
};

const upsertObservation = async (params: {
  serviceClient: SupabaseClient;
  observation: DemandObservationRecord;
}): Promise<string> => {
  const { data: existing, error: lookupError } = await params.serviceClient
    .from("demand_observations")
    .select("id,sampled_for_review,sampled_at,review_status,review_notes,reviewed_at,reviewed_by")
    .eq("source_kind", params.observation.sourceKind)
    .eq("source_id", params.observation.sourceId)
    .eq("stage", params.observation.stage)
    .eq("extractor_version", params.observation.extractorVersion)
    .maybeSingle();

  if (lookupError) {
    throw new ApiError(
      500,
      "demand_observation_lookup_failed",
      "Could not inspect existing demand observation",
      lookupError.message,
    );
  }

  const sampledForReview = existing?.sampled_for_review ??
    shouldSampleDemandObservation(
      [
        params.observation.sourceKind,
        params.observation.sourceId,
        params.observation.stage,
        String(params.observation.extractorVersion),
      ].join(":"),
      params.observation.confidence,
    );
  const sampledAt = existing?.sampled_at ??
    (sampledForReview ? new Date().toISOString() : null);

  const payload = {
    source_kind: params.observation.sourceKind,
    source_id: params.observation.sourceId,
    user_id: params.observation.userId,
    chat_session_id: params.observation.chatSessionId,
    recipe_id: params.observation.recipeId,
    variant_id: params.observation.variantId,
    observed_at: params.observation.observedAt,
    stage: params.observation.stage,
    extractor_scope: params.observation.extractorScope,
    extractor_version: params.observation.extractorVersion,
    confidence: params.observation.confidence,
    privacy_tier: params.observation.privacyTier,
    admin_snippet_redacted: params.observation.adminSnippetRedacted,
    raw_trace_ref: params.observation.rawTraceRef,
    summary_jsonb: params.observation.summary,
    sampled_for_review: sampledForReview,
    sampled_at: sampledAt,
    updated_at: new Date().toISOString(),
  };

  if (!existing?.id) {
    const { data, error } = await params.serviceClient
      .from("demand_observations")
      .insert({
        ...payload,
        review_status: "pending",
      })
      .select("id")
      .single();

    if (error || !data?.id) {
      throw new ApiError(
        500,
        "demand_observation_insert_failed",
        "Could not persist demand observation",
        error?.message,
      );
    }

    return String(data.id);
  }

  const { error: updateError } = await params.serviceClient
    .from("demand_observations")
    .update(payload)
    .eq("id", existing.id);

  if (updateError) {
    throw new ApiError(
      500,
      "demand_observation_update_failed",
      "Could not update demand observation",
      updateError.message,
    );
  }

  return String(existing.id);
};

const replaceFacts = async (params: {
  serviceClient: SupabaseClient;
  observationId: string;
  facts: DemandFactRecord[];
}): Promise<void> => {
  const { error: deleteError } = await params.serviceClient
    .from("demand_fact_values")
    .delete()
    .eq("observation_id", params.observationId);

  if (deleteError) {
    throw new ApiError(
      500,
      "demand_fact_delete_failed",
      "Could not replace demand facts",
      deleteError.message,
    );
  }

  if (params.facts.length === 0) {
    return;
  }

  const { error: insertError } = await params.serviceClient
    .from("demand_fact_values")
    .insert(
      params.facts.map((fact) => ({
        observation_id: params.observationId,
        facet: fact.facet,
        normalized_value: fact.normalizedValue,
        raw_value: fact.rawValue,
        polarity: fact.polarity,
        entity_id: fact.entityId,
        confidence: fact.confidence,
        rank: fact.rank,
        metadata_jsonb: fact.metadata,
      })),
    );

  if (insertError) {
    throw new ApiError(
      500,
      "demand_fact_insert_failed",
      "Could not persist demand facts",
      insertError.message,
    );
  }
};

const replaceOutcomes = async (params: {
  serviceClient: SupabaseClient;
  observationId: string;
  outcomes: Array<{
    originObservationId: string | null;
    outcomeType: string;
    sourceKind: string;
    sourceId: string;
    recipeId: string | null;
    variantId: string | null;
    candidateId: string | null;
    occurredAt: string;
    payload: Record<string, JsonValue>;
  }>;
}): Promise<void> => {
  const { error: deleteError } = await params.serviceClient
    .from("demand_outcomes")
    .delete()
    .eq("observation_id", params.observationId);

  if (deleteError) {
    throw new ApiError(
      500,
      "demand_outcome_delete_failed",
      "Could not replace demand outcomes",
      deleteError.message,
    );
  }

  if (params.outcomes.length === 0) {
    return;
  }

  const { error: insertError } = await params.serviceClient
    .from("demand_outcomes")
    .insert(
      params.outcomes.map((outcome) => ({
        observation_id: params.observationId,
        origin_observation_id: outcome.originObservationId,
        outcome_type: outcome.outcomeType,
        source_kind: outcome.sourceKind,
        source_id: outcome.sourceId,
        recipe_id: outcome.recipeId,
        variant_id: outcome.variantId,
        candidate_id: outcome.candidateId,
        occurred_at: outcome.occurredAt,
        payload_jsonb: outcome.payload,
      })),
    );

  if (insertError) {
    throw new ApiError(
      500,
      "demand_outcome_insert_failed",
      "Could not persist demand outcomes",
      insertError.message,
    );
  }
};

const updateDemandJobState = async (params: {
  serviceClient: SupabaseClient;
  jobId: string;
  patch: Record<string, JsonValue>;
}): Promise<void> => {
  const { error } = await params.serviceClient
    .from("demand_extraction_jobs")
    .update({
      ...params.patch,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.jobId);

  if (error) {
    throw new ApiError(
      500,
      "demand_job_update_failed",
      "Could not update demand job",
      error.message,
    );
  }
};

export const enqueueDemandExtractionJob = async (params: {
  serviceClient: SupabaseClient;
  sourceKind: string;
  sourceId: string;
  userId?: string | null;
  stage: DemandStage;
  extractorScope: string;
  extractorVersion?: number;
  observedAt?: string | null;
  payload?: Record<string, JsonValue>;
}): Promise<void> => {
  const observedAt = toIsoString(params.observedAt);
  const extractorVersion = Number.isFinite(Number(params.extractorVersion))
    ? Math.max(1, Math.trunc(Number(params.extractorVersion)))
    : 1;

  const { error } = await params.serviceClient
    .from("demand_extraction_jobs")
    .upsert(
      {
        source_kind: params.sourceKind,
        source_id: params.sourceId,
        user_id: params.userId ?? null,
        stage: params.stage,
        extractor_scope: params.extractorScope,
        extractor_version: extractorVersion,
        observed_at: observedAt,
        payload_jsonb: params.payload ?? {},
        status: "pending",
        attempts: 0,
        max_attempts: DEFAULT_MAX_ATTEMPTS,
        next_attempt_at: observedAt,
        locked_at: null,
        locked_by: null,
        last_error: null,
        observation_id: null,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "source_kind,source_id,stage,extractor_version",
      },
    );

  if (error) {
    throw new ApiError(
      500,
      "demand_job_enqueue_failed",
      "Could not enqueue demand extraction job",
      error.message,
    );
  }
};

export const processDemandExtractionJobs = async (params: {
  serviceClient: SupabaseClient;
  actorUserId: string;
  requestId: string;
  limit: number;
}): Promise<{
  reaped: number;
  claimed: number;
  processed: number;
  completed: number;
  failed: number;
  deadLettered: number;
  graph: Record<string, JsonValue>;
  queue: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    dead_letter: number;
  };
}> => {
  const now = new Date();
  const staleThreshold = new Date(now.getTime() - STALE_LOCK_WINDOW_MS).toISOString();
  const { data: staleJobs, error: staleLookupError } = await params.serviceClient
    .from("demand_extraction_jobs")
    .select("id")
    .eq("status", "processing")
    .lt("locked_at", staleThreshold);

  if (staleLookupError) {
    throw new ApiError(
      500,
      "demand_jobs_stale_lookup_failed",
      "Could not inspect stale demand jobs",
      staleLookupError.message,
    );
  }

  let reaped = 0;
  if ((staleJobs ?? []).length > 0) {
    const staleIds = (staleJobs ?? []).map((job) => job.id);
    const { error: reapError } = await params.serviceClient
      .from("demand_extraction_jobs")
      .update({
        status: "pending",
        locked_at: null,
        locked_by: null,
        next_attempt_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .in("id", staleIds);

    if (reapError) {
      throw new ApiError(
        500,
        "demand_jobs_reap_failed",
        "Could not release stale demand jobs",
        reapError.message,
      );
    }
    reaped = staleIds.length;
  }

  if (params.limit <= 0) {
    return {
      reaped,
      claimed: 0,
      processed: 0,
      completed: 0,
      failed: 0,
      deadLettered: 0,
      graph: {},
      queue: await queueStatusSnapshot(params.serviceClient),
    };
  }

  const { data: dueJobs, error: dueJobsError } = await params.serviceClient
    .from("demand_extraction_jobs")
    .select("id,source_kind,source_id,user_id,stage,extractor_scope,extractor_version,observed_at,payload_jsonb,attempts,max_attempts,status")
    .in("status", ["pending", "failed"])
    .lte("next_attempt_at", now.toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(params.limit);

  if (dueJobsError) {
    throw new ApiError(
      500,
      "demand_jobs_due_fetch_failed",
      "Could not load due demand jobs",
      dueJobsError.message,
    );
  }

  let claimed = 0;
  let processed = 0;
  let completed = 0;
  let failed = 0;
  let deadLettered = 0;

  for (const job of (dueJobs ?? []) as Array<DemandJobRow & { attempts?: number; max_attempts?: number; status?: string }>) {
    const nextAttempt = Number(job.attempts ?? 0) + 1;
    const { data: claimedRow, error: lockError } = await params.serviceClient
      .from("demand_extraction_jobs")
      .update({
        status: "processing",
        attempts: nextAttempt,
        locked_at: now.toISOString(),
        locked_by: "v1_demand_jobs_process",
        updated_at: now.toISOString(),
      })
      .eq("id", job.id)
      .eq("status", job.status ?? "pending")
      .select("id")
      .maybeSingle();

    if (lockError) {
      throw new ApiError(
        500,
        "demand_job_lock_failed",
        "Could not claim demand job",
        lockError.message,
      );
    }
    if (!claimedRow?.id) {
      continue;
    }

    claimed += 1;

    try {
      const extraction = await extractDemandJob({
        serviceClient: params.serviceClient,
        job,
        requestId: params.requestId,
      });

      const observationId = await upsertObservation({
        serviceClient: params.serviceClient,
        observation: extraction.observation,
      });

      await replaceFacts({
        serviceClient: params.serviceClient,
        observationId,
        facts: extraction.facts,
      });

      const linkedOutcomes = await attachOutcomeOriginIds({
        serviceClient: params.serviceClient,
        observationId,
        observation: extraction.observation,
        outcomes: extraction.outcomes,
      });

      await replaceOutcomes({
        serviceClient: params.serviceClient,
        observationId,
        outcomes: linkedOutcomes,
      });

      await updateDemandJobState({
        serviceClient: params.serviceClient,
        jobId: job.id,
        patch: {
          status: "completed",
          observation_id: observationId,
          locked_at: null,
          locked_by: null,
          last_error: null,
        },
      });

      processed += 1;
      completed += 1;
    } catch (error) {
      const nextStatus = nextAttempt >= Number(job.max_attempts ?? DEFAULT_MAX_ATTEMPTS)
        ? "dead_letter"
        : "failed";
      await updateDemandJobState({
        serviceClient: params.serviceClient,
        jobId: job.id,
        patch: {
          status: nextStatus,
          locked_at: null,
          locked_by: null,
          last_error: error instanceof Error ? error.message : String(error),
          next_attempt_at: nextStatus === "dead_letter" ? new Date().toISOString() : toBackoffIso(nextAttempt),
        },
      });

      processed += 1;
      if (nextStatus === "dead_letter") {
        deadLettered += 1;
      } else {
        failed += 1;
      }
    }
  }

  let graph: Record<string, JsonValue> = {};
  if (completed > 0) {
    const { data, error } = await params.serviceClient.rpc("refresh_demand_graph_edges");
    if (error) {
      throw new ApiError(
        500,
        "demand_graph_refresh_failed",
        "Could not refresh demand graph edges",
        error.message,
      );
    }
    graph = (data && typeof data === "object" && !Array.isArray(data))
      ? data as Record<string, JsonValue>
      : {};
  }

  return {
    reaped,
    claimed,
    processed,
    completed,
    failed,
    deadLettered,
    graph,
    queue: await queueStatusSnapshot(params.serviceClient),
  };
};

export const backfillDemandExtractionJobs = async (params: {
  serviceClient: SupabaseClient;
  requestId: string;
  userId?: string;
  hours?: number;
  limit: number;
}): Promise<{
  chatMessages: number;
  imports: number;
  behaviorEvents: number;
}> => {
  const hours = Number.isFinite(Number(params.hours))
    ? Math.max(1, Math.min(24 * 30, Number(params.hours)))
    : 24 * 7;
  const sinceIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const limit = Math.max(1, Math.min(500, params.limit));

  const chatQuery = params.serviceClient
    .from("chat_messages")
    .select("id,chat_id,created_at")
    .eq("role", "user")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(limit);
  const importQuery = params.serviceClient
    .from("import_provenance")
    .select("id,user_id,updated_at")
    .eq("status", "completed")
    .gte("updated_at", sinceIso)
    .order("updated_at", { ascending: false })
    .limit(limit);
  const behaviorQuery = params.serviceClient
    .from("behavior_events")
    .select("event_id,user_id,event_type,occurred_at")
    .in("event_type", ["recipe_cooked_inferred", "ingredient_substitution_applied"])
    .gte("occurred_at", sinceIso)
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (params.userId) {
    importQuery.eq("user_id", params.userId);
    behaviorQuery.eq("user_id", params.userId);
  }

  const [{ data: chatMessages }, { data: imports }, { data: behaviorEvents }] = await Promise.all([
    chatQuery,
    importQuery,
    behaviorQuery,
  ]);

  for (const message of chatMessages ?? []) {
    await enqueueDemandExtractionJob({
      serviceClient: params.serviceClient,
      sourceKind: "chat_message",
      sourceId: String(message.id),
      stage: "intent",
      extractorScope: "demand_extract_observation",
      observedAt: message.created_at,
    });
  }

  for (const provenance of imports ?? []) {
    await enqueueDemandExtractionJob({
      serviceClient: params.serviceClient,
      sourceKind: "import_provenance",
      sourceId: String(provenance.id),
      userId: provenance.user_id ? String(provenance.user_id) : null,
      stage: "import",
      extractorScope: "demand_extract_observation",
      observedAt: provenance.updated_at,
    });
  }

  for (const event of behaviorEvents ?? []) {
    const stage: DemandStage = event.event_type === "recipe_cooked_inferred"
      ? "consumption"
      : "feedback";
    await enqueueDemandExtractionJob({
      serviceClient: params.serviceClient,
      sourceKind: "behavior_event",
      sourceId: String(event.event_id),
      userId: event.user_id ? String(event.user_id) : null,
      stage,
      extractorScope: "demand_summarize_outcome_reason",
      observedAt: event.occurred_at,
    });
  }

  return {
    chatMessages: (chatMessages ?? []).length,
    imports: (imports ?? []).length,
    behaviorEvents: (behaviorEvents ?? []).length,
  };
};
