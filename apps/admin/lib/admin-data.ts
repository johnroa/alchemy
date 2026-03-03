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
  emptyOutputCount: number;
  imagePendingCount: number;
  imageProcessingCount: number;
  imageReadyCount: number;
  imageFailedCount: number;
  imageTotalCount: number;
  activeMemoryCount: number;
  recentErrors: Array<{ created_at: string; scope: string; reason: string }>;
  recentActivity: Array<{ created_at: string; scope: string; entity_type: string; action: string }>;
}> => {
  const client = getAdminClient();

  const [
    { data: costRows },
    { data: flagsRows },
    { data: emptyOutputRows },
    { data: imageRows },
    { data: memoryRows },
    { data: activityRows }
  ] = await Promise.all([
    client.from("v_llm_cost_latency_rollup").select("request_count,avg_latency_ms,total_cost_usd"),
    client.from("v_abuse_rate_limit_flags").select("created_at,scope,reason").order("created_at", { ascending: false }).limit(8),
    client
      .from("events")
      .select("id")
      .eq("event_type", "llm_call")
      .contains("event_payload", { error_code: "llm_empty_output" }),
    client.from("recipe_image_jobs").select("status"),
    client.from("memories").select("status"),
    client.from("changelog_events").select("created_at,scope,entity_type,action").order("created_at", { ascending: false }).limit(10)
  ]);

  const requestCount = (costRows ?? []).reduce((sum, row) => sum + Number(row.request_count ?? 0), 0);
  const weightedLatencySum = (costRows ?? []).reduce((sum, row) => {
    return sum + Number(row.avg_latency_ms ?? 0) * Number(row.request_count ?? 0);
  }, 0);
  const avgLatencyMs = requestCount === 0 ? 0 : Math.round(weightedLatencySum / requestCount);
  const totalCostUsd = (costRows ?? []).reduce((sum, row) => sum + Number(row.total_cost_usd ?? 0), 0);

  const imagePendingCount = (imageRows ?? []).filter((row) => row.status === "pending").length;
  const imageProcessingCount = (imageRows ?? []).filter((row) => row.status === "processing").length;
  const imageReadyCount = (imageRows ?? []).filter((row) => row.status === "ready").length;
  const imageFailedCount = (imageRows ?? []).filter((row) => row.status === "failed").length;
  const imageTotalCount = (imageRows ?? []).length;
  const activeMemoryCount = (memoryRows ?? []).filter((row) => row.status === "active").length;

  return {
    requestCount,
    avgLatencyMs,
    totalCostUsd,
    safetyIncidentCount: (flagsRows ?? []).length,
    emptyOutputCount: (emptyOutputRows ?? []).length,
    imagePendingCount,
    imageProcessingCount,
    imageReadyCount,
    imageFailedCount,
    imageTotalCount,
    activeMemoryCount,
    recentErrors: (flagsRows ?? []).map((row) => ({
      created_at: row.created_at as string,
      scope: (row.scope as string) ?? "unknown",
      reason: (row.reason as string) ?? "n/a"
    })),
    recentActivity: (activityRows ?? []).map((row) => ({
      created_at: row.created_at as string,
      scope: String(row.scope ?? "unknown"),
      entity_type: String(row.entity_type ?? "unknown"),
      action: String(row.action ?? "unknown")
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

type RecipeAuditIndexRow = {
  id: string;
  title: string;
  owner_user_id: string;
  owner_email: string | null;
  source_draft_id: string | null;
  current_version_id: string | null;
  visibility: string;
  image_status: string;
  created_at: string;
  updated_at: string;
  version_count: number;
  save_count: number;
  attachment_count: number;
  draft_message_count: number;
  latest_diff_summary: string | null;
  latest_request_id: string | null;
};

type RecipeAuditDetail = {
  recipe: {
    id: string;
    title: string;
    owner_user_id: string;
    owner_email: string | null;
    source_draft_id: string | null;
    current_version_id: string | null;
    visibility: string;
    hero_image_url: string | null;
    image_status: string;
    created_at: string;
    updated_at: string;
  };
  draft: {
    id: string;
    status: string;
    created_at: string;
    updated_at: string;
    context: Record<string, unknown>;
  } | null;
  versions: Array<{
    id: string;
    parent_version_id: string | null;
    diff_summary: string | null;
    created_at: string;
    created_by: string;
    ingredient_count: number;
    step_count: number;
    payload: Record<string, unknown>;
    event_type: string | null;
    request_id: string | null;
    event_metadata: Record<string, unknown> | null;
  }>;
  draft_messages: Array<{
    id: string;
    role: string;
    content: string;
    metadata: Record<string, unknown>;
    created_at: string;
  }>;
  attachments: Array<{
    id: string;
    relation_type: string;
    position: number;
    source: string;
    child_recipe_id: string;
    child_recipe_title: string | null;
    child_current_version_id: string | null;
    updated_at: string;
  }>;
  changelog: Array<{
    id: string;
    scope: string;
    entity_type: string;
    entity_id: string | null;
    action: string;
    request_id: string | null;
    created_at: string;
    metadata: Record<string, unknown>;
  }>;
};

const isSchemaMissingError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const message = (error as { message?: string }).message?.toLowerCase() ?? "";
  const code = (error as { code?: string }).code?.toLowerCase() ?? "";

  return (
    message.includes("could not find the table") ||
    message.includes("not found in the schema cache") ||
    message.includes("schema cache") ||
    message.includes("does not exist") ||
    message.includes("undefined column") ||
    code === "42p01" ||
    code === "42703"
  );
};

export const getRecipeAuditIndexData = async (
  searchTerm?: string
): Promise<{
  rows: RecipeAuditIndexRow[];
  totals: {
    recipes: number;
    versions: number;
    attachments: number;
    saves: number;
    draftBacked: number;
  };
}> => {
  const client = getAdminClient();
  const preferredRecipesQuery = await client
    .from("recipes")
    .select("id,title,owner_user_id,source_draft_id,current_version_id,visibility,image_status,created_at,updated_at")
    .order("updated_at", { ascending: false })
    .limit(250);

  let recipes: Array<{
    id: string;
    title: string;
    owner_user_id: string;
    source_draft_id: string | null;
    current_version_id: string | null;
    visibility: string;
    image_status: string;
    created_at: string;
    updated_at: string;
  }> = [];

  if (preferredRecipesQuery.error) {
    if (!isSchemaMissingError(preferredRecipesQuery.error)) {
      throw new Error(preferredRecipesQuery.error.message);
    }

    const legacyRecipesQuery = await client
      .from("recipes")
      .select("id,title,owner_user_id,source_draft_id,current_version_id,visibility,created_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(250);

    if (legacyRecipesQuery.error) {
      throw new Error(legacyRecipesQuery.error.message);
    }

    recipes = (legacyRecipesQuery.data ?? []).map((row) => ({
      ...row,
      image_status: row.current_version_id ? "ready" : "pending"
    }));
  } else {
    recipes = (preferredRecipesQuery.data ?? []) as Array<{
      id: string;
      title: string;
      owner_user_id: string;
      source_draft_id: string | null;
      current_version_id: string | null;
      visibility: string;
      image_status: string;
      created_at: string;
      updated_at: string;
    }>;
  }

  const normalizedSearch = searchTerm?.trim().toLowerCase() ?? "";
  const filteredRecipes =
    normalizedSearch.length === 0
      ? recipes
      : recipes.filter((recipe) => {
          const haystack = [
            recipe.id,
            recipe.title,
            recipe.owner_user_id,
            recipe.source_draft_id ?? "",
            recipe.current_version_id ?? ""
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(normalizedSearch);
        });

  const recipeIds = filteredRecipes.map((recipe) => recipe.id);
  const ownerIds = Array.from(new Set(filteredRecipes.map((recipe) => recipe.owner_user_id)));
  const draftIds = Array.from(new Set(filteredRecipes.map((recipe) => recipe.source_draft_id).filter((id): id is string => Boolean(id))));
  const currentVersionIds = Array.from(
    new Set(filteredRecipes.map((recipe) => recipe.current_version_id).filter((id): id is string => Boolean(id)))
  );

  const [
    { data: owners },
    { data: versions },
    { data: saves },
    { data: attachments },
    { data: draftMessages },
    { data: currentVersions },
    { data: versionEvents }
  ] = await Promise.all([
    ownerIds.length === 0
      ? Promise.resolve({ data: [] as Array<{ id: string; email: string | null }> })
      : client.from("users").select("id,email").in("id", ownerIds),
    recipeIds.length === 0
      ? Promise.resolve({ data: [] as Array<{ recipe_id: string }> })
      : client.from("recipe_versions").select("id,recipe_id").in("recipe_id", recipeIds),
    recipeIds.length === 0
      ? Promise.resolve({ data: [] as Array<{ recipe_id: string }> })
      : client.from("recipe_saves").select("recipe_id").in("recipe_id", recipeIds),
    recipeIds.length === 0
      ? Promise.resolve({ data: [] as Array<{ parent_recipe_id: string }> })
      : client.from("recipe_links").select("parent_recipe_id").in("parent_recipe_id", recipeIds),
    draftIds.length === 0
      ? Promise.resolve({ data: [] as Array<{ draft_id: string }> })
      : client.from("recipe_draft_messages").select("draft_id").in("draft_id", draftIds),
    currentVersionIds.length === 0
      ? Promise.resolve({ data: [] as Array<{ id: string; diff_summary: string | null }> })
      : client.from("recipe_versions").select("id,diff_summary").in("id", currentVersionIds),
    currentVersionIds.length === 0
      ? Promise.resolve({ data: [] as Array<{ recipe_version_id: string; request_id: string | null }> })
      : client
          .from("recipe_version_events")
          .select("recipe_version_id,request_id,created_at")
          .in("recipe_version_id", currentVersionIds)
          .order("created_at", { ascending: false })
  ]);

  const ownerById = new Map((owners ?? []).map((owner) => [owner.id, owner.email]));
  const versionCountByRecipe = new Map<string, number>();
  for (const row of versions ?? []) {
    versionCountByRecipe.set(row.recipe_id, (versionCountByRecipe.get(row.recipe_id) ?? 0) + 1);
  }

  const saveCountByRecipe = new Map<string, number>();
  for (const row of saves ?? []) {
    saveCountByRecipe.set(row.recipe_id, (saveCountByRecipe.get(row.recipe_id) ?? 0) + 1);
  }

  const attachmentCountByRecipe = new Map<string, number>();
  for (const row of attachments ?? []) {
    attachmentCountByRecipe.set(row.parent_recipe_id, (attachmentCountByRecipe.get(row.parent_recipe_id) ?? 0) + 1);
  }

  const draftMessageCountByDraft = new Map<string, number>();
  for (const row of draftMessages ?? []) {
    draftMessageCountByDraft.set(row.draft_id, (draftMessageCountByDraft.get(row.draft_id) ?? 0) + 1);
  }

  const diffByVersion = new Map((currentVersions ?? []).map((row) => [row.id, row.diff_summary]));
  const requestByVersion = new Map<string, string | null>();
  for (const row of versionEvents ?? []) {
    if (!requestByVersion.has(row.recipe_version_id)) {
      requestByVersion.set(row.recipe_version_id, row.request_id);
    }
  }

  const rows: RecipeAuditIndexRow[] = filteredRecipes.map((recipe) => ({
    id: recipe.id,
    title: recipe.title,
    owner_user_id: recipe.owner_user_id,
    owner_email: ownerById.get(recipe.owner_user_id) ?? null,
    source_draft_id: recipe.source_draft_id,
    current_version_id: recipe.current_version_id,
    visibility: recipe.visibility,
    image_status: recipe.image_status,
    created_at: recipe.created_at,
    updated_at: recipe.updated_at,
    version_count: versionCountByRecipe.get(recipe.id) ?? 0,
    save_count: saveCountByRecipe.get(recipe.id) ?? 0,
    attachment_count: attachmentCountByRecipe.get(recipe.id) ?? 0,
    draft_message_count: recipe.source_draft_id ? draftMessageCountByDraft.get(recipe.source_draft_id) ?? 0 : 0,
    latest_diff_summary: recipe.current_version_id ? diffByVersion.get(recipe.current_version_id) ?? null : null,
    latest_request_id: recipe.current_version_id ? requestByVersion.get(recipe.current_version_id) ?? null : null
  }));

  const totals = rows.reduce(
    (acc, row) => {
      acc.recipes += 1;
      acc.versions += row.version_count;
      acc.attachments += row.attachment_count;
      acc.saves += row.save_count;
      if (row.source_draft_id) {
        acc.draftBacked += 1;
      }
      return acc;
    },
    { recipes: 0, versions: 0, attachments: 0, saves: 0, draftBacked: 0 }
  );

  return { rows, totals };
};

export const getRecipeAuditDetail = async (recipeId: string): Promise<RecipeAuditDetail | null> => {
  const client = getAdminClient();

  const preferredRecipeQuery = await client
    .from("recipes")
    .select("id,title,owner_user_id,source_draft_id,current_version_id,visibility,hero_image_url,image_status,created_at,updated_at")
    .eq("id", recipeId)
    .maybeSingle();

  let recipe: {
    id: string;
    title: string;
    owner_user_id: string;
    source_draft_id: string | null;
    current_version_id: string | null;
    visibility: string;
    hero_image_url: string | null;
    image_status: string;
    created_at: string;
    updated_at: string;
  } | null = null;

  if (preferredRecipeQuery.error) {
    if (!isSchemaMissingError(preferredRecipeQuery.error)) {
      throw new Error(preferredRecipeQuery.error.message);
    }

    const legacyRecipeQuery = await client
      .from("recipes")
      .select("id,title,owner_user_id,source_draft_id,current_version_id,visibility,hero_image_url,created_at,updated_at")
      .eq("id", recipeId)
      .maybeSingle();

    if (legacyRecipeQuery.error) {
      throw new Error(legacyRecipeQuery.error.message);
    }

    if (legacyRecipeQuery.data) {
      recipe = {
        ...legacyRecipeQuery.data,
        image_status: legacyRecipeQuery.data.hero_image_url ? "ready" : "pending"
      };
    }
  } else {
    recipe = preferredRecipeQuery.data;
  }

  if (!recipe) {
    return null;
  }

  const [{ data: owner }, { data: versions, error: versionsError }, { data: draft }, { data: draftMessages }, { data: links }] =
    await Promise.all([
      client.from("users").select("id,email").eq("id", recipe.owner_user_id).maybeSingle(),
      client
        .from("recipe_versions")
        .select("id,parent_version_id,diff_summary,created_at,created_by,payload")
        .eq("recipe_id", recipe.id)
        .order("created_at", { ascending: true }),
      recipe.source_draft_id
        ? client.from("recipe_drafts").select("id,status,context,created_at,updated_at").eq("id", recipe.source_draft_id).maybeSingle()
        : Promise.resolve({ data: null }),
      recipe.source_draft_id
        ? client
            .from("recipe_draft_messages")
            .select("id,role,content,metadata,created_at")
            .eq("draft_id", recipe.source_draft_id)
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [] as Array<{ id: string; role: string; content: string; metadata: Record<string, unknown>; created_at: string }> }),
      client
        .from("recipe_links")
        .select("id,child_recipe_id,relation_type_id,position,source,metadata,updated_at")
        .eq("parent_recipe_id", recipe.id)
        .order("position", { ascending: true })
    ]);

  if (versionsError) {
    throw new Error(versionsError.message);
  }

  const versionRows = (versions ?? []) as Array<{
    id: string;
    parent_version_id: string | null;
    diff_summary: string | null;
    created_at: string;
    created_by: string;
    payload: Record<string, unknown>;
  }>;
  const versionIds = versionRows.map((version) => version.id);

  const [{ data: versionEvents }, { data: relationTypes }, { data: childRecipes }] = await Promise.all([
    versionIds.length === 0
      ? Promise.resolve({ data: [] as Array<{ recipe_version_id: string; event_type: string; request_id: string | null; metadata: Record<string, unknown>; created_at: string }> })
      : client
          .from("recipe_version_events")
          .select("recipe_version_id,event_type,request_id,metadata,created_at")
          .in("recipe_version_id", versionIds)
          .order("created_at", { ascending: false }),
    (links ?? []).length === 0
      ? Promise.resolve({ data: [] as Array<{ id: string; name: string }> })
      : client
          .from("graph_relation_types")
          .select("id,name")
          .in(
            "id",
            Array.from(new Set((links ?? []).map((link) => link.relation_type_id)))
          ),
    (links ?? []).length === 0
      ? Promise.resolve({ data: [] as Array<{ id: string; title: string; current_version_id: string | null }> })
      : client
          .from("recipes")
          .select("id,title,current_version_id")
          .in(
            "id",
            Array.from(new Set((links ?? []).map((link) => link.child_recipe_id)))
          )
  ]);

  const eventByVersion = new Map<
    string,
    { event_type: string; request_id: string | null; metadata: Record<string, unknown> | null }
  >();
  for (const event of versionEvents ?? []) {
    if (!eventByVersion.has(event.recipe_version_id)) {
      eventByVersion.set(event.recipe_version_id, {
        event_type: event.event_type,
        request_id: event.request_id,
        metadata:
          event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
            ? (event.metadata as Record<string, unknown>)
            : null
      });
    }
  }

  const relationById = new Map((relationTypes ?? []).map((relationType) => [relationType.id, relationType.name]));
  const childById = new Map((childRecipes ?? []).map((childRecipe) => [childRecipe.id, childRecipe]));
  const requestIds = Array.from(
    new Set(
      (versionEvents ?? [])
        .map((event) => event.request_id)
        .filter((requestId): requestId is string => typeof requestId === "string" && requestId.length > 0)
    )
  );

  const [recipeChanges, draftChanges, requestChanges] = await Promise.all([
    client
      .from("changelog_events")
      .select("id,scope,entity_type,entity_id,action,request_id,created_at,metadata")
      .eq("entity_type", "recipe")
      .eq("entity_id", recipe.id)
      .order("created_at", { ascending: false })
      .limit(200),
    recipe.source_draft_id
      ? client
          .from("changelog_events")
          .select("id,scope,entity_type,entity_id,action,request_id,created_at,metadata")
          .eq("entity_type", "recipe_draft")
          .eq("entity_id", recipe.source_draft_id)
          .order("created_at", { ascending: false })
          .limit(200)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    requestIds.length === 0
      ? Promise.resolve({ data: [] as Array<Record<string, unknown>> })
      : client
          .from("changelog_events")
          .select("id,scope,entity_type,entity_id,action,request_id,created_at,metadata")
          .in("request_id", requestIds)
          .order("created_at", { ascending: false })
          .limit(300)
  ]);

  const changelogById = new Map<string, RecipeAuditDetail["changelog"][number]>();
  for (const row of [...(recipeChanges.data ?? []), ...(draftChanges.data ?? []), ...(requestChanges.data ?? [])]) {
    const id = String(row.id);
    if (changelogById.has(id)) {
      continue;
    }

    changelogById.set(id, {
      id,
      scope: String(row.scope ?? "unknown"),
      entity_type: String(row.entity_type ?? "unknown"),
      entity_id: row.entity_id ? String(row.entity_id) : null,
      action: String(row.action ?? "unknown"),
      request_id: row.request_id ? String(row.request_id) : null,
      created_at: String(row.created_at ?? new Date().toISOString()),
      metadata:
        row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {}
    });
  }

  const versionsWithMetrics = versionRows.map((version) => {
    const event = eventByVersion.get(version.id);
    const payload = version.payload && typeof version.payload === "object" ? version.payload : {};
    const ingredients = Array.isArray((payload as { ingredients?: unknown }).ingredients)
      ? ((payload as { ingredients: unknown[] }).ingredients as unknown[])
      : [];
    const steps = Array.isArray((payload as { steps?: unknown }).steps)
      ? ((payload as { steps: unknown[] }).steps as unknown[])
      : [];

    return {
      id: version.id,
      parent_version_id: version.parent_version_id,
      diff_summary: version.diff_summary,
      created_at: version.created_at,
      created_by: version.created_by,
      ingredient_count: ingredients.length,
      step_count: steps.length,
      payload: payload as Record<string, unknown>,
      event_type: event?.event_type ?? null,
      request_id: event?.request_id ?? null,
      event_metadata: event?.metadata ?? null
    };
  });

  const attachmentRows = (links ?? []).map((link) => ({
    id: link.id,
    relation_type: relationById.get(link.relation_type_id) ?? "unknown_relation",
    position: Number(link.position ?? 0),
    source: String(link.source ?? "llm"),
    child_recipe_id: link.child_recipe_id,
    child_recipe_title: childById.get(link.child_recipe_id)?.title ?? null,
    child_current_version_id: childById.get(link.child_recipe_id)?.current_version_id ?? null,
    updated_at: String(link.updated_at)
  }));

  return {
    recipe: {
      id: recipe.id,
      title: recipe.title,
      owner_user_id: recipe.owner_user_id,
      owner_email: owner?.email ?? null,
      source_draft_id: recipe.source_draft_id,
      current_version_id: recipe.current_version_id,
      visibility: recipe.visibility,
      hero_image_url: recipe.hero_image_url,
      image_status: recipe.image_status,
      created_at: recipe.created_at,
      updated_at: recipe.updated_at
    },
    draft: draft
      ? {
          id: String(draft.id),
          status: String(draft.status),
          created_at: String(draft.created_at),
          updated_at: String(draft.updated_at),
          context:
            draft.context && typeof draft.context === "object" && !Array.isArray(draft.context)
              ? (draft.context as Record<string, unknown>)
              : {}
        }
      : null,
    versions: versionsWithMetrics,
    draft_messages: (draftMessages ?? []).map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      metadata:
        message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata)
          ? (message.metadata as Record<string, unknown>)
          : {},
      created_at: message.created_at
    })),
    attachments: attachmentRows,
    changelog: Array.from(changelogById.values()).sort((a, b) => {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    })
  };
};

