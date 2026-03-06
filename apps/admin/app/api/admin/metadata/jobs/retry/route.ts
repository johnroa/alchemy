import { NextResponse } from "next/server";
import { normalizeApiBase } from "@/lib/admin-api-base";
import { proxyJsonRequest } from "@/lib/admin-http";
import { getAdminSimulationBearerToken } from "@/lib/admin-simulation-token";
import { requireCloudflareAccess } from "@/lib/supabase-admin";

type Body = {
  job_id?: string;
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
            : "Unable to acquire admin simulation bearer token for metadata retry"
      },
      { status: 500 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as Body;
  if (!body.job_id) {
    return NextResponse.json({ error: "job_id is required" }, { status: 400 });
  }

  const apiBase = normalizeApiBase(process.env["API_BASE_URL"]);
  return await proxyJsonRequest({
    apiBase,
    token,
    path: "/metadata-jobs/retry",
    method: "POST",
    body: { job_id: body.job_id },
    errorMessage: "Metadata job retry failed",
  });
}
