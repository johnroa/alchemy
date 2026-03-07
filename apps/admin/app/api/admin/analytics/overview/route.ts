import { NextResponse } from "next/server";
import { getAnalyticsOverviewData } from "@/lib/admin-data";
import { requireCloudflareAccess } from "@/lib/supabase-admin";

export async function GET(): Promise<NextResponse> {
  await requireCloudflareAccess();
  return NextResponse.json(await getAnalyticsOverviewData());
}
