import { NextResponse } from "next/server";
import { getAdminClient, requireCloudflareAccess } from "@/lib/supabase-admin";

type ModelOverride = { provider: string; model: string };
type SimulationVariant = "single" | "A" | "B";
type SimComplexity = "basic" | "medium" | "high";

type Body = {
  action?: string;
  scenario?: string;
  complexity?: SimComplexity;
  variant?: SimulationVariant;
  seed?: number;
  run_group_id?: string;
  model_overrides?: Record<string, ModelOverride>;
  /* Step-by-step fields (action: "step" | "complete") */
  step_name?: string;
  token?: string;
  api_base?: string;
  prompts?: { start: string; refine: string; trigger: string; iterate: string };
  request_id?: string;
  actor_id?: string | null;
  context?: Record<string, unknown>;
  /* Complete fields */
  steps?: SimStep[];
  ok?: boolean;
  error?: string;
};

type CandidateRecipeComponent = {
  component_id?: string;
  role?: string;
  title?: string;
  recipe?: {
    title?: string;
    description?: string;
    servings?: number;
    notes?: string;
    ingredients?: Array<{
      name?: string;
      amount?: number;
      unit?: string;
      category?: string;
      preparation?: string;
    }>;
    steps?: Array<{
      index?: number;
      instruction?: string;
      notes?: string;
      timer_seconds?: number;
    }>;
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

type TokenUsageSummary = {
  request_id: string | null;
  llm_call_count: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  scopes: string[];
  scope_stats: Record<string, {
    llm_call_count: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cost_usd: number;
    latency_ms: number;
  }>;
};

type ApiCallResult<T> = {
  data: T;
  request_id: string | null;
  server_ms: number | null;
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

const normalizeSeed = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Math.floor(Date.now() % 2_147_483_647);
  }
  return Math.max(1, Math.min(2_147_483_647, Math.floor(numeric)));
};

const normalizeComplexity = (value: unknown): SimComplexity => {
  if (value === "basic" || value === "medium" || value === "high") {
    return value;
  }
  return "medium";
};

const seededRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const pickSeeded = <T>(rng: () => number, values: readonly [T, ...T[]]): T =>
  values[Math.floor(rng() * values.length) % values.length]!;

const buildScenarioPrompts = (scenario: string, seed: number, complexity: SimComplexity): {
  start: string;
  refine: string;
  trigger: string;
  iterate: string;
} => {
  const rng = seededRandom(seed);
  const proteins: readonly [string, ...string[]] = [
    "chicken",
    "salmon",
    "tofu",
    "shrimp",
    "turkey",
  ];
  const spiceLevels: readonly [string, ...string[]] = ["mild", "medium", "spicy"];
  const sides: readonly [string, ...string[]] = ["broccoli", "green beans", "zucchini", "asparagus"];
  const quickMinutesBasic: readonly [number, ...number[]] = [25, 30, 35];
  const quickMinutesMedium: readonly [number, ...number[]] = [30, 35, 40];
  const quickMinutesHigh: readonly [number, ...number[]] = [35, 40, 45];
  const targetMinutesBasic: readonly [number, ...number[]] = [35, 45, 55];
  const targetMinutesMedium: readonly [number, ...number[]] = [50, 65, 80];
  const targetMinutesHigh: readonly [number, ...number[]] = [75, 90, 105];
  const diners: readonly [number, ...number[]] = [2, 3, 4];

  const protein = pickSeeded(rng, proteins);
  const spice = pickSeeded(rng, spiceLevels);
  const side = pickSeeded(rng, sides);
  const quickTargetMinutes = pickSeeded(
    rng,
    complexity === "high"
      ? quickMinutesHigh
      : complexity === "basic"
      ? quickMinutesBasic
      : quickMinutesMedium
  );
  const targetMinutes = pickSeeded(
    rng,
    complexity === "high"
      ? targetMinutesHigh
      : complexity === "basic"
      ? targetMinutesBasic
      : targetMinutesMedium
  );
  const servingCount = pickSeeded(rng, diners);
  const complexityWord = complexity === "high" ? "high-complexity" : complexity === "basic" ? "simple" : "moderately complex";
  const dishAnchor = `${spice} ${protein} with ${side}`;
  const complexityTargets = complexity === "high"
    ? "roughly 12-18 ingredients and 10-16 steps for the main component"
    : complexity === "basic"
    ? "roughly 6-9 ingredients and 4-7 steps for the main component"
    : "roughly 9-12 ingredients and 7-10 steps for the main component";
  const componentGuidance = complexity === "high"
    ? "Include a main plus 1-2 substantial supporting components."
    : complexity === "basic"
    ? "Prefer a main component, with at most one simple supporting component."
    : "Include a main plus one meaningful supporting component.";
  const techniqueGuidance = complexity === "high"
    ? "Use advanced techniques, layered prep, and explicit timing details."
    : complexity === "basic"
    ? "Keep technique straightforward and practical."
    : "Use clear, moderately detailed technique and timing.";

  if (scenario === "quick_weeknight") {
    return {
      start:
        `I need a quick weeknight dinner for ${servingCount}. Keep it ${complexityWord} but practical.`,
      refine:
        `Let's lock the dish to ${dishAnchor}. ${techniqueGuidance} ${componentGuidance}`,
      trigger:
        `Great, generate the full candidate recipe set for exactly that dish. Aim for ${complexityTargets}.`,
      iterate:
        `Looks good. Keep the same dish and core ingredients, but make it dairy-free and under ${quickTargetMinutes} minutes.`,
    };
  }

  return {
    start:
      `I want a ${complexityWord} dinner for ${servingCount} with coordinated components.`,
    refine:
      `Can we do ${dishAnchor}? ${componentGuidance} ${techniqueGuidance}`,
    trigger:
      `Perfect. Generate the full candidate recipe set for that exact dish. Aim for ${complexityTargets}. Include clear timers and step-by-step detail.`,
    iterate:
      `Nice. Keep the same dish identity and core ingredients, but bring total time under ${targetMinutes} minutes and keep it dairy-free.`,
  };
};

const extractRequestId = (
  payload: unknown,
  alchemyRequestIdHeader: string | null,
  requestIdHeader: string | null
): string | null => {
  if (typeof alchemyRequestIdHeader === "string" && alchemyRequestIdHeader.trim().length > 0) {
    return alchemyRequestIdHeader.trim();
  }
  if (typeof requestIdHeader === "string" && requestIdHeader.trim().length > 0) {
    return requestIdHeader.trim();
  }
  if (payload && typeof payload === "object" && "request_id" in payload) {
    const candidate = (payload as { request_id?: unknown }).request_id;
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const requestJson = async <T>(params: {
  apiBase: string;
  token: string;
  path: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: Record<string, unknown>;
  modelOverrides?: Record<string, ModelOverride>;
  retryAttempts?: number;
}): Promise<ApiCallResult<T>> => {
  const maxAttempts = Math.max(1, Math.min(4, Math.trunc(params.retryAttempts ?? 1)));
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
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
        const retryableStatus = response.status === 429 || response.status >= 500;
        const message = `HTTP ${response.status} ${params.method ?? "GET"} ${params.path}: ${
          typeof payload === "string" ? payload : JSON.stringify(payload)
        }`;

        if (retryableStatus && attempt < maxAttempts) {
          await sleep(150 * attempt);
          continue;
        }
        throw new Error(message);
      }

      return {
        data: payload as T,
        request_id: extractRequestId(
          payload,
          response.headers.get("x-alchemy-request-id"),
          response.headers.get("x-request-id")
        ),
        server_ms: (() => {
          const raw = Number(response.headers.get("x-alchemy-server-ms"));
          return Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : null;
        })()
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= maxAttempts) {
        break;
      }
      await sleep(150 * attempt);
    }
  }

  throw lastError ?? new Error(`Request failed: ${params.method ?? "GET"} ${params.path}`);
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

const projectCandidateForTrace = (candidate: CandidateRecipeSet | null | undefined): Record<string, unknown> | null => {
  if (!candidate || !Array.isArray(candidate.components) || candidate.components.length === 0) {
    return null;
  }

  const components = candidate.components.map((component) => {
    const recipe = component.recipe ?? {};
    const ingredients = Array.isArray(recipe.ingredients)
      ? recipe.ingredients
          .map((ingredient) => ({
            name: typeof ingredient.name === "string" ? ingredient.name : "",
            amount: typeof ingredient.amount === "number" ? ingredient.amount : null,
            unit: typeof ingredient.unit === "string" ? ingredient.unit : "",
            category: typeof ingredient.category === "string" ? ingredient.category : "",
            preparation: typeof ingredient.preparation === "string" ? ingredient.preparation : ""
          }))
          .filter((ingredient) => ingredient.name.length > 0)
      : [];

    const steps = Array.isArray(recipe.steps)
      ? recipe.steps
          .map((step, index) => ({
            index: typeof step.index === "number" && Number.isFinite(step.index) ? step.index : index + 1,
            instruction: typeof step.instruction === "string" ? step.instruction : "",
            notes: typeof step.notes === "string" ? step.notes : "",
            timer_seconds:
              typeof step.timer_seconds === "number" && Number.isFinite(step.timer_seconds) ? step.timer_seconds : null
          }))
          .filter((step) => step.instruction.length > 0)
      : [];

    const servings = typeof recipe.servings === "number" && Number.isFinite(recipe.servings) ? recipe.servings : null;

    return {
      component_id: component.component_id ?? "",
      role: component.role ?? "",
      title: component.title ?? "",
      recipe: {
        title: recipe.title ?? component.title ?? "",
        description: typeof recipe.description === "string" ? recipe.description : "",
        servings,
        notes: typeof recipe.notes === "string" ? recipe.notes : "",
        ingredient_count: ingredients.length,
        step_count: steps.length,
        ingredients,
        steps
      }
    };
  });

  return {
    candidate_id: candidate.candidate_id ?? "",
    revision: typeof candidate.revision === "number" && Number.isFinite(candidate.revision) ? candidate.revision : null,
    active_component_id: candidate.active_component_id ?? null,
    components
  };
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

/**
 * Standalone token-usage loader for step-by-step mode.
 * Mirrors the logic inside runSimulation but accepts client as a parameter
 * so it can be used from the per-step handler without the runSimulation closure.
 */
const loadStepTokenUsage = async (
  client: ReturnType<typeof getAdminClient>,
  apiRequestId: string | null
): Promise<{ tokenUsage: TokenUsageSummary | null; usageQueryMs: number; llmMs: number }> => {
  if (!apiRequestId) {
    return { tokenUsage: null, usageQueryMs: 0, llmMs: 0 };
  }
  const dbStart = Date.now();
  const { data, error } = await client
    .from("events")
    .select("token_input,token_output,token_total,cost_usd,latency_ms,event_payload")
    .eq("request_id", apiRequestId)
    .eq("event_type", "llm_call");
  const usageQueryMs = Date.now() - dbStart;
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const zeroUsage: TokenUsageSummary = {
    request_id: apiRequestId, llm_call_count: 0,
    input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0,
    scopes: [], scope_stats: {}
  };
  if (error || !Array.isArray(data)) {
    return { tokenUsage: zeroUsage, usageQueryMs, llmMs: 0 };
  }
  let inputTokens = 0, outputTokens = 0, totalTokens = 0, costUsd = 0;
  const scopes = new Set<string>();
  const scopeStats: Record<string, { llm_call_count: number; input_tokens: number; output_tokens: number; total_tokens: number; cost_usd: number; latency_ms: number }> = {};
  for (const row of data) {
    const r = row as Record<string, unknown>;
    const inp = num(r["token_input"]), out = num(r["token_output"]);
    const tot = Math.max(num(r["token_total"]), inp + out);
    inputTokens += inp; outputTokens += out; totalTokens += tot;
    costUsd += num(r["cost_usd"]);
    const latency = num(r["latency_ms"]);
    const payload = r["event_payload"];
    let scopeName = "unknown";
    if (payload && typeof payload === "object" && "scope" in payload) {
      const s = (payload as { scope?: unknown }).scope;
      if (typeof s === "string" && s.trim().length > 0) scopeName = s.trim();
    }
    scopes.add(scopeName);
    const cur = scopeStats[scopeName] ?? { llm_call_count: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0, latency_ms: 0 };
    cur.llm_call_count += 1; cur.input_tokens += inp; cur.output_tokens += out;
    cur.total_tokens += tot; cur.cost_usd += num(r["cost_usd"]); cur.latency_ms += latency;
    scopeStats[scopeName] = cur;
  }
  for (const key of Object.keys(scopeStats)) {
    scopeStats[key]!.cost_usd = Number(scopeStats[key]!.cost_usd.toFixed(6));
  }
  const llmMs = Object.values(scopeStats).reduce((sum, s) => sum + Math.max(0, s.latency_ms), 0);
  return {
    tokenUsage: {
      request_id: apiRequestId, llm_call_count: data.length,
      input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: totalTokens,
      cost_usd: Number(costUsd.toFixed(6)), scopes: Array.from(scopes), scope_stats: scopeStats
    },
    usageQueryMs, llmMs
  };
};

/* ---------- Step-by-step execution types ---------- */

type StepExecParams = {
  client: ReturnType<typeof getAdminClient>;
  apiBase: string;
  token: string;
  prompts: { start: string; refine: string; trigger: string; iterate: string };
  modelOverrides: Record<string, ModelOverride>;
  ctx: Record<string, unknown>;
};

type StepExecResult = {
  result: Record<string, unknown>;
  contextUpdates: Record<string, unknown>;
};

/* ---------- Per-step executors ---------- */

const execChatStart = async (p: StepExecParams): Promise<StepExecResult> => {
  const t0 = Date.now();
  const api = await requestJson<ChatApiResponse>({
    apiBase: p.apiBase, token: p.token, path: "/chat", method: "POST",
    body: { message: p.prompts.start }, modelOverrides: p.modelOverrides, retryAttempts: 1
  });
  const apiMs = Date.now() - t0;
  const response = api.data;
  const { tokenUsage, usageQueryMs, llmMs } = await loadStepTokenUsage(p.client, api.request_id);
  assertCondition(typeof response.id === "string" && response.id.length > 0, "Chat session id missing");
  return {
    result: {
      chat_id: response.id, user_prompt: p.prompts.start, api_request_id: api.request_id,
      token_usage: tokenUsage,
      timing: { api_ms: apiMs, usage_query_ms: usageQueryMs, llm_ms: llmMs, server_ms: api.server_ms },
      loop_state: response.loop_state ?? "unknown",
      assistant_reply: extractAssistantText(response),
      message_count: Array.isArray(response.messages) ? response.messages.length : 0,
      thread_tail: Array.isArray(response.messages) ? response.messages.slice(-6) : []
    },
    contextUpdates: { chat_id: response.id }
  };
};

const execChatRefine = async (p: StepExecParams): Promise<StepExecResult> => {
  const chatId = String(p.ctx["chat_id"] ?? "");
  assertCondition(chatId.length > 0, "chat_id missing in context");
  const t0 = Date.now();
  const api = await requestJson<ChatApiResponse>({
    apiBase: p.apiBase, token: p.token, path: `/chat/${chatId}/messages`, method: "POST",
    body: { message: p.prompts.refine }, modelOverrides: p.modelOverrides, retryAttempts: 1
  });
  const apiMs = Date.now() - t0;
  const response = api.data;
  const { tokenUsage, usageQueryMs, llmMs } = await loadStepTokenUsage(p.client, api.request_id);
  const candidateCount = Array.isArray(response.candidate_recipe_set?.components)
    ? response.candidate_recipe_set.components.length : 0;
  return {
    result: {
      user_prompt: p.prompts.refine, api_request_id: api.request_id, token_usage: tokenUsage,
      timing: { api_ms: apiMs, usage_query_ms: usageQueryMs, llm_ms: llmMs, server_ms: api.server_ms },
      loop_state: response.loop_state ?? "unknown",
      assistant_reply: extractAssistantText(response),
      message_count: Array.isArray(response.messages) ? response.messages.length : 0,
      candidate_summary: summarizeComponents(response.candidate_recipe_set),
      candidate_snapshot: projectCandidateForTrace(response.candidate_recipe_set),
      candidate_count: candidateCount,
      thread_tail: Array.isArray(response.messages) ? response.messages.slice(-6) : []
    },
    contextUpdates: {
      refine_candidate_count: candidateCount,
      refine_candidate_summary: summarizeComponents(response.candidate_recipe_set),
      refine_candidate_snapshot: projectCandidateForTrace(response.candidate_recipe_set),
      refine_loop_state: response.loop_state ?? "unknown",
      refine_assistant_reply: extractAssistantText(response),
      refine_thread_tail: Array.isArray(response.messages) ? response.messages.slice(-6) : []
    }
  };
};

const execChatGenerationTrigger = async (p: StepExecParams): Promise<StepExecResult> => {
  const chatId = String(p.ctx["chat_id"] ?? "");
  assertCondition(chatId.length > 0, "chat_id missing in context");
  const refineCount = Number(p.ctx["refine_candidate_count"] ?? 0);

  if (refineCount === 0) {
    /* Refine didn't produce candidates — send explicit generation trigger */
    const t0 = Date.now();
    const api = await requestJson<ChatApiResponse>({
      apiBase: p.apiBase, token: p.token, path: `/chat/${chatId}/messages`, method: "POST",
      body: { message: p.prompts.trigger }, modelOverrides: p.modelOverrides, retryAttempts: 1
    });
    const apiMs = Date.now() - t0;
    const response = api.data;
    const { tokenUsage, usageQueryMs, llmMs } = await loadStepTokenUsage(p.client, api.request_id);
    const candidateCount = Array.isArray(response.candidate_recipe_set?.components)
      ? response.candidate_recipe_set.components.length : 0;
    assertCondition(candidateCount > 0,
      `chat_generation_trigger did not produce candidates (loop_state=${response.loop_state ?? "unknown"})`);
    const summary = summarizeComponents(response.candidate_recipe_set);
    const snapshot = projectCandidateForTrace(response.candidate_recipe_set);
    return {
      result: {
        generation_prompt: p.prompts.trigger, generation_source: "chat_generation_trigger",
        loop_state: response.loop_state ?? "unknown",
        candidate_id: response.candidate_recipe_set?.candidate_id ?? "",
        revision: typeof response.candidate_recipe_set?.revision === "number" ? response.candidate_recipe_set.revision : null,
        active_component_id: response.candidate_recipe_set?.active_component_id ?? null,
        candidate_count: candidateCount, candidate_summary: summary, candidate_snapshot: snapshot,
        assistant_reply: extractAssistantText(response),
        thread_tail: Array.isArray(response.messages) ? response.messages.slice(-6) : [],
        reused_candidate_from_step: null,
        api_request_id: api.request_id, token_usage: tokenUsage,
        timing: { api_ms: apiMs, usage_query_ms: usageQueryMs, llm_ms: llmMs, server_ms: api.server_ms }
      },
      contextUpdates: {
        ensured_candidate_id: response.candidate_recipe_set?.candidate_id ?? "",
        ensured_revision: typeof response.candidate_recipe_set?.revision === "number" ? response.candidate_recipe_set.revision : null,
        ensured_active_component_id: response.candidate_recipe_set?.active_component_id ?? null,
        ensured_candidate_count: candidateCount, ensured_candidate_summary: summary, ensured_candidate_snapshot: snapshot
      }
    };
  }

  /* Refine already produced candidates — reuse them */
  const snap = (p.ctx["refine_candidate_snapshot"] ?? null) as Record<string, unknown> | null;
  const candidateId = snap ? String(snap["candidate_id"] ?? "") : "";
  const revision = snap && typeof snap["revision"] === "number" ? snap["revision"] : null;
  const activeComponentId = snap ? (String(snap["active_component_id"] ?? "") || null) : null;
  const refineSummary = Array.isArray(p.ctx["refine_candidate_summary"]) ? p.ctx["refine_candidate_summary"] : [];
  return {
    result: {
      generation_prompt: p.prompts.refine, generation_source: "chat_refine",
      loop_state: String(p.ctx["refine_loop_state"] ?? "unknown"),
      candidate_id: candidateId, revision, active_component_id: activeComponentId,
      candidate_count: refineCount, candidate_summary: refineSummary,
      candidate_snapshot: snap,
      assistant_reply: String(p.ctx["refine_assistant_reply"] ?? ""),
      thread_tail: Array.isArray(p.ctx["refine_thread_tail"]) ? p.ctx["refine_thread_tail"] : [],
      reused_candidate_from_step: "chat_refine", api_request_id: null,
      token_usage: { request_id: null, llm_call_count: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0, scopes: [], scope_stats: {} },
      timing: { api_ms: 0, usage_query_ms: 0, llm_ms: 0, server_ms: 0 }
    },
    contextUpdates: {
      ensured_candidate_id: candidateId, ensured_revision: revision,
      ensured_active_component_id: activeComponentId, ensured_candidate_count: refineCount,
      ensured_candidate_summary: refineSummary, ensured_candidate_snapshot: snap
    }
  };
};

const execCandidateSetActiveComponent = async (p: StepExecParams): Promise<StepExecResult> => {
  const chatId = String(p.ctx["chat_id"] ?? "");
  const candidateSummary = Array.isArray(p.ctx["ensured_candidate_summary"]) ? p.ctx["ensured_candidate_summary"] : [];
  const second = candidateSummary[1] as Record<string, unknown> | undefined;
  const targetId = second && typeof second["component_id"] === "string" ? second["component_id"].trim() : "";

  if (!targetId) {
    return {
      result: { skipped: true, reason: "candidate has fewer than 2 components", candidate_snapshot: p.ctx["ensured_candidate_snapshot"] ?? null },
      contextUpdates: { active_component_candidate_snapshot: p.ctx["ensured_candidate_snapshot"] ?? null }
    };
  }

  const t0 = Date.now();
  const api = await requestJson<ChatApiResponse>({
    apiBase: p.apiBase, token: p.token, path: `/chat/${chatId}/candidate`, method: "PATCH",
    body: { action: "set_active_component", component_id: targetId }, modelOverrides: p.modelOverrides, retryAttempts: 1
  });
  const apiMs = Date.now() - t0;
  const response = api.data;
  assertCondition(response.candidate_recipe_set?.active_component_id === targetId,
    `set_active_component failed (expected ${targetId}, got ${String(response.candidate_recipe_set?.active_component_id)})`);
  return {
    result: {
      skipped: false, target_component_id: targetId, active_component_id: targetId,
      api_request_id: api.request_id,
      token_usage: { request_id: api.request_id, llm_call_count: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0, scopes: [], scope_stats: {} },
      timing: { api_ms: apiMs, usage_query_ms: 0, llm_ms: 0, server_ms: api.server_ms },
      candidate_summary: summarizeComponents(response.candidate_recipe_set),
      candidate_snapshot: projectCandidateForTrace(response.candidate_recipe_set)
    },
    contextUpdates: { active_component_candidate_snapshot: projectCandidateForTrace(response.candidate_recipe_set) }
  };
};

const execChatIterateCandidate = async (p: StepExecParams): Promise<StepExecResult> => {
  const chatId = String(p.ctx["chat_id"] ?? "");
  assertCondition(chatId.length > 0, "chat_id missing in context");
  const t0 = Date.now();
  const api = await requestJson<ChatApiResponse>({
    apiBase: p.apiBase, token: p.token, path: `/chat/${chatId}/messages`, method: "POST",
    body: { message: p.prompts.iterate }, modelOverrides: p.modelOverrides, retryAttempts: 1
  });
  const apiMs = Date.now() - t0;
  const response = api.data;
  const { tokenUsage, usageQueryMs, llmMs } = await loadStepTokenUsage(p.client, api.request_id);
  const components = summarizeComponents(response.candidate_recipe_set);
  assertCondition(components.length > 0, "Iteration response lost candidate recipe set");
  return {
    result: {
      user_prompt: p.prompts.iterate, tweak_prompt: p.prompts.iterate,
      api_request_id: api.request_id, token_usage: tokenUsage,
      timing: { api_ms: apiMs, usage_query_ms: usageQueryMs, llm_ms: llmMs, server_ms: api.server_ms },
      loop_state: response.loop_state ?? "unknown",
      assistant_reply: extractAssistantText(response),
      message_count: Array.isArray(response.messages) ? response.messages.length : 0,
      candidate_id: response.candidate_recipe_set?.candidate_id ?? String(p.ctx["ensured_candidate_id"] ?? ""),
      revision: response.candidate_recipe_set?.revision ?? (typeof p.ctx["ensured_revision"] === "number" ? p.ctx["ensured_revision"] : null),
      active_component_id: response.candidate_recipe_set?.active_component_id ?? (typeof p.ctx["ensured_active_component_id"] === "string" ? p.ctx["ensured_active_component_id"] : null),
      candidate_summary: components,
      candidate_snapshot_before: p.ctx["active_component_candidate_snapshot"] ?? null,
      candidate_snapshot: projectCandidateForTrace(response.candidate_recipe_set),
      thread_tail: Array.isArray(response.messages) ? response.messages.slice(-6) : []
    },
    contextUpdates: {}
  };
};

const execCommitCandidateSet = async (p: StepExecParams): Promise<StepExecResult> => {
  const chatId = String(p.ctx["chat_id"] ?? "");
  assertCondition(chatId.length > 0, "chat_id missing in context");
  const t0 = Date.now();
  const api = await requestJson<ChatApiResponse>({
    apiBase: p.apiBase, token: p.token, path: `/chat/${chatId}/commit`, method: "POST",
    body: {}, modelOverrides: p.modelOverrides, retryAttempts: 1
  });
  const apiMs = Date.now() - t0;
  const response = api.data;
  const { tokenUsage, usageQueryMs, llmMs } = await loadStepTokenUsage(p.client, api.request_id);
  const recipes = Array.isArray(response.commit?.recipes) ? response.commit.recipes : [];
  assertCondition(recipes.length > 0, "Commit did not return persisted recipe ids");
  const mapped = recipes.map((r) => ({
    component_id: r.component_id ?? "", role: r.role ?? "", title: r.title ?? "",
    recipe_id: r.recipe_id ?? "", recipe_version_id: r.recipe_version_id ?? ""
  }));
  return {
    result: {
      api_request_id: api.request_id, token_usage: tokenUsage,
      timing: { api_ms: apiMs, usage_query_ms: usageQueryMs, llm_ms: llmMs, server_ms: api.server_ms },
      loop_state: response.loop_state ?? "unknown",
      committed_count: Number(response.commit?.committed_count ?? recipes.length),
      recipes: mapped,
      link_count: Array.isArray(response.commit?.links) ? response.commit.links.length : 0,
      post_save_options: Array.isArray(response.commit?.post_save_options) ? response.commit.post_save_options : []
    },
    contextUpdates: { primary_recipe_id: String(mapped[0]?.recipe_id ?? "") }
  };
};

const execFetchCommittedRecipe = async (p: StepExecParams): Promise<StepExecResult> => {
  const recipeId = String(p.ctx["primary_recipe_id"] ?? "");
  assertCondition(recipeId.length > 0, "No primary recipe id available after commit");
  const t0 = Date.now();
  const api = await requestJson<RecipeApiResponse>({
    apiBase: p.apiBase, token: p.token,
    path: `/recipes/${recipeId}?units=metric&group_by=component&inline_measurements=true`,
    method: "GET", modelOverrides: p.modelOverrides, retryAttempts: 1
  });
  const apiMs = Date.now() - t0;
  const recipe = api.data;
  const { tokenUsage, usageQueryMs, llmMs } = await loadStepTokenUsage(p.client, api.request_id);
  return {
    result: {
      api_request_id: api.request_id, token_usage: tokenUsage,
      timing: { api_ms: apiMs, usage_query_ms: usageQueryMs, llm_ms: llmMs, server_ms: api.server_ms },
      recipe_id: recipeId, title: recipe.title ?? "",
      ingredient_count: Array.isArray(recipe.ingredients) ? recipe.ingredients.length : 0,
      step_count: Array.isArray(recipe.steps) ? recipe.steps.length : 0,
      ingredient_group_count: Array.isArray(recipe.ingredient_groups) ? recipe.ingredient_groups.length : 0
    },
    contextUpdates: { fetched_recipe_id: recipeId }
  };
};

const execFetchCookbook = async (p: StepExecParams): Promise<StepExecResult> => {
  const recipeId = String(p.ctx["fetched_recipe_id"] ?? p.ctx["primary_recipe_id"] ?? "");
  const t0 = Date.now();
  const api = await requestJson<CookbookApiResponse>({
    apiBase: p.apiBase, token: p.token, path: "/recipes/cookbook", method: "GET",
    modelOverrides: p.modelOverrides, retryAttempts: 1
  });
  const apiMs = Date.now() - t0;
  const response = api.data;
  const { tokenUsage, usageQueryMs, llmMs } = await loadStepTokenUsage(p.client, api.request_id);
  const items = Array.isArray(response.items) ? response.items : [];
  const containsCommitted = items.some((item) => (item.recipe_id ?? item.id ?? "") === recipeId);
  return {
    result: {
      api_request_id: api.request_id, token_usage: tokenUsage,
      timing: { api_ms: apiMs, usage_query_ms: usageQueryMs, llm_ms: llmMs, server_ms: api.server_ms },
      item_count: items.length, contains_primary_recipe: containsCommitted
    },
    contextUpdates: {}
  };
};

/** Dispatches to the correct step executor by name. */
const executeSimStep = async (stepName: string, p: StepExecParams): Promise<StepExecResult> => {
  switch (stepName) {
    case "chat_start": return execChatStart(p);
    case "chat_refine": return execChatRefine(p);
    case "chat_generation_trigger": return execChatGenerationTrigger(p);
    case "candidate_set_active_component": return execCandidateSetActiveComponent(p);
    case "chat_iterate_candidate": return execChatIterateCandidate(p);
    case "commit_candidate_set": return execCommitCandidateSet(p);
    case "fetch_committed_recipe": return execFetchCommittedRecipe(p);
    case "fetch_cookbook": return execFetchCookbook(p);
    default: throw new Error(`Unknown simulation step: ${stepName}`);
  }
};

/* ---------- Action handlers for step-by-step mode ---------- */

/**
 * action: "init" — acquires sim token, builds scenario prompts, logs run_started.
 * Returns context the client needs to drive subsequent step calls.
 */
const handleSimInit = async (body: Body): Promise<Response> => {
  const identity = await requireCloudflareAccess();
  const client = getAdminClient();
  const { data: actor } = await client.from("users").select("id").eq("email", identity.email).maybeSingle();

  const scenario = (body.scenario ?? "default_api_ux").trim() || "default_api_ux";
  const complexity = normalizeComplexity(body.complexity);
  const seed = normalizeSeed(body.seed);
  const variant: SimulationVariant = body.variant ?? "single";
  const runGroupId = typeof body.run_group_id === "string" && body.run_group_id.trim().length > 0
    ? body.run_group_id.trim() : crypto.randomUUID();
  const modelOverrides = body.model_overrides ?? {};

  const apiBase = normalizeApiBase(process.env["API_BASE_URL"]);
  const supabaseUrl = (process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "").trim().replace(/\/+$/, "");
  const serviceKey = process.env["SUPABASE_SECRET_KEY"] ?? process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";

  let token: string;
  try {
    token = process.env["ADMIN_SIMULATION_BEARER_TOKEN"] ?? await getSimToken(supabaseUrl, serviceKey);
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to acquire simulation token: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }

  const requestId = crypto.randomUUID();
  const prompts = buildScenarioPrompts(scenario, seed, complexity);

  await client.from("events").insert({
    user_id: actor?.id ?? null,
    event_type: "simulation_run_started",
    request_id: requestId,
    event_payload: {
      scenario, complexity, variant, seed, run_group_id: runGroupId, trigger: "admin_ui",
      model_overrides: Object.keys(modelOverrides).length > 0 ? modelOverrides : undefined
    }
  });

  return NextResponse.json({ request_id: requestId, token, api_base: apiBase, prompts, actor_id: actor?.id ?? null });
};

/**
 * action: "step" — executes a single simulation step (one API call + token usage query).
 * The client passes accumulated context from previous steps.
 */
const handleSimStep = async (body: Body): Promise<Response> => {
  await requireCloudflareAccess();
  const client = getAdminClient();

  const stepName = body.step_name ?? "";
  const token = body.token ?? "";
  const apiBase = body.api_base ?? "";
  const prompts = body.prompts ?? { start: "", refine: "", trigger: "", iterate: "" };
  const modelOverrides = body.model_overrides ?? {};
  const ctx = body.context ?? {};

  if (!token || !apiBase || !stepName) {
    return NextResponse.json({ error: "Missing required step fields (step_name, token, api_base)" }, { status: 400 });
  }

  const startedAt = Date.now();
  try {
    const { result, contextUpdates } = await executeSimStep(stepName, {
      client, apiBase, token, prompts, modelOverrides, ctx
    });
    const latencyMs = Date.now() - startedAt;
    return NextResponse.json({
      step: { name: stepName, status: "ok", latency_ms: latencyMs, started_at: new Date(startedAt).toISOString(), completed_at: new Date().toISOString(), result },
      context_updates: contextUpdates
    });
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({
      step: { name: stepName, status: "failed", latency_ms: latencyMs, started_at: new Date(startedAt).toISOString(), completed_at: new Date().toISOString(), error: message },
      context_updates: {}
    });
  }
};

/**
 * action: "complete" — logs the final simulation_run_completed or _failed event.
 * Called by the client after all steps finish (or on failure).
 */
const handleSimComplete = async (body: Body): Promise<Response> => {
  await requireCloudflareAccess();
  const client = getAdminClient();

  const requestId = body.request_id ?? "";
  const actorId = body.actor_id ?? null;
  const steps = Array.isArray(body.steps) ? body.steps : [];
  const totalMs = steps.reduce((sum, s) => sum + (s.latency_ms ?? 0), 0);

  if (body.ok) {
    const checks: SimChecks = {
      zero_failed_steps: steps.every((s) => s.status === "ok"),
      steps_executed: steps.length, total_latency_ms: totalMs,
      timestamp: new Date().toISOString()
    };
    await client.from("events").insert({
      user_id: actorId, event_type: "simulation_run_completed",
      request_id: requestId, latency_ms: totalMs,
      event_payload: {
        scenario: body.scenario,
        complexity: body.complexity,
        variant: body.variant,
        seed: body.seed,
        run_group_id: body.run_group_id,
        prompts: body.prompts,
        checks,
        steps
      }
    });
  } else {
    await client.from("events").insert({
      user_id: actorId, event_type: "simulation_run_failed",
      request_id: requestId, latency_ms: totalMs,
      event_payload: {
        scenario: body.scenario,
        complexity: body.complexity,
        variant: body.variant,
        seed: body.seed,
        run_group_id: body.run_group_id,
        error: body.error,
        steps
      }
    });
  }

  return NextResponse.json({ ok: true });
};

const runSimulation = async (params: {
  scenario: string;
  complexity: SimComplexity;
  variant: SimulationVariant;
  seed: number;
  runGroupId: string;
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
  const toFiniteNumber = (value: unknown): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return 0;
    }
    return value;
  };
  const loadTokenUsage = async (apiRequestId: string | null): Promise<TokenUsageSummary | null> => {
    if (!apiRequestId) {
      return null;
    }

    const { data, error } = await client
      .from("events")
      .select("token_input,token_output,token_total,cost_usd,latency_ms,event_payload")
      .eq("request_id", apiRequestId)
      .eq("event_type", "llm_call");

    if (error) {
      return {
        request_id: apiRequestId,
        llm_call_count: 0,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        cost_usd: 0,
        scopes: [],
        scope_stats: {}
      };
    }

    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let costUsd = 0;
    const scopes = new Set<string>();
    const scopeStats = new Map<string, {
      llm_call_count: number;
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      cost_usd: number;
      latency_ms: number;
    }>();
    const rows = Array.isArray(data) ? data : [];

    for (const row of rows) {
      const input = toFiniteNumber((row as { token_input?: unknown }).token_input);
      const output = toFiniteNumber((row as { token_output?: unknown }).token_output);
      const total = Math.max(toFiniteNumber((row as { token_total?: unknown }).token_total), input + output);
      inputTokens += input;
      outputTokens += output;
      totalTokens += total;
      costUsd += toFiniteNumber((row as { cost_usd?: unknown }).cost_usd);
      const latency = toFiniteNumber((row as { latency_ms?: unknown }).latency_ms);

      const payload = (row as { event_payload?: unknown }).event_payload;
      let scopeName = "unknown";
      if (payload && typeof payload === "object" && "scope" in payload) {
        const scope = (payload as { scope?: unknown }).scope;
        if (typeof scope === "string" && scope.trim().length > 0) {
          scopeName = scope.trim();
        }
      }
      scopes.add(scopeName);
      const current = scopeStats.get(scopeName) ?? {
        llm_call_count: 0,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        cost_usd: 0,
        latency_ms: 0
      };
      current.llm_call_count += 1;
      current.input_tokens += input;
      current.output_tokens += output;
      current.total_tokens += total;
      current.cost_usd += toFiniteNumber((row as { cost_usd?: unknown }).cost_usd);
      current.latency_ms += latency;
      scopeStats.set(scopeName, current);
    }

    const scopeStatsObj: TokenUsageSummary["scope_stats"] = {};
    for (const [scope, stats] of scopeStats.entries()) {
      scopeStatsObj[scope] = {
        llm_call_count: stats.llm_call_count,
        input_tokens: stats.input_tokens,
        output_tokens: stats.output_tokens,
        total_tokens: stats.total_tokens,
        cost_usd: Number(stats.cost_usd.toFixed(6)),
        latency_ms: stats.latency_ms
      };
    }

    return {
      request_id: apiRequestId,
      llm_call_count: rows.length,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      cost_usd: Number(costUsd.toFixed(6)),
      scopes: Array.from(scopes),
      scope_stats: scopeStatsObj
    };
  };
  const sumLlmLatencyMs = (usage: TokenUsageSummary | null): number => {
    if (!usage) {
      return 0;
    }
    return Object.values(usage.scope_stats).reduce((sum, scope) => {
      return sum + Math.max(0, Number(scope.latency_ms || 0));
    }, 0);
  };
  const loadTokenUsageWithTiming = async (
    apiRequestId: string | null
  ): Promise<{ tokenUsage: TokenUsageSummary | null; usageQueryMs: number; llmMs: number }> => {
    const dbStartedAt = Date.now();
    const tokenUsage = await loadTokenUsage(apiRequestId);
    const usageQueryMs = Date.now() - dbStartedAt;
    return {
      tokenUsage,
      usageQueryMs,
      llmMs: sumLlmLatencyMs(tokenUsage)
    };
  };

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
        complexity: params.complexity,
        variant: params.variant,
        seed: params.seed,
        run_group_id: params.runGroupId,
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

    const prompts = buildScenarioPrompts(params.scenario, params.seed, params.complexity);

    const chat = await runStep("chat_start", async () => {
      const apiStartedAt = Date.now();
      const api = await requestJson<ChatApiResponse>({
        apiBase,
        token,
        path: "/chat",
        method: "POST",
        body: { message: prompts.start },
        modelOverrides: params.modelOverrides,
        retryAttempts: 1
      });
      const apiMs = Date.now() - apiStartedAt;
      const response = api.data;
      const { tokenUsage, usageQueryMs, llmMs } = await loadTokenUsageWithTiming(api.request_id);

      assertCondition(typeof response.id === "string" && response.id.length > 0, "Chat session id missing");

      return {
        chat_id: response.id,
        user_prompt: prompts.start,
        api_request_id: api.request_id,
        token_usage: tokenUsage,
        timing: { api_ms: apiMs, usage_query_ms: usageQueryMs, llm_ms: llmMs, server_ms: api.server_ms },
        loop_state: response.loop_state ?? "unknown",
        assistant_reply: extractAssistantText(response),
        message_count: Array.isArray(response.messages) ? response.messages.length : 0,
        thread_tail: Array.isArray(response.messages) ? response.messages.slice(-6) : []
      };
    });

    const refine = await runStep("chat_refine", async () => {
      const apiStartedAt = Date.now();
      const api = await requestJson<ChatApiResponse>({
        apiBase,
        token,
        path: `/chat/${chat.chat_id}/messages`,
        method: "POST",
        body: { message: prompts.refine },
        modelOverrides: params.modelOverrides,
        retryAttempts: 1
      });
      const apiMs = Date.now() - apiStartedAt;
      const response = api.data;
      const { tokenUsage, usageQueryMs, llmMs } = await loadTokenUsageWithTiming(api.request_id);

      return {
        user_prompt: prompts.refine,
        api_request_id: api.request_id,
        token_usage: tokenUsage,
        timing: { api_ms: apiMs, usage_query_ms: usageQueryMs, llm_ms: llmMs, server_ms: api.server_ms },
        loop_state: response.loop_state ?? "unknown",
        assistant_reply: extractAssistantText(response),
        message_count: Array.isArray(response.messages) ? response.messages.length : 0,
        candidate_summary: summarizeComponents(response.candidate_recipe_set),
        candidate_snapshot: projectCandidateForTrace(response.candidate_recipe_set),
        candidate_count: Array.isArray(response.candidate_recipe_set?.components)
          ? response.candidate_recipe_set.components.length
          : 0,
        thread_tail: Array.isArray(response.messages) ? response.messages.slice(-6) : []
      };
    });

    const ensuredCandidate = await runStep("chat_generation_trigger", async () => {
      if (refine.candidate_count === 0) {
        const apiStartedAt = Date.now();
        const api = await requestJson<ChatApiResponse>({
          apiBase,
          token,
          path: `/chat/${chat.chat_id}/messages`,
          method: "POST",
          body: { message: prompts.trigger },
          modelOverrides: params.modelOverrides,
          retryAttempts: 1
        });
        const apiMs = Date.now() - apiStartedAt;
        const response = api.data;
        const { tokenUsage, usageQueryMs, llmMs } = await loadTokenUsageWithTiming(api.request_id);

        const candidateCount = Array.isArray(response.candidate_recipe_set?.components)
          ? response.candidate_recipe_set.components.length
          : 0;
        assertCondition(
          candidateCount > 0,
          `chat_generation_trigger did not produce candidate tabs (loop_state=${response.loop_state ?? "unknown"})`
        );

        return {
          generation_prompt: prompts.trigger,
          generation_source: "chat_generation_trigger",
          loop_state: response.loop_state ?? "unknown",
          candidate_id: response.candidate_recipe_set?.candidate_id ?? "",
          revision:
            typeof response.candidate_recipe_set?.revision === "number"
              ? response.candidate_recipe_set.revision
              : null,
          active_component_id: response.candidate_recipe_set?.active_component_id ?? null,
          candidate_count: candidateCount,
          candidate_summary: summarizeComponents(response.candidate_recipe_set),
          candidate_snapshot: projectCandidateForTrace(response.candidate_recipe_set),
          assistant_reply: extractAssistantText(response),
          thread_tail: Array.isArray(response.messages) ? response.messages.slice(-6) : [],
          reused_candidate_from_step: null,
          api_request_id: api.request_id,
          token_usage: tokenUsage,
          timing: { api_ms: apiMs, usage_query_ms: usageQueryMs, llm_ms: llmMs, server_ms: api.server_ms }
        };
      }

      return {
        generation_prompt: prompts.refine,
        generation_source: "chat_refine",
        loop_state: refine.loop_state,
        candidate_id:
          typeof refine.candidate_snapshot?.["candidate_id"] === "string"
            ? (refine.candidate_snapshot["candidate_id"] as string)
            : "",
        revision:
          typeof refine.candidate_snapshot?.["revision"] === "number"
            ? (refine.candidate_snapshot["revision"] as number)
            : null,
        active_component_id:
          typeof refine.candidate_snapshot?.["active_component_id"] === "string"
            ? (refine.candidate_snapshot["active_component_id"] as string)
            : null,
        candidate_count: refine.candidate_count,
        candidate_summary: refine.candidate_summary,
        candidate_snapshot: refine.candidate_snapshot ?? null,
        assistant_reply: refine.assistant_reply,
        thread_tail: refine.thread_tail,
        reused_candidate_from_step: "chat_refine",
        api_request_id: null,
        token_usage: {
          request_id: null,
          llm_call_count: 0,
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          cost_usd: 0,
          scopes: [],
          scope_stats: {}
        },
        timing: { api_ms: 0, usage_query_ms: 0, llm_ms: 0, server_ms: 0 }
      };
    });

    const activeComponentSync = await runStep("candidate_set_active_component", async () => {
      const candidateSummary = Array.isArray(ensuredCandidate.candidate_summary)
        ? ensuredCandidate.candidate_summary
        : [];
      const secondComponent = candidateSummary[1];
      const targetComponentId =
        secondComponent && typeof secondComponent["component_id"] === "string"
          ? (secondComponent["component_id"] as string).trim()
          : "";

      if (!targetComponentId) {
        return {
          skipped: true,
          reason: "candidate has fewer than 2 components",
          candidate_snapshot: ensuredCandidate.candidate_snapshot ?? null
        };
      }

      const apiStartedAt = Date.now();
      const api = await requestJson<ChatApiResponse>({
        apiBase,
        token,
        path: `/chat/${chat.chat_id}/candidate`,
        method: "PATCH",
        body: { action: "set_active_component", component_id: targetComponentId },
        modelOverrides: params.modelOverrides,
        retryAttempts: 1
      });
      const apiMs = Date.now() - apiStartedAt;
      const response = api.data;
      const activeComponentId = response.candidate_recipe_set?.active_component_id ?? null;
      assertCondition(
        activeComponentId === targetComponentId,
        `set_active_component failed (expected ${targetComponentId}, got ${String(activeComponentId)})`
      );

      return {
        skipped: false,
        target_component_id: targetComponentId,
        active_component_id: activeComponentId,
        api_request_id: api.request_id,
        token_usage: {
          request_id: api.request_id,
          llm_call_count: 0,
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          cost_usd: 0,
          scopes: [],
          scope_stats: {}
        },
        timing: { api_ms: apiMs, usage_query_ms: 0, llm_ms: 0, server_ms: api.server_ms },
        candidate_summary: summarizeComponents(response.candidate_recipe_set),
        candidate_snapshot: projectCandidateForTrace(response.candidate_recipe_set)
      };
    });

    const iterated = await runStep("chat_iterate_candidate", async () => {
      const apiStartedAt = Date.now();
      const api = await requestJson<ChatApiResponse>({
        apiBase,
        token,
        path: `/chat/${chat.chat_id}/messages`,
        method: "POST",
        body: { message: prompts.iterate },
        modelOverrides: params.modelOverrides,
        retryAttempts: 1
      });
      const apiMs = Date.now() - apiStartedAt;
      const response = api.data;
      const { tokenUsage, usageQueryMs, llmMs } = await loadTokenUsageWithTiming(api.request_id);

      const components = summarizeComponents(response.candidate_recipe_set);
      assertCondition(components.length > 0, "Iteration response lost candidate recipe set");

      return {
        user_prompt: prompts.iterate,
        tweak_prompt: prompts.iterate,
        api_request_id: api.request_id,
        token_usage: tokenUsage,
        timing: { api_ms: apiMs, usage_query_ms: usageQueryMs, llm_ms: llmMs, server_ms: api.server_ms },
        loop_state: response.loop_state ?? "unknown",
        assistant_reply: extractAssistantText(response),
        message_count: Array.isArray(response.messages) ? response.messages.length : 0,
        candidate_id: response.candidate_recipe_set?.candidate_id ?? ensuredCandidate.candidate_id,
        revision: response.candidate_recipe_set?.revision ?? ensuredCandidate.revision,
        active_component_id: response.candidate_recipe_set?.active_component_id ?? ensuredCandidate.active_component_id,
        candidate_summary: components,
        candidate_snapshot_before:
          typeof activeComponentSync.candidate_snapshot === "object" && activeComponentSync.candidate_snapshot !== null
            ? activeComponentSync.candidate_snapshot
            : null,
        candidate_snapshot: projectCandidateForTrace(response.candidate_recipe_set),
        thread_tail: Array.isArray(response.messages) ? response.messages.slice(-6) : []
      };
    });

    const committed = await runStep("commit_candidate_set", async () => {
      const apiStartedAt = Date.now();
      const api = await requestJson<ChatApiResponse>({
        apiBase,
        token,
        path: `/chat/${chat.chat_id}/commit`,
        method: "POST",
        body: {},
        modelOverrides: params.modelOverrides,
        retryAttempts: 1
      });
      const apiMs = Date.now() - apiStartedAt;
      const response = api.data;
      const { tokenUsage, usageQueryMs, llmMs } = await loadTokenUsageWithTiming(api.request_id);

      const recipes = Array.isArray(response.commit?.recipes) ? response.commit?.recipes : [];
      assertCondition(recipes.length > 0, "Commit did not return persisted recipe ids");

      return {
        api_request_id: api.request_id,
        token_usage: tokenUsage,
        timing: { api_ms: apiMs, usage_query_ms: usageQueryMs, llm_ms: llmMs, server_ms: api.server_ms },
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

      const apiStartedAt = Date.now();
      const api = await requestJson<RecipeApiResponse>({
        apiBase,
        token,
        path: `/recipes/${primaryRecipeId}?units=metric&group_by=component&inline_measurements=true`,
        method: "GET",
        modelOverrides: params.modelOverrides,
        retryAttempts: 1
      });
      const apiMs = Date.now() - apiStartedAt;
      const recipe = api.data;
      const { tokenUsage, usageQueryMs, llmMs } = await loadTokenUsageWithTiming(api.request_id);

      return {
        api_request_id: api.request_id,
        token_usage: tokenUsage,
        timing: { api_ms: apiMs, usage_query_ms: usageQueryMs, llm_ms: llmMs, server_ms: api.server_ms },
        recipe_id: primaryRecipeId,
        title: recipe.title ?? "",
        ingredient_count: Array.isArray(recipe.ingredients) ? recipe.ingredients.length : 0,
        step_count: Array.isArray(recipe.steps) ? recipe.steps.length : 0,
        ingredient_group_count: Array.isArray(recipe.ingredient_groups) ? recipe.ingredient_groups.length : 0
      };
    });

    await runStep("fetch_cookbook", async () => {
      const apiStartedAt = Date.now();
      const api = await requestJson<CookbookApiResponse>({
        apiBase,
        token,
        path: "/recipes/cookbook",
        method: "GET",
        modelOverrides: params.modelOverrides,
        retryAttempts: 1
      });
      const apiMs = Date.now() - apiStartedAt;
      const response = api.data;
      const { tokenUsage, usageQueryMs, llmMs } = await loadTokenUsageWithTiming(api.request_id);

      const items = Array.isArray(response.items) ? response.items : [];
      const containsCommitted = items.some((item) => {
        const id = item.recipe_id ?? item.id ?? "";
        return id === fetchedRecipe.recipe_id;
      });

      return {
        api_request_id: api.request_id,
        token_usage: tokenUsage,
        timing: { api_ms: apiMs, usage_query_ms: usageQueryMs, llm_ms: llmMs, server_ms: api.server_ms },
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
        complexity: params.complexity,
        variant: params.variant,
        seed: params.seed,
        run_group_id: params.runGroupId,
        prompts,
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
        complexity: params.complexity,
        variant: params.variant,
        seed: params.seed,
        run_group_id: params.runGroupId,
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
  const body = (await request.json().catch(() => ({}))) as Body;
  const action = body.action ?? "run";

  /* ---- Step-by-step mode: each step is its own short-lived request ---- */
  if (action === "init") {
    return handleSimInit(body);
  }
  if (action === "step") {
    return handleSimStep(body);
  }
  if (action === "complete") {
    return handleSimComplete(body);
  }

  /* ---- Legacy full-run mode (may timeout on Cloudflare Workers) ---- */
  const url = new URL(request.url);
  const stream = url.searchParams.get("stream") === "1";

  const scenario = (body.scenario ?? "default_api_ux").trim() || "default_api_ux";
  const complexity = normalizeComplexity(body.complexity);
  const variant: SimulationVariant = body.variant ?? "single";
  const seed = normalizeSeed(body.seed);
  const runGroupId = typeof body.run_group_id === "string" && body.run_group_id.trim().length > 0
    ? body.run_group_id.trim()
    : crypto.randomUUID();
  const modelOverrides = body.model_overrides ?? {};

  if (!stream) {
    const result = await runSimulation({ scenario, complexity, variant, seed, runGroupId, modelOverrides });
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
        complexity,
        variant,
        seed,
        runGroupId,
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
