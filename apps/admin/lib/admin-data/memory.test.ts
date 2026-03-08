import { describe, expect, it } from "vitest";
import { buildMemoryOperationsViewModel } from "./memory";

describe("buildMemoryOperationsViewModel", () => {
  it("uses exact queue and retrieval counts while preserving per-user repair signals", () => {
    const result = buildMemoryOperationsViewModel({
      snapshots: [
        {
          user_id: "user-1",
          token_estimate: 420,
          updated_at: "2026-03-07T12:00:00.000Z",
        },
      ],
      memories: [
        {
          id: "memory-1",
          user_id: "user-1",
          memory_type: "dietary",
          memory_kind: "preference",
          status: "active",
          confidence: 0.9,
          salience: 0.8,
          memory_content: { likes: ["lemon"] },
          updated_at: "2026-03-07T12:01:00.000Z",
        },
        {
          id: "memory-2",
          user_id: "user-1",
          memory_type: "equipment",
          memory_kind: "preference",
          status: "active",
          confidence: 0.7,
          salience: 0.6,
          memory_content: { owns: ["air fryer"] },
          updated_at: "2026-03-07T12:02:00.000Z",
        },
        {
          id: "memory-3",
          user_id: "user-2",
          memory_type: "skill",
          memory_kind: "profile",
          status: "active",
          confidence: 0.6,
          salience: 0.5,
          memory_content: { level: "intermediate" },
          updated_at: "2026-03-07T12:03:00.000Z",
        },
      ],
      jobs: [
        {
          id: "job-1",
          user_id: "user-1",
          chat_id: "chat-1",
          message_id: "message-1",
          status: "pending",
          attempts: 0,
          max_attempts: 5,
          next_attempt_at: "2026-03-07T12:04:00.000Z",
          last_error: null,
          locked_at: null,
          locked_by: null,
          updated_at: "2026-03-07T12:04:00.000Z",
        },
        {
          id: "job-2",
          user_id: "user-2",
          chat_id: "chat-2",
          message_id: "message-2",
          status: "failed",
          attempts: 3,
          max_attempts: 5,
          next_attempt_at: "2026-03-07T12:05:00.000Z",
          last_error: "timeout",
          locked_at: null,
          locked_by: null,
          updated_at: "2026-03-07T12:05:00.000Z",
        },
      ],
      searchDocs: [
        {
          memory_id: "memory-1",
          user_id: "user-1",
          indexed_at: "2026-03-07T12:06:00.000Z",
          updated_at: "2026-03-07T12:06:00.000Z",
        },
        {
          memory_id: "memory-3",
          user_id: "user-2",
          indexed_at: "2026-03-07T12:07:00.000Z",
          updated_at: "2026-03-07T12:07:00.000Z",
        },
      ],
      changelog: [
        {
          action: "backfill",
          created_at: "2026-03-07T12:08:00.000Z",
        },
      ],
      users: [
        { id: "user-1", email: "one@alchemy.test" },
        { id: "user-2", email: "two@alchemy.test" },
      ],
      counts: {
        pending: 7,
        processing: 2,
        ready: 19,
        failed: 4,
        staleLockedJobs: 3,
        activeMemoryCount: 25,
        indexedDocumentCount: 20,
      },
      oldestDueJobAt: "2026-03-07T11:59:00.000Z",
    });

    expect(result.summary.queue.pending).toBe(7);
    expect(result.summary.queue.processing).toBe(2);
    expect(result.summary.queue.ready).toBe(19);
    expect(result.summary.queue.failed).toBe(4);
    expect(result.summary.queue.stale_locked_jobs).toBe(3);
    expect(result.summary.queue.oldest_due_job_at).toBe("2026-03-07T11:59:00.000Z");

    expect(result.summary.retrieval.active_memory_count).toBe(25);
    expect(result.summary.retrieval.indexed_document_count).toBe(20);
    expect(result.summary.retrieval.missing_document_count).toBe(5);
    expect(result.summary.retrieval.coverage_percent).toBe(80);
    expect(result.summary.retrieval.affected_user_count).toBe(1);
    expect(result.summary.retrieval.last_reindex_at).toBe("2026-03-07T12:08:00.000Z");

    expect(result.users[0]?.user_id).toBe("user-1");
    expect(result.users[0]?.missing_document_count).toBe(1);
    expect(result.memories.find((memory) => memory.id === "memory-2")?.retrieval_status).toBe("missing");
    expect(result.memories.find((memory) => memory.id === "memory-1")?.retrieval_status).toBe("indexed");
  });
});
