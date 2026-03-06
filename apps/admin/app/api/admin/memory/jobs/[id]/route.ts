import { NextResponse } from "next/server";
import { getAdminClient, requireCloudflareAccess } from "@/lib/supabase-admin";

const toObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
};

export async function GET(
  _: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  await requireCloudflareAccess();
  const client = getAdminClient();
  const { id } = await context.params;

  const { data, error } = await client
    .from("memory_jobs")
    .select("id,interaction_context,metadata")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Memory job not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: String(data.id),
    interaction_context: toObject(data.interaction_context),
    metadata: toObject(data.metadata)
  });
}
