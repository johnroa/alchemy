import { NextResponse } from "next/server";
import { getDemandObservationsData } from "@/lib/admin-data";
import { requireCloudflareAccess } from "@/lib/supabase-admin";

export async function GET(request: Request): Promise<NextResponse> {
  await requireCloudflareAccess();

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 25);
  const stage = url.searchParams.get("stage") ?? undefined;
  const reviewStatus = url.searchParams.get("review_status");
  const sampledOnly = url.searchParams.get("sampled_only") === "true";
  const params: Parameters<typeof getDemandObservationsData>[0] = {
    limit,
    sampledOnly,
  };

  if (stage) {
    params.stage = stage;
  }
  if (reviewStatus === "pending" || reviewStatus === "confirmed" || reviewStatus === "rejected") {
    params.reviewStatus = reviewStatus;
  }

  return NextResponse.json(await getDemandObservationsData(params));
}
