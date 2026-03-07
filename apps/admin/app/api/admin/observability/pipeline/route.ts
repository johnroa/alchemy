import { NextResponse } from "next/server";
import { normalizeApiBase } from "@/lib/admin-api-base";
import { proxyJsonRequest } from "@/lib/admin-http";
import { getAdminSimulationBearerToken } from "@/lib/admin-simulation-token";
import { requireCloudflareAccess } from "@/lib/supabase-admin";

/**
 * GET /api/admin/observability/pipeline
 *
 * Returns aggregated LLM pipeline observability metrics:
 * per-scope call counts, latency percentiles, error rates, cost,
 * variant health counts, and graph edge creation rate.
 *
 * Query params:
 *   hours: int (1-720, default 24) — lookback window
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
            : "Unable to acquire admin simulation bearer token for observability",
      },
      { status: 500 }
    );
  }

  const url = new URL(request.url);
  const hours = url.searchParams.get("hours") ?? "24";

  const apiBase = normalizeApiBase(process.env["API_BASE_URL"]);
  return await proxyJsonRequest({
    apiBase,
    token,
    path: `/observability/pipeline?hours=${encodeURIComponent(hours)}`,
    method: "GET",
    errorMessage: "Pipeline observability fetch failed",
  });
}
