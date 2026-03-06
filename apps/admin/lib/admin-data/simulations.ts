import { getAdminClient, toRecord } from "@/lib/supabase-admin";
import type { RegistryModel } from "./shared";

const toRegistryModels = (rows: unknown[] | null | undefined): RegistryModel[] => {
  return (rows ?? []).map((model) => {
    const row = model as RegistryModel;
    return {
      ...row,
      billing_mode: row.billing_mode === "image" ? "image" : "token",
      billing_metadata: toRecord(row.billing_metadata as never) as Record<string, unknown>
    };
  });
};

export const getRecipeSimulationData = async (): Promise<{
  recentRuns: Array<{ created_at: string; request_id: string | null; event_type: string; event_payload: Record<string, unknown> }>;
  routes: Array<{ scope: string; provider: string; model: string; is_active: boolean }>;
  registryModels: RegistryModel[];
}> => {
  const client = getAdminClient();
  const [{ data: events }, { data: routes }, { data: registry }] = await Promise.all([
    client
      .from("events")
      .select("created_at,request_id,event_type,event_payload")
      .in("event_type", ["simulation_run_started", "simulation_run_completed", "simulation_run_failed"])
      .order("created_at", { ascending: false })
      .limit(100),
    client
      .from("llm_model_routes")
      .select("scope,provider,model,is_active")
      .in("scope", [
        "chat_ideation",
        "chat_generation",
        "chat_iteration",
        "classify",
        "ingredient_alias_normalize",
        "ingredient_phrase_split",
        "ingredient_enrich",
        "recipe_metadata_enrich",
        "ingredient_relation_infer",
        "preference_normalize",
        "equipment_filter"
      ])
      .order("scope")
      .order("is_active", { ascending: false }),
    client
      .from("llm_model_registry")
      .select("id,provider,model,display_name,input_cost_per_1m_tokens,output_cost_per_1m_tokens,billing_mode,billing_metadata,context_window_tokens,max_output_tokens,is_available,notes")
      .eq("is_available", true)
      .order("provider")
      .order("display_name")
  ]);

  return {
    recentRuns: (events ?? []).map((row) => ({
      created_at: row.created_at as string,
      request_id: (row.request_id as string | null) ?? null,
      event_type: row.event_type as string,
      event_payload: toRecord(row.event_payload as never) as Record<string, unknown>
    })),
    routes: (routes ?? []).map((route) => ({
      scope: route.scope as string,
      provider: route.provider as string,
      model: route.model as string,
      is_active: Boolean(route.is_active)
    })),
    registryModels: toRegistryModels(registry as unknown[] | null | undefined)
  };
};

export const getSimulationData = getRecipeSimulationData;

export const getImageSimulationData = async (): Promise<{
  activeImageRoute: { provider: string; model: string } | null;
  activeJudgeRoute: { provider: string; model: string } | null;
  registryModels: Array<{
    id: string;
    provider: string;
    model: string;
    display_name: string;
    billing_mode: "token" | "image";
  }>;
}> => {
  const client = getAdminClient();
  const [{ data: routes }, { data: registry }] = await Promise.all([
    client
      .from("llm_model_routes")
      .select("scope,provider,model,is_active")
      .in("scope", ["image", "image_quality_eval"])
      .eq("is_active", true),
    client
      .from("llm_model_registry")
      .select("id,provider,model,display_name,billing_mode")
      .eq("is_available", true)
      .eq("billing_mode", "image")
      .order("provider")
      .order("display_name")
  ]);

  const activeImageRoute = (routes ?? []).find((route) => route.scope === "image");
  const activeJudgeRoute = (routes ?? []).find((route) => route.scope === "image_quality_eval");

  return {
    activeImageRoute: activeImageRoute
      ? {
          provider: String(activeImageRoute.provider ?? ""),
          model: String(activeImageRoute.model ?? "")
        }
      : null,
    activeJudgeRoute: activeJudgeRoute
      ? {
          provider: String(activeJudgeRoute.provider ?? ""),
          model: String(activeJudgeRoute.model ?? "")
        }
      : null,
    registryModels: (registry ?? []).map((row) => ({
      id: String(row.id ?? ""),
      provider: String(row.provider ?? ""),
      model: String(row.model ?? ""),
      display_name: String(row.display_name ?? ""),
      billing_mode: row.billing_mode === "image" ? "image" : "token",
    }))
  };
};
