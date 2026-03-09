import { getAdminClient, toRecord } from "@/lib/supabase-admin";
import {
  compareModelUsageActionRows,
  DEFAULT_MODEL_USAGE_ACTION_SORT,
  type ModelUsageActionSort,
} from "@/lib/llm-analytics";
import type { RegistryModel } from "./shared";

type LlmRoute = {
  id: string;
  scope: string;
  route_name: string;
  provider: string;
  model: string;
  config: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
};

type Prompt = {
  id: string;
  scope: string;
  version: number;
  name: string;
  template: string;
  is_active: boolean;
  created_at: string;
};

type Rule = {
  id: string;
  scope: string;
  version: number;
  name: string;
  rule: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
};

const toFiniteNumber = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const LLM_EVENTS_PAGE_SIZE = 1000;

type LlmEventRow = {
  id: string;
  created_at: string;
  token_input: unknown;
  token_output: unknown;
  token_total: unknown;
  cost_usd: unknown;
  latency_ms: unknown;
  event_payload: unknown;
};

const scopeLabel = (scope: string): string => {
  const known: Record<string, string> = {
    generate: "Generating",
    chat_ideation: "Chat Ideation",
    chat_generation: "Chat Generation",
    chat_iteration: "Chat Iteration",
    image: "Image Generation",
    classify: "Classification",
    ingredient_alias_normalize: "Ingredient Alias Normalize",
    ingredient_phrase_split: "Ingredient Phrase Split",
    ingredient_enrich: "Ingredient Enrich",
    recipe_metadata_enrich: "Recipe Metadata Enrich",
    ingredient_relation_infer: "Ingredient Relation Infer",
    preference_normalize: "Preference Normalize",
    equipment_filter: "Equipment Filter",
    onboarding: "Onboarding",
    memory_extract: "Memory Extract",
    memory_retrieval_embed: "Memory Retrieval Embed",
    memory_select: "Memory Select",
    memory_summarize: "Memory Summarize",
    memory_conflict_resolve: "Memory Conflict Resolve",
    image_quality_eval: "Image Quality Eval",
    image_reuse_eval: "Image Reuse Eval",
    recipe_canonicalize: "Recipe Canonicalize",
    recipe_canon_match: "Recipe Canon Match",
    recipe_personalize: "Recipe Personalize",
  };

  if (scope in known) {
    return known[scope] ?? scope;
  }

  return scope
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
};

export const getLlmConfigData = async (): Promise<{
  routes: LlmRoute[];
  prompts: Prompt[];
  rules: Rule[];
  models: RegistryModel[];
}> => {
  const client = getAdminClient();

  const [{ data: routes }, { data: prompts }, { data: rules }, { data: models }] = await Promise.all([
    client
      .from("llm_model_routes")
      .select("id,scope,route_name,provider,model,config,is_active,created_at")
      .order("scope", { ascending: true }),
    client
      .from("llm_prompts")
      .select("id,scope,version,name,template,is_active,created_at")
      .order("scope", { ascending: true })
      .order("version", { ascending: false }),
    client
      .from("llm_rules")
      .select("id,scope,version,name,rule,is_active,created_at")
      .order("scope", { ascending: true })
      .order("version", { ascending: false }),
    client
      .from("llm_model_registry")
      .select("id,provider,model,display_name,input_cost_per_1m_tokens,output_cost_per_1m_tokens,billing_mode,billing_metadata,context_window_tokens,max_output_tokens,is_available,notes")
      .order("provider")
      .order("display_name")
  ]);

  return {
    routes: (routes ?? []).map((route) => ({
      ...route,
      config: toRecord(route.config as never) as Record<string, unknown>
    })) as LlmRoute[],
    prompts: (prompts ?? []) as Prompt[],
    rules: (rules ?? []).map((rule) => ({
      ...rule,
      rule: toRecord(rule.rule as never) as Record<string, unknown>
    })) as Rule[],
    models: (models ?? []).map((model) => ({
      ...model,
      billing_mode: model.billing_mode === "image" ? "image" : "token",
      billing_metadata: toRecord(model.billing_metadata as never) as Record<string, unknown>
    })) as RegistryModel[]
  };
};

