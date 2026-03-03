import { NextResponse } from "next/server";
import { getAdminClient, requireCloudflareAccess } from "@/lib/supabase-admin";

export async function GET(): Promise<NextResponse> {
  await requireCloudflareAccess();
  const client = getAdminClient();

  const { data, error } = await client
    .from("v_changelog_recent")
    .select("id,created_at,scope,entity_type,entity_id,action,request_id,actor_email")
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ items: data ?? [] });
}
