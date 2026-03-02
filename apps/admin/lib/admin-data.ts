import { getAdminClient, toRecord } from "@/lib/supabase-admin";

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

export const getDashboardData = async (): Promise<{
  requestCount: number;
  avgLatencyMs: number;
  totalCostUsd: number;
  safetyIncidentCount: number;
  recentErrors: Array<{ created_at: string; scope: string; reason: string }>;
}> => {
  const client = getAdminClient();

  const [{ data: costRows }, { data: flagsRows }] = await Promise.all([
    client.from("v_llm_cost_latency_rollup").select("request_count,avg_latency_ms,total_cost_usd"),
    client.from("v_abuse_rate_limit_flags").select("created_at,scope,reason").order("created_at", { ascending: false }).limit(8)
  ]);

  const requestCount = (costRows ?? []).reduce((sum, row) => sum + Number(row.request_count ?? 0), 0);
  const weightedLatencySum = (costRows ?? []).reduce((sum, row) => {
    return sum + Number(row.avg_latency_ms ?? 0) * Number(row.request_count ?? 0);
  }, 0);
  const avgLatencyMs = requestCount === 0 ? 0 : Math.round(weightedLatencySum / requestCount);
  const totalCostUsd = (costRows ?? []).reduce((sum, row) => sum + Number(row.total_cost_usd ?? 0), 0);

  return {
    requestCount,
    avgLatencyMs,
    totalCostUsd,
    safetyIncidentCount: (flagsRows ?? []).length,
    recentErrors: (flagsRows ?? []).map((row) => ({
      created_at: row.created_at as string,
      scope: (row.scope as string) ?? "unknown",
      reason: (row.reason as string) ?? "n/a"
    }))
  };
};

export const getUsersData = async (): Promise<Array<{ id: string; email: string | null; status: string; updated_at: string }>> => {
  const client = getAdminClient();
  const { data } = await client
    .from("users")
    .select("id,email,status,updated_at")
    .order("updated_at", { ascending: false })
    .limit(100);

  return (data ?? []) as Array<{ id: string; email: string | null; status: string; updated_at: string }>;
};

export const getLlmConfigData = async (): Promise<{
  routes: LlmRoute[];
  prompts: Prompt[];
  rules: Rule[];
}> => {
  const client = getAdminClient();

  const [{ data: routes }, { data: prompts }, { data: rules }] = await Promise.all([
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
      .order("version", { ascending: false })
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
    })) as Rule[]
  };
};

export const getRecipeAuditData = async (): Promise<
  Array<{ version_id: string; recipe_id: string; diff_summary: string | null; created_at: string; step_count: number; ingredient_count: number }>
> => {
  const client = getAdminClient();
  const { data } = await client
    .from("v_recipe_version_diff_meta")
    .select("version_id,recipe_id,diff_summary,created_at,step_count,ingredient_count")
    .order("created_at", { ascending: false })
    .limit(100);

  return (data ?? []) as Array<{
    version_id: string;
    recipe_id: string;
    diff_summary: string | null;
    created_at: string;
    step_count: number;
    ingredient_count: number;
  }>;
};

export const getGraphData = async (): Promise<{
  entities: Array<{ id: string; entity_type: string; label: string }>;
  edges: Array<{ id: string; from_entity_id: string; to_entity_id: string; confidence: number }>;
}> => {
  const client = getAdminClient();

  const [{ data: entities }, { data: edges }] = await Promise.all([
    client.from("graph_entities").select("id,entity_type,label").order("updated_at", { ascending: false }).limit(100),
    client.from("graph_edges").select("id,from_entity_id,to_entity_id,confidence").order("created_at", { ascending: false }).limit(100)
  ]);

  return {
    entities: (entities ?? []) as Array<{ id: string; entity_type: string; label: string }> ,
    edges: (edges ?? []) as Array<{ id: string; from_entity_id: string; to_entity_id: string; confidence: number }>
  };
};

export const getModerationData = async (): Promise<{
  queue: Array<{ recipe_id: string; status: string; moderation_notes: string | null; updated_at: string }>;
}> => {
  const client = getAdminClient();
  const { data } = await client
    .from("explore_publications")
    .select("recipe_id,status,moderation_notes,updated_at")
    .order("updated_at", { ascending: false })
    .limit(100);

  return {
    queue: (data ?? []) as Array<{ recipe_id: string; status: string; moderation_notes: string | null; updated_at: string }>
  };
};
