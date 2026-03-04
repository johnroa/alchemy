import { NextResponse } from "next/server";
import { getAdminClient, requireCloudflareAccess } from "@/lib/supabase-admin";

type IngredientRow = {
  id: string;
  canonical_name: string;
  normalized_key: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type AliasRow = {
  id: string;
  alias_key: string;
  source: string;
  confidence: number;
  created_at: string;
  updated_at: string;
};

type OntologyLinkRow = {
  id: string;
  relation_type: string;
  source: string;
  confidence: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  ontology_term: Array<{
    id: string;
    term_type: string;
    term_key: string;
    label: string;
    source: string;
    metadata: Record<string, unknown> | null;
  }> | null;
};

type PairRow = {
  ingredient_a_id: string;
  ingredient_b_id: string;
  co_occurrence_count: number;
  recipe_count: number;
  pmi: number | null;
  lift: number | null;
  created_at: string;
  updated_at: string;
};

type UsageRow = {
  id: string;
  recipe_version_id: string;
  source_name: string;
  source_amount: number | null;
  source_unit: string | null;
  normalized_amount_si: number | null;
  normalized_unit: string | null;
  normalized_status: string;
  category: string | null;
  component: string | null;
  position: number;
  updated_at: string;
};

type RecipeVersionRow = {
  id: string;
  recipe_id: string;
  created_at: string;
};

type RecipeRow = {
  id: string;
  title: string;
  visibility: string;
  image_status: string;
  updated_at: string;
};

const toFiniteNumber = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export async function GET(
  _: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  await requireCloudflareAccess();
  const client = getAdminClient();
  const { id } = await context.params;

  const { data: ingredient, error: ingredientError } = await client
    .from("ingredients")
    .select("id,canonical_name,normalized_key,metadata,created_at,updated_at")
    .eq("id", id)
    .maybeSingle();

  if (ingredientError) {
    return NextResponse.json({ error: ingredientError.message }, { status: 500 });
  }

  if (!ingredient) {
    return NextResponse.json({ error: "Ingredient not found" }, { status: 404 });
  }

  const [aliasesResult, ontologyResult, pairsResult, usagesResult] = await Promise.all([
    client
      .from("ingredient_aliases")
      .select("id,alias_key,source,confidence,created_at,updated_at")
      .eq("ingredient_id", id)
      .order("confidence", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(120),
    client
      .from("ingredient_ontology_links")
      .select(
        "id,relation_type,source,confidence,metadata,created_at,updated_at,ontology_term:ontology_terms(id,term_type,term_key,label,source,metadata)"
      )
      .eq("ingredient_id", id)
      .order("confidence", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(200),
    client
      .from("ingredient_pair_stats")
      .select("ingredient_a_id,ingredient_b_id,co_occurrence_count,recipe_count,pmi,lift,created_at,updated_at")
      .or(`ingredient_a_id.eq.${id},ingredient_b_id.eq.${id}`)
      .order("co_occurrence_count", { ascending: false })
      .limit(200),
    client
      .from("recipe_ingredients")
      .select(
        "id,recipe_version_id,source_name,source_amount,source_unit,normalized_amount_si,normalized_unit,normalized_status,category,component,position,updated_at"
      )
      .eq("ingredient_id", id)
      .order("updated_at", { ascending: false })
      .limit(200)
  ]);

  if (aliasesResult.error) {
    return NextResponse.json({ error: aliasesResult.error.message }, { status: 500 });
  }
  if (ontologyResult.error) {
    return NextResponse.json({ error: ontologyResult.error.message }, { status: 500 });
  }
  if (pairsResult.error) {
    return NextResponse.json({ error: pairsResult.error.message }, { status: 500 });
  }
  if (usagesResult.error) {
    return NextResponse.json({ error: usagesResult.error.message }, { status: 500 });
  }

  const aliases = (aliasesResult.data ?? []) as AliasRow[];
  const ontologyLinks = (ontologyResult.data ?? []) as OntologyLinkRow[];
  const pairRows = (pairsResult.data ?? []) as PairRow[];
  const usageRows = (usagesResult.data ?? []) as UsageRow[];

  const pairedIngredientIds = Array.from(
    new Set(
      pairRows.map((row) => (row.ingredient_a_id === id ? row.ingredient_b_id : row.ingredient_a_id)).filter(Boolean)
    )
  );

  const { data: pairedIngredients, error: pairedIngredientsError } =
    pairedIngredientIds.length > 0
      ? await client
          .from("ingredients")
          .select("id,canonical_name,normalized_key")
          .in("id", pairedIngredientIds)
      : {
          data: [] as Array<{ id: string; canonical_name: string; normalized_key: string }>,
          error: null
        };

  if (pairedIngredientsError) {
    return NextResponse.json({ error: pairedIngredientsError.message }, { status: 500 });
  }

  const pairedIngredientById = new Map(
    (pairedIngredients ?? []).map((row) => [row.id, { canonical_name: row.canonical_name, normalized_key: row.normalized_key }])
  );

  const recipeVersionIds = Array.from(new Set(usageRows.map((row) => row.recipe_version_id).filter(Boolean)));

  const { data: versions, error: versionsError } =
    recipeVersionIds.length > 0
      ? await client
          .from("recipe_versions")
          .select("id,recipe_id,created_at")
          .in("id", recipeVersionIds)
      : { data: [] as RecipeVersionRow[], error: null };

  if (versionsError) {
    return NextResponse.json({ error: versionsError.message }, { status: 500 });
  }

  const versionRows = (versions ?? []) as RecipeVersionRow[];
  const recipeIds = Array.from(new Set(versionRows.map((row) => row.recipe_id).filter(Boolean)));

  const { data: recipes, error: recipesError } =
    recipeIds.length > 0
      ? await client
          .from("recipes")
          .select("id,title,visibility,image_status,updated_at")
          .in("id", recipeIds)
      : { data: [] as RecipeRow[], error: null };

  if (recipesError) {
    return NextResponse.json({ error: recipesError.message }, { status: 500 });
  }

  const versionById = new Map(versionRows.map((row) => [row.id, row]));
  const recipeById = new Map(((recipes ?? []) as RecipeRow[]).map((row) => [row.id, row]));

  const graphEntityResult = await client
    .from("graph_entities")
    .select("id")
    .eq("entity_type", "ingredient")
    .eq("label", ingredient.canonical_name)
    .maybeSingle();

  if (graphEntityResult.error) {
    return NextResponse.json({ error: graphEntityResult.error.message }, { status: 500 });
  }

  const graphEntityId = graphEntityResult.data?.id ?? null;
  let graphOutgoingCount = 0;
  let graphIncomingCount = 0;

  if (graphEntityId) {
    const [outgoingResult, incomingResult] = await Promise.all([
      client.from("graph_edges").select("id", { count: "exact", head: true }).eq("from_entity_id", graphEntityId),
      client.from("graph_edges").select("id", { count: "exact", head: true }).eq("to_entity_id", graphEntityId)
    ]);

    if (outgoingResult.error) {
      return NextResponse.json({ error: outgoingResult.error.message }, { status: 500 });
    }
    if (incomingResult.error) {
      return NextResponse.json({ error: incomingResult.error.message }, { status: 500 });
    }

    graphOutgoingCount = outgoingResult.count ?? 0;
    graphIncomingCount = incomingResult.count ?? 0;
  }

  const ingredientRow = ingredient as IngredientRow;

  return NextResponse.json({
    ingredient: {
      id: ingredientRow.id,
      canonical_name: ingredientRow.canonical_name,
      normalized_key: ingredientRow.normalized_key,
      metadata:
        ingredientRow.metadata && typeof ingredientRow.metadata === "object" && !Array.isArray(ingredientRow.metadata)
          ? ingredientRow.metadata
          : {},
      created_at: ingredientRow.created_at,
      updated_at: ingredientRow.updated_at
    },
    aliases: aliases.map((alias) => ({
      id: alias.id,
      alias_key: alias.alias_key,
      source: alias.source,
      confidence: Number(alias.confidence ?? 0),
      created_at: alias.created_at,
      updated_at: alias.updated_at
    })),
    ontology_links: ontologyLinks.map((link) => ({
      ...(() => {
        const term = Array.isArray(link.ontology_term) ? link.ontology_term[0] ?? null : null;
        return {
          term: term
            ? {
                id: term.id,
                term_type: term.term_type,
                term_key: term.term_key,
                label: term.label,
                source: term.source,
                metadata: term.metadata ?? {}
              }
            : null
        };
      })(),
      id: link.id,
      relation_type: link.relation_type,
      source: link.source,
      confidence: Number(link.confidence ?? 0),
      metadata: link.metadata ?? {},
      created_at: link.created_at,
      updated_at: link.updated_at
    })),
    pair_links: pairRows.map((row) => {
      const pairedId = row.ingredient_a_id === id ? row.ingredient_b_id : row.ingredient_a_id;
      const pairedIngredient = pairedIngredientById.get(pairedId);
      return {
        ingredient_id: pairedId,
        canonical_name: pairedIngredient?.canonical_name ?? "Unknown ingredient",
        normalized_key: pairedIngredient?.normalized_key ?? null,
        co_occurrence_count: Number(row.co_occurrence_count ?? 0),
        recipe_count: Number(row.recipe_count ?? 0),
        pmi: toFiniteNumber(row.pmi),
        lift: toFiniteNumber(row.lift),
        updated_at: row.updated_at
      };
    }),
    usages: usageRows.map((row) => {
      const version = versionById.get(row.recipe_version_id);
      const recipe = version ? recipeById.get(version.recipe_id) : null;
      return {
        id: row.id,
        recipe_id: version?.recipe_id ?? null,
        recipe_title: recipe?.title ?? "Unknown recipe",
        recipe_visibility: recipe?.visibility ?? null,
        recipe_image_status: recipe?.image_status ?? null,
        recipe_version_id: row.recipe_version_id,
        source_name: row.source_name,
        source_amount: row.source_amount != null ? Number(row.source_amount) : null,
        source_unit: row.source_unit,
        normalized_amount_si: row.normalized_amount_si != null ? Number(row.normalized_amount_si) : null,
        normalized_unit: row.normalized_unit,
        normalized_status: row.normalized_status,
        category: row.category,
        component: row.component,
        position: Number(row.position ?? 0),
        updated_at: row.updated_at
      };
    }),
    graph: {
      entity_id: graphEntityId,
      outgoing_edges: graphOutgoingCount,
      incoming_edges: graphIncomingCount,
      total_edges: graphOutgoingCount + graphIncomingCount
    }
  });
}