export const getGraphData = async (): Promise<{
  entities: Array<{ id: string; entity_type: string; label: string }>;
  edges: Array<{ id: string; from_entity_id: string; to_entity_id: string; from_label: string; to_label: string; confidence: number }>;
}> => {
  const client = getAdminClient();

  const [{ data: entities, error: entitiesError }, { data: edges }] = await Promise.all([
    client.from("graph_entities").select("id,entity_type,label").order("updated_at", { ascending: false }).limit(200),
    client.from("graph_edges").select("id,from_entity_id,to_entity_id,confidence").order("confidence", { ascending: false }).limit(100)
  ]);

  if (entitiesError && !isSchemaMissingError(entitiesError)) {
    throw new Error(entitiesError.message);
  }

  const entityList = (entities ?? []) as Array<{ id: string; entity_type: string; label: string }>;
  const entityLabelById = new Map(entityList.map((e) => [e.id, e.label]));

  return {
    entities: entityList.slice(0, 100),
    edges: ((edges ?? []) as Array<{ id: string; from_entity_id: string; to_entity_id: string; confidence: number }>).map((edge) => ({
      ...edge,
      from_label: entityLabelById.get(edge.from_entity_id) ?? edge.from_entity_id.slice(0, 8),
      to_label: entityLabelById.get(edge.to_entity_id) ?? edge.to_entity_id.slice(0, 8)
    }))
  };
};

