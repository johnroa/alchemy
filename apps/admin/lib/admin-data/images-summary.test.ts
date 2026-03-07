import { describe, expect, it } from "vitest";
import { buildImagesOverview } from "./images-summary";

describe("buildImagesOverview", () => {
  it("computes pipeline and binding rollups", () => {
  const overview = buildImagesOverview({
    requests: [
      {
        id: "req-1",
        status: "ready",
        resolution_source: "generated",
        created_at: "2026-03-06T12:00:00.000Z",
        updated_at: "2026-03-06T12:00:10.000Z",
      },
      {
        id: "req-2",
        status: "ready",
        resolution_source: "reused",
        created_at: "2026-03-06T12:01:00.000Z",
        updated_at: "2026-03-06T12:01:04.000Z",
      },
      {
        id: "req-3",
        status: "processing",
        resolution_source: null,
        created_at: "2026-03-06T12:02:00.000Z",
        updated_at: "2026-03-06T12:02:03.000Z",
      },
      {
        id: "req-4",
        status: "failed",
        resolution_source: null,
        created_at: "2026-03-06T12:03:00.000Z",
        updated_at: "2026-03-06T12:03:02.000Z",
      },
    ],
    candidateBindings: [
      { image_request_id: "req-1" },
      { image_request_id: "req-2" },
      { image_request_id: "req-3" },
    ],
    assignments: [
      { image_request_id: "req-1" },
      { image_request_id: "req-4" },
    ],
  });

    expect(overview.pendingCount).toBe(0);
    expect(overview.processingCount).toBe(1);
    expect(overview.readyCount).toBe(2);
    expect(overview.failedCount).toBe(1);
    expect(overview.generatedCount).toBe(1);
    expect(overview.reusedCount).toBe(1);
    expect(overview.candidateBoundCount).toBe(3);
    expect(overview.persistedBoundCount).toBe(2);
    expect(overview.sharedCount).toBe(1);
    expect(overview.candidateOnlyCount).toBe(2);
    expect(overview.persistedOnlyCount).toBe(1);
    expect(overview.avgReadyLatencyMs).toBe(7_000);
    expect(overview.failureRate).toBe(0.25);
  });
});
