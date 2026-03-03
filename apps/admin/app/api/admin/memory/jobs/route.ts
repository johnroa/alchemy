import { NextResponse } from "next/server";
import { getAdminClient, requireCloudflareAccess } from "@/lib/supabase-admin";

export async function GET(): Promise<NextResponse> {
  await requireCloudflareAccess();
  const client = getAdminClient();

  const { data: jobs, error: jobsError } = await client
    .from("memory_jobs")
    .select("id,user_id,chat_id,message_id,status,attempts,max_attempts,next_attempt_at,last_error,locked_at,locked_by,updated_at")
    .order("updated_at", { ascending: false })
    .limit(300);

  if (jobsError) {
    return NextResponse.json({ error: jobsError.message }, { status: 500 });
  }

  const userIds = Array.from(new Set((jobs ?? []).map((job) => String(job.user_id))));
  const { data: users, error: usersError } =
    userIds.length > 0
      ? await client.from("users").select("id,email").in("id", userIds)
      : { data: [] as Array<{ id: string; email: string | null }>, error: null };

  if (usersError) {
    return NextResponse.json({ error: usersError.message }, { status: 500 });
  }

  const emailByUserId = new Map((users ?? []).map((user) => [String(user.id), user.email]));

  return NextResponse.json({
    jobs: (jobs ?? []).map((job) => ({
      id: String(job.id),
      user_id: String(job.user_id),
      user_email: emailByUserId.get(String(job.user_id)) ?? null,
      chat_id: String(job.chat_id),
      message_id: String(job.message_id),
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