export const getModelUsageData = async (
  options: { rangeDays?: number; actionSort?: ModelUsageActionSort } = {},
): Promise<{
  windowStart: string;
  windowEnd: string;
  totals: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    totalCostUsd: number;
    avgLatencyMs: number;
  };
  byAction: Array<{
    scope: string;
    label: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    avgLatencyMs: number;
    callShare: number;
    tokenShare: number;
  }>;
  byModel: Array<{
    provider: string;
    model: string;
    displayName: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    avgLatencyMs: number;
    callShare: number;
    tokenShare: number;
    scopes: string[];
  }>;
  hourly: Array<{
    bucketStart: string;
    label: string;
    calls: number;
    tokens: number;
    costUsd: number;
  }>;
  daily: Array<{
    bucketStart: string;
    label: string;
    calls: number;
    tokens: number;
    costUsd: number;
  }>;
}> => {
  const client = getAdminClient();
  const windowEnd = new Date();
  const rangeDays = Math.max(1, Math.min(90, Math.round(options.rangeDays ?? 14)));
  const actionSort = options.actionSort ?? DEFAULT_MODEL_USAGE_ACTION_SORT;
  const windowStart = new Date(windowEnd.getTime() - rangeDays * 24 * 60 * 60 * 1000);
  const hourlyStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000);

  const [{ count: totalEventCount, error: countError }, { data: routes }, { data: registry }] = await Promise.all([
    client
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "llm_call")
      .gte("created_at", windowStart.toISOString()),
    client
      .from("llm_model_routes")
      .select("scope,provider,model,is_active")
      .eq("is_active", true),
    client.from("llm_model_registry").select("provider,model,display_name")
  ]);

  if (countError) {
    throw new Error(countError.message);
  }

  const rows: LlmEventRow[] = [];
  const pageCount = Math.ceil((totalEventCount ?? 0) / LLM_EVENTS_PAGE_SIZE);
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const from = pageIndex * LLM_EVENTS_PAGE_SIZE;
    const to = Math.min((pageIndex + 1) * LLM_EVENTS_PAGE_SIZE, totalEventCount ?? 0) - 1;
    const { data, error } = await client
      .from("events")
      .select("id,created_at,token_input,token_output,token_total,cost_usd,latency_ms,event_payload")
      .eq("event_type", "llm_call")
      .gte("created_at", windowStart.toISOString())
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);

    if (error) {
      throw new Error(error.message);
    }

    rows.push(...((data ?? []) as LlmEventRow[]));
  }

  const routeByScope = new Map<string, { provider: string; model: string }>();
  for (const route of routes ?? []) {
    const scope = String(route.scope ?? "").trim();
    if (!scope) {
      continue;
    }

    routeByScope.set(scope, {
      provider: String(route.provider ?? "unknown"),
      model: String(route.model ?? "unknown")
    });
  }

  const modelDisplayByKey = new Map<string, string>();
  for (const row of registry ?? []) {
    const provider = String(row.provider ?? "unknown");
    const model = String(row.model ?? "unknown");
    modelDisplayByKey.set(`${provider}/${model}`, String(row.display_name ?? model));
  }

  const actionMap = new Map<string, {
    scope: string;
    label: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    latencyMsSum: number;
    latencyCount: number;
  }>();
  const modelMap = new Map<string, {
    provider: string;
    model: string;
    displayName: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    latencyMsSum: number;
    latencyCount: number;
    scopes: Set<string>;
  }>();

  const totals = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    latencyMsSum: 0,
    latencyCount: 0
  };

  const hourlyBuckets = new Map<string, { bucketStart: string; label: string; calls: number; tokens: number; costUsd: number }>();
  const dailyBuckets = new Map<string, { bucketStart: string; label: string; calls: number; tokens: number; costUsd: number }>();

  for (let index = 23; index >= 0; index -= 1) {
    const bucketDate = new Date(windowEnd.getTime() - index * 60 * 60 * 1000);
    bucketDate.setMinutes(0, 0, 0);
    const key = bucketDate.toISOString();
    hourlyBuckets.set(key, {
      bucketStart: key,
      label: bucketDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      calls: 0,
      tokens: 0,
      costUsd: 0
    });
  }

  for (let index = rangeDays - 1; index >= 0; index -= 1) {
    const bucketDate = new Date(windowEnd);
    bucketDate.setHours(0, 0, 0, 0);
    bucketDate.setDate(bucketDate.getDate() - index);
    const key = bucketDate.toISOString();
    dailyBuckets.set(key, {
      bucketStart: key,
      label: bucketDate.toLocaleDateString([], { month: "short", day: "numeric" }),
      calls: 0,
      tokens: 0,
      costUsd: 0
    });
  }

  for (const row of rows ?? []) {
    const payload = toRecord(row.event_payload as never) as Record<string, unknown>;
    const scope = typeof payload["scope"] === "string" && payload["scope"].trim().length > 0 ? payload["scope"].trim() : "unknown";
    const activeRoute = routeByScope.get(scope);
    const provider =
      typeof payload["provider"] === "string" && payload["provider"].trim().length > 0
        ? payload["provider"].trim()
        : (activeRoute?.provider ?? "unknown");
    const model =
      typeof payload["model"] === "string" && payload["model"].trim().length > 0
        ? payload["model"].trim()
        : (activeRoute?.model ?? "unknown");

    const inputTokens = toFiniteNumber(row.token_input);
    const outputTokens = toFiniteNumber(row.token_output);
    const tokenTotal = Math.max(toFiniteNumber(row.token_total), inputTokens + outputTokens);
    const costUsd = toFiniteNumber(row.cost_usd);
    const latencyMs = toFiniteNumber(row.latency_ms);

    totals.calls += 1;
    totals.inputTokens += inputTokens;
    totals.outputTokens += outputTokens;
    totals.totalTokens += tokenTotal;
    totals.totalCostUsd += costUsd;
    if (latencyMs > 0) {
      totals.latencyMsSum += latencyMs;
      totals.latencyCount += 1;
    }

    const actionRecord = actionMap.get(scope) ?? {
      scope,
      label: scopeLabel(scope),
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      latencyMsSum: 0,
      latencyCount: 0
    };
    actionRecord.calls += 1;
    actionRecord.inputTokens += inputTokens;
    actionRecord.outputTokens += outputTokens;
    actionRecord.totalTokens += tokenTotal;
    actionRecord.costUsd += costUsd;
    if (latencyMs > 0) {
      actionRecord.latencyMsSum += latencyMs;
      actionRecord.latencyCount += 1;
    }
    actionMap.set(scope, actionRecord);

    const modelKey = `${provider}/${model}`;
    const modelRecord = modelMap.get(modelKey) ?? {
      provider,
      model,
      displayName: modelDisplayByKey.get(modelKey) ?? model,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      latencyMsSum: 0,
      latencyCount: 0,
      scopes: new Set<string>()
    };
    modelRecord.calls += 1;
    modelRecord.inputTokens += inputTokens;
    modelRecord.outputTokens += outputTokens;
    modelRecord.totalTokens += tokenTotal;
    modelRecord.costUsd += costUsd;
    modelRecord.scopes.add(scope);
    if (latencyMs > 0) {
      modelRecord.latencyMsSum += latencyMs;
      modelRecord.latencyCount += 1;
    }
    modelMap.set(modelKey, modelRecord);

    const createdAt = new Date(String(row.created_at));
    if (Number.isFinite(createdAt.getTime()) && createdAt >= hourlyStart) {
      const bucketDate = new Date(createdAt);
      bucketDate.setMinutes(0, 0, 0);
      const bucket = hourlyBuckets.get(bucketDate.toISOString());
      if (bucket) {
        bucket.calls += 1;
        bucket.tokens += tokenTotal;
        bucket.costUsd += costUsd;
      }
    }

    if (Number.isFinite(createdAt.getTime()) && createdAt >= windowStart) {
      const bucketDate = new Date(createdAt);
      bucketDate.setHours(0, 0, 0, 0);
      const bucket = dailyBuckets.get(bucketDate.toISOString());
      if (bucket) {
        bucket.calls += 1;
        bucket.tokens += tokenTotal;
        bucket.costUsd += costUsd;
      }
    }
  }

  return {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    totals: {
      calls: totals.calls,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      totalTokens: totals.totalTokens,
      totalCostUsd: totals.totalCostUsd,
      avgLatencyMs: totals.latencyCount === 0 ? 0 : Math.round(totals.latencyMsSum / totals.latencyCount)
    },
    byAction: Array.from(actionMap.values())
      .sort((a, b) => compareModelUsageActionRows(a, b, actionSort))
      .map((row) => ({
        scope: row.scope,
        label: row.label,
        calls: row.calls,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        totalTokens: row.totalTokens,
        costUsd: row.costUsd,
        avgLatencyMs: row.latencyCount === 0 ? 0 : Math.round(row.latencyMsSum / row.latencyCount),
        callShare: totals.calls === 0 ? 0 : row.calls / totals.calls,
        tokenShare: totals.totalTokens === 0 ? 0 : row.totalTokens / totals.totalTokens
      })),
    byModel: Array.from(modelMap.values())
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .map((row) => ({
        provider: row.provider,
        model: row.model,
        displayName: row.displayName,
        calls: row.calls,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        totalTokens: row.totalTokens,
        costUsd: row.costUsd,
        avgLatencyMs: row.latencyCount === 0 ? 0 : Math.round(row.latencyMsSum / row.latencyCount),
        callShare: totals.calls === 0 ? 0 : row.calls / totals.calls,
        tokenShare: totals.totalTokens === 0 ? 0 : row.totalTokens / totals.totalTokens,
        scopes: Array.from(row.scopes).sort()
      })),
    hourly: Array.from(hourlyBuckets.values()),
    daily: Array.from(dailyBuckets.values())
  };
};
