import { NextResponse } from "next/server";
import { getAdminClient, requireCloudflareAccess } from "@/lib/supabase-admin";

type Body = {
  user_id: string;
};

export async function POST(request: Request): Promise<NextResponse> {
  await requireCloudflareAccess();
  const body = (await request.json()) as Body;

  if (!body.user_id) {
    return NextResponse.json({ error: "user_id is required" }, { status: 400 });
  }

  const client = getAdminClient();

  const { error: snapshotError } = await client.from("memory_snapshots").upsert({
    user_id: body.user_id,
    summary: {
      status: "rebuild_pending",
      requested_at: new Date().toISOString()
    },
    token_estimate: 0,
    updated_at: new Date().toISOString()
  });

  if (snapshotError) {
    return NextResponse.json({ error: snapshotError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
