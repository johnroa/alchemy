import { NextResponse } from "next/server";
import { normalizeApiBase } from "@/lib/admin-api-base";
import { readJsonBody } from "@/lib/admin-http";
import { getAdminSimulationBearerToken } from "@/lib/admin-simulation-token";
import { getAdminClient, requireCloudflareAccess } from "@/lib/supabase-admin";

type ModelOverride = {
  provider: string;
  model: string;
};

type Body = {
  scenario_id?: string;
  lane_a_override?: ModelOverride;
  lane_b_override?: ModelOverride;
};

type CompareResponse = {
  request_id: string;
  scenario: {
    id: string;
    title: string;
  };
  lane_a: {
    status: string;
    provider: string | null;
    model: string | null;
    latency_ms: number | null;
    cost_usd: number | null;
    error: string | null;
  };
  lane_b: {
    status: string;
    provider: string | null;
    model: string | null;
    latency_ms: number | null;
    cost_usd: number | null;
    error: string | null;
  };
  judge: {
    status: string;
    provider: string | null;
    model: string | null;
    latency_ms: number | null;
    winner: "A" | "B" | "tie" | null;
    confidence: number | null;
    error: string | null;
  };
  completed: boolean;
};

const summarizeCompareResponse = (payload: CompareResponse): Record<string, unknown> => ({
  upstream_request_id: payload.request_id,
  scenario: {
    id: payload.scenario.id,
    title: payload.scenario.title,
  },
  completed: payload.completed,
  lane_a: {
    status: payload.lane_a.status,
    provider: payload.lane_a.provider,
    model: payload.lane_a.model,
    latency_ms: payload.lane_a.latency_ms,
    cost_usd: payload.lane_a.cost_usd,
    error: payload.lane_a.error,
  },
  lane_b: {
    status: payload.lane_b.status,
    provider: payload.lane_b.provider,
    model: payload.lane_b.model,
    latency_ms: payload.lane_b.latency_ms,
    cost_usd: payload.lane_b.cost_usd,
    error: payload.lane_b.error,
  },
  judge: {
    status: payload.judge.status,
    provider: payload.judge.provider,
    model: payload.judge.model,
    latency_ms: payload.judge.latency_ms,
    winner: payload.judge.winner,
    confidence: payload.judge.confidence,
    error: payload.judge.error,
  },
});

export async function POST(request: Request): Promise<NextResponse> {
  const identity = await requireCloudflareAccess();
  const client = getAdminClient();
  const body = (await request.json().catch(() => ({}))) as Body;
  const scenarioId = typeof body.scenario_id === "string" ? body.scenario_id.trim() : "";
  if (!scenarioId) {
    return NextResponse.json({ error: "scenario_id is required" }, { status: 400 });
  }

  const { data: actor } = await client.from("users").select("id").eq("email", identity.email).maybeSingle();
  const adminRequestId = crypto.randomUUID();
  const apiBase = normalizeApiBase(process.env["API_BASE_URL"]);

  await client.from("events").insert({
    user_id: actor?.id ?? null,
    event_type: "image_simulation_run_started",
    request_id: adminRequestId,
    event_payload: {
      scenario_id: scenarioId,
      lane_a_override: body.lane_a_override ?? null,
      lane_b_override: body.lane_b_override ?? null,
      trigger: "admin_ui",
    },
  });

  let token: string;
  try {
    token = await getAdminSimulationBearerToken();
  } catch (error) {
    await client.from("events").insert({
      user_id: actor?.id ?? null,
      event_type: "image_simulation_run_failed",
      request_id: adminRequestId,
      event_payload: {
        scenario_id: scenarioId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return NextResponse.json(
      { error: `Failed to acquire simulation token: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(`${apiBase}/image-simulations/compare`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        scenario_id: scenarioId,
        lane_a_override: body.lane_a_override,
        lane_b_override: body.lane_b_override,
      }),
    });
  } catch (error) {
    await client.from("events").insert({
      user_id: actor?.id ?? null,
      event_type: "image_simulation_run_failed",
      request_id: adminRequestId,
      latency_ms: Date.now() - startedAt,
      event_payload: {
        scenario_id: scenarioId,
        error: error instanceof Error ? error.message : String(error),
      },
    });

    return NextResponse.json(
      {
        error: "Image simulation compare failed",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 502 }
    );
  }

  const payload = await readJsonBody(response);
  const latencyMs = Date.now() - startedAt;

  if (!response.ok) {
    await client.from("events").insert({
      user_id: actor?.id ?? null,
      event_type: "image_simulation_run_failed",
      request_id: adminRequestId,
      latency_ms: latencyMs,
      event_payload: {
        scenario_id: scenarioId,
        details: payload,
      },
    });

    return NextResponse.json(
      {
        error: "Image simulation compare failed",
        details: payload,
      },
      { status: response.status }
    );
  }

  const comparePayload = payload as CompareResponse;
  await client.from("events").insert({
    user_id: actor?.id ?? null,
    event_type: "image_simulation_run_completed",
    request_id: adminRequestId,
    latency_ms: latencyMs,
    event_payload: summarizeCompareResponse(comparePayload),
  });

  return NextResponse.json(comparePayload);
}
