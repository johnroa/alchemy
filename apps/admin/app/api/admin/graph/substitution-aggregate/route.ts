import { NextResponse } from "next/server";
import { normalizeApiBase } from "@/lib/admin-api-base";
import { proxyJsonRequest } from "@/lib/admin-http";
import { getAdminSimulationBearerToken } from "@/lib/admin-simulation-token";
import { requireCloudflareAccess } from "@/lib/supabase-admin";

type Body = {
  limit?: number;
  min_count?: number;
  min_confidence?: number;
};

/**
 * POST /api/admin/graph/substitution-aggregate
 *
 * Triggers the batch substitution aggregation job. Scans variant
 * provenance for substitution_diffs, aggregates patterns across all
 * users, and creates/strengthens substitutes_for and alternative_to
 * graph edges with source: 'variant_aggregation'.
 *
 * Body params:
 * - limit: max variant versions to scan (default 500, max 2000)
 * - min_count: minimum occurrences before creating an edge (default 3)
 * - min_confidence: floor confidence for new edges (default 0.5)
 */
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
            : "Unable to acquire admin simulation bearer token for substitution aggregation",
      },
      { status: 500 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Body;
  const apiBase = normalizeApiBase(process.env["API_BASE_URL"]);

  return await proxyJsonRequest({
    apiBase,
    token,
    path: "/graph/substitution-aggregate",
    method: "POST",
    body: {
      limit: body.limit,
      min_count: body.min_count,
      min_confidence: body.min_confidence,
    },
    errorMessage: "Substitution aggregation job failed",
  });
}
