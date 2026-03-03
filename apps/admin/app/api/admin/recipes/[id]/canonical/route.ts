import { NextResponse } from "next/server";
import { getAdminClient, requireCloudflareAccess } from "@/lib/supabase-admin";

export async function GET(
  _: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  await requireCloudflareAccess();
  const client = getAdminClient();
  const { id } = await context.params;

  const { data: recipe, error: recipeError } = await client
    .from("recipes")
    .select("id,title,current_version_id")
    .eq("id", id)
    .maybeSingle();

  if (recipeError) {
    return NextResponse.json({ error: recipeError.message }, { status: 500 });
  }

  if (!recipe) {
    return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
  }

  if (!recipe.current_version_id) {
    return NextResponse.json({
      recipe: {
        id: recipe.id,
        title: recipe.title,
        current_version_id: null
      },
      canonical_ingredients: []
    });
  }

  const { data: rows, error: rowsError } = await client
    .from("recipe_ingredients")
    .select("id,recipe_version_id,ingredient_id,source_name,source_amount,source_unit,normalized_amount_si,normalized_unit,unit_kind,normalized_status,category,component,position,updated_at")
    .eq("recipe_version_id", recipe.current_version_id)
    .order("position", { ascending: true });

  if (rowsError) {
    return NextResponse.json({ error: rowsError.message }, { status: 500 });
  }

  const ingredientIds = Array.from(new Set((rows ?? []).map((row) => row.ingredient_id).filter((value): value is string => Boolean(value))));
  const { data: ingredients, error: ingredientsError } =
    ingredientIds.length > 0
      ? await client.from("ingredients").select("id,canonical_name").in("id", ingredientIds)
      : { data: [] as Array<{ id: string; canonical_name: string }>, error: null };

  if (ingredientsError) {
    return NextResponse.json({ error: ingredientsError.message }, { status: 500 });
  }

  const canonicalById = new Map((ingredients ?? []).map((item) => [item.id, item.canonical_name]));

  return NextResponse.json({
    recipe: {
      id: recipe.id,
      title: recipe.title,
      current_version_id: recipe.current_version_id
    },
    canonical_ingredients: (rows ?? []).map((row) => ({
      id: row.id,
      recipe_version_id: row.recipe_version_id,
      ingredient_id: row.ingredient_id,
      canonical_name: row.ingredient_id ? canonicalById.get(row.ingredient_id) ?? null : null,
      source_name: row.source_name,
      source_amount: row.source_amount,
      source_unit: row.source_unit,
      normalized_amount_si: row.normalized_amount_si,
      normalized_unit: row.normalized_unit,
      unit_kind: row.unit_kind,
      normalized_status: row.normalized_status,
      category: row.category,
      component: row.component,
      position: row.position,
      updated_at: row.updated_at
    }))
  });
}
