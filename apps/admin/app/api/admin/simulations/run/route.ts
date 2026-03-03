import { NextResponse } from "next/server";
import { getAdminClient, requireCloudflareAccess } from "@/lib/supabase-admin";

type ModelOverride = { provider: string; model: string };

type Body = {
  scenario?: string;
  model_overrides?: Record<string, ModelOverride>;
};

const normalizeApiBase = (raw: string | undefined): string => {
  const value = (raw ?? "https://api.cookwithalchemy.com/v1").trim();
  if (!value) {
    return "https://api.cookwithalchemy.com/v1";
  }

  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const withoutTrailing = withProtocol.replace(/\/+$/, "");
  return withoutTrailing.endsWith("/v1") ? withoutTrailing : `${withoutTrailing}/v1`;
};

const requestJson = async <T>(params: {
  apiBase: string;
  token: string;
  path: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: Record<string, unknown>;
  modelOverrides?: Record<string, ModelOverride>;
}): Promise<T> => {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${params.token}`
  };
  if (params.modelOverrides && Object.keys(params.modelOverrides).length > 0) {
    headers["x-sim-model-overrides"] = JSON.stringify(params.modelOverrides);
  }
  const init: RequestInit = {
    method: params.method ?? "GET",
    headers
  };

  if (params.body) {
    init.body = JSON.stringify(params.body);
  }

  const response = await fetch(`${params.apiBase}${params.path}`, init);

  const payloadText = await response.text();
  let payload: unknown = payloadText;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    // keep raw payload
  }

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${params.method ?? "GET"} ${params.path}: ${
        typeof payload === "string" ? payload : JSON.stringify(payload)
      }`
    );
  }

  return payload as T;
};

const assertCondition = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const SIM_USER_EMAIL = "sim-1772428603705@cookwithalchemy.com";
const SIM_USER_PASSWORD = "AlchemySim2026";

