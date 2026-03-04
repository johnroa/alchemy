import { getAdminClient, toRecord } from "@/lib/supabase-admin";

export type RegistryModel = {
  id: string;
  provider: string;
  model: string;
  display_name: string;
  input_cost_per_1m_tokens: number;
  output_cost_per_1m_tokens: number;
  context_window_tokens: number | null;
  max_output_tokens: number | null;
  is_available: boolean;
  notes: string | null;
};

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
      .select("id,provider,model,display_name,input_cost_per_1m_tokens,output_cost_per_1m_tokens,context_window_tokens,max_output_tokens,is_available,notes")
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
    models: (models ?? []) as RegistryModel[]
  };
};

type RecipeAuditIndexRow = {
  id: string;
  title: string;
  owner_user_id: string;
  owner_email: string | null;
  source_chat_id: string | null;
  current_version_id: string | null;
  visibility: string;
  image_status: string;
  created_at: string;
  updated_at: string;
  version_count: number;
  save_count: number;
  attachment_count: number;
  chat_message_count: number;
  latest_diff_summary: string | null;
  latest_request_id: string | null;
};

type RecipeAuditDetail = {
  recipe: {
    id: string;
    title: string;
    owner_user_id: string;
    owner_email: string | null;
    source_chat_id: string | null;
    current_version_id: string | null;
    visibility: string;
    hero_image_url: string | null;
    image_status: string;
    created_at: string;
    updated_at: string;
  };
  chat: {
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
  chat_messages: Array<{
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
  canonical_ingredients: Array<{
    id: string;
    recipe_version_id: string;
    ingredient_id: string | null;
    canonical_name: string | null;
    source_name: string;
    source_amount: number | null;
    source_unit: string | null;
    normalized_amount_si: number | null;
    normalized_unit: string | null;
    unit_kind: string;
    normalized_status: string;
    category: string | null;
    component: string | null;
    position: number;
    updated_at: string;
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
    chatBacked: number;
  };
}> => {
  const client = getAdminClient();
  const preferredRecipesQuery = await client
    .from("recipes")
    .select("id,title,owner_user_id,source_chat_id,current_version_id,visibility,image_status,created_at,updated_at")
    .order("updated_at", { ascending: false })
    .limit(250);

  let recipes: Array<{
    id: string;
    title: string;
    owner_user_id: string;
    source_chat_id: string | null;
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
      .select("id,title,owner_user_id,source_chat_id,current_version_id,visibility,created_at,updated_at")
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
      source_chat_id: string | null;
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
            recipe.source_chat_id ?? "",
            recipe.current_version_id ?? ""
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(normalizedSearch);
        });

  const recipeIds = filteredRecipes.map((recipe) => recipe.id);
  const ownerIds = Array.from(new Set(filteredRecipes.map((recipe) => recipe.owner_user_id)));
  const chatIds = Array.from(new Set(filteredRecipes.map((recipe) => recipe.source_chat_id).filter((id): id is string => Boolean(id))));
  const currentVersionIds = Array.from(
    new Set(filteredRecipes.map((recipe) => recipe.current_version_id).filter((id): id is string => Boolean(id)))
  );

  const [
    { data: owners },
    { data: versions },
    { data: saves },
    { data: attachments },
    { data: chatMessages },
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
    chatIds.length === 0
      ? Promise.resolve({ data: [] as Array<{ chat_id: string }> })
      : client.from("chat_messages").select("chat_id").in("chat_id", chatIds),
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

  const chatMessageCountByChat = new Map<string, number>();
  for (const row of chatMessages ?? []) {
    chatMessageCountByChat.set(row.chat_id, (chatMessageCountByChat.get(row.chat_id) ?? 0) + 1);
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
    source_chat_id: recipe.source_chat_id,
    current_version_id: recipe.current_version_id,
    visibility: recipe.visibility,
    image_status: recipe.image_status,
    created_at: recipe.created_at,
    updated_at: recipe.updated_at,
    version_count: versionCountByRecipe.get(recipe.id) ?? 0,
    save_count: saveCountByRecipe.get(recipe.id) ?? 0,
    attachment_count: attachmentCountByRecipe.get(recipe.id) ?? 0,
    chat_message_count: recipe.source_chat_id ? chatMessageCountByChat.get(recipe.source_chat_id) ?? 0 : 0,
    latest_diff_summary: recipe.current_version_id ? diffByVersion.get(recipe.current_version_id) ?? null : null,
    latest_request_id: recipe.current_version_id ? requestByVersion.get(recipe.current_version_id) ?? null : null
  }));

  const totals = rows.reduce(
    (acc, row) => {
      acc.recipes += 1;
      acc.versions += row.version_count;
      acc.attachments += row.attachment_count;
      acc.saves += row.save_count;
      if (row.source_chat_id) {
        acc.chatBacked += 1;
      }
      return acc;
    },
    { recipes: 0, versions: 0, attachments: 0, saves: 0, chatBacked: 0 }
  );

  return { rows, totals };
};