export const getModerationData = async (): Promise<{
  queue: Array<{ recipe_id: string; status: string; moderation_notes: string | null; updated_at: string }>;
}> => {
  return {
    queue: []
  };
};

export const getMemoryData = async (): Promise<{
  snapshots: Array<{ user_id: string; email: string | null; token_estimate: number; updated_at: string }>;
  memories: Array<{ id: string; user_id: string; email: string | null; memory_type: string; memory_kind: string; status: string; confidence: number; salience: number; content: string | null; updated_at: string }>;
}> => {
  const client = getAdminClient();

  const [{ data: snapshots }, { data: memoriesRaw }] = await Promise.all([
    client.from("memory_snapshots").select("user_id,token_estimate,updated_at").order("updated_at", { ascending: false }).limit(100),
    client
      .from("memories")
      .select("id,user_id,memory_type,memory_kind,status,confidence,salience,content,updated_at")
      .order("updated_at", { ascending: false })
      .limit(150)
  ]);

  const userIds = Array.from(
    new Set([
      ...(snapshots ?? []).map((s) => s.user_id as string),
      ...(memoriesRaw ?? []).map((m) => m.user_id as string)
    ])
  );

  const { data: users } =
    userIds.length > 0
      ? await client.from("users").select("id,email").in("id", userIds)
      : { data: [] as Array<{ id: string; email: string | null }> };

  const emailById = new Map((users ?? []).map((u) => [u.id, u.email as string | null]));

  return {
    snapshots: (snapshots ?? []).map((s) => ({
      user_id: String(s.user_id),
      email: emailById.get(String(s.user_id)) ?? null,
      token_estimate: Number(s.token_estimate ?? 0),
      updated_at: String(s.updated_at)
    })),
    memories: (memoriesRaw ?? []).map((m) => ({
      id: String(m.id),
      user_id: String(m.user_id),
      email: emailById.get(String(m.user_id)) ?? null,
      memory_type: String(m.memory_type ?? ""),
      memory_kind: String(m.memory_kind ?? ""),
      status: String(m.status ?? ""),
      confidence: Number(m.confidence ?? 0),
      salience: Number(m.salience ?? 0),
      content: m.content ? String(m.content) : null,
      updated_at: String(m.updated_at)
    }))
  };
};

