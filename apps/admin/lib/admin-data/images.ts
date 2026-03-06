import { getAdminClient, toRecord } from "@/lib/supabase-admin";
import { buildImagesOverview } from "./images-summary";
import { isSchemaMissingError } from "./shared";

type ImageRequestRow = {
  id: string;
  normalized_title: string;
  status: string;
  resolution_source: string | null;
  asset_id: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  reuse_evaluation: Record<string, unknown>;
};

type ImageJobRow = {
  id: string;
  image_request_id: string;
  status: string;
  attempt: number;
  max_attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  updated_at: string;
};

type ImageAssetRow = {
  id: string;
  image_url: string;
  source_provider: string;
  source_model: string;
  source_recipe_id: string | null;
  source_recipe_version_id: string | null;
  qa_status: string;
  usage_count: number;
  created_at: string;
};

export const getImagesDashboardData = async (): Promise<{
  overview: ReturnType<typeof buildImagesOverview>;
  requests: Array<ImageRequestRow & { candidate_binding_count: number; persisted_assignment_count: number }>;
  jobs: Array<ImageJobRow & { normalized_title: string | null }>;
  assets: Array<ImageAssetRow & { latest_request: ImageRequestRow | null }>;
  routes: {
    image: { provider: string; model: string } | null;
    judge: { provider: string; model: string } | null;
    reuse: { provider: string; model: string } | null;
  };
  registryModels: Array<{
    id: string;
    provider: string;
    model: string;
    display_name: string;
    billing_mode: "token" | "image";
  }>;
  recentSimulationEvents: Array<{
    created_at: string;
    request_id: string | null;
    event_type: string;
    event_payload: Record<string, unknown>;
  }>;
}> => {
  const client = getAdminClient();

  const [
    { data: requestRows, error: requestsError },
    { data: jobRows, error: jobsError },
    { data: assetRows, error: assetsError },
    { data: candidateBindings, error: candidateBindingsError },
    { data: assignments, error: assignmentsError },
    { data: routes },
    { data: registryModels },
    { data: simulationEvents },
  ] = await Promise.all([
    client
      .from("image_requests")
      .select("id,normalized_title,status,resolution_source,asset_id,last_error,created_at,updated_at,reuse_evaluation")
      .order("updated_at", { ascending: false })
      .limit(200),
    client
      .from("image_jobs")
      .select("id,image_request_id,status,attempt,max_attempts,next_attempt_at,last_error,updated_at")
      .order("updated_at", { ascending: false })
      .limit(200),
    client
      .from("recipe_image_assets")
      .select("id,image_url,source_provider,source_model,source_recipe_id,source_recipe_version_id,qa_status,usage_count,created_at")
      .order("created_at", { ascending: false })
      .limit(120),
    client.from("candidate_image_bindings").select("image_request_id"),
    client.from("recipe_image_assignments").select("image_request_id"),
    client
      .from("llm_model_routes")
      .select("scope,provider,model,is_active")
      .in("scope", ["image", "image_quality_eval", "image_reuse_eval"])
      .eq("is_active", true),
    client
      .from("llm_model_registry")
      .select("id,provider,model,display_name,billing_mode")
      .eq("is_available", true)
      .eq("billing_mode", "image")
      .order("provider")
      .order("display_name"),
    client
      .from("events")
      .select("created_at,request_id,event_type,event_payload")
      .in("event_type", ["simulation_run_started", "simulation_run_completed", "simulation_run_failed"])
      .order("created_at", { ascending: false })
      .limit(40),
  ]);

  if (requestsError && !isSchemaMissingError(requestsError)) {
    throw new Error(requestsError.message);
  }
  if (jobsError && !isSchemaMissingError(jobsError)) {
    throw new Error(jobsError.message);
  }
  if (assetsError && !isSchemaMissingError(assetsError)) {
    throw new Error(assetsError.message);
  }
  if (candidateBindingsError && !isSchemaMissingError(candidateBindingsError)) {
    throw new Error(candidateBindingsError.message);
  }
  if (assignmentsError && !isSchemaMissingError(assignmentsError)) {
    throw new Error(assignmentsError.message);
  }

  const requests = (requestRows ?? []).map((row) => ({
    id: String(row.id),
    normalized_title: String(row.normalized_title ?? ""),
    status: String(row.status ?? "pending"),
    resolution_source: row.resolution_source ? String(row.resolution_source) : null,
    asset_id: row.asset_id ? String(row.asset_id) : null,
    last_error: row.last_error ? String(row.last_error) : null,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
    reuse_evaluation: toRecord(row.reuse_evaluation as never) as Record<string, unknown>,
  }));

  const candidateBindingCountByRequest = new Map<string, number>();
  for (const binding of candidateBindings ?? []) {
    const requestId = String(binding.image_request_id ?? "");
    if (!requestId) continue;
    candidateBindingCountByRequest.set(requestId, (candidateBindingCountByRequest.get(requestId) ?? 0) + 1);
  }

  const assignmentCountByRequest = new Map<string, number>();
  for (const assignment of assignments ?? []) {
    const requestId = String(assignment.image_request_id ?? "");
    if (!requestId) continue;
    assignmentCountByRequest.set(requestId, (assignmentCountByRequest.get(requestId) ?? 0) + 1);
  }

  const requestById = new Map(requests.map((request) => [request.id, request]));
  const jobs = (jobRows ?? []).map((job) => ({
    id: String(job.id),
    image_request_id: String(job.image_request_id),
    normalized_title: requestById.get(String(job.image_request_id))?.normalized_title ?? null,
    status: String(job.status ?? "pending"),
    attempt: Number(job.attempt ?? 0),
    max_attempts: Number(job.max_attempts ?? 0),
    next_attempt_at: String(job.next_attempt_at ?? ""),
    last_error: job.last_error ? String(job.last_error) : null,
    updated_at: String(job.updated_at ?? ""),
  }));

  const assets = (assetRows ?? []).map((asset) => {
    const latestRequest = requests.find((request) => request.asset_id === String(asset.id)) ?? null;
    return {
      id: String(asset.id),
      image_url: String(asset.image_url ?? ""),
      source_provider: String(asset.source_provider ?? ""),
      source_model: String(asset.source_model ?? ""),
      source_recipe_id: asset.source_recipe_id ? String(asset.source_recipe_id) : null,
      source_recipe_version_id: asset.source_recipe_version_id ? String(asset.source_recipe_version_id) : null,
      qa_status: String(asset.qa_status ?? "unreviewed"),
      usage_count: Number(asset.usage_count ?? 0),
      created_at: String(asset.created_at ?? ""),
      latest_request: latestRequest,
    };
  });

  const overview = buildImagesOverview({
    requests,
    candidateBindings: (candidateBindings ?? []).map((binding) => ({
      image_request_id: String(binding.image_request_id ?? ""),
    })),
    assignments: (assignments ?? []).map((assignment) => ({
      image_request_id: String(assignment.image_request_id ?? ""),
    })),
  });

  const activeImageRoute = (routes ?? []).find((route) => route.scope === "image");
  const activeJudgeRoute = (routes ?? []).find((route) => route.scope === "image_quality_eval");
  const activeReuseRoute = (routes ?? []).find((route) => route.scope === "image_reuse_eval");

  return {
    overview,
    requests: requests.map((request) => ({
      ...request,
      candidate_binding_count: candidateBindingCountByRequest.get(request.id) ?? 0,
      persisted_assignment_count: assignmentCountByRequest.get(request.id) ?? 0,
    })),
    jobs,
    assets,
    routes: {
      image: activeImageRoute
        ? { provider: String(activeImageRoute.provider ?? ""), model: String(activeImageRoute.model ?? "") }
        : null,
      judge: activeJudgeRoute
        ? { provider: String(activeJudgeRoute.provider ?? ""), model: String(activeJudgeRoute.model ?? "") }
        : null,
      reuse: activeReuseRoute
        ? { provider: String(activeReuseRoute.provider ?? ""), model: String(activeReuseRoute.model ?? "") }
        : null,
    },
    registryModels: (registryModels ?? []).map((row) => ({
      id: String(row.id ?? ""),
      provider: String(row.provider ?? ""),
      model: String(row.model ?? ""),
      display_name: String(row.display_name ?? ""),
      billing_mode: row.billing_mode === "image" ? "image" : "token",
    })),
    recentSimulationEvents: (simulationEvents ?? []).map((event) => ({
      created_at: String(event.created_at ?? ""),
      request_id: event.request_id ? String(event.request_id) : null,
      event_type: String(event.event_type ?? ""),
      event_payload: toRecord(event.event_payload as never) as Record<string, unknown>,
    })),
  };
};
