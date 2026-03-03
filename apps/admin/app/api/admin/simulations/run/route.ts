import { NextResponse } from "next/server";
import { getAdminClient, requireCloudflareAccess } from "@/lib/supabase-admin";

type ModelOverride = { provider: string; model: string };
type SimulationVariant = "single" | "A" | "B";

type Body = {
  scenario?: string;
  variant?: SimulationVariant;
  model_overrides?: Record<string, ModelOverride>;
};

type CandidateRecipeComponent = {
  component_id?: string;
  role?: string;
  title?: string;
  recipe?: {
    title?: string;
    ingredients?: unknown[];
    steps?: unknown[];
  };
};

type CandidateRecipeSet = {
  candidate_id?: string;
  revision?: number;
  active_component_id?: string | null;
  components?: CandidateRecipeComponent[];
};

type CommitRecipe = {
  component_id?: string;
  role?: string;
  title?: string;
  recipe_id?: string;
  recipe_version_id?: string;
};

type CommitPayload = {
  candidate_id?: string;
  revision?: number;
  committed_count?: number;
  recipes?: CommitRecipe[];
  links?: unknown[];
  post_save_options?: string[];
};

type ChatApiResponse = {
  id?: string;
  loop_state?: string;
  assistant_reply?: { text?: string } | null;
  candidate_recipe_set?: CandidateRecipeSet | null;
  commit?: CommitPayload;
  messages?: unknown[];
};

type RecipeApiResponse = {
  id?: string;
  title?: string;
  ingredients?: unknown[];
  steps?: unknown[];
  ingredient_groups?: unknown[];
};

type CookbookApiResponse = {
  items?: Array<{ id?: string; recipe_id?: string }>;
};

type SimStep = {
  name: string;
  status: "ok" | "failed";
  latency_ms: number;
  started_at: string;
  completed_at: string;
  result?: Record<string, unknown>;
  error?: string;
};

type SimChecks = {
  zero_failed_steps: boolean;
  steps_executed: number;
  total_latency_ms: number;
  timestamp: string;
};

type BaseTraceEvent = {
  request_id: string;
  at: string;
};

type SimTraceEvent =
  | (BaseTraceEvent & { type: "run_started"; scenario: string; variant: SimulationVariant })
  | (BaseTraceEvent & { type: "step_started"; step: string })
  | (BaseTraceEvent & { type: "step_completed"; step: string; latency_ms: number; result: Record<string, unknown> })
  | (BaseTraceEvent & { type: "step_failed"; step: string; latency_ms: number; error: string })
  | (BaseTraceEvent & { type: "run_completed"; checks: SimChecks })
  | (BaseTraceEvent & { type: "run_failed"; error: string });

type SimResult = {
  ok: boolean;
  request_id: string;
  checks?: SimChecks;
  error?: string;
  steps: SimStep[];
  trace: SimTraceEvent[];
};

const SIM_USER_EMAIL = "sim-1772428603705@cookwithalchemy.com";
const SIM_USER_PASSWORD = "AlchemySim2026";

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
    // keep raw string payload
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

const extractAssistantText = (response: ChatApiResponse): string => {
  const direct = response.assistant_reply?.text?.trim();
  if (direct) {
    return direct;
  }

  const messages = Array.isArray(response.messages) ? response.messages : [];
  for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
    const message = messages[idx];
    if (message && typeof message === "object" && "role" in message && "content" in message) {
      const role = String((message as { role?: unknown }).role ?? "");
      if (role !== "assistant") {
        continue;
      }

      const content = (message as { content?: unknown }).content;
      if (typeof content === "string" && content.trim().length > 0) {
        return content.trim();
      }

      if (Array.isArray(content)) {
        for (const part of content) {
          if (part && typeof part === "object" && "text" in part) {
            const text = String((part as { text?: unknown }).text ?? "").trim();
            if (text.length > 0) {
              return text;
            }
          }
        }
      }
    }
  }

  return "";
};

