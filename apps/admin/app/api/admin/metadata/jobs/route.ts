import { NextResponse } from "next/server";
import { getAdminClient, requireCloudflareAccess } from "@/lib/supabase-admin";

export async function GET(): Promise<NextResponse> {
  await requireCloudflareAccess();
  const client = getAdminClient();

  const { data: jobs, error: jobsError } = await client
    .from("recipe_metadata_jobs")
    .select("id,recipe_id,recipe_version_id,status,attempts,max_attempts,next_attempt_at,last_error,locked_at,locked_by,updated_at")
    .order("updated_at", { ascending: false })
    .limit(250);

  if (jobsError) {
    return NextResponse.json({ error: jobsError.message }, { status: 500 });
  }

  const recipeIds = Array.from(new Set((jobs ?? []).map((job) => job.recipe_id)));
  const { data: recipes, error: recipesError } =
    recipeIds.length > 0
      ? await client.from("recipes").select("id,title").in("id", recipeIds)
      : { data: [] as Array<{ id: string; title: string }>, error: null };

  if (recipesError) {
    return NextResponse.json({ error: recipesError.message }, { status: 500 });
  }

  const titleByRecipeId = new Map((recipes ?? []).map((recipe) => [recipe.id, recipe.title]));

  return NextResponse.json({
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
  });
}
