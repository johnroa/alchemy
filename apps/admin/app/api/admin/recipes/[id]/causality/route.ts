import { NextResponse } from "next/server";
import { getAdminClient, requireCloudflareAccess } from "@/lib/supabase-admin";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  await requireCloudflareAccess();
  const { id } = await context.params;
  const client = getAdminClient();

  const [{ data: versions, error: versionsError }, { data: links, error: linksError }] = await Promise.all([
    client
      .from("recipe_versions")
      .select("id,parent_version_id,diff_summary,created_at")
      .eq("recipe_id", id)
      .order("created_at", { ascending: true }),
    client
      .from("recipe_links")
      .select("id,parent_recipe_id,child_recipe_id,relation_type_id,position,updated_at")
      .eq("parent_recipe_id", id)
      .order("position", { ascending: true })
  ]);

  if (versionsError || linksError) {
    return NextResponse.json({ error: versionsError?.message ?? linksError?.message ?? "Unknown error" }, { status: 500 });
  }

  const versionIds = (versions ?? []).map((version) => version.id);
  let versionEvents: Array<Record<string, unknown>> = [];

  if (versionIds.length > 0) {
    const { data, error } = await client
      .from("recipe_version_events")
      .select("id,recipe_version_id,event_type,request_id,metadata,created_at")
      .in("recipe_version_id", versionIds)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    versionEvents = (data ?? []) as Array<Record<string, unknown>>;
  }

  return NextResponse.json({ versions: versions ?? [], version_events: versionEvents, links: links ?? [] });
}
