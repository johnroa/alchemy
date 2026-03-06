export type ImageSummaryRequestRow = {
  id: string;
  status: string;
  resolution_source: string | null;
  created_at: string;
  updated_at: string;
};

export type ImageSummaryLinkRow = {
  image_request_id: string;
};

const asMillis = (value: string): number | null => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const buildImagesOverview = (params: {
  requests: ImageSummaryRequestRow[];
  candidateBindings: ImageSummaryLinkRow[];
  assignments: ImageSummaryLinkRow[];
}): {
  pendingCount: number;
  processingCount: number;
  readyCount: number;
  failedCount: number;
  totalCount: number;
  generatedCount: number;
  reusedCount: number;
  candidateBoundCount: number;
  persistedBoundCount: number;
  candidateOnlyCount: number;
  persistedOnlyCount: number;
  sharedCount: number;
  avgReadyLatencyMs: number | null;
  failureRate: number;
} => {
  const pendingCount = params.requests.filter((request) => request.status === "pending").length;
  const processingCount = params.requests.filter((request) => request.status === "processing").length;
  const readyCount = params.requests.filter((request) => request.status === "ready").length;
  const failedCount = params.requests.filter((request) => request.status === "failed").length;
  const totalCount = params.requests.length;
  const generatedCount = params.requests.filter((request) => request.resolution_source === "generated").length;
  const reusedCount = params.requests.filter((request) => request.resolution_source === "reused").length;

  const candidateRequestIds = new Set(params.candidateBindings.map((binding) => binding.image_request_id));
  const persistedRequestIds = new Set(params.assignments.map((assignment) => assignment.image_request_id));
  const sharedCount = [...candidateRequestIds].filter((requestId) => persistedRequestIds.has(requestId)).length;
  const candidateOnlyCount = [...candidateRequestIds].filter((requestId) => !persistedRequestIds.has(requestId)).length;
  const persistedOnlyCount = [...persistedRequestIds].filter((requestId) => !candidateRequestIds.has(requestId)).length;

  const readyLatencies = params.requests.flatMap((request) => {
    if (request.status !== "ready") {
      return [];
    }
    const createdAt = asMillis(request.created_at);
    const updatedAt = asMillis(request.updated_at);
    if (createdAt === null || updatedAt === null || updatedAt < createdAt) {
      return [];
    }
    return [updatedAt - createdAt];
  });
  const avgReadyLatencyMs = readyLatencies.length > 0
    ? Math.round(readyLatencies.reduce((sum, latency) => sum + latency, 0) / readyLatencies.length)
    : null;

  return {
    pendingCount,
    processingCount,
    readyCount,
    failedCount,
    totalCount,
    generatedCount,
    reusedCount,
    candidateBoundCount: candidateRequestIds.size,
    persistedBoundCount: persistedRequestIds.size,
    candidateOnlyCount,
    persistedOnlyCount,
    sharedCount,
    avgReadyLatencyMs,
    failureRate: totalCount > 0 ? failedCount / totalCount : 0,
  };
};
