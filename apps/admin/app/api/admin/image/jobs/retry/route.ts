import { NextResponse } from "next/server";
import { getAdminClient, requireCloudflareAccess } from "@/lib/supabase-admin";

type Body = {
  job_id: string;
};

export async function POST(request: Request): Promise<NextResponse> {
  await requireCloudflareAccess();
  const body = (await request.json()) as Body;

  if (!body.job_id) {
    return NextResponse.json({ error: "job_id is required" }, { status: 400 });
  }

  const client = getAdminClient();
  const { error } = await client
    .from("image_jobs")
    .update({ status: "pending", next_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", body.job_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
