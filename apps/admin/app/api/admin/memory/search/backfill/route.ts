import { NextResponse } from "next/server";
import { normalizeApiBase } from "@/lib/admin-api-base";
import { proxyJsonRequest } from "@/lib/admin-http";
import { getAdminSimulationBearerToken } from "@/lib/admin-simulation-token";
import { requireCloudflareAccess } from "@/lib/supabase-admin";

type Body = {
  user_id?: string;
  limit?: number;
  missing_only?: boolean;
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
            : "Unable to acquire admin simulation bearer token for memory backfill",
      },
      { status: 500 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Body;
  const limit = Number.isFinite(Number(body.limit))
    ? Math.max(1, Math.min(200, Number(body.limit)))
    : 100;
  const apiBase = normalizeApiBase(process.env["API_BASE_URL"]);

  return await proxyJsonRequest({
    apiBase,
    token,
    path: "/memory-search/backfill",
    method: "POST",
    body: {
      user_id: body.user_id,
      limit,
      missing_only: body.missing_only !== false,
    },
    errorMessage: "Memory retrieval backfill failed",
  });
}
