import { NextResponse } from "next/server";
import { getAdminClient, requireCloudflareAccess } from "@/lib/supabase-admin";

export async function GET(
  _request: Request,
  context: { params: Promise<{ requestId: string }> }
): Promise<NextResponse> {
  await requireCloudflareAccess();
  const { requestId } = await context.params;
  const client = getAdminClient();

  const [{ data: events, error: eventsError }, { data: changes, error: changesError }] = await Promise.all([
    client
      .from("events")
      .select("id,event_type,event_payload,latency_ms,safety_state,created_at")
      .eq("request_id", requestId)
      .order("created_at", { ascending: true }),
    client
      .from("changelog_events")
      .select("id,scope,entity_type,entity_id,action,before_json,after_json,created_at")
      .eq("request_id", requestId)
      .order("created_at", { ascending: true })
  ]);

  if (eventsError || changesError) {
    return NextResponse.json({ error: eventsError?.message ?? changesError?.message ?? "Unknown error" }, { status: 500 });
  }

  return NextResponse.json({ events: events ?? [], changes: changes ?? [] });
}
