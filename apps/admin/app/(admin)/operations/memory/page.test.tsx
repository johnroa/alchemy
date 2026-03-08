import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MemoryPage from "./page";

const { getMemoryData } = vi.hoisted(() => ({
  getMemoryData: vi.fn(),
}));

vi.mock("@/lib/admin-data", () => ({
  getMemoryData,
}));

vi.mock("@/components/admin/memory-jobs-table", () => ({
  MemoryJobsTable: () => <div data-testid="memory-jobs-table" />,
}));

vi.mock("@/components/admin/memory-actions", () => ({
  MemoryActions: () => <div data-testid="memory-actions" />,
}));

vi.mock("@/components/admin/memory-pipeline-controls", () => ({
  MemoryPipelineControls: () => <div data-testid="memory-pipeline-controls">controls</div>,
}));

describe("MemoryPage", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    getMemoryData.mockResolvedValue({
      summary: {
        queue: {
          pending: 11,
          processing: 2,
          ready: 9,
          failed: 3,
          oldest_due_job_at: "2026-03-07T12:00:00.000Z",
          stale_locked_jobs: 1,
          recent_activity: [{ label: "12 PM", processed: 4, failed: 1 }],
        },
        retrieval: {
          active_memory_count: 42,
          indexed_document_count: 39,
          missing_document_count: 3,
          coverage_percent: 92.86,
          affected_user_count: 2,
          last_reindex_at: "2026-03-07T12:05:00.000Z",
        },
      },
      users: [
        {
          user_id: "user-1",
          email: "one@alchemy.test",
          active_memory_count: 10,
          indexed_document_count: 9,
          missing_document_count: 1,
          snapshot_token_estimate: 420,
          snapshot_updated_at: "2026-03-07T12:01:00.000Z",
          pending_job_count: 2,
          failed_job_count: 1,
        },
      ],
      snapshots: [],
      memories: [
        {
          id: "memory-1",
          user_id: "user-1",
          email: "one@alchemy.test",
          memory_type: "dietary",
          memory_kind: "preference",
          status: "active",
          confidence: 0.9,
          salience: 0.8,
          content: "{\"likes\":[\"lemon\"]}",
          retrieval_indexed_at: "2026-03-07T12:03:00.000Z",
          retrieval_status: "indexed",
          updated_at: "2026-03-07T12:03:00.000Z",
        },
      ],
      jobs: [],
    });
  });

  it("renders memory operations KPIs and repair sections", async () => {
    render(await MemoryPage());

    expect(screen.getByText("Memory")).toBeInTheDocument();
    expect(screen.getByText("Queue Health")).toBeInTheDocument();
    expect(screen.getByText("Retrieval Coverage")).toBeInTheDocument();
    expect(screen.getByText("Per-User Health")).toBeInTheDocument();
    expect(screen.getByText("Memory Records")).toBeInTheDocument();
    expect(screen.getAllByText("11").length).toBeGreaterThan(0);
    expect(screen.getByText("Indexed Retrieval Docs")).toBeInTheDocument();
    expect(screen.getAllByText("one@alchemy.test").length).toBeGreaterThan(0);
    expect(screen.getByTestId("memory-pipeline-controls")).toBeInTheDocument();
    expect(screen.getByTestId("memory-jobs-table")).toBeInTheDocument();
    expect(screen.getByTestId("memory-actions")).toBeInTheDocument();
  });
});