const summarizeComponents = (candidate: CandidateRecipeSet | null | undefined): Array<Record<string, unknown>> => {
  if (!candidate || !Array.isArray(candidate.components)) {
    return [];
  }

  return candidate.components.map((component) => ({
    component_id: component.component_id ?? "",
    role: component.role ?? "",
    title: component.title ?? "",
    recipe_title: component.recipe?.title ?? component.title ?? "",
    ingredient_count: Array.isArray(component.recipe?.ingredients) ? component.recipe?.ingredients.length : 0,
    step_count: Array.isArray(component.recipe?.steps) ? component.recipe?.steps.length : 0
  }));
};

const readJsonBody = async (response: Response): Promise<Record<string, unknown>> => {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
    return { raw: parsed };
  } catch {
    return { raw: text };
  }
};

const signInSimulationUser = async (supabaseUrl: string, serviceKey: string): Promise<string> => {
  const signInRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: serviceKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: SIM_USER_EMAIL, password: SIM_USER_PASSWORD })
  });

  const signInData = await readJsonBody(signInRes);
  const accessToken = String(signInData["access_token"] ?? "");
  if (!signInRes.ok || accessToken.length === 0) {
    throw new Error(
      `Simulation user password sign-in failed (${signInRes.status}): ${JSON.stringify(signInData)}`
    );
  }

  return accessToken;
};

const getSimToken = async (supabaseUrl: string, serviceKey: string): Promise<string> => {
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing Supabase URL or service key in admin worker environment");
  }

  let magiclinkFailure = "";

  const linkRes = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ type: "magiclink", email: SIM_USER_EMAIL })
  });

  const linkData = await readJsonBody(linkRes);
  const emailOtp = String(linkData["email_otp"] ?? "");

  if (linkRes.ok && emailOtp.length > 0) {
    const verifyRes = await fetch(`${supabaseUrl}/auth/v1/verify`, {
      method: "POST",
      headers: { apikey: serviceKey, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "magiclink", token: emailOtp, email: SIM_USER_EMAIL })
    });

    const verifyData = await readJsonBody(verifyRes);
    const verifyToken = String(verifyData["access_token"] ?? "");
    if (verifyRes.ok && verifyToken.length > 0) {
      return verifyToken;
    }

    magiclinkFailure = `Magiclink verify failed (${verifyRes.status}): ${JSON.stringify(verifyData)}`;
  } else {
    magiclinkFailure = `Magiclink generation failed (${linkRes.status}): ${JSON.stringify(linkData)}`;
  }

  try {
    return await signInSimulationUser(supabaseUrl, serviceKey);
  } catch (error) {
    const passwordFailure = error instanceof Error ? error.message : String(error);
    throw new Error(`${magiclinkFailure}; ${passwordFailure}`);
  }
};

