import { NextResponse } from "next/server";
import { getAdminClient, requireCloudflareAccess } from "@/lib/supabase-admin";

type Body = {
  scenario?: string;
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
}): Promise<T> => {
  const init: RequestInit = {
    method: params.method ?? "GET",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${params.token}`
    }
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

export async function POST(request: Request): Promise<NextResponse> {
  const identity = await requireCloudflareAccess();
  const body = (await request.json().catch(() => ({}))) as Body;
  const client = getAdminClient();
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const apiBase = normalizeApiBase(process.env["API_BASE_URL"]);
  const token = process.env["ADMIN_SIMULATION_BEARER_TOKEN"];

  if (!token) {
    return NextResponse.json(
      { error: "ADMIN_SIMULATION_BEARER_TOKEN must be set to run API simulation" },
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
      trigger: "admin_ui"
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
    const draft = await runStep("create_draft", async () => {
      const response = await requestJson<{ id: string; messages: unknown[] }>({
        apiBase,
        token,
        path: "/recipe-drafts",
        method: "POST",
        body: {
          message: "chicken parm for a romantic dinner for 2"
        }
      });
      assertCondition(typeof response.id === "string" && response.id.length > 0, "Draft id missing");
      assertCondition(Array.isArray(response.messages) && response.messages.length >= 2, "Draft response missing thread");
      return {
        draft_id: response.id,
        message_count: response.messages.length
      };
    });

    await runStep("chat_tweak", async () => {
      const response = await requestJson<{ messages: unknown[] }>({
        apiBase,
        token,
        path: `/recipe-drafts/${draft.draft_id}/messages`,
        method: "POST",
        body: { message: "What can I add to make it spicy?" }
      });
      assertCondition(Array.isArray(response.messages) && response.messages.length >= 4, "Tweak response missing messages");
      return {
        message_count: response.messages.length
      };
    });

    await runStep("chat_attachment_request", async () => {
      const response = await requestJson<{ messages: unknown[] }>({
        apiBase,
        token,
        path: `/recipe-drafts/${draft.draft_id}/messages`,
        method: "POST",
        body: { message: "Attach one side and one appetizer to this meal." }
      });
      assertCondition(
        Array.isArray(response.messages) && response.messages.length >= 6,
        "Attachment request response missing messages"
      );
      return {
        message_count: response.messages.length
      };
    });

    const finalized = await runStep("finalize", async () => {
      const response = await requestJson<{
        recipe?: {
          id?: string;
          image_status?: string;
          attachments?: unknown[];
        };
      }>({
        apiBase,
        token,
        path: `/recipe-drafts/${draft.draft_id}/finalize`,
        method: "POST"
      });

      const recipeId = response.recipe?.id;
      assertCondition(typeof recipeId === "string" && recipeId.length > 0, "Finalize did not return recipe id");
      return {
        recipe_id: recipeId,
        image_status: response.recipe?.image_status ?? "unknown",
        attachment_count: Array.isArray(response.recipe?.attachments) ? response.recipe.attachments.length : 0
      };
    });

    await runStep("save_recipe", async () => {
      const response = await requestJson<{ saved: boolean }>({
        apiBase,
        token,
        path: `/recipes/${finalized.recipe_id}/save`,
        method: "POST"
      });
      assertCondition(response.saved === true, "Save endpoint did not return saved=true");
      return {
        saved: response.saved
      };
    });

    await runStep("history", async () => {
      const response = await requestJson<{
        versions?: unknown[];
        draft_messages?: unknown[];
      }>({
        apiBase,
        token,
        path: `/recipes/${finalized.recipe_id}/history`
      });

      const versions = Array.isArray(response.versions) ? response.versions.length : 0;
      assertCondition(versions > 0, "History did not return versions");
      return {
        versions,
        draft_messages: Array.isArray(response.draft_messages) ? response.draft_messages.length : 0
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
