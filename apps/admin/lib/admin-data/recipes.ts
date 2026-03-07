import { getAdminClient } from "@/lib/supabase-admin";
import { isSchemaMissingError } from "./shared";

export type RecipeAuditIndexRow = {
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

export type RecipeAuditDetail = {
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
  image_assignment: {
    image_request_id: string;
    asset_id: string | null;
    asset_image_url: string | null;
    assignment_source: string | null;
    reused_from_recipe_id: string | null;
    reused_from_recipe_version_id: string | null;
    reuse_evaluation: Record<string, unknown>;
  } | null;
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
    recipes = (preferredRecipesQuery.data ?? []) as typeof recipes;
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
  const currentVersionIds = Array.from(new Set(filteredRecipes.map((recipe) => recipe.current_version_id).filter((id): id is string => Boolean(id))));

  const [
    { data: owners },
    { data: versions },
    { data: saves },
    { data: attachments },
    { data: chatMessages },
    { data: currentVersions },
    { data: versionEvents }
  ] = await Promise.all([
    ownerIds.length === 0 ? Promise.resolve({ data: [] as Array<{ id: string; email: string | null }> }) : client.from("users").select("id,email").in("id", ownerIds),
    recipeIds.length === 0 ? Promise.resolve({ data: [] as Array<{ recipe_id: string }> }) : client.from("recipe_versions").select("id,recipe_id").in("recipe_id", recipeIds),
    recipeIds.length === 0 ? Promise.resolve({ data: [] as Array<{ recipe_id: string }> }) : client.from("recipe_saves").select("recipe_id").in("recipe_id", recipeIds),
    recipeIds.length === 0 ? Promise.resolve({ data: [] as Array<{ parent_recipe_id: string }> }) : client.from("recipe_links").select("parent_recipe_id").in("parent_recipe_id", recipeIds),
    chatIds.length === 0 ? Promise.resolve({ data: [] as Array<{ chat_id: string }> }) : client.from("chat_messages").select("chat_id").in("chat_id", chatIds),
    currentVersionIds.length === 0 ? Promise.resolve({ data: [] as Array<{ id: string; diff_summary: string | null }> }) : client.from("recipe_versions").select("id,diff_summary").in("id", currentVersionIds),
    currentVersionIds.length === 0
      ? Promise.resolve({ data: [] as Array<{ recipe_version_id: string; request_id: string | null }> })
      : client.from("recipe_version_events").select("recipe_version_id,request_id,created_at").in("recipe_version_id", currentVersionIds).order("created_at", { ascending: false })
  ]);

  const ownerById = new Map((owners ?? []).map((owner) => [owner.id, owner.email]));
  const versionCountByRecipe = new Map<string, number>();
  for (const row of versions ?? []) versionCountByRecipe.set(row.recipe_id, (versionCountByRecipe.get(row.recipe_id) ?? 0) + 1);
  const saveCountByRecipe = new Map<string, number>();
  for (const row of saves ?? []) saveCountByRecipe.set(row.recipe_id, (saveCountByRecipe.get(row.recipe_id) ?? 0) + 1);
  const attachmentCountByRecipe = new Map<string, number>();
  for (const row of attachments ?? []) attachmentCountByRecipe.set(row.parent_recipe_id, (attachmentCountByRecipe.get(row.parent_recipe_id) ?? 0) + 1);
  const chatMessageCountByChat = new Map<string, number>();
  for (const row of chatMessages ?? []) chatMessageCountByChat.set(row.chat_id, (chatMessageCountByChat.get(row.chat_id) ?? 0) + 1);
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
      if (row.source_chat_id) acc.chatBacked += 1;
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

  const [{ data: owner }, { data: versions, error: versionsError }, { data: chat }, { data: chatMessages }, { data: links }, { data: imageAssignment, error: imageAssignmentError }] =
    await Promise.all([
      client.from("users").select("id,email").eq("id", recipe.owner_user_id).maybeSingle(),
      client.from("recipe_versions").select("id,parent_version_id,diff_summary,created_at,created_by,payload").eq("recipe_id", recipe.id).order("created_at", { ascending: true }),
      recipe.source_chat_id ? client.from("chat_sessions").select("id,status,context,created_at,updated_at").eq("id", recipe.source_chat_id).maybeSingle() : Promise.resolve({ data: null }),
      recipe.source_chat_id
        ? client.from("chat_messages").select("id,role,content,metadata,created_at").eq("chat_id", recipe.source_chat_id).order("created_at", { ascending: true })
        : Promise.resolve({ data: [] as Array<{ id: string; role: string; content: string; metadata: Record<string, unknown>; created_at: string }> }),
      client.from("recipe_links").select("id,child_recipe_id,relation_type_id,position,source,metadata,updated_at").eq("parent_recipe_id", recipe.id).order("position", { ascending: true }),
      recipe.current_version_id
        ? client
            .from("recipe_image_assignments")
            .select("image_request_id,asset_id,assignment_source,reused_from_recipe_id,reused_from_recipe_version_id,reuse_evaluation")
            .eq("recipe_version_id", recipe.current_version_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null })
    ]);

  if (versionsError) {
    throw new Error(versionsError.message);
  }
  if (imageAssignmentError && !isSchemaMissingError(imageAssignmentError)) {
    throw new Error(imageAssignmentError.message);
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
      : client.from("recipe_version_events").select("recipe_version_id,event_type,request_id,metadata,created_at").in("recipe_version_id", versionIds).order("created_at", { ascending: false }),
    (links ?? []).length === 0
      ? Promise.resolve({ data: [] as Array<{ id: string; name: string }> })
      : client.from("graph_relation_types").select("id,name").in("id", Array.from(new Set((links ?? []).map((link) => link.relation_type_id)))),
    (links ?? []).length === 0
      ? Promise.resolve({ data: [] as Array<{ id: string; title: string; current_version_id: string | null }> })
      : client.from("recipes").select("id,title,current_version_id").in("id", Array.from(new Set((links ?? []).map((link) => link.child_recipe_id))))
  ]);

  const eventByVersion = new Map<string, { event_type: string; request_id: string | null; metadata: Record<string, unknown> | null }>();
  for (const event of versionEvents ?? []) {
    if (!eventByVersion.has(event.recipe_version_id)) {
      eventByVersion.set(event.recipe_version_id, {
        event_type: event.event_type,
        request_id: event.request_id,
        metadata: event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata) ? (event.metadata as Record<string, unknown>) : null
      });
    }
  }

  const relationById = new Map((relationTypes ?? []).map((relationType) => [relationType.id, relationType.name]));
  const childById = new Map((childRecipes ?? []).map((childRecipe) => [childRecipe.id, childRecipe]));
  const requestIds = Array.from(
    new Set((versionEvents ?? []).map((event) => event.request_id).filter((requestId): requestId is string => typeof requestId === "string" && requestId.length > 0))
  );

  const [recipeChanges, chatChanges, requestChanges] = await Promise.all([
    client.from("changelog_events").select("id,scope,entity_type,entity_id,action,request_id,created_at,metadata").eq("entity_type", "recipe").eq("entity_id", recipe.id).order("created_at", { ascending: false }).limit(200),
    recipe.source_chat_id
      ? client.from("changelog_events").select("id,scope,entity_type,entity_id,action,request_id,created_at,metadata").eq("entity_type", "chat_session").eq("entity_id", recipe.source_chat_id).order("created_at", { ascending: false }).limit(200)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    requestIds.length === 0
      ? Promise.resolve({ data: [] as Array<Record<string, unknown>> })
      : client.from("changelog_events").select("id,scope,entity_type,entity_id,action,request_id,created_at,metadata").in("request_id", requestIds).order("created_at", { ascending: false }).limit(300)
  ]);

  const changelogById = new Map<string, RecipeAuditDetail["changelog"][number]>();
  for (const row of [...(recipeChanges.data ?? []), ...(chatChanges.data ?? []), ...(requestChanges.data ?? [])]) {
    const id = String(row.id);
    if (changelogById.has(id)) continue;
    changelogById.set(id, {
      id,
      scope: String(row.scope ?? "unknown"),
      entity_type: String(row.entity_type ?? "unknown"),
      entity_id: row.entity_id ? String(row.entity_id) : null,
      action: String(row.action ?? "unknown"),
      request_id: row.request_id ? String(row.request_id) : null,
      created_at: String(row.created_at ?? new Date().toISOString()),
      metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? (row.metadata as Record<string, unknown>) : {}
    });
  }

  const versionsWithMetrics = versionRows.map((version) => {
    const event = eventByVersion.get(version.id);
    const payload = version.payload && typeof version.payload === "object" ? version.payload : {};
    const ingredients = Array.isArray((payload as { ingredients?: unknown }).ingredients) ? ((payload as { ingredients: unknown[] }).ingredients as unknown[]) : [];
    const steps = Array.isArray((payload as { steps?: unknown }).steps) ? ((payload as { steps: unknown[] }).steps as unknown[]) : [];

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
      .select("id,recipe_version_id,ingredient_id,source_name,source_amount,source_unit,normalized_amount_si,normalized_unit,unit_kind,normalized_status,category,component,position,updated_at")
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

  const canonicalIngredientIds = Array.from(new Set(canonicalIngredientsRaw.map((row) => row.ingredient_id).filter((id): id is string => Boolean(id))));
  const canonicalNameById = new Map<string, string>();
  if (canonicalIngredientIds.length > 0) {
    const canonicalNamesResult = await client.from("ingredients").select("id,canonical_name").in("id", canonicalIngredientIds);
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

  let assetImageUrl: string | null = null;
  if (imageAssignment?.asset_id) {
    const assetResult = await client
      .from("recipe_image_assets")
      .select("image_url")
      .eq("id", imageAssignment.asset_id)
      .maybeSingle();
    if (!assetResult.error && assetResult.data?.image_url) {
      assetImageUrl = String(assetResult.data.image_url);
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
    image_assignment: imageAssignment
      ? {
          image_request_id: String(imageAssignment.image_request_id),
          asset_id: imageAssignment.asset_id ? String(imageAssignment.asset_id) : null,
          asset_image_url: assetImageUrl,
          assignment_source: imageAssignment.assignment_source ? String(imageAssignment.assignment_source) : null,
          reused_from_recipe_id: imageAssignment.reused_from_recipe_id ? String(imageAssignment.reused_from_recipe_id) : null,
          reused_from_recipe_version_id: imageAssignment.reused_from_recipe_version_id ? String(imageAssignment.reused_from_recipe_version_id) : null,
          reuse_evaluation: imageAssignment.reuse_evaluation && typeof imageAssignment.reuse_evaluation === "object" && !Array.isArray(imageAssignment.reuse_evaluation)
            ? (imageAssignment.reuse_evaluation as Record<string, unknown>)
            : {}
        }
      : null,
    chat: chat
      ? {
          id: String(chat.id),
          status: String(chat.status),
          created_at: String(chat.created_at),
          updated_at: String(chat.updated_at),
          context: chat.context && typeof chat.context === "object" && !Array.isArray(chat.context) ? (chat.context as Record<string, unknown>) : {}
        }
      : null,
    versions: versionsWithMetrics,
    chat_messages: (chatMessages ?? []).map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      metadata: message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata) ? (message.metadata as Record<string, unknown>) : {},
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
    changelog: Array.from(changelogById.values()).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  };
};

// ── Cookbook + Variant admin data functions ──────────────────────────────────

export type CookbookEntryRow = {
  user_id: string;
  user_email: string | null;
  canonical_recipe_id: string;
  autopersonalize: boolean;
  saved_at: string;
  updated_at: string;
  variant_id: string | null;
  variant_status: string | null;
  preference_fingerprint: string | null;
  last_materialized_at: string | null;
  derivation_kind: string | null;
};

type VariantDetailRow = {
  variant_id: string;
  user_id: string;
  user_email: string | null;
  canonical_recipe_id: string;
  canonical_title: string;
  stale_status: string;
  preference_fingerprint: string | null;
  base_canonical_version_id: string;
  last_materialized_at: string | null;
  created_at: string;
  versions: Array<{
    id: string;
    parent_variant_version_id: string | null;
    source_canonical_version_id: string;
    derivation_kind: string;
    provenance: Record<string, unknown>;
    created_at: string;
    payload_summary: {
      title: string;
      ingredient_count: number;
      step_count: number;
    };
  }>;
};

/**
 * Fetch all cookbook entries for a canonical recipe. Used in the recipe audit
 * panel's Cookbook tab to show who has saved this recipe and their variant status.
 */
export const getRecipeCookbookEntries = async (
  recipeId: string
): Promise<CookbookEntryRow[]> => {
  const client = getAdminClient();

  const { data: entries, error } = await client
    .from("cookbook_entries")
    .select("user_id, canonical_recipe_id, autopersonalize, saved_at, updated_at")
    .eq("canonical_recipe_id", recipeId)
    .order("saved_at", { ascending: false });

  if (error) {
    if (!isSchemaMissingError(error)) throw new Error(error.message);
    return [];
  }

  if (!entries || entries.length === 0) return [];

  const userIds = Array.from(new Set(entries.map((e) => e.user_id)));

  const [{ data: users }, { data: variants }] = await Promise.all([
    client.from("users").select("id,email").in("id", userIds),
    client
      .from("user_recipe_variants")
      .select("id, user_id, stale_status, preference_fingerprint, last_materialized_at, current_version_id")
      .eq("canonical_recipe_id", recipeId)
      .in("user_id", userIds),
  ]);

  const emailById = new Map((users ?? []).map((u) => [u.id, u.email]));
  const variantByUser = new Map(
    (variants ?? []).map((v) => [v.user_id, v])
  );

  // Fetch derivation_kind for variants that have a current version
  const versionIds = (variants ?? [])
    .map((v) => v.current_version_id)
    .filter((id): id is string => Boolean(id));

  let derivationByVersionId = new Map<string, string>();
  if (versionIds.length > 0) {
    const { data: versionData } = await client
      .from("user_recipe_variant_versions")
      .select("id, derivation_kind")
      .in("id", versionIds);
    derivationByVersionId = new Map(
      (versionData ?? []).map((v) => [v.id, v.derivation_kind])
    );
  }

  return entries.map((entry) => {
    const variant = variantByUser.get(entry.user_id);
    return {
      user_id: entry.user_id,
      user_email: emailById.get(entry.user_id) ?? null,
      canonical_recipe_id: entry.canonical_recipe_id,
      autopersonalize: entry.autopersonalize,
      saved_at: entry.saved_at,
      updated_at: entry.updated_at,
      variant_id: variant?.id ?? null,
      variant_status: variant?.stale_status ?? null,
      preference_fingerprint: variant?.preference_fingerprint ?? null,
      last_materialized_at: variant?.last_materialized_at ?? null,
      derivation_kind: variant?.current_version_id
        ? derivationByVersionId.get(variant.current_version_id) ?? null
        : null,
    };
  });
};

/**
 * Fetch full variant detail for the admin variant inspector. Shows the variant's
 * version history with provenance and payload summaries for side-by-side comparison.
 */
export const getVariantDetail = async (
  variantId: string
): Promise<VariantDetailRow | null> => {
  const client = getAdminClient();

  const { data: variant, error } = await client
    .from("user_recipe_variants")
    .select("id, user_id, canonical_recipe_id, stale_status, preference_fingerprint, base_canonical_version_id, last_materialized_at, created_at")
    .eq("id", variantId)
    .maybeSingle();

  if (error || !variant) return null;

  const [{ data: user }, { data: recipe }, { data: versions }] = await Promise.all([
    client.from("users").select("email").eq("id", variant.user_id).maybeSingle(),
    client.from("recipes").select("title").eq("id", variant.canonical_recipe_id).maybeSingle(),
    client
      .from("user_recipe_variant_versions")
      .select("id, parent_variant_version_id, source_canonical_version_id, derivation_kind, provenance, payload, created_at")
      .eq("variant_id", variantId)
      .order("created_at", { ascending: true }),
  ]);

  return {
    variant_id: variant.id,
    user_id: variant.user_id,
    user_email: user?.email ?? null,
    canonical_recipe_id: variant.canonical_recipe_id,
    canonical_title: recipe?.title ?? "Unknown",
    stale_status: variant.stale_status,
    preference_fingerprint: variant.preference_fingerprint,
    base_canonical_version_id: variant.base_canonical_version_id,
    last_materialized_at: variant.last_materialized_at,
    created_at: variant.created_at,
    versions: (versions ?? []).map((v) => {
      const payload = v.payload && typeof v.payload === "object" ? v.payload as Record<string, unknown> : {};
      const ingredients = Array.isArray(payload["ingredients"]) ? payload["ingredients"] : [];
      const steps = Array.isArray(payload["steps"]) ? payload["steps"] : [];
      return {
        id: v.id,
        parent_variant_version_id: v.parent_variant_version_id,
        source_canonical_version_id: v.source_canonical_version_id,
        derivation_kind: v.derivation_kind,
        provenance: v.provenance && typeof v.provenance === "object" && !Array.isArray(v.provenance) ? v.provenance as Record<string, unknown> : {},
        created_at: v.created_at,
        payload_summary: {
          title: typeof payload["title"] === "string" ? payload["title"] : "Untitled",
          ingredient_count: ingredients.length,
          step_count: steps.length,
        },
      };
    }),
  };
};

/**
 * Aggregate variant health stats for the admin dashboard and recipe coverage snapshot.
 * Returns counts of cookbook entries, variants by status, and materialisation rates.
 */
export const getVariantStats = async (): Promise<{
  cookbook_entries: number;
  variants_total: number;
  variants_current: number;
  variants_stale: number;
  variants_processing: number;
  variants_failed: number;
  variants_needs_review: number;
}> => {
  const client = getAdminClient();

  const [cookbookResult, variantsResult] = await Promise.all([
    client.from("cookbook_entries").select("user_id", { count: "exact", head: true }),
    client.from("user_recipe_variants").select("stale_status"),
  ]);

  if (cookbookResult.error && !isSchemaMissingError(cookbookResult.error)) {
    throw new Error(cookbookResult.error.message);
  }

  const variants = variantsResult.data ?? [];
  const statusCounts = variants.reduce(
    (acc, v) => {
      const status = v.stale_status as string;
      if (status === "current") acc.current += 1;
      else if (status === "stale") acc.stale += 1;
      else if (status === "processing") acc.processing += 1;
      else if (status === "failed") acc.failed += 1;
      else if (status === "needs_review") acc.needs_review += 1;
      return acc;
    },
    { current: 0, stale: 0, processing: 0, failed: 0, needs_review: 0 }
  );

  return {
    cookbook_entries: cookbookResult.count ?? 0,
    variants_total: variants.length,
    variants_current: statusCounts.current,
    variants_stale: statusCounts.stale,
    variants_processing: statusCounts.processing,
    variants_failed: statusCounts.failed,
    variants_needs_review: statusCounts.needs_review,
  };
};