export const getChangelogData = async (): Promise<{
  items: Array<{
    id: string;
    created_at: string;
    scope: string;
    entity_type: string;
    entity_id: string | null;
    action: string;
    request_id: string | null;
    actor_email: string | null;
  }>;
}> => {
  const client = getAdminClient();
  const { data } = await client
    .from("v_changelog_recent")
    .select("id,created_at,scope,entity_type,entity_id,action,request_id,actor_email")
    .order("created_at", { ascending: false })
    .limit(200);

  return {
    items: (data ?? []) as Array<{
      id: string;
      created_at: string;
      scope: string;
      entity_type: string;
      entity_id: string | null;
      action: string;
      request_id: string | null;
      actor_email: string | null;
    }>
  };
};

export const getImagePipelineData = async (): Promise<{
  jobs: Array<{ id: string; recipe_id: string; status: string; attempt: number; max_attempts: number; next_attempt_at: string; last_error: string | null; updated_at: string }>;
}> => {
  const client = getAdminClient();
  const { data } = await client
    .from("recipe_image_jobs")
    .select("id,recipe_id,status,attempt,max_attempts,next_attempt_at,last_error,updated_at")
    .order("updated_at", { ascending: false })
    .limit(200);

  return {
    jobs: (data ?? []) as Array<{ id: string; recipe_id: string; status: string; attempt: number; max_attempts: number; next_attempt_at: string; last_error: string | null; updated_at: string }>
  };
};

