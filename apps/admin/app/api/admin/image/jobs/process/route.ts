import { NextResponse } from "next/server";
import { normalizeApiBase } from "@/lib/admin-api-base";
import { proxyJsonRequest } from "@/lib/admin-http";
import { getAdminSimulationBearerToken } from "@/lib/admin-simulation-token";
import { requireCloudflareAccess } from "@/lib/supabase-admin";

type Body = {
  limit?: number;
};

export async function POST(request: Request): Promise<NextResponse> {
  await requireCloudflareAccess();

  let token: string;
  try {
    token = await getAdminSimulationBearerToken();
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to acquire admin simulation bearer token for image processing",
      },
      { status: 500 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Body;
  const apiBase = normalizeApiBase(process.env["API_BASE_URL"]);
  const limit = Number.isFinite(Number(body.limit)) ? Math.max(1, Math.min(20, Number(body.limit))) : 5;
  return await proxyJsonRequest({
    apiBase,
    token,
    path: "/image-jobs/process",
    method: "POST",
    body: { limit },
    errorMessage: "Image job processing failed",
  });
}
