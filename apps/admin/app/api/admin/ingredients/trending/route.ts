import { NextResponse } from "next/server";
import { normalizeApiBase } from "@/lib/admin-api-base";
import { proxyJsonRequest } from "@/lib/admin-http";
import { getAdminSimulationBearerToken } from "@/lib/admin-simulation-token";
import { requireCloudflareAccess } from "@/lib/supabase-admin";

/**
 * GET /api/admin/ingredients/trending
 *
 * Returns trending ingredients with popularity and substitution momentum.
 * Proxies to GET /ingredients/trending on the edge function.
 * Supports ?sort=trending|momentum and ?limit=N query params.
 */
export async function GET(request: Request): Promise<NextResponse> {
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
            : "Unable to acquire admin simulation bearer token for ingredient trending",
      },
      { status: 500 }
    );
  }

  const url = new URL(request.url);
  const sort = url.searchParams.get("sort") ?? "trending";
  const limit = url.searchParams.get("limit") ?? "20";

  const apiBase = normalizeApiBase(process.env["API_BASE_URL"]);
  return await proxyJsonRequest({
    apiBase,
    token,
    path: `/ingredients/trending?sort=${encodeURIComponent(sort)}&limit=${encodeURIComponent(limit)}`,
    method: "GET",
    errorMessage: "Ingredient trending fetch failed",
  });
}
