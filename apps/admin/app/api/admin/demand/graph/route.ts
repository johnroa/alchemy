import { NextResponse } from "next/server";
import { getDemandGraphData } from "@/lib/admin-data";
import { requireCloudflareAccess } from "@/lib/supabase-admin";

export async function GET(request: Request): Promise<NextResponse> {
  await requireCloudflareAccess();

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const window = url.searchParams.get("window");
  const params: Parameters<typeof getDemandGraphData>[0] = { limit };

  if (window === "7d" || window === "30d") {
    params.window = window;
  }

  return NextResponse.json(await getDemandGraphData(params));
}