export const getRecipeAuditDetail = async (recipeId: string): Promise<RecipeAuditDetail | null> => {
  const client = getAdminClient();

  const preferredRecipeQuery = await client
    .from("recipes")
    .select("id,title,owner_user_id,source_chat_id,current_version_id,visibility,hero_image_url,image_status,created_at,updated_at")
    .eq("id", recipeId)
    .maybeSingle();

  let recipe: {
    id: string;
    title: string;
    owner_user_id: string;
    source_chat_id: string | null;
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
      .select("id,title,owner_user_id,source_chat_id,current_version_id,visibility,hero_image_url,created_at,updated_at")
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

  const [{ data: owner }, { data: versions, error: versionsError }, { data: chat }, { data: chatMessages }, { data: links }] =
    await Promise.all([
      client.from("users").select("id,email").eq("id", recipe.owner_user_id).maybeSingle(),
      client
        .from("recipe_versions")
        .select("id,parent_version_id,diff_summary,created_at,created_by,payload")
        .eq("recipe_id", recipe.id)
        .order("created_at", { ascending: true }),
      recipe.source_chat_id
        ? client.from("chat_sessions").select("id,status,context,created_at,updated_at").eq("id", recipe.source_chat_id).maybeSingle()
        : Promise.resolve({ data: null }),
      recipe.source_chat_id
        ? client
            .from("chat_messages")
            .select("id,role,content,metadata,created_at")
            .eq("chat_id", recipe.source_chat_id)
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

  const [recipeChanges, chatChanges, requestChanges] = await Promise.all([
    client
      .from("changelog_events")
      .select("id,scope,entity_type,entity_id,action,request_id,created_at,metadata")
      .eq("entity_type", "recipe")
      .eq("entity_id", recipe.id)
      .order("created_at", { ascending: false })
      .limit(200),
    recipe.source_chat_id
      ? client
          .from("changelog_events")
          .select("id,scope,entity_type,entity_id,action,request_id,created_at,metadata")
          .eq("entity_type", "chat_session")
          .eq("entity_id", recipe.source_chat_id)
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
  for (const row of [...(recipeChanges.data ?? []), ...(chatChanges.data ?? []), ...(requestChanges.data ?? [])]) {
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

  let canonicalIngredientsRaw: Array<{
    id: string;
    recipe_version_id: string;
    ingredient_id: string | null;
    source_name: string;
    source_amount: number | null;
    source_unit: string | null;
    normalized_amount_si: number | null;
    normalized_unit: string | null;
    unit_kind: string;
    normalized_status: string;
    category: string | null;
    component: string | null;
    position: number;
    updated_at: string;
  }> = [];

  if (recipe.current_version_id) {
    const canonicalResult = await client
      .from("recipe_ingredients")
      .select(
        "id,recipe_version_id,ingredient_id,source_name,source_amount,source_unit,normalized_amount_si,normalized_unit,unit_kind,normalized_status,category,component,position,updated_at"
      )
      .eq("recipe_version_id", recipe.current_version_id)
      .order("position", { ascending: true });

    if (canonicalResult.error) {
      if (!isSchemaMissingError(canonicalResult.error)) {
        throw new Error(canonicalResult.error.message);
      }
    } else {
      canonicalIngredientsRaw = (canonicalResult.data ?? []) as typeof canonicalIngredientsRaw;
    }
  }

  const canonicalIngredientIds = Array.from(
    new Set(canonicalIngredientsRaw.map((row) => row.ingredient_id).filter((id): id is string => Boolean(id)))
  );
  const canonicalNameById = new Map<string, string>();
  if (canonicalIngredientIds.length > 0) {
    const canonicalNamesResult = await client
      .from("ingredients")
      .select("id,canonical_name")
      .in("id", canonicalIngredientIds);

    if (canonicalNamesResult.error) {
      if (!isSchemaMissingError(canonicalNamesResult.error)) {
        throw new Error(canonicalNamesResult.error.message);
      }
    } else {
      for (const row of canonicalNamesResult.data ?? []) {
        canonicalNameById.set(row.id, row.canonical_name);
      }
    }
  }

  return {
    recipe: {
      id: recipe.id,
      title: recipe.title,
      owner_user_id: recipe.owner_user_id,
      owner_email: owner?.email ?? null,
      source_chat_id: recipe.source_chat_id,
      current_version_id: recipe.current_version_id,
      visibility: recipe.visibility,
      hero_image_url: recipe.hero_image_url,
      image_status: recipe.image_status,
      created_at: recipe.created_at,
      updated_at: recipe.updated_at
    },
    chat: chat
      ? {
          id: String(chat.id),
          status: String(chat.status),
          created_at: String(chat.created_at),
          updated_at: String(chat.updated_at),
          context:
            chat.context && typeof chat.context === "object" && !Array.isArray(chat.context)
              ? (chat.context as Record<string, unknown>)
              : {}
        }
      : null,
    versions: versionsWithMetrics,
    chat_messages: (chatMessages ?? []).map((message) => ({
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
    canonical_ingredients: canonicalIngredientsRaw.map((row) => ({
      id: String(row.id),
      recipe_version_id: String(row.recipe_version_id),
      ingredient_id: row.ingredient_id ? String(row.ingredient_id) : null,
      canonical_name: row.ingredient_id ? canonicalNameById.get(row.ingredient_id) ?? null : null,
      source_name: String(row.source_name),
      source_amount: row.source_amount != null ? Number(row.source_amount) : null,
      source_unit: row.source_unit ? String(row.source_unit) : null,
      normalized_amount_si: row.normalized_amount_si != null ? Number(row.normalized_amount_si) : null,
      normalized_unit: row.normalized_unit ? String(row.normalized_unit) : null,
      unit_kind: String(row.unit_kind ?? "unknown"),
      normalized_status: String(row.normalized_status ?? "needs_retry"),
      category: row.category ? String(row.category) : null,
      component: row.component ? String(row.component) : null,
      position: Number(row.position ?? 0),
      updated_at: String(row.updated_at)
    })),
    changelog: Array.from(changelogById.values()).sort((a, b) => {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    })
  };
};

export const getGraphData = async (recipeId?: string): Promise<{
  context_recipe_id: string | null;
  entities: Array<{ id: string; entity_type: string; label: string; metadata: Record<string, unknown> }>;
  edges: Array<{
    id: string;
    from_entity_id: string;
    to_entity_id: string;
    from_label: string;
    to_label: string;
    relation_type: string;
    confidence: number;
    source: string;
  }>;
  relation_types: string[];
  metadata_queue: {
    pending: number;
    processing: number;
    ready: number;
    failed: number;
  };
}> => {
  const client = getAdminClient();

  let entityIds: string[] = [];
  let contextRecipeId: string | null = null;

  if (recipeId) {
    const { data: recipe, error: recipeError } = await client
      .from("recipes")
      .select("id,current_version_id")
      .eq("id", recipeId)
      .maybeSingle();

    if (recipeError && !isSchemaMissingError(recipeError)) {
      throw new Error(recipeError.message);
    }

    if (recipe?.current_version_id) {
      contextRecipeId = recipe.id;
      const { data: links, error: linksError } = await client
        .from("recipe_graph_links")
        .select("entity_id")
        .eq("recipe_version_id", recipe.current_version_id);

      if (linksError && !isSchemaMissingError(linksError)) {
        throw new Error(linksError.message);
      }

      entityIds = Array.from(new Set((links ?? []).map((link) => String(link.entity_id))));
    }
  }

  let entities: Array<{ id: string; entity_type: string; label: string; metadata: Record<string, unknown> }> = [];
  if (entityIds.length > 0) {
    const { data: byId, error: byIdError } = await client
      .from("graph_entities")
      .select("id,entity_type,label,metadata")
      .in("id", entityIds)
      .limit(400);

    if (byIdError && !isSchemaMissingError(byIdError)) {
      throw new Error(byIdError.message);
    }

    entities = ((byId ?? []) as Array<{ id: string; entity_type: string; label: string; metadata: Record<string, unknown> }>).slice(0, 400);
  } else {
    const { data: recentEntities, error: entitiesError } = await client
      .from("graph_entities")
      .select("id,entity_type,label,metadata")
      .order("updated_at", { ascending: false })
      .limit(400);

    if (entitiesError && !isSchemaMissingError(entitiesError)) {
      throw new Error(entitiesError.message);
    }

    entities = (recentEntities ?? []) as Array<{ id: string; entity_type: string; label: string; metadata: Record<string, unknown> }>;
    entityIds = entities.map((entity) => entity.id);
  }

  if (entityIds.length === 0) {
    const queue = await getMetadataQueueSnapshot(client);
    return { context_recipe_id: contextRecipeId, entities: [], edges: [], relation_types: [], metadata_queue: queue };
  }

  const [{ data: edgesFrom, error: edgesFromError }, { data: edgesTo, error: edgesToError }] = await Promise.all([
    client
      .from("graph_edges")
      .select("id,from_entity_id,to_entity_id,relation_type_id,confidence,source")
      .in("from_entity_id", entityIds)
      .limit(500),
    client
      .from("graph_edges")
      .select("id,from_entity_id,to_entity_id,relation_type_id,confidence,source")
      .in("to_entity_id", entityIds)
      .limit(500)
  ]);

  if (edgesFromError && !isSchemaMissingError(edgesFromError)) {
    throw new Error(edgesFromError.message);
  }
  if (edgesToError && !isSchemaMissingError(edgesToError)) {
    throw new Error(edgesToError.message);
  }

  const rawEdges = [...(edgesFrom ?? []), ...(edgesTo ?? [])] as Array<{
    id: string;
    from_entity_id: string;
    to_entity_id: string;
    relation_type_id: string;
    confidence: number;
    source: string;
  }>;
  const entityIdSet = new Set(entityIds);
  const edgeById = new Map<string, (typeof rawEdges)[number]>();
  for (const edge of rawEdges) {
    if (!entityIdSet.has(edge.from_entity_id) || !entityIdSet.has(edge.to_entity_id)) {
      continue;
    }
    edgeById.set(edge.id, edge);
  }
  const edges = Array.from(edgeById.values());

  const relationTypeIds = Array.from(new Set(edges.map((edge) => edge.relation_type_id)));
  let relationNameById = new Map<string, string>();
  if (relationTypeIds.length > 0) {
    const { data: relationRows, error: relationError } = await client
      .from("graph_relation_types")
      .select("id,name")
      .in("id", relationTypeIds);
    if (relationError && !isSchemaMissingError(relationError)) {
      throw new Error(relationError.message);
    }
    relationNameById = new Map((relationRows ?? []).map((row) => [row.id, row.name]));
  }

  const entityLabelById = new Map(entities.map((entity) => [entity.id, entity.label]));

  return {
    context_recipe_id: contextRecipeId,
    entities,
    edges: edges.map((edge) => ({
      id: edge.id,
      from_entity_id: edge.from_entity_id,
      to_entity_id: edge.to_entity_id,
      from_label: entityLabelById.get(edge.from_entity_id) ?? edge.from_entity_id.slice(0, 8),
      to_label: entityLabelById.get(edge.to_entity_id) ?? edge.to_entity_id.slice(0, 8),
      relation_type: relationNameById.get(edge.relation_type_id) ?? "unknown",
      confidence: Number(edge.confidence ?? 0),
      source: String(edge.source ?? "unknown")
    })),
    relation_types: Array.from(new Set(edges.map((edge) => relationNameById.get(edge.relation_type_id) ?? "unknown"))).sort(),
    metadata_queue: await getMetadataQueueSnapshot(client)
  };
};

const getMetadataQueueSnapshot = async (
  client: ReturnType<typeof getAdminClient>
): Promise<{ pending: number; processing: number; ready: number; failed: number }> => {
  const [pending, processing, ready, failed] = await Promise.all([
    client.from("recipe_metadata_jobs").select("id", { count: "exact", head: true }).eq("status", "pending"),
    client.from("recipe_metadata_jobs").select("id", { count: "exact", head: true }).eq("status", "processing"),
    client.from("recipe_metadata_jobs").select("id", { count: "exact", head: true }).eq("status", "ready"),
    client.from("recipe_metadata_jobs").select("id", { count: "exact", head: true }).eq("status", "failed")
  ]);

  const errors = [pending.error, processing.error, ready.error, failed.error].filter(
    (error): error is NonNullable<typeof pending.error> => Boolean(error)
  );

  const blockingError = errors.find((error) => !isSchemaMissingError(error));
  if (blockingError) {
    throw new Error(blockingError.message);
  }

  return {
    pending: pending.count ?? 0,
    processing: processing.count ?? 0,
    ready: ready.count ?? 0,
    failed: failed.count ?? 0
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
  jobs: Array<{
    id: string;
    user_id: string;
    user_email: string | null;
    chat_id: string;
    message_id: string;
    status: string;
    attempts: number;
    max_attempts: number;
    next_attempt_at: string;
    last_error: string | null;
    locked_at: string | null;
    locked_by: string | null;
    updated_at: string;
  }>;
}> => {
  const client = getAdminClient();

  const [{ data: snapshots }, { data: memoriesRaw }, { data: jobsRaw, error: jobsError }] = await Promise.all([
    client.from("memory_snapshots").select("user_id,token_estimate,updated_at").order("updated_at", { ascending: false }).limit(100),
    client
      .from("memories")
      .select("id,user_id,memory_type,memory_kind,status,confidence,salience,content,updated_at")
      .order("updated_at", { ascending: false })
      .limit(150),
    client
      .from("memory_jobs")
      .select("id,user_id,chat_id,message_id,status,attempts,max_attempts,next_attempt_at,last_error,locked_at,locked_by,updated_at")
      .order("updated_at", { ascending: false })
      .limit(300)
  ]);

  if (jobsError && !isSchemaMissingError(jobsError)) {
    throw new Error(jobsError.message);
  }

  const userIds = Array.from(
    new Set([
      ...(snapshots ?? []).map((s) => s.user_id as string),
      ...(memoriesRaw ?? []).map((m) => m.user_id as string),
      ...((jobsRaw ?? []) as Array<{ user_id: string }>).map((j) => j.user_id)
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
    })),
    jobs: (jobsRaw ?? []).map((job) => ({
      id: String(job.id),
      user_id: String(job.user_id),
      user_email: emailById.get(String(job.user_id)) ?? null,
      chat_id: String(job.chat_id),
      message_id: String(job.message_id),
      status: String(job.status ?? "pending"),
      attempts: Number(job.attempts ?? 0),
      max_attempts: Number(job.max_attempts ?? 0),
      next_attempt_at: String(job.next_attempt_at),
      last_error: job.last_error ? String(job.last_error) : null,
      locked_at: job.locked_at ? String(job.locked_at) : null,
      locked_by: job.locked_by ? String(job.locked_by) : null,
      updated_at: String(job.updated_at)
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

export const getMetadataPipelineData = async (): Promise<{
  jobs: Array<{
    id: string;
    recipe_id: string;
    recipe_version_id: string;
    recipe_title: string | null;
    status: string;
    attempts: number;
    max_attempts: number;
    next_attempt_at: string;
    last_error: string | null;
    locked_at: string | null;
    locked_by: string | null;
    updated_at: string;
  }>;
}> => {
  const client = getAdminClient();
  const { data: jobs, error: jobsError } = await client
    .from("recipe_metadata_jobs")
    .select("id,recipe_id,recipe_version_id,status,attempts,max_attempts,next_attempt_at,last_error,locked_at,locked_by,updated_at")
    .order("updated_at", { ascending: false })
    .limit(250);

  if (jobsError) {
    if (isSchemaMissingError(jobsError)) {
      return { jobs: [] };
    }
    throw new Error(jobsError.message);
  }

  const recipeIds = Array.from(new Set((jobs ?? []).map((job) => job.recipe_id)));
  const { data: recipes, error: recipesError } =
    recipeIds.length > 0
      ? await client.from("recipes").select("id,title").in("id", recipeIds)
      : { data: [] as Array<{ id: string; title: string }>, error: null };

  if (recipesError && !isSchemaMissingError(recipesError)) {
    throw new Error(recipesError.message);
  }

  const titleByRecipeId = new Map((recipes ?? []).map((recipe) => [recipe.id, recipe.title]));

  return {
    jobs: (jobs ?? []).map((job) => ({
      id: String(job.id),
      recipe_id: String(job.recipe_id),
      recipe_version_id: String(job.recipe_version_id),
      recipe_title: titleByRecipeId.get(String(job.recipe_id)) ?? null,
      status: String(job.status),
      attempts: Number(job.attempts ?? 0),
      max_attempts: Number(job.max_attempts ?? 0),
      next_attempt_at: String(job.next_attempt_at),
      last_error: job.last_error ? String(job.last_error) : null,
      locked_at: job.locked_at ? String(job.locked_at) : null,
      locked_by: job.locked_by ? String(job.locked_by) : null,
      updated_at: String(job.updated_at)
    }))
  };
};

export const getIngredientsData = async (): Promise<{
  ingredients: Array<{
    id: string;
    canonical_name: string;
    normalized_key: string;
    alias_count: number;
    usage_count: number;
    metadata: Record<string, unknown>;
    metadata_key_count: number;
    enrichment_confidence: number | null;
    ontology_link_count: number;
    pair_link_count: number;
    updated_at: string;
  }>;
  aliases: Array<{
    id: string;
    ingredient_id: string;
    canonical_name: string | null;
    alias_key: string;
    source: string;
    confidence: number;
    updated_at: string;
  }>;
  unresolved_rows: Array<{
    id: string;
    recipe_version_id: string;
    source_name: string;
    source_amount: number | null;
    source_unit: string | null;
    normalized_status: string;
    updated_at: string;
  }>;
}> => {
  const client = getAdminClient();

  const [ingredientsResult, aliasesResult, usageResult, unresolvedResult] = await Promise.all([
    client
      .from("ingredients")
      .select("id,canonical_name,normalized_key,metadata,updated_at")
      .order("updated_at", { ascending: false })
      .limit(300),
    client
      .from("ingredient_aliases")
      .select("id,ingredient_id,alias_key,source,confidence,updated_at")
      .order("updated_at", { ascending: false })
      .limit(400),
    client
      .from("recipe_ingredients")
      .select("ingredient_id")
      .not("ingredient_id", "is", null)
      .limit(2000),
    client
      .from("recipe_ingredients")
      .select("id,recipe_version_id,source_name,source_amount,source_unit,normalized_status,updated_at")
      .eq("normalized_status", "needs_retry")
      .order("updated_at", { ascending: false })
      .limit(150)
  ]);

  if (ingredientsResult.error && !isSchemaMissingError(ingredientsResult.error)) {
    throw new Error(ingredientsResult.error.message);
  }
  if (aliasesResult.error && !isSchemaMissingError(aliasesResult.error)) {
    throw new Error(aliasesResult.error.message);
  }
  if (usageResult.error && !isSchemaMissingError(usageResult.error)) {
    throw new Error(usageResult.error.message);
  }
  if (unresolvedResult.error && !isSchemaMissingError(unresolvedResult.error)) {
    throw new Error(unresolvedResult.error.message);
  }

  const ingredients = (ingredientsResult.data ?? []) as Array<{
    id: string;
    canonical_name: string;
    normalized_key: string;
    metadata: Record<string, unknown> | null;
    updated_at: string;
  }>;

  const aliases = (aliasesResult.data ?? []) as Array<{
    id: string;
    ingredient_id: string;
    alias_key: string;
    source: string;
    confidence: number;
    updated_at: string;
  }>;

  const usageRows = (usageResult.data ?? []) as Array<{ ingredient_id: string | null }>;
  const unresolvedRows = (unresolvedResult.data ?? []) as Array<{
    id: string;
    recipe_version_id: string;
    source_name: string;
    source_amount: number | null;
    source_unit: string | null;
    normalized_status: string;
    updated_at: string;
  }>;

  const aliasCountByIngredientId = new Map<string, number>();
  for (const alias of aliases) {
    aliasCountByIngredientId.set(alias.ingredient_id, (aliasCountByIngredientId.get(alias.ingredient_id) ?? 0) + 1);
  }

  const usageCountByIngredientId = new Map<string, number>();
  for (const row of usageRows) {
    if (!row.ingredient_id) continue;
    usageCountByIngredientId.set(row.ingredient_id, (usageCountByIngredientId.get(row.ingredient_id) ?? 0) + 1);
  }

  const canonicalNameById = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient.canonical_name]));
  const ingredientIds = ingredients.map((ingredient) => ingredient.id);

  let ontologyRows: Array<{ ingredient_id: string }> = [];
  let pairRowsA: Array<{ ingredient_a_id: string; ingredient_b_id: string }> = [];
  let pairRowsB: Array<{ ingredient_a_id: string; ingredient_b_id: string }> = [];

  if (ingredientIds.length > 0) {
    const [ontologyResult, pairAResult, pairBResult] = await Promise.all([
      client
        .from("ingredient_ontology_links")
        .select("ingredient_id")
        .in("ingredient_id", ingredientIds)
        .limit(5000),
      client
        .from("ingredient_pair_stats")
        .select("ingredient_a_id,ingredient_b_id")
        .in("ingredient_a_id", ingredientIds)
        .limit(5000),
      client
        .from("ingredient_pair_stats")
        .select("ingredient_a_id,ingredient_b_id")
        .in("ingredient_b_id", ingredientIds)
        .limit(5000)
    ]);

    if (ontologyResult.error && !isSchemaMissingError(ontologyResult.error)) {
      throw new Error(ontologyResult.error.message);
    }
    if (pairAResult.error && !isSchemaMissingError(pairAResult.error)) {
      throw new Error(pairAResult.error.message);
    }
    if (pairBResult.error && !isSchemaMissingError(pairBResult.error)) {
      throw new Error(pairBResult.error.message);
    }

    ontologyRows = (ontologyResult.data ?? []) as Array<{ ingredient_id: string }>;
    pairRowsA = (pairAResult.data ?? []) as Array<{ ingredient_a_id: string; ingredient_b_id: string }>;
    pairRowsB = (pairBResult.data ?? []) as Array<{ ingredient_a_id: string; ingredient_b_id: string }>;
  }

  const ontologyCountByIngredientId = new Map<string, number>();
  for (const row of ontologyRows) {
    ontologyCountByIngredientId.set(
      row.ingredient_id,
      (ontologyCountByIngredientId.get(row.ingredient_id) ?? 0) + 1
    );
  }

  const pairCountByIngredientId = new Map<string, number>();
  const uniquePairs = new Set<string>();
  for (const row of [...pairRowsA, ...pairRowsB]) {
    const a = row.ingredient_a_id;
    const b = row.ingredient_b_id;
    if (!a || !b) continue;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (uniquePairs.has(key)) continue;
    uniquePairs.add(key);

    pairCountByIngredientId.set(a, (pairCountByIngredientId.get(a) ?? 0) + 1);
    pairCountByIngredientId.set(b, (pairCountByIngredientId.get(b) ?? 0) + 1);
  }

  return {
    ingredients: ingredients.map((ingredient) => ({
      ...(() => {
        const metadata =
          ingredient.metadata && typeof ingredient.metadata === "object" && !Array.isArray(ingredient.metadata)
            ? (ingredient.metadata as Record<string, unknown>)
            : {};
        const confidenceRaw = metadata["enrichment_confidence"];
        const confidenceValue = Number(confidenceRaw);
        return {
          metadata,
          metadata_key_count: Object.keys(metadata).length,
          enrichment_confidence: Number.isFinite(confidenceValue) ? confidenceValue : null
        };
      })(),
      id: ingredient.id,
      canonical_name: ingredient.canonical_name,
      normalized_key: ingredient.normalized_key,
      alias_count: aliasCountByIngredientId.get(ingredient.id) ?? 0,
      usage_count: usageCountByIngredientId.get(ingredient.id) ?? 0,
      ontology_link_count: ontologyCountByIngredientId.get(ingredient.id) ?? 0,
      pair_link_count: pairCountByIngredientId.get(ingredient.id) ?? 0,
      updated_at: ingredient.updated_at
    })),
    aliases: aliases.map((alias) => ({
      id: alias.id,
      ingredient_id: alias.ingredient_id,
      canonical_name: canonicalNameById.get(alias.ingredient_id) ?? null,
      alias_key: alias.alias_key,
      source: alias.source,
      confidence: Number(alias.confidence ?? 0),
      updated_at: alias.updated_at
    })),
    unresolved_rows: unresolvedRows.map((row) => ({
      id: row.id,
      recipe_version_id: row.recipe_version_id,
      source_name: row.source_name,
      source_amount: row.source_amount != null ? Number(row.source_amount) : null,
      source_unit: row.source_unit ? String(row.source_unit) : null,
      normalized_status: String(row.normalized_status ?? "needs_retry"),
      updated_at: row.updated_at
    }))
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

const toFiniteNumber = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const scopeLabel = (scope: string): string => {
  const known: Record<string, string> = {
    generate: "Generating",
    chat: "Chat",
    chat_ideation: "Chat Ideation",
    chat_generation: "Chat Generation",
    chat_iteration: "Chat Iteration",
    tweak: "Tweaking",
    image: "Image Generation",
    classify: "Classification",
    onboarding: "Onboarding",
    memory_extract: "Memory Extract",
    memory_select: "Memory Select",
    memory_summarize: "Memory Summarize",
    memory_conflict_resolve: "Memory Conflict Resolve"
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

export const getModelUsageData = async (): Promise<{
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
  const windowStart = new Date(windowEnd.getTime() - 14 * 24 * 60 * 60 * 1000);
  const hourlyStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000);

  const [{ data: rows, error }, { data: routes }, { data: registry }] = await Promise.all([
    client
      .from("events")
      .select("created_at,token_input,token_output,token_total,cost_usd,latency_ms,event_payload")
      .eq("event_type", "llm_call")
      .gte("created_at", windowStart.toISOString())
      .order("created_at", { ascending: false })
      .limit(5000),
    client
      .from("llm_model_routes")
      .select("scope,provider,model,is_active")
      .eq("is_active", true),
    client.from("llm_model_registry").select("provider,model,display_name")
  ]);

  if (error) {
    throw new Error(error.message);
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
    const key = `${provider}/${model}`;
    modelDisplayByKey.set(key, String(row.display_name ?? model));
  }

  const actionMap = new Map<
    string,
    {
      scope: string;
      label: string;
      calls: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costUsd: number;
      latencyMsSum: number;
      latencyCount: number;
    }
  >();
  const modelMap = new Map<
    string,
    {
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
    }
  >();

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

  for (let index = 13; index >= 0; index -= 1) {
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
      .sort((a, b) => b.totalTokens - a.totalTokens)
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

export const getSimulationData = async (): Promise<{
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
      .in("scope", ["chat_ideation", "chat_generation", "chat_iteration", "classify"])
      .order("scope")
      .order("is_active", { ascending: false }),
    client
      .from("llm_model_registry")
      .select("id,provider,model,display_name,input_cost_per_1m_tokens,output_cost_per_1m_tokens,context_window_tokens,max_output_tokens,is_available,notes")
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
    routes: (routes ?? []).map((r) => ({
      scope: r.scope as string,
      provider: r.provider as string,
      model: r.model as string,
      is_active: Boolean(r.is_active)
    })),
    registryModels: (registry ?? []) as RegistryModel[]
  };
};
