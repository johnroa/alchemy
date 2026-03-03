import { NextResponse } from "next/server";
import { requireCloudflareAccess } from "@/lib/supabase-admin";

const normalizeApiBase = (raw: string | undefined): string => {
  const value = (raw ?? "https://api.cookwithalchemy.com/v1").trim();
  if (!value) {
    return "https://api.cookwithalchemy.com/v1";
  }

  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const withoutTrailing = withProtocol.replace(/\/+$/, "");
  return withoutTrailing.endsWith("/v1") ? withoutTrailing : `${withoutTrailing}/v1`;
};

type Body = {
  limit?: number;
};

export async function POST(request: Request): Promise<NextResponse> {
  await requireCloudflareAccess();

  const token = process.env["ADMIN_SIMULATION_BEARER_TOKEN"];
  if (!token) {
    return NextResponse.json(
      { error: "ADMIN_SIMULATION_BEARER_TOKEN is required for memory job processing" },
      { status: 500 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as Body;
  const limit = Number.isFinite(Number(body.limit)) ? Math.max(1, Math.min(100, Number(body.limit))) : 25;
  const apiBase = normalizeApiBase(process.env["API_BASE_URL"]);

  const response = await fetch(`${apiBase}/memory-jobs/process`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ limit })
  });

  const payloadText = await response.text();
  let payload: unknown = payloadText;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    // keep raw string payload
  }

  if (!response.ok) {
    return NextResponse.json(
      {
        error: "Memory job processing failed",
        details: payload
      },
      { status: response.status }
    );
  }

  return NextResponse.json(payload);
}
