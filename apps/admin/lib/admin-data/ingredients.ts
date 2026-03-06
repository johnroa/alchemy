import { getAdminClient } from "@/lib/supabase-admin";
import { isSchemaMissingError } from "./shared";

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
  summary: {
    totals: {
      ingredients: number;
      aliases: number;
      mapped_ingredients: number;
      enriched_ingredients: number;
      ontology_links: number;
      pair_links: number;
      unresolved_rows: number;
      recipe_ingredient_rows: number;
      recipes_with_current_version: number;
    };
    rates: {
      mapped_coverage: number;
      enriched_coverage: number;
      ontology_coverage: number;
      pair_coverage: number;
      unresolved_rate: number;
    };
    averages: {
      enrichment_confidence: number | null;
      ingredients_per_recipe: number | null;
      unresolved_per_recipe: number | null;
      ontology_links_per_enriched: number | null;
      pair_links_per_mapped: number | null;
    };
    windows: {
      current_start: string;
      current_end: string;
      previous_start: string;
      previous_end: string;
      ingredients_added: { current: number; previous: number };
      aliases_added: { current: number; previous: number };
      enrichments_completed: { current: number; previous: number };
      ontology_links_added: { current: number; previous: number };
      pair_links_updated: { current: number; previous: number };
      unresolved_touched: { current: number; previous: number };
    };
  };
}> => {
  const client = getAdminClient();
  const now = new Date();
  const currentWindowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const previousWindowStart = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const currentWindowStartIso = currentWindowStart.toISOString();
  const previousWindowStartIso = previousWindowStart.toISOString();

  const inWindow = (value: string | null | undefined, startMs: number, endMs: number): boolean => {
    if (!value) return false;
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return false;
    return timestamp >= startMs && timestamp < endMs;
  };
  const nowMs = now.getTime();
  const currentStartMs = currentWindowStart.getTime();
  const previousStartMs = previousWindowStart.getTime();

  const [
    ingredientsResult,
    ingredientMetricsResult,
    aliasesResult,
    usageResult,
    unresolvedResult,
    totalRecipeIngredientCountResult,
    unresolvedCountResult,
    recipesResult,
    aliasesWindowResult,
    ontologyAllResult,
    ontologyWindowResult,
    pairAllResult,
    pairWindowResult
  ] = await Promise.all([
    client.from("ingredients").select("id,canonical_name,normalized_key,metadata,updated_at").order("updated_at", { ascending: false }).limit(300),
    client.from("ingredients").select("id,metadata,created_at,updated_at").order("updated_at", { ascending: false }).limit(5000),
    client.from("ingredient_aliases").select("id,ingredient_id,alias_key,source,confidence,updated_at").order("updated_at", { ascending: false }).limit(500),
    client.from("recipe_ingredients").select("ingredient_id,recipe_version_id,normalized_status,updated_at").limit(50000),
    client
      .from("recipe_ingredients")
      .select("id,recipe_version_id,source_name,source_amount,source_unit,normalized_status,updated_at")
      .eq("normalized_status", "needs_retry")
      .order("updated_at", { ascending: false })
      .limit(150),
    client.from("recipe_ingredients").select("id", { count: "exact", head: true }),
    client.from("recipe_ingredients").select("id", { count: "exact", head: true }).eq("normalized_status", "needs_retry"),
    client.from("recipes").select("id,current_version_id").not("current_version_id", "is", null).limit(5000),
    client.from("ingredient_aliases").select("id,created_at").gte("created_at", previousWindowStartIso).limit(5000),
    client.from("ingredient_ontology_links").select("ingredient_id").limit(20000),
    client.from("ingredient_ontology_links").select("ingredient_id,created_at").gte("created_at", previousWindowStartIso).limit(20000),
    client.from("ingredient_pair_stats").select("ingredient_a_id,ingredient_b_id").limit(20000),
    client.from("ingredient_pair_stats").select("ingredient_a_id,ingredient_b_id,updated_at").gte("updated_at", previousWindowStartIso).limit(20000)
  ]);

  if (ingredientsResult.error && !isSchemaMissingError(ingredientsResult.error)) throw new Error(ingredientsResult.error.message);
  if (ingredientMetricsResult.error && !isSchemaMissingError(ingredientMetricsResult.error)) throw new Error(ingredientMetricsResult.error.message);
  if (aliasesResult.error && !isSchemaMissingError(aliasesResult.error)) throw new Error(aliasesResult.error.message);
  if (usageResult.error && !isSchemaMissingError(usageResult.error)) throw new Error(usageResult.error.message);
  if (unresolvedResult.error && !isSchemaMissingError(unresolvedResult.error)) throw new Error(unresolvedResult.error.message);
  if (totalRecipeIngredientCountResult.error && !isSchemaMissingError(totalRecipeIngredientCountResult.error)) throw new Error(totalRecipeIngredientCountResult.error.message);
  if (unresolvedCountResult.error && !isSchemaMissingError(unresolvedCountResult.error)) throw new Error(unresolvedCountResult.error.message);
  if (recipesResult.error && !isSchemaMissingError(recipesResult.error)) throw new Error(recipesResult.error.message);
  if (aliasesWindowResult.error && !isSchemaMissingError(aliasesWindowResult.error)) throw new Error(aliasesWindowResult.error.message);
  if (ontologyAllResult.error && !isSchemaMissingError(ontologyAllResult.error)) throw new Error(ontologyAllResult.error.message);
  if (ontologyWindowResult.error && !isSchemaMissingError(ontologyWindowResult.error)) throw new Error(ontologyWindowResult.error.message);
  if (pairAllResult.error && !isSchemaMissingError(pairAllResult.error)) throw new Error(pairAllResult.error.message);
  if (pairWindowResult.error && !isSchemaMissingError(pairWindowResult.error)) throw new Error(pairWindowResult.error.message);

  const ingredients = (ingredientsResult.data ?? []) as Array<{
    id: string;
    canonical_name: string;
    normalized_key: string;
    metadata: Record<string, unknown> | null;
    updated_at: string;
  }>;
  const ingredientMetrics = (ingredientMetricsResult.data ?? []) as Array<{
    id: string;
    metadata: Record<string, unknown> | null;
    created_at: string;
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
  const usageRows = (usageResult.data ?? []) as Array<{
    ingredient_id: string | null;
    recipe_version_id: string;
    normalized_status: string;
    updated_at: string;
  }>;
  const unresolvedRows = (unresolvedResult.data ?? []) as Array<{
    id: string;
    recipe_version_id: string;
    source_name: string;
    source_amount: number | null;
    source_unit: string | null;
    normalized_status: string;
    updated_at: string;
  }>;
  const aliasWindowRows = (aliasesWindowResult.data ?? []) as Array<{ id: string; created_at: string }>;
  const ontologyRows = (ontologyAllResult.data ?? []) as Array<{ ingredient_id: string }>;
  const ontologyWindowRows = (ontologyWindowResult.data ?? []) as Array<{ ingredient_id: string; created_at: string }>;
  const pairRows = (pairAllResult.data ?? []) as Array<{ ingredient_a_id: string; ingredient_b_id: string }>;
  const pairWindowRows = (pairWindowResult.data ?? []) as Array<{ ingredient_a_id: string; ingredient_b_id: string; updated_at: string }>;
  const recipes = (recipesResult.data ?? []) as Array<{ id: string; current_version_id: string }>;

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

  const ontologyCountByIngredientId = new Map<string, number>();
  for (const row of ontologyRows) {
    ontologyCountByIngredientId.set(row.ingredient_id, (ontologyCountByIngredientId.get(row.ingredient_id) ?? 0) + 1);
  }

  const pairCountByIngredientId = new Map<string, number>();
  const uniquePairs = new Set<string>();
  for (const row of pairRows) {
    const ingredientA = row.ingredient_a_id;
    const ingredientB = row.ingredient_b_id;
    if (!ingredientA || !ingredientB) continue;
    const key = ingredientA < ingredientB ? `${ingredientA}:${ingredientB}` : `${ingredientB}:${ingredientA}`;
    if (uniquePairs.has(key)) continue;
    uniquePairs.add(key);
    pairCountByIngredientId.set(ingredientA, (pairCountByIngredientId.get(ingredientA) ?? 0) + 1);
    pairCountByIngredientId.set(ingredientB, (pairCountByIngredientId.get(ingredientB) ?? 0) + 1);
  }

  const ingredientMetricById = new Map(
    ingredientMetrics.map((row) => {
      const metadata =
        row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {};
      const confidenceRaw = metadata["enrichment_confidence"];
      const confidence = Number(confidenceRaw);
      const enrichedAtRaw = metadata["enriched_at"];
      const enrichedAt = typeof enrichedAtRaw === "string" ? enrichedAtRaw : null;
      return [
        row.id,
        {
          metadata,
          confidence: Number.isFinite(confidence) ? confidence : null,
          enriched_at: enrichedAt,
          created_at: row.created_at
        }
      ];
    })
  );

  const ingredientIdsAll = ingredientMetrics.map((row) => row.id);
  const mappedIngredientCount = ingredientIdsAll.filter((id) => (usageCountByIngredientId.get(id) ?? 0) > 0).length;
  const enrichedIngredientCount = ingredientIdsAll.filter((id) => (ingredientMetricById.get(id)?.confidence ?? null) != null).length;
  const ingredientWithOntologyCount = ingredientIdsAll.filter((id) => (ontologyCountByIngredientId.get(id) ?? 0) > 0).length;
  const ingredientWithPairsCount = ingredientIdsAll.filter((id) => (pairCountByIngredientId.get(id) ?? 0) > 0).length;

  const confidenceValues = ingredientIdsAll
    .map((id) => ingredientMetricById.get(id)?.confidence ?? null)
    .filter((value): value is number => value != null);
  const avgEnrichmentConfidence = confidenceValues.length > 0
    ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
    : null;

  const currentVersionIds = new Set(recipes.map((row) => row.current_version_id));
  const ingredientCountByVersionId = new Map<string, number>();
  let unresolvedRowsForCurrentRecipes = 0;
  for (const row of usageRows) {
    if (!currentVersionIds.has(row.recipe_version_id)) continue;
    ingredientCountByVersionId.set(row.recipe_version_id, (ingredientCountByVersionId.get(row.recipe_version_id) ?? 0) + 1);
    if (row.normalized_status === "needs_retry") {
      unresolvedRowsForCurrentRecipes += 1;
    }
  }
  const recipeCount = recipes.length;
  const ingredientsPerRecipe = recipeCount > 0
    ? Array.from(currentVersionIds).reduce((sum, versionId) => sum + (ingredientCountByVersionId.get(versionId) ?? 0), 0) / recipeCount
    : null;
  const unresolvedPerRecipe = recipeCount > 0 ? unresolvedRowsForCurrentRecipes / recipeCount : null;

  const currentWindow = { start: currentStartMs, end: nowMs };
  const previousWindow = { start: previousStartMs, end: currentStartMs };

  let ingredientsAddedCurrent = 0;
  let ingredientsAddedPrevious = 0;
  let enrichmentsCurrent = 0;
  let enrichmentsPrevious = 0;
  for (const row of ingredientMetrics) {
    if (inWindow(row.created_at, currentWindow.start, currentWindow.end)) ingredientsAddedCurrent += 1;
    if (inWindow(row.created_at, previousWindow.start, previousWindow.end)) ingredientsAddedPrevious += 1;
    const enrichedAt = ingredientMetricById.get(row.id)?.enriched_at;
    if (inWindow(enrichedAt, currentWindow.start, currentWindow.end)) enrichmentsCurrent += 1;
    if (inWindow(enrichedAt, previousWindow.start, previousWindow.end)) enrichmentsPrevious += 1;
  }

  let aliasesAddedCurrent = 0;
  let aliasesAddedPrevious = 0;
  for (const row of aliasWindowRows) {
    if (inWindow(row.created_at, currentWindow.start, currentWindow.end)) aliasesAddedCurrent += 1;
    if (inWindow(row.created_at, previousWindow.start, previousWindow.end)) aliasesAddedPrevious += 1;
  }

  let ontologyAddedCurrent = 0;
  let ontologyAddedPrevious = 0;
  for (const row of ontologyWindowRows) {
    if (inWindow(row.created_at, currentWindow.start, currentWindow.end)) ontologyAddedCurrent += 1;
    if (inWindow(row.created_at, previousWindow.start, previousWindow.end)) ontologyAddedPrevious += 1;
  }

  const pairCurrentSet = new Set<string>();
  const pairPreviousSet = new Set<string>();
  for (const row of pairWindowRows) {
    const key = row.ingredient_a_id < row.ingredient_b_id
      ? `${row.ingredient_a_id}:${row.ingredient_b_id}`
      : `${row.ingredient_b_id}:${row.ingredient_a_id}`;
    if (inWindow(row.updated_at, currentWindow.start, currentWindow.end)) pairCurrentSet.add(key);
    if (inWindow(row.updated_at, previousWindow.start, previousWindow.end)) pairPreviousSet.add(key);
  }

  let unresolvedTouchedCurrent = 0;
  let unresolvedTouchedPrevious = 0;
  for (const row of usageRows) {
    if (row.normalized_status !== "needs_retry") continue;
    if (inWindow(row.updated_at, currentWindow.start, currentWindow.end)) unresolvedTouchedCurrent += 1;
    if (inWindow(row.updated_at, previousWindow.start, previousWindow.end)) unresolvedTouchedPrevious += 1;
  }

  const totalIngredients = ingredientMetrics.length;
  const totalAliases = aliases.length;
  const totalRecipeIngredientRows = totalRecipeIngredientCountResult.count ?? usageRows.length;
  const unresolvedTotalRows = unresolvedCountResult.count ?? unresolvedRows.length;
  const totalOntologyLinks = ontologyRows.length;
  const totalPairLinks = uniquePairs.size;
  const mappedCoverage = totalIngredients > 0 ? mappedIngredientCount / totalIngredients : 0;
  const enrichedCoverage = totalIngredients > 0 ? enrichedIngredientCount / totalIngredients : 0;
  const ontologyCoverage = totalIngredients > 0 ? ingredientWithOntologyCount / totalIngredients : 0;
  const pairCoverage = totalIngredients > 0 ? ingredientWithPairsCount / totalIngredients : 0;
  const unresolvedRate = totalRecipeIngredientRows > 0 ? unresolvedTotalRows / totalRecipeIngredientRows : 0;

  return {
    ingredients: ingredients.map((ingredient) => {
      const metric = ingredientMetricById.get(ingredient.id);
      const metadata = metric?.metadata ?? {};
      return {
        id: ingredient.id,
        canonical_name: ingredient.canonical_name,
        normalized_key: ingredient.normalized_key,
        alias_count: aliasCountByIngredientId.get(ingredient.id) ?? 0,
        usage_count: usageCountByIngredientId.get(ingredient.id) ?? 0,
        metadata,
        metadata_key_count: Object.keys(metadata).length,
        enrichment_confidence: metric?.confidence ?? null,
        ontology_link_count: ontologyCountByIngredientId.get(ingredient.id) ?? 0,
        pair_link_count: pairCountByIngredientId.get(ingredient.id) ?? 0,
        updated_at: ingredient.updated_at
      };
    }),
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
    })),
    summary: {
      totals: {
        ingredients: totalIngredients,
        aliases: totalAliases,
        mapped_ingredients: mappedIngredientCount,
        enriched_ingredients: enrichedIngredientCount,
        ontology_links: totalOntologyLinks,
        pair_links: totalPairLinks,
        unresolved_rows: unresolvedTotalRows,
        recipe_ingredient_rows: totalRecipeIngredientRows,
        recipes_with_current_version: recipeCount
      },
      rates: {
        mapped_coverage: mappedCoverage,
        enriched_coverage: enrichedCoverage,
        ontology_coverage: ontologyCoverage,
        pair_coverage: pairCoverage,
        unresolved_rate: unresolvedRate
      },
      averages: {
        enrichment_confidence: avgEnrichmentConfidence,
        ingredients_per_recipe: ingredientsPerRecipe,
        unresolved_per_recipe: unresolvedPerRecipe,
        ontology_links_per_enriched: enrichedIngredientCount > 0 ? totalOntologyLinks / enrichedIngredientCount : null,
        pair_links_per_mapped: mappedIngredientCount > 0 ? totalPairLinks / mappedIngredientCount : null
      },
      windows: {
        current_start: currentWindowStartIso,
        current_end: now.toISOString(),
        previous_start: previousWindowStartIso,
        previous_end: currentWindowStartIso,
        ingredients_added: { current: ingredientsAddedCurrent, previous: ingredientsAddedPrevious },
        aliases_added: { current: aliasesAddedCurrent, previous: aliasesAddedPrevious },
        enrichments_completed: { current: enrichmentsCurrent, previous: enrichmentsPrevious },
        ontology_links_added: { current: ontologyAddedCurrent, previous: ontologyAddedPrevious },
        pair_links_updated: { current: pairCurrentSet.size, previous: pairPreviousSet.size },
        unresolved_touched: { current: unresolvedTouchedCurrent, previous: unresolvedTouchedPrevious }
      }
    }
  };
};