export const getRequestTraceData = async (): Promise<{
  events: Array<{ id: string; request_id: string | null; event_type: string; created_at: string; safety_state: string | null; latency_ms: number | null; event_payload: Record<string, unknown> }>;
  changes: Array<{ id: string; request_id: string | null; scope: string; entity_type: string; action: string; created_at: string }>;
}> => {
  const client = getAdminClient();

  const [{ data: events }, { data: changes }] = await Promise.all([
    client
      .from("events")
      .select("id,request_id,event_type,created_at,safety_state,latency_ms,event_payload")
      .order("created_at", { ascending: false })
      .limit(200),
    client
      .from("changelog_events")
      .select("id,request_id,scope,entity_type,action,created_at")
      .order("created_at", { ascending: false })
      .limit(200)
  ]);

  return {
    events: (events ?? []).map((row) => ({
      id: String(row.id),
      request_id: (row.request_id as string | null) ?? null,
      event_type: String(row.event_type ?? ""),
      created_at: String(row.created_at ?? ""),
      safety_state: (row.safety_state as string | null) ?? null,
      latency_ms: row.latency_ms != null ? Number(row.latency_ms) : null,
      event_payload: toRecord(row.event_payload as never) as Record<string, unknown>
    })),
    changes: (changes ?? []) as Array<{ id: string; request_id: string | null; scope: string; entity_type: string; action: string; created_at: string }>
  };
};

