import { NextResponse } from "next/server";
import { getAdminClient, requireCloudflareAccess } from "@/lib/supabase-admin";

export async function GET(): Promise<NextResponse> {
  await requireCloudflareAccess();
  const client = getAdminClient();

  const { data, error } = await client
    .from("recipe_image_jobs")
    .select("id,recipe_id,status,attempt,max_attempts,next_attempt_at,last_error,updated_at")
    .order("updated_at", { ascending: false })
    .limit(250);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ jobs: data ?? [] });
}
