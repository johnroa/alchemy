import { NextResponse } from "next/server";
import { parseAnalyticsQueryState, PIPELINE_ANALYTICS_QUERY } from "@/lib/admin-analytics";
import { getPipelineAnalyticsData } from "@/lib/admin-data";
import { requireCloudflareAccess } from "@/lib/supabase-admin";

export async function GET(request: Request): Promise<NextResponse> {
  await requireCloudflareAccess();

  const url = new URL(request.url);
  const query = parseAnalyticsQueryState(Object.fromEntries(url.searchParams.entries()), PIPELINE_ANALYTICS_QUERY);

  return NextResponse.json(await getPipelineAnalyticsData(query));
}
