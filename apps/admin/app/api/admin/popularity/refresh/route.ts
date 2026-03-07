import { NextResponse } from "next/server";
import { normalizeApiBase } from "@/lib/admin-api-base";
import { proxyJsonRequest } from "@/lib/admin-http";
import { getAdminSimulationBearerToken } from "@/lib/admin-simulation-token";
import { requireCloudflareAccess } from "@/lib/supabase-admin";

/**
 * POST /api/admin/popularity/refresh
 *
 * Triggers the batch popularity + ingredient trending refresh RPC.
 * Returns recipe and ingredient update counts.
 */
export async function POST(): Promise<NextResponse> {
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
            : "Unable to acquire admin simulation bearer token for popularity refresh",
      },
      { status: 500 }
    );
  }

  const apiBase = normalizeApiBase(process.env["API_BASE_URL"]);
  return await proxyJsonRequest({
    apiBase,
    token,
    path: "/popularity/refresh",
    method: "POST",
    body: {},
    errorMessage: "Popularity refresh failed",
  });
}