const getSimToken = async (supabaseUrl: string, serviceKey: string): Promise<string> => {
  // Generate a magic link OTP for the sim user and verify it to get a fresh access token
  const linkRes = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${serviceKey}`, "apikey": serviceKey, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email: SIM_USER_EMAIL })
  });
  const linkData = (await linkRes.json()) as { email_otp?: string };
  if (!linkData.email_otp) {
    // Fall back to password sign-in
    const signInRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "apikey": serviceKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: SIM_USER_EMAIL, password: SIM_USER_PASSWORD })
    });
    const signInData = (await signInRes.json()) as { access_token?: string };
    if (!signInData.access_token) throw new Error("Failed to sign in simulation user");
    return signInData.access_token;
  }
  const verifyRes = await fetch(`${supabaseUrl}/auth/v1/verify`, {
    method: "POST",
    headers: { "apikey": serviceKey, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", token: linkData.email_otp, email: SIM_USER_EMAIL })
  });
  const verifyData = (await verifyRes.json()) as { access_token?: string };
  if (!verifyData.access_token) throw new Error("Failed to verify sim user OTP");
  return verifyData.access_token;
};

export async function POST(request: Request): Promise<NextResponse> {
  const identity = await requireCloudflareAccess();
  const body = (await request.json().catch(() => ({}))) as Body;
  const client = getAdminClient();
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const apiBase = normalizeApiBase(process.env["API_BASE_URL"]);
  const modelOverrides = body.model_overrides ?? {};

  const supabaseUrl = (process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "").trim().replace(/\/+$/, "");
  const serviceKey = process.env["SUPABASE_SECRET_KEY"] ?? process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";

  let token: string;
  try {
    token = process.env["ADMIN_SIMULATION_BEARER_TOKEN"] ?? await getSimToken(supabaseUrl, serviceKey);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to acquire simulation token: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }

  const { data: actor } = await client.from("users").select("id").eq("email", identity.email).maybeSingle();

  await client.from("events").insert({
    user_id: actor?.id ?? null,
    event_type: "simulation_run_started",
    request_id: requestId,
    event_payload: {
      scenario: body.scenario ?? "default_api_ux",
      trigger: "admin_ui",
      model_overrides: Object.keys(modelOverrides).length > 0 ? modelOverrides : undefined
    }
  });

  const steps: Array<{
    name: string;
    latency_ms: number;
    status: "ok" | "failed";
    result?: Record<string, unknown>;
    error?: string;
  }> = [];

  const runStep = async <T extends Record<string, unknown>>(
    name: string,
    fn: () => Promise<T>
  ): Promise<T> => {
    const stepStartedAt = Date.now();
    try {
      const result = await fn();
      steps.push({
        name,
        status: "ok",
        latency_ms: Date.now() - stepStartedAt,
        result
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      steps.push({
        name,
        status: "failed",
        latency_ms: Date.now() - stepStartedAt,
        error: message
      });
      throw error;
    }
  };

  try {
    const chatPrompts = {
      start: "I want dinner for two that's cozy and Italian.",
      refine: "Let's do spicy chicken parm with a simple side.",
      iterate: "Make the main a little lighter and keep total time under 45 minutes."
    } as const;

    const chat = await runStep("chat_start", async () => {
      const response = await requestJson<{ id: string; messages: unknown[]; loop_state?: string; candidate_recipe_set?: { components?: unknown[] } | null }>({
        apiBase,
        token,
        path: "/chat",
        method: "POST",
        body: { message: chatPrompts.start },
        modelOverrides
      });
      assertCondition(typeof response.id === "string" && response.id.length > 0, "Chat session id missing");
      assertCondition(Array.isArray(response.messages) && response.messages.length >= 2, "Chat start response missing thread");
      return {
        chat_id: response.id,
        loop_state: response.loop_state ?? "unknown",
        message_count: response.messages.length,
        component_count: Array.isArray(response.candidate_recipe_set?.components) ? response.candidate_recipe_set?.components.length : 0
      };
    });

    const refine = await runStep("chat_refine", async () => {
      const response = await requestJson<{
        messages: unknown[];
        loop_state?: string;
        candidate_recipe_set?: { components?: unknown[]; active_component_id?: string | null } | null;
      }>({
        apiBase,
        token,
        path: `/chat/${chat.chat_id}/messages`,
        method: "POST",
        body: { message: chatPrompts.refine },
        modelOverrides
      });
      assertCondition(Array.isArray(response.messages) && response.messages.length >= 4, "Chat refine response missing messages");
      const componentCount = Array.isArray(response.candidate_recipe_set?.components) ? response.candidate_recipe_set.components.length : 0;
      return {
        loop_state: response.loop_state ?? "unknown",
        message_count: response.messages.length,
        component_count: componentCount,
        has_candidate: componentCount > 0,
        active_component_id: response.candidate_recipe_set?.active_component_id ?? null
      };
    });

    const ensuredCandidate = await runStep("chat_generation_trigger", async () => {
      if (refine.has_candidate) {
        return {
          loop_state: refine.loop_state,
          component_count: refine.component_count,
          active_component_id: refine.active_component_id
        };
      }
      const response = await requestJson<{
        messages: unknown[];
        loop_state?: string;
        candidate_recipe_set?: { components?: unknown[]; active_component_id?: string | null } | null;
      }>({
        apiBase,
        token,
        path: `/chat/${chat.chat_id}/messages`,
        method: "POST",
        body: { message: "Generate a complete recipe now with one side dish." },
        modelOverrides
      });
      assertCondition(
        Array.isArray(response.candidate_recipe_set?.components) && response.candidate_recipe_set.components.length > 0,
        "Generation trigger did not produce a candidate recipe set"
      );
      return {
        loop_state: response.loop_state ?? "unknown",
        component_count: response.candidate_recipe_set?.components?.length ?? 0,
        active_component_id: response.candidate_recipe_set?.active_component_id ?? null
      };
    });

    const iterated = await runStep("chat_iterate_candidate", async () => {
      const response = await requestJson<{
        messages: unknown[];
        loop_state?: string;
        candidate_recipe_set?: { components?: unknown[]; active_component_id?: string | null } | null;
      }>({
        apiBase,
        token,
        path: `/chat/${chat.chat_id}/messages`,
        method: "POST",
        body: { message: chatPrompts.iterate },
        modelOverrides
      });
      assertCondition(Array.isArray(response.messages) && response.messages.length >= 6, "Iteration response missing messages");
      const componentCount = Array.isArray(response.candidate_recipe_set?.components) ? response.candidate_recipe_set.components.length : 0;
      assertCondition(componentCount > 0, "Iteration response lost candidate recipe set");
      return {
        loop_state: response.loop_state ?? "unknown",
        message_count: response.messages.length,
        component_count: componentCount,
        active_component_id: response.candidate_recipe_set?.active_component_id ?? ensuredCandidate.active_component_id
      };
    });

    await runStep("candidate_set_active_component", async () => {
      if (!iterated.active_component_id) {
        return { skipped: true };
      }
      const response = await requestJson<{
        loop_state?: string;
        candidate_recipe_set?: { active_component_id?: string | null; components?: unknown[] } | null;
      }>({
        apiBase,
        token,
        path: `/chat/${chat.chat_id}/candidate`,
        method: "PATCH",
        body: {
          action: "set_active_component",
          component_id: iterated.active_component_id
        },
        modelOverrides
      });
      return {
        loop_state: response.loop_state ?? "unknown",
        active_component_id: response.candidate_recipe_set?.active_component_id ?? null,
        component_count: Array.isArray(response.candidate_recipe_set?.components) ? response.candidate_recipe_set.components.length : 0
      };
    });

    const committed = await runStep("commit_candidate_set", async () => {
      const response = await requestJson<{
        loop_state?: string;
        commit?: {
          committed_count?: number;
          recipes?: Array<{ recipe_id?: string; role?: string }>;
          links?: unknown[];
        };
      }>({
        apiBase,
        token,
        path: `/chat/${chat.chat_id}/commit`,
        method: "POST"
      });
      const recipes = response.commit?.recipes ?? [];
      assertCondition(Array.isArray(recipes) && recipes.length > 0, "Commit did not return persisted recipe ids");
      return {
        loop_state: response.loop_state ?? "unknown",
        committed_count: Number(response.commit?.committed_count ?? recipes.length),
        recipe_ids: recipes.map((recipe) => String(recipe.recipe_id ?? "")).filter((id) => id.length > 0),
        link_count: Array.isArray(response.commit?.links) ? response.commit?.links.length : 0
      };
    });

    await runStep("history", async () => {
      const primaryRecipeId = committed.recipe_ids[0];
      assertCondition(typeof primaryRecipeId === "string" && primaryRecipeId.length > 0, "No committed recipe id available for history check");
      const response = await requestJson<{
        versions?: unknown[];
        chat_messages?: unknown[];
      }>({
        apiBase,
        token,
        path: `/recipes/${primaryRecipeId}/history`
      });

      const versions = Array.isArray(response.versions) ? response.versions.length : 0;
      assertCondition(versions > 0, "History did not return versions");
      return {
        versions,
        chat_messages: Array.isArray(response.chat_messages) ? response.chat_messages.length : 0
      };
    });

    await runStep("cookbook", async () => {
      const response = await requestJson<{ items?: unknown[] }>({
        apiBase,
        token,
        path: "/recipes/cookbook"
      });
      assertCondition(Array.isArray(response.items), "Cookbook payload missing items");
      return {
        item_count: response.items?.length ?? 0
      };
    });

    await runStep("changelog", async () => {
      const response = await requestJson<{ items?: unknown[] }>({
        apiBase,
        token,
        path: "/changelog"
      });
      const itemCount = Array.isArray(response.items) ? response.items.length : 0;
      assertCondition(itemCount > 0, "Changelog payload missing events");
      return {
        item_count: itemCount
      };
    });

    await runStep("image_jobs_process", async () => {
      const response = await requestJson<{ processed: number; ready: number; failed: number; pending: number }>({
        apiBase,
        token,
        path: "/image-jobs/process",
        method: "POST",
        body: { limit: 8 }
      });
      return {
        processed: response.processed,
        ready: response.ready,
        failed: response.failed,
        pending: response.pending
      };
    });

    const checks = {
      zero_failed_steps: steps.every((step) => step.status === "ok"),
      steps_executed: steps.length,
      timestamp: new Date().toISOString()
    };

    await client.from("events").insert({
      user_id: actor?.id ?? null,
      event_type: "simulation_run_completed",
      request_id: requestId,
      latency_ms: Date.now() - startedAt,
      event_payload: {
        scenario: body.scenario ?? "default_api_ux",
        checks,
        steps
      }
    });

    return NextResponse.json({ ok: true, request_id: requestId, checks, steps });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await client.from("events").insert({
      user_id: actor?.id ?? null,
      event_type: "simulation_run_failed",
      request_id: requestId,
      latency_ms: Date.now() - startedAt,
      event_payload: {
        scenario: body.scenario ?? "default_api_ux",
        error: message,
        steps
      }
    });

    return NextResponse.json(
      {
        ok: false,
        request_id: requestId,
        error: message,
        steps
      },
      { status: 500 }
    );
  }
}
