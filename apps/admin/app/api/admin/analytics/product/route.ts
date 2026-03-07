import { NextResponse } from "next/server";
import { DEFAULT_ANALYTICS_QUERY, parseAnalyticsQueryState } from "@/lib/admin-analytics";
import { getProductAnalyticsData } from "@/lib/admin-data";
import { requireCloudflareAccess } from "@/lib/supabase-admin";

export async function GET(request: Request): Promise<NextResponse> {
  await requireCloudflareAccess();

  const url = new URL(request.url);
  const query = parseAnalyticsQueryState(Object.fromEntries(url.searchParams.entries()), DEFAULT_ANALYTICS_QUERY);

  return NextResponse.json(await getProductAnalyticsData(query));
}
