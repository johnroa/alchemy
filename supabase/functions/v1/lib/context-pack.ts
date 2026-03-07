import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../../_shared/errors.ts";
import type { JsonValue, MemoryRecord } from "../../_shared/types.ts";
import { llmGateway } from "../../_shared/llm-gateway.ts";
import type { PreferenceContext } from "./preferences.ts";
import {
  getPreferences,
  buildNaturalLanguagePreferenceContext,
} from "./preferences.ts";
import {
  getMemorySnapshot,
  getActiveMemories,
  logChangelog,
} from "./user-profile.ts";
import type { ContextPack } from "./chat-types.ts";

export const buildContextPack = async (params: {
  userClient: SupabaseClient;
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  prompt: string;
  context: Record<string, JsonValue>;
  selectionMode?: "llm" | "fast";
}): Promise<ContextPack> => {
  const memoryFetchLimit = params.selectionMode === "fast" ? 12 : 36;
  const [preferences, memorySnapshot, memories] = await Promise.all([
    getPreferences(params.userClient, params.userId),
    getMemorySnapshot(params.userClient, params.userId),
    getActiveMemories(params.userClient, params.userId, memoryFetchLimit),
  ]);
  const preferencesNaturalLanguage = buildNaturalLanguagePreferenceContext(
    preferences,
  );

  if (memories.length === 0) {
    return {
      preferences,
      preferencesNaturalLanguage,
      memorySnapshot,
      selectedMemories: [],
      selectedMemoryIds: [],
    };
  }

  if (params.selectionMode === "fast") {
    const selectedMemories = memories.slice(0, 12);
    return {
      preferences,
      preferencesNaturalLanguage,
      memorySnapshot,
      selectedMemories,
      selectedMemoryIds: selectedMemories.map((memory) => memory.id),
    };
  }

  let selectedIds: string[] = [];
  try {
    const selection = await llmGateway.selectMemories({
      client: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      prompt: params.prompt,
      context: {
        preferences,
        preferences_natural_language: preferencesNaturalLanguage,
        memory_snapshot: memorySnapshot,
        ...params.context,
      },
      memories,
    });
    selectedIds = selection.selected_memory_ids;
  } catch (error) {
    console.error("memory_select_failed", error);
    selectedIds = memories.map((memory) => memory.id).slice(0, 12);
  }

  const selectedSet = new Set(selectedIds);
  const selectedMemories = memories.filter((memory) =>
    selectedSet.has(memory.id)
  );

  return {
    preferences,
    preferencesNaturalLanguage,
    memorySnapshot,
    selectedMemories,
    selectedMemoryIds: selectedMemories.map((memory) => memory.id),
  };
};

