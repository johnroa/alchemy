import { getAdminClient } from "@/lib/supabase-admin";
import { isSchemaMissingError } from "./shared";

export const getMemoryData = async (): Promise<{
  snapshots: Array<{ user_id: string; email: string | null; token_estimate: number; updated_at: string }>;
  memories: Array<{ id: string; user_id: string; email: string | null; memory_type: string; memory_kind: string; status: string; confidence: number; salience: number; content: string | null; updated_at: string }>;
  jobs: Array<{
    id: string;
    user_id: string;
    user_email: string | null;
    chat_id: string;
    message_id: string;
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

  const [{ data: snapshots }, { data: memoriesRaw }, { data: jobsRaw, error: jobsError }] = await Promise.all([
    client.from("memory_snapshots").select("user_id,token_estimate,updated_at").order("updated_at", { ascending: false }).limit(100),
    client
      .from("memories")
      .select("id,user_id,memory_type,memory_kind,status,confidence,salience,content,updated_at")
      .order("updated_at", { ascending: false })
      .limit(150),
    client
      .from("memory_jobs")
      .select("id,user_id,chat_id,message_id,status,attempts,max_attempts,next_attempt_at,last_error,locked_at,locked_by,updated_at")
      .order("updated_at", { ascending: false })
      .limit(300)
  ]);

  if (jobsError && !isSchemaMissingError(jobsError)) {
    throw new Error(jobsError.message);
  }

  const userIds = Array.from(
    new Set([
      ...(snapshots ?? []).map((snapshot) => snapshot.user_id as string),
      ...(memoriesRaw ?? []).map((memory) => memory.user_id as string),
      ...((jobsRaw ?? []) as Array<{ user_id: string }>).map((job) => job.user_id)
    ])
  );

  const { data: users } =
    userIds.length > 0
      ? await client.from("users").select("id,email").in("id", userIds)
      : { data: [] as Array<{ id: string; email: string | null }> };

  const emailById = new Map((users ?? []).map((user) => [user.id, user.email as string | null]));

  return {
    snapshots: (snapshots ?? []).map((snapshot) => ({
      user_id: String(snapshot.user_id),
      email: emailById.get(String(snapshot.user_id)) ?? null,
      token_estimate: Number(snapshot.token_estimate ?? 0),
      updated_at: String(snapshot.updated_at)
    })),
    memories: (memoriesRaw ?? []).map((memory) => ({
      id: String(memory.id),
      user_id: String(memory.user_id),
      email: emailById.get(String(memory.user_id)) ?? null,
      memory_type: String(memory.memory_type ?? ""),
      memory_kind: String(memory.memory_kind ?? ""),
      status: String(memory.status ?? ""),
      confidence: Number(memory.confidence ?? 0),
      salience: Number(memory.salience ?? 0),
      content: memory.content ? String(memory.content) : null,
      updated_at: String(memory.updated_at)
    })),
    jobs: (jobsRaw ?? []).map((job) => ({
      id: String(job.id),
      user_id: String(job.user_id),
      user_email: emailById.get(String(job.user_id)) ?? null,
      chat_id: String(job.chat_id),
      message_id: String(job.message_id),
      status: String(job.status ?? "pending"),
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
