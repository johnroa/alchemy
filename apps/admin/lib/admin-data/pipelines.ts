import { getAdminClient } from "@/lib/supabase-admin";
import { isSchemaMissingError } from "./shared";

export const getImagePipelineData = async (): Promise<{
  jobs: Array<{ id: string; image_request_id: string; normalized_title: string | null; status: string; attempt: number; max_attempts: number; next_attempt_at: string; last_error: string | null; updated_at: string }>;
}> => {
  const client = getAdminClient();
  const { data: jobs } = await client
    .from("image_jobs")
    .select("id,image_request_id,status,attempt,max_attempts,next_attempt_at,last_error,updated_at")
    .order("updated_at", { ascending: false })
    .limit(200);

  const requestIds = Array.from(new Set((jobs ?? []).map((job) => String(job.image_request_id ?? ""))).values()).filter(Boolean);
  const { data: requests } = requestIds.length > 0
    ? await client.from("image_requests").select("id,normalized_title").in("id", requestIds)
    : { data: [] as Array<{ id: string; normalized_title: string | null }> };
  const titleByRequestId = new Map((requests ?? []).map((request) => [String(request.id), request.normalized_title ? String(request.normalized_title) : null]));

  return {
    jobs: (jobs ?? []).map((job) => ({
      id: String(job.id),
      image_request_id: String(job.image_request_id),
      normalized_title: titleByRequestId.get(String(job.image_request_id)) ?? null,
      status: String(job.status),
      attempt: Number(job.attempt ?? 0),
      max_attempts: Number(job.max_attempts ?? 0),
      next_attempt_at: String(job.next_attempt_at),
      last_error: job.last_error ? String(job.last_error) : null,
      updated_at: String(job.updated_at),
    }))
  };
};

export const getMetadataPipelineData = async (): Promise<{
  jobs: Array<{
    id: string;
    recipe_id: string;
    recipe_version_id: string;
    recipe_title: string | null;
    status: string;
    attempts: number;
    max_attempts: number;
    next_attempt_at: string;
    last_error: string | null;
    locked_at: string | null;
    locked_by: string | null;
    updated_at: string;
  }>;
}> => {
  const client = getAdminClient();
  const { data: jobs, error: jobsError } = await client
    .from("recipe_metadata_jobs")
    .select("id,recipe_id,recipe_version_id,status,attempts,max_attempts,next_attempt_at,last_error,locked_at,locked_by,updated_at")
    .order("updated_at", { ascending: false })
    .limit(250);

  if (jobsError) {
    if (isSchemaMissingError(jobsError)) {
      return { jobs: [] };
    }
    throw new Error(jobsError.message);
  }

  const recipeIds = Array.from(new Set((jobs ?? []).map((job) => job.recipe_id)));
  const { data: recipes, error: recipesError } =
    recipeIds.length > 0
      ? await client.from("recipes").select("id,title").in("id", recipeIds)
      : { data: [] as Array<{ id: string; title: string }>, error: null };

  if (recipesError && !isSchemaMissingError(recipesError)) {
    throw new Error(recipesError.message);
  }

  const titleByRecipeId = new Map((recipes ?? []).map((recipe) => [recipe.id, recipe.title]));

  return {
    jobs: (jobs ?? []).map((job) => ({
      id: String(job.id),
      recipe_id: String(job.recipe_id),
      recipe_version_id: String(job.recipe_version_id),
      recipe_title: titleByRecipeId.get(String(job.recipe_id)) ?? null,
      status: String(job.status),
      attempts: Number(job.attempts ?? 0),
      max_attempts: Number(job.max_attempts ?? 0),
      next_attempt_at: String(job.next_attempt_at),
      last_error: job.last_error ? String(job.last_error) : null,
      locked_at: job.locked_at ? String(job.locked_at) : null,
      locked_by: job.locked_by ? String(job.locked_by) : null,
      updated_at: String(job.updated_at)
    }))
  };
};