const runSimulation = async (params: {
  scenario: string;
  variant: SimulationVariant;
  modelOverrides: Record<string, ModelOverride>;
  emit?: (event: SimTraceEvent) => Promise<void>;
}): Promise<SimResult> => {
  const identity = await requireCloudflareAccess();
  const client = getAdminClient();
  const { data: actor } = await client.from("users").select("id").eq("email", identity.email).maybeSingle();
  const requestId = crypto.randomUUID();
  const startedAtMs = Date.now();

  const steps: SimStep[] = [];
  const trace: SimTraceEvent[] = [];

  const apiBase = normalizeApiBase(process.env["API_BASE_URL"]);
  const supabaseUrl = (process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "").trim().replace(/\/+$/, "");
  const serviceKey = process.env["SUPABASE_SECRET_KEY"] ?? process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";

  const emit = async (event: SimTraceEvent): Promise<void> => {
    trace.push(event);
    if (params.emit) {
      await params.emit(event);
    }
  };

  const eventAt = (): string => new Date().toISOString();

  const runStep = async <T extends Record<string, unknown>>(
    name: string,
    fn: () => Promise<T>
  ): Promise<T> => {
    const startedAt = Date.now();
    await emit({ type: "step_started", request_id: requestId, step: name, at: eventAt() });

    try {
      const result = await fn();
      const latencyMs = Date.now() - startedAt;
      const completedAt = eventAt();

      steps.push({
        name,
        status: "ok",
        latency_ms: latencyMs,
        started_at: new Date(startedAt).toISOString(),
        completed_at: completedAt,
        result
      });

      await emit({
        type: "step_completed",
        request_id: requestId,
        step: name,
        latency_ms: latencyMs,
        at: completedAt,
        result
      });

      return result;
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const completedAt = eventAt();
      const message = error instanceof Error ? error.message : String(error);

      steps.push({
        name,
        status: "failed",
        latency_ms: latencyMs,
        started_at: new Date(startedAt).toISOString(),
        completed_at: completedAt,
        error: message
      });

      await emit({
        type: "step_failed",
        request_id: requestId,
        step: name,
        latency_ms: latencyMs,
        at: completedAt,
        error: message
      });

      throw error;
    }
  };

  try {
    let token: string;
    try {
      token = process.env["ADMIN_SIMULATION_BEARER_TOKEN"] ?? await getSimToken(supabaseUrl, serviceKey);
    } catch (error) {
      throw new Error(`Failed to acquire simulation token: ${error instanceof Error ? error.message : String(error)}`);
    }

    await client.from("events").insert({
      user_id: actor?.id ?? null,
      event_type: "simulation_run_started",
      request_id: requestId,
      event_payload: {
        scenario: params.scenario,
        variant: params.variant,
        trigger: "admin_ui",
        model_overrides: Object.keys(params.modelOverrides).length > 0 ? params.modelOverrides : undefined
      }
    });

    await emit({
      type: "run_started",
      request_id: requestId,
      at: eventAt(),
      scenario: params.scenario,
      variant: params.variant
    });

    const prompts = {
      start: "I want a quick high-protein dinner for two. Keep it simple and weeknight-friendly.",
      refine: "Let's make it spicy chicken with one vegetable side. Keep prep practical.",
      trigger: "Great. Generate the full candidate recipe set now.",
      iterate: "Tweak it: keep total time under 45 minutes and make it dairy-free."
    } as const;

    const chat = await runStep("chat_start", async () => {
      const response = await requestJson<ChatApiResponse>({
        apiBase,
        token,
        path: "/chat",
        method: "POST",
        body: { message: prompts.start },
        modelOverrides: params.modelOverrides
      });

      assertCondition(typeof response.id === "string" && response.id.length > 0, "Chat session id missing");

      return {
        chat_id: response.id,
        loop_state: response.loop_state ?? "unknown",
        assistant_reply: extractAssistantText(response),
        message_count: Array.isArray(response.messages) ? response.messages.length : 0,
        thread_tail: Array.isArray(response.messages) ? response.messages.slice(-6) : []
      };
    });

    const refine = await runStep("chat_refine", async () => {
      const response = await requestJson<ChatApiResponse>({
        apiBase,
        token,
        path: `/chat/${chat.chat_id}/messages`,
        method: "POST",
        body: { message: prompts.refine },
        modelOverrides: params.modelOverrides
      });

      return {
        loop_state: response.loop_state ?? "unknown",
        assistant_reply: extractAssistantText(response),
        message_count: Array.isArray(response.messages) ? response.messages.length : 0,
        candidate_summary: summarizeComponents(response.candidate_recipe_set),
        candidate_count: Array.isArray(response.candidate_recipe_set?.components)
          ? response.candidate_recipe_set.components.length
          : 0,
        thread_tail: Array.isArray(response.messages) ? response.messages.slice(-6) : []
      };
    });

    const ensuredCandidate = await runStep("chat_generation_trigger", async () => {
      if (refine.candidate_count > 0) {
        return {
          loop_state: refine.loop_state,
          candidate_id: "",
          revision: null,
          active_component_id: null,
          candidate_count: refine.candidate_count,
          candidate_summary: refine.candidate_summary,
          assistant_reply: "",
          thread_tail: []
        };
      }

      const triggerMessages = [
        prompts.trigger,
        "Generate the candidate recipe set now. Include complete normalized ingredients and steps."
      ] as const;

      const attemptNotes: string[] = [];
      for (let attempt = 0; attempt < triggerMessages.length; attempt += 1) {
        const attemptNumber = attempt + 1;
        const triggerMessage = triggerMessages[attempt];

        try {
          const response = await requestJson<ChatApiResponse>({
            apiBase,
            token,
            path: `/chat/${chat.chat_id}/messages`,
            method: "POST",
            body: { message: triggerMessage },
            modelOverrides: params.modelOverrides
          });

          const components = summarizeComponents(response.candidate_recipe_set);
          if (components.length > 0) {
            return {
              loop_state: response.loop_state ?? "unknown",
              candidate_id: response.candidate_recipe_set?.candidate_id ?? "",
              revision: response.candidate_recipe_set?.revision ?? null,
              active_component_id: response.candidate_recipe_set?.active_component_id ?? null,
              candidate_count: components.length,
              candidate_summary: components,
              assistant_reply: extractAssistantText(response),
              thread_tail: Array.isArray(response.messages) ? response.messages.slice(-6) : []
            };
          }

          attemptNotes.push(
            `attempt ${attemptNumber}: no candidate (loop_state=${response.loop_state ?? "unknown"})`
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          attemptNotes.push(`attempt ${attemptNumber}: ${message}`);
        }
      }

      throw new Error(`Generation trigger did not produce a candidate recipe set: ${attemptNotes.join(" | ")}`);
    });

    const iterated = await runStep("chat_iterate_candidate", async () => {
      const response = await requestJson<ChatApiResponse>({
        apiBase,
        token,
        path: `/chat/${chat.chat_id}/messages`,
        method: "POST",
        body: { message: prompts.iterate },
        modelOverrides: params.modelOverrides
      });

      const components = summarizeComponents(response.candidate_recipe_set);
      assertCondition(components.length > 0, "Iteration response lost candidate recipe set");

      return {
        loop_state: response.loop_state ?? "unknown",
        assistant_reply: extractAssistantText(response),
        message_count: Array.isArray(response.messages) ? response.messages.length : 0,
        candidate_id: response.candidate_recipe_set?.candidate_id ?? ensuredCandidate.candidate_id,
        revision: response.candidate_recipe_set?.revision ?? ensuredCandidate.revision,
        active_component_id: response.candidate_recipe_set?.active_component_id ?? ensuredCandidate.active_component_id,
        candidate_summary: components,
        thread_tail: Array.isArray(response.messages) ? response.messages.slice(-6) : []
      };
    });

    await runStep("candidate_set_active_component", async () => {
      const activeId = iterated.active_component_id;
      if (!activeId) {
        return {
          skipped: true,
          reason: "No active component id provided in candidate set"
        };
      }

      const response = await requestJson<ChatApiResponse>({
        apiBase,
        token,
        path: `/chat/${chat.chat_id}/candidate`,
        method: "PATCH",
        body: {
          action: "set_active_component",
          component_id: activeId
        },
        modelOverrides: params.modelOverrides
      });

      return {
        loop_state: response.loop_state ?? "unknown",
        active_component_id: response.candidate_recipe_set?.active_component_id ?? null,
        candidate_summary: summarizeComponents(response.candidate_recipe_set)
      };
    });

    const committed = await runStep("commit_candidate_set", async () => {
      const response = await requestJson<ChatApiResponse>({
        apiBase,
        token,
        path: `/chat/${chat.chat_id}/commit`,
        method: "POST",
        body: {},
        modelOverrides: params.modelOverrides
      });

      const recipes = Array.isArray(response.commit?.recipes) ? response.commit?.recipes : [];
      assertCondition(recipes.length > 0, "Commit did not return persisted recipe ids");

      return {
        loop_state: response.loop_state ?? "unknown",
        committed_count: Number(response.commit?.committed_count ?? recipes.length),
        recipes: recipes.map((recipe) => ({
          component_id: recipe.component_id ?? "",
          role: recipe.role ?? "",
          title: recipe.title ?? "",
          recipe_id: recipe.recipe_id ?? "",
          recipe_version_id: recipe.recipe_version_id ?? ""
        })),
        link_count: Array.isArray(response.commit?.links) ? response.commit?.links.length : 0,
        post_save_options: Array.isArray(response.commit?.post_save_options) ? response.commit?.post_save_options : []
      };
    });

    const primaryRecipeId = Array.isArray(committed.recipes)
      ? String((committed.recipes[0] as { recipe_id?: unknown })?.recipe_id ?? "")
      : "";

    const fetchedRecipe = await runStep("fetch_committed_recipe", async () => {
      assertCondition(primaryRecipeId.length > 0, "No primary recipe id available after commit");

      const recipe = await requestJson<RecipeApiResponse>({
        apiBase,
        token,
        path: `/recipes/${primaryRecipeId}?units=metric&group_by=component&inline_measurements=true`,
        method: "GET",
        modelOverrides: params.modelOverrides
      });

      return {
        recipe_id: primaryRecipeId,
        title: recipe.title ?? "",
        ingredient_count: Array.isArray(recipe.ingredients) ? recipe.ingredients.length : 0,
        step_count: Array.isArray(recipe.steps) ? recipe.steps.length : 0,
        ingredient_group_count: Array.isArray(recipe.ingredient_groups) ? recipe.ingredient_groups.length : 0
      };
    });

    await runStep("fetch_cookbook", async () => {
      const response = await requestJson<CookbookApiResponse>({
        apiBase,
        token,
        path: "/recipes/cookbook",
        method: "GET",
        modelOverrides: params.modelOverrides
      });

      const items = Array.isArray(response.items) ? response.items : [];
      const containsCommitted = items.some((item) => {
        const id = item.recipe_id ?? item.id ?? "";
        return id === fetchedRecipe.recipe_id;
      });

      return {
        item_count: items.length,
        contains_primary_recipe: containsCommitted
      };
    });

    const checks: SimChecks = {
      zero_failed_steps: steps.every((step) => step.status === "ok"),
      steps_executed: steps.length,
      total_latency_ms: Date.now() - startedAtMs,
      timestamp: new Date().toISOString()
    };

    await client.from("events").insert({
      user_id: actor?.id ?? null,
      event_type: "simulation_run_completed",
      request_id: requestId,
      latency_ms: checks.total_latency_ms,
      event_payload: {
        scenario: params.scenario,
        variant: params.variant,
        checks,
        steps
      }
    });

    await emit({
      type: "run_completed",
      request_id: requestId,
      at: eventAt(),
      checks
    });

    return {
      ok: true,
      request_id: requestId,
      checks,
      steps,
      trace
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    const failedChecks: SimChecks = {
      zero_failed_steps: false,
      steps_executed: steps.length,
      total_latency_ms: Date.now() - startedAtMs,
      timestamp: new Date().toISOString()
    };

    await emit({
      type: "run_failed",
      request_id: requestId,
      at: eventAt(),
      error: message
    });

    await client.from("events").insert({
      user_id: actor?.id ?? null,
      event_type: "simulation_run_failed",
      request_id: requestId,
      latency_ms: failedChecks.total_latency_ms,
      event_payload: {
        scenario: params.scenario,
        variant: params.variant,
        error: message,
        steps
      }
    });

    return {
      ok: false,
      request_id: requestId,
      error: message,
      checks: failedChecks,
      steps,
      trace
    };
  }
};

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const stream = url.searchParams.get("stream") === "1";
  const body = (await request.json().catch(() => ({}))) as Body;

  const scenario = (body.scenario ?? "default_api_ux").trim() || "default_api_ux";
  const variant: SimulationVariant = body.variant ?? "single";
  const modelOverrides = body.model_overrides ?? {};

  if (!stream) {
    const result = await runSimulation({ scenario, variant, modelOverrides });
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  const encoder = new TextEncoder();
  const streamPair = new TransformStream<Uint8Array, Uint8Array>();
  const writer = streamPair.writable.getWriter();

  const writeEvent = async (event: SimTraceEvent | { type: "result"; payload: SimResult }): Promise<void> => {
    await writer.write(encoder.encode(`${JSON.stringify(event)}\n`));
  };

  void (async () => {
    try {
      const result = await runSimulation({
        scenario,
        variant,
        modelOverrides,
        emit: async (event) => {
          await writeEvent(event);
        }
      });

      await writeEvent({ type: "result", payload: result });
    } catch (error) {
      const fallback: SimResult = {
        ok: false,
        request_id: crypto.randomUUID(),
        error: error instanceof Error ? error.message : String(error),
        steps: [],
        trace: []
      };

      await writeEvent({ type: "result", payload: fallback });
    } finally {
      await writer.close();
    }
  })();

  return new Response(streamPair.readable, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
