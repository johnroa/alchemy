import { NextResponse } from "next/server";
import { getAdminClient, requireCloudflareAccess } from "@/lib/supabase-admin";

export async function GET(): Promise<NextResponse> {
  await requireCloudflareAccess();
  const client = getAdminClient();

  const [{ data: snapshots, error: snapshotsError }, { data: memories, error: memoriesError }] = await Promise.all([
    client.from("memory_snapshots").select("id,user_id,token_estimate,updated_at").order("updated_at", { ascending: false }).limit(200),
    client
      .from("memories")
      .select("id,user_id,memory_type,memory_kind,status,confidence,salience,updated_at")
      .order("updated_at", { ascending: false })
      .limit(300)
  ]);

  if (snapshotsError || memoriesError) {
    return NextResponse.json({ error: snapshotsError?.message ?? memoriesError?.message ?? "Unknown error" }, { status: 500 });
  }

  return NextResponse.json({ snapshots: snapshots ?? [], memories: memories ?? [] });
}