export const getVersionCausalityData = async (): Promise<{
  versionEvents: Array<{ id: string; recipe_version_id: string; event_type: string; request_id: string | null; created_at: string }>;
  links: Array<{ id: string; parent_recipe_id: string; child_recipe_id: string; position: number; updated_at: string }>;
}> => {
  const client = getAdminClient();

  const [{ data: versionEvents }, { data: links }] = await Promise.all([
    client
      .from("recipe_version_events")
      .select("id,recipe_version_id,event_type,request_id,created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    client
      .from("recipe_links")
      .select("id,parent_recipe_id,child_recipe_id,position,updated_at")
      .order("updated_at", { ascending: false })
      .limit(200)
  ]);

  return {
    versionEvents: (versionEvents ?? []) as Array<{ id: string; recipe_version_id: string; event_type: string; request_id: string | null; created_at: string }>,
    links: (links ?? []) as Array<{ id: string; parent_recipe_id: string; child_recipe_id: string; position: number; updated_at: string }>
  };
};

export const getSimulationData = async (): Promise<{
  recentRuns: Array<{ created_at: string; request_id: string | null; event_type: string; event_payload: Record<string, unknown> }>;
}> => {
  const client = getAdminClient();
  const { data } = await client
    .from("events")
    .select("created_at,request_id,event_type,event_payload")
    .in("event_type", ["simulation_run_started", "simulation_run_completed", "simulation_run_failed"])
    .order("created_at", { ascending: false })
    .limit(100);

  return {
    recentRuns: (data ?? []).map((row) => ({
      created_at: row.created_at as string,
      request_id: (row.request_id as string | null) ?? null,
      event_type: row.event_type as string,
      event_payload: toRecord(row.event_payload as never) as Record<string, unknown>
    }))
  };
};
