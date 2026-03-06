/// <reference lib="deno.ns" />
import { buildImagesOverview } from "./images-summary.ts";

Deno.test("buildImagesOverview computes pipeline and binding rollups", () => {
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

  if (overview.pendingCount !== 0) {
    throw new Error("expected no pending requests");
  }
  if (overview.processingCount !== 1 || overview.readyCount !== 2 || overview.failedCount !== 1) {
    throw new Error("expected status counts");
  }
  if (overview.generatedCount !== 1 || overview.reusedCount !== 1) {
    throw new Error("expected resolution source counts");
  }
  if (overview.candidateBoundCount !== 3 || overview.persistedBoundCount !== 2) {
    throw new Error("expected bound request counts");
  }
  if (overview.sharedCount !== 1 || overview.candidateOnlyCount !== 2 || overview.persistedOnlyCount !== 1) {
    throw new Error("expected request overlap counts");
  }
  if (overview.avgReadyLatencyMs !== 7_000) {
    throw new Error("expected average ready latency");
  }
  if (overview.failureRate !== 0.25) {
    throw new Error("expected failure rate");
  }
});