export const updateMemoryFromInteraction = async (params: {
  userClient: SupabaseClient;
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  interactionContext: Record<string, JsonValue>;
  mode?: "full" | "light";
}): Promise<void> => {
  if (params.mode === "light") {
    await logChangelog({
      serviceClient: params.serviceClient,
      actorUserId: params.userId,
      scope: "memory",
      entityType: "memory_snapshot",
      entityId: params.userId,
      action: "interaction_observed",
      requestId: params.requestId,
      afterJson: {
        mode: "light",
        reason: "deferred_memory_processing",
      },
    });
    return;
  }

  const existingMemories = await getActiveMemories(
    params.userClient,
    params.userId,
    200,
  );

  let candidates: Array<{
    memory_type: string;
    memory_kind?: string;
    memory_content: JsonValue;
    confidence?: number;
    salience?: number;
    source?: string;
  }> = [];

  try {
    candidates = await llmGateway.extractMemories({
      client: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      context: params.interactionContext,
    });
  } catch (error) {
    console.error("memory_extract_failed", error);
  }

  if (candidates.length > 0) {
    const preferredInsert = await params.userClient.from("memories").insert(
      candidates.map((candidate) => ({
        user_id: params.userId,
        memory_type: candidate.memory_type,
        memory_kind: candidate.memory_kind ?? "preference",
        memory_content: candidate.memory_content,
        confidence: Number.isFinite(Number(candidate.confidence))
          ? Number(candidate.confidence)
          : 0.5,
        salience: Number.isFinite(Number(candidate.salience))
          ? Number(candidate.salience)
          : 0.5,
        source: candidate.source ?? "llm_extract",
        status: "active",
      })),
    );

    if (preferredInsert.error) {
      console.error("memory_insert_failed", preferredInsert.error);
    }
  }

  try {
    const conflict = await llmGateway.resolveMemoryConflicts({
      client: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      existingMemories,
      candidates,
    });

    for (const action of conflict.actions) {
      if (!action.memory_id) {
        continue;
      }

      if (action.action === "delete") {
        const deleteUpdate = await params.userClient
          .from("memories")
          .update({ status: "deleted", updated_at: new Date().toISOString() })
          .eq("id", action.memory_id);

        if (deleteUpdate.error) {
          console.error("memory_delete_failed", deleteUpdate.error);
        }
      }

      if (action.action === "supersede") {
        const supersedeUpdate = await params.userClient
          .from("memories")
          .update({
            status: "superseded",
            supersedes_memory_id: action.supersedes_memory_id ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", action.memory_id);

        if (supersedeUpdate.error) {
          console.error("memory_supersede_failed", supersedeUpdate.error);
        }
      }

      if (action.action === "merge" && action.merged_content) {
        await params.userClient
          .from("memories")
          .update({
            memory_content: action.merged_content,
            updated_at: new Date().toISOString(),
          })
          .eq("id", action.memory_id);
      }
    }
  } catch (error) {
    console.error("memory_conflict_resolution_failed", error);
  }

  const activeMemories = await getActiveMemories(
    params.userClient,
    params.userId,
    200,
  );
  try {
    const summary = await llmGateway.summarizeMemories({
      client: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      memories: activeMemories,
      context: params.interactionContext,
    });

    const { error: snapshotError } = await params.userClient.from(
      "memory_snapshots",
    ).upsert({
      user_id: params.userId,
      summary: summary.summary,
      token_estimate: summary.token_estimate ?? 0,
      updated_at: new Date().toISOString(),
    });

    if (snapshotError) {
      console.error("memory_snapshot_upsert_failed", snapshotError);
    }
  } catch (error) {
    console.error("memory_summary_failed", error);
  }

  await logChangelog({
    serviceClient: params.serviceClient,
    actorUserId: params.userId,
    scope: "memory",
    entityType: "memory_snapshot",
    entityId: params.userId,
    action: "updated",
    requestId: params.requestId,
    afterJson: {
      active_memory_count: activeMemories.length,
    },
  });
};

export const enqueueMemoryJob = async (params: {
  serviceClient: SupabaseClient;
  userId: string;
  chatId: string;
  messageId: string;
  interactionContext: Record<string, JsonValue>;
}): Promise<void> => {
  const { error } = await params.serviceClient.from("memory_jobs").upsert(
    {
      user_id: params.userId,
      chat_id: params.chatId,
      message_id: params.messageId,
      status: "pending",
      attempts: 0,
      max_attempts: 5,
      next_attempt_at: new Date().toISOString(),
      interaction_context: params.interactionContext,
      locked_at: null,
      locked_by: null,
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "chat_id,message_id" },
  );

  if (error) {
    throw new ApiError(
      500,
      "memory_job_enqueue_failed",
      "Could not enqueue memory job",
      error.message,
    );
  }
};

export const processMemoryJobs = async (params: {
  userClient: SupabaseClient;
  serviceClient: SupabaseClient;
  actorUserId: string;
  requestId: string;
  limit: number;
}): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  queue: { pending: number; processing: number; ready: number; failed: number };
}> => {
  const nowIso = new Date().toISOString();
  const staleCutoffIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const lockOwner = `memory-worker:${crypto.randomUUID()}`;

  const staleResult = await params.serviceClient
    .from("memory_jobs")
    .select("id")
    .eq("status", "processing")
    .lt("locked_at", staleCutoffIso)
    .limit(200);

  if (staleResult.error) {
    throw new ApiError(
      500,
      "memory_jobs_stale_fetch_failed",
      "Could not fetch stale memory jobs",
      staleResult.error.message,
    );
  }

  if ((staleResult.data ?? []).length > 0) {
    const staleIds = (staleResult.data ?? []).map((row) => row.id);
    const staleUpdate = await params.serviceClient
      .from("memory_jobs")
      .update({
        status: "pending",
        locked_at: null,
        locked_by: null,
        next_attempt_at: nowIso,
        updated_at: nowIso,
      })
      .in("id", staleIds);

    if (staleUpdate.error) {
      throw new ApiError(
        500,
        "memory_jobs_stale_requeue_failed",
        "Could not requeue stale memory jobs",
        staleUpdate.error.message,
      );
    }
  }

  const dueResult = await params.serviceClient
    .from("memory_jobs")
    .select(
      "id,user_id,chat_id,message_id,attempts,max_attempts,interaction_context",
    )
    .in("status", ["pending", "failed"])
    .lte("next_attempt_at", nowIso)
    .order("next_attempt_at", { ascending: true })
    .limit(Math.min(Math.max(params.limit, 1), 100));

  if (dueResult.error) {
    throw new ApiError(
      500,
      "memory_jobs_due_fetch_failed",
      "Could not fetch due memory jobs",
      dueResult.error.message,
    );
  }

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const row of dueResult.data ?? []) {
    const claim = await params.serviceClient
      .from("memory_jobs")
      .update({
        status: "processing",
        locked_at: nowIso,
        locked_by: lockOwner,
        updated_at: nowIso,
      })
      .eq("id", row.id)
      .in("status", ["pending", "failed"])
      .select("id,user_id,interaction_context,attempts,max_attempts")
      .maybeSingle();

    if (claim.error || !claim.data) {
      continue;
    }

    processed += 1;
    try {
      await updateMemoryFromInteraction({
        userClient: params.userClient,
        serviceClient: params.serviceClient,
        userId: claim.data.user_id,
        requestId: params.requestId,
        interactionContext:
          (claim.data.interaction_context as Record<string, JsonValue>) ?? {},
        mode: "full",
      });

      const readyUpdate = await params.serviceClient
        .from("memory_jobs")
        .update({
          status: "ready",
          locked_at: null,
          locked_by: null,
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", claim.data.id);

      if (readyUpdate.error) {
        throw new ApiError(
          500,
          "memory_job_ready_update_failed",
          "Could not update memory job status",
          readyUpdate.error.message,
        );
      }

      succeeded += 1;
    } catch (error) {
      const attempts = Number(claim.data.attempts ?? 0) + 1;
      const maxAttempts = Number(claim.data.max_attempts ?? 5);
      const terminal = attempts >= maxAttempts;
      const baseDelay = Math.min(60, 2 ** Math.min(attempts, 6)) * 1000;
      const jitter = Math.floor(Math.random() * 1000);
      const nextAttemptAt = new Date(Date.now() + baseDelay + jitter)
        .toISOString();

      const failedUpdate = await params.serviceClient
        .from("memory_jobs")
        .update({
          status: terminal ? "failed" : "pending",
          attempts,
          next_attempt_at: terminal ? new Date().toISOString() : nextAttemptAt,
          locked_at: null,
          locked_by: null,
          last_error: error instanceof Error
            ? error.message.slice(0, 2000)
            : String(error).slice(0, 2000),
          updated_at: new Date().toISOString(),
        })
        .eq("id", claim.data.id);

      if (failedUpdate.error) {
        throw new ApiError(
          500,
          "memory_job_failure_update_failed",
          "Could not update memory job failure",
          failedUpdate.error.message,
        );
      }

      failed += 1;
    }
  }

  const queueRows = await params.serviceClient.from("memory_jobs").select(
    "status",
  );
  if (queueRows.error) {
    throw new ApiError(
      500,
      "memory_jobs_queue_fetch_failed",
      "Could not fetch memory queue summary",
      queueRows.error.message,
    );
  }

  const queue = { pending: 0, processing: 0, ready: 0, failed: 0 };
  for (const row of queueRows.data ?? []) {
    if (row.status === "pending") queue.pending += 1;
    if (row.status === "processing") queue.processing += 1;
    if (row.status === "ready") queue.ready += 1;
    if (row.status === "failed") queue.failed += 1;
  }

  return { processed, succeeded, failed, queue };
};
