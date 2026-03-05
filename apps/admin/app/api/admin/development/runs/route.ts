import { NextResponse } from "next/server";
import { getAdminClient, requireCloudflareAccess } from "@/lib/supabase-admin";

type Query = {
  limit: number;
  status: string | null;
  operationKey: string | null;
};

const parseQuery = (request: Request): Query => {
  const { searchParams } = new URL(request.url);
  const rawLimit = Number(searchParams.get("limit"));
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, rawLimit)) : 50;
  const status = searchParams.get("status");
  const operationKey = searchParams.get("operation_key");
  return {
    limit,
    status: typeof status === "string" && status.trim().length > 0 ? status.trim().toLowerCase() : null,
    operationKey:
      typeof operationKey === "string" && operationKey.trim().length > 0
        ? operationKey.trim().toLowerCase()
        : null,
  };
};

export async function GET(request: Request): Promise<NextResponse> {
  await requireCloudflareAccess();
  const query = parseQuery(request);
  const client = getAdminClient();

  let builder = client
    .from("development_operation_runs")
    .select(
      "id,operation_key,status,requested_by_email,request_payload,preview_counts,result_counts,error,created_at,updated_at,completed_at",
    )
    .order("created_at", { ascending: false })
    .limit(query.limit);

  if (query.status) {
    builder = builder.eq("status", query.status);
  }
  if (query.operationKey) {
    builder = builder.eq("operation_key", query.operationKey);
  }

  const { data, error } = await builder;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    runs: data ?? [],
  });
}
