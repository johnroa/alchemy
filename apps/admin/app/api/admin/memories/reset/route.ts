import { NextResponse } from "next/server";
import { getAdminClient, requireCloudflareAccess } from "@/lib/supabase-admin";

type Body = {
  user_id: string;
};

export async function POST(request: Request): Promise<NextResponse> {
  await requireCloudflareAccess();
  const body = (await request.json().catch(() => ({}))) as Body;

  if (!body.user_id) {
    return NextResponse.json({ error: "user_id is required" }, { status: 400 });
  }

  const client = getAdminClient();
  const now = new Date().toISOString();

  const { error: memoryError } = await client
    .from("memories")
    .update({ status: "deleted", updated_at: now })
    .eq("user_id", body.user_id)
    .neq("status", "deleted");

  if (memoryError) {
    return NextResponse.json({ error: memoryError.message }, { status: 500 });
  }

  const { error: snapshotError } = await client.from("memory_snapshots").upsert({
    user_id: body.user_id,
    summary: {},
    token_estimate: 0,
    updated_at: now
  });

  if (snapshotError) {
    return NextResponse.json({ error: snapshotError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

