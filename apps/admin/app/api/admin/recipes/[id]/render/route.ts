import { NextResponse } from "next/server";
import { normalizeApiBase } from "@/lib/admin-api-base";
import { readJsonBody } from "@/lib/admin-http";
import {
  getAdminSimulationBearerToken,
  getBearerTokenForEmail,
} from "@/lib/admin-simulation-token";
import {
  RECIPE_RENDER_GROUP_BY,
  RECIPE_RENDER_TEMPERATURE_UNITS,
  RECIPE_RENDER_UNITS,
  RECIPE_RENDER_VERBOSITIES,
  type RecipeRenderGroupBy,
  type RecipeRenderIngredient,
  type RecipeRenderIngredientGroup,
  type RecipeRenderInspectorResponse,
  type RecipeRenderPreview,
  type RecipeRenderSource,
  type RecipeRenderStep,
  type RecipeRenderTemperatureUnit,
  type RecipeRenderUnits,
  type RecipeRenderVerbosity,
} from "@/lib/recipe-render-preview";
import { getAdminClient, requireCloudflareAccess } from "@/lib/supabase-admin";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const toString = (value: unknown): string => (typeof value === "string" ? value : "");

const toNullableString = (value: unknown): string | null => {
  const normalized = toString(value).trim();
  return normalized.length > 0 ? normalized : null;
};

const toNumberOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const toBoolean = (value: string | null, fallback: boolean): boolean => {
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
};

const parseUnits = (value: string | null): RecipeRenderUnits =>
  value === "metric" ? "metric" : "imperial";

const parseGroupBy = (value: string | null): RecipeRenderGroupBy =>
  RECIPE_RENDER_GROUP_BY.includes(value as RecipeRenderGroupBy)
    ? (value as RecipeRenderGroupBy)
    : "component";

const parseTemperatureUnit = (value: string | null): RecipeRenderTemperatureUnit =>
  RECIPE_RENDER_TEMPERATURE_UNITS.includes(value as RecipeRenderTemperatureUnit)
    ? (value as RecipeRenderTemperatureUnit)
    : "fahrenheit";

const buildRenderPath = (params: {
  recipeId: string | null;
  verbosity: RecipeRenderVerbosity;
  units: RecipeRenderUnits;
  groupBy: RecipeRenderGroupBy;
  inlineMeasurements: boolean;
  temperatureUnit: RecipeRenderTemperatureUnit;
  cookbookEntryId: string | null;
}): string => {
  const query = new URLSearchParams();
  query.set("units", params.units);
  query.set("group_by", params.groupBy);
  query.set("inline_measurements", params.inlineMeasurements ? "true" : "false");
  query.set("verbosity", params.verbosity);
  query.set("temperature_unit", params.temperatureUnit);

  if (params.cookbookEntryId) {
    return `/recipes/cookbook/${encodeURIComponent(params.cookbookEntryId)}?${query.toString()}`;
  }

  if (!params.recipeId) {
    throw new Error("Canonical render path requires a recipe id");
  }

  return `/recipes/${encodeURIComponent(params.recipeId)}?${query.toString()}`;
};

const normalizeIngredient = (value: unknown): RecipeRenderIngredient => {
  const record = isRecord(value) ? value : {};
  const rawAmount = record["amount"];
  const amount =
    typeof rawAmount === "number" && Number.isFinite(rawAmount)
      ? rawAmount
      : typeof rawAmount === "string"
        ? rawAmount
        : null;

  return {
    name: toString(record["name"]) || "Untitled ingredient",
    amount,
    unit: toNullableString(record["unit"]),
    display_amount: toNullableString(record["display_amount"]),
    preparation: toNullableString(record["preparation"]),
    category: toNullableString(record["category"]),
    component: toNullableString(record["component"]),
  };
};

const normalizeIngredientGroup = (value: unknown): RecipeRenderIngredientGroup => {
  const record = isRecord(value) ? value : {};
  const ingredients = Array.isArray(record["ingredients"])
    ? record["ingredients"].map(normalizeIngredient)
    : [];

  return {
    key: toString(record["key"]) || "group",
    label: toString(record["label"]) || "Ingredients",
    ingredients,
  };
};

const normalizeStep = (value: unknown): RecipeRenderStep => {
  const record = isRecord(value) ? value : {};
  return {
    index: toNumberOrNull(record["index"]) ?? 0,
    instruction: toString(record["instruction"]),
    title: toNullableString(record["title"]),
    notes: toNullableString(record["notes"]),
  };
};

const normalizeRecipePreview = (value: unknown): RecipeRenderPreview => {
  const record = isRecord(value) ? value : {};
  const ingredients = Array.isArray(record["ingredients"])
    ? record["ingredients"].map(normalizeIngredient)
    : [];
  const ingredientGroups = Array.isArray(record["ingredient_groups"])
    ? record["ingredient_groups"].map(normalizeIngredientGroup)
    : [];
  const steps = Array.isArray(record["steps"])
    ? record["steps"].map(normalizeStep)
    : [];
  const pairings = Array.isArray(record["pairings"])
    ? record["pairings"].filter((value): value is string => typeof value === "string")
    : [];

  return {
    id: toString(record["id"]),
    title: toString(record["title"]) || "Untitled recipe",
    summary: toString(record["summary"]),
    description: toNullableString(record["description"]),
    servings: toNumberOrNull(record["servings"]),
    ingredients,
    ingredient_groups: ingredientGroups,
    steps,
    notes: toNullableString(record["notes"]),
    pairings,
    image_url: toNullableString(record["image_url"]),
    image_status: toString(record["image_status"]) || "pending",
  };
};

const fetchUpstreamJson = async (
  apiBase: string,
  token: string,
  path: string,
): Promise<unknown> => {
  const response = await fetch(`${apiBase}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  const payload = await readJsonBody(response);
  if (!response.ok) {
    const details =
      typeof payload === "string" ? payload : JSON.stringify(payload);
    throw new Error(`Render preview fetch failed (${response.status}): ${details}`);
  }

  return payload;
};

const buildCanonicalSource = (): RecipeRenderSource => ({
  kind: "canonical",
  label: "Canonical",
});

const buildCookbookEntrySource = (params: {
  cookbookEntryId: string;
  canonicalRecipeId: string | null;
  canonicalStatus: string | null;
  sourceKind: string | null;
  canonicalFailureReason: string | null;
  sourceChatId: string | null;
  userEmail: string | null;
  variantId: string | null;
  variantStatus: string | null;
  derivationKind: string | null;
  adaptationSummary: string;
  personalizedAt: string | null;
}): RecipeRenderSource => ({
  kind: "cookbook_entry",
  label: params.userEmail
    ? `Private · ${params.userEmail}`
    : `Private · ${params.cookbookEntryId.slice(0, 8)}`,
  cookbook_entry_id: params.cookbookEntryId,
  canonical_recipe_id: params.canonicalRecipeId,
  canonical_status: params.canonicalStatus,
  source_kind: params.sourceKind,
  canonical_failure_reason: params.canonicalFailureReason,
  source_chat_id: params.sourceChatId,
  user_email: params.userEmail,
  variant_id: params.variantId,
  variant_status: params.variantStatus,
  derivation_kind: params.derivationKind,
  adaptation_summary: params.adaptationSummary,
  personalized_at: params.personalizedAt,
});

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  await requireCloudflareAccess();

  const { id: recipeId } = await context.params;
  if (!recipeId?.trim()) {
    return NextResponse.json({ error: "recipeId is required" }, { status: 400 });
  }

  const url = new URL(request.url);
  const units = parseUnits(url.searchParams.get("units"));
  const groupBy = parseGroupBy(url.searchParams.get("group_by"));
  const inlineMeasurements = toBoolean(
    url.searchParams.get("inline_measurements"),
    true,
  );
  const temperatureUnit = parseTemperatureUnit(
    url.searchParams.get("temperature_unit"),
  );
  const cookbookEntryId = toNullableString(url.searchParams.get("cookbook_entry_id"));
  const variantId = toNullableString(url.searchParams.get("variant_id"));

  const apiBase = normalizeApiBase(process.env["API_BASE_URL"]);

  let token: string;
  let source: RecipeRenderSource;

  if (!cookbookEntryId && !variantId) {
    try {
      token = await getAdminSimulationBearerToken();
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Unable to acquire canonical preview bearer token",
        },
        { status: 500 },
      );
    }
    source = buildCanonicalSource();
  } else {
    const client = getAdminClient();
    let resolvedCookbookEntryId = cookbookEntryId;
    let resolvedVariantId = variantId;
    let variantState: {
      id: string;
      user_id: string;
      cookbook_entry_id: string;
      stale_status: string | null;
      current_version_id: string | null;
    } | null = null;

    if (!resolvedCookbookEntryId && resolvedVariantId) {
      const { data: variant, error: variantError } = await client
        .from("user_recipe_variants")
        .select("id,user_id,cookbook_entry_id,stale_status,current_version_id")
        .eq("id", resolvedVariantId)
        .maybeSingle();

      if (variantError) {
        return NextResponse.json(
          { error: variantError.message },
          { status: 500 },
        );
      }
      if (!variant?.cookbook_entry_id) {
        return NextResponse.json(
          { error: "Variant is not linked to a cookbook entry" },
          { status: 404 },
        );
      }

      resolvedCookbookEntryId = variant.cookbook_entry_id;
      variantState = {
        id: variant.id,
        user_id: variant.user_id,
        cookbook_entry_id: variant.cookbook_entry_id,
        stale_status: toNullableString(variant.stale_status),
        current_version_id: variant.current_version_id,
      };
    }

    if (!resolvedCookbookEntryId) {
      return NextResponse.json(
        { error: "cookbook_entry_id is required for private preview" },
        { status: 400 },
      );
    }

    const { data: entry, error: entryError } = await client
      .from("cookbook_entries")
      .select("id,user_id,canonical_recipe_id,canonical_status,source_kind,source_chat_id,canonical_failure_reason,active_variant_id")
      .eq("id", resolvedCookbookEntryId)
      .maybeSingle();

    if (entryError) {
      return NextResponse.json(
        { error: entryError.message },
        { status: 500 },
      );
    }
    if (!entry) {
      return NextResponse.json(
        { error: "Cookbook entry not found" },
        { status: 404 },
      );
    }

    if (entry.canonical_recipe_id && entry.canonical_recipe_id !== recipeId) {
      return NextResponse.json(
        { error: "Cookbook entry is linked to a different canonical recipe" },
        { status: 404 },
      );
    }

    if (!variantState && entry.active_variant_id) {
      const { data: variant, error: variantError } = await client
        .from("user_recipe_variants")
        .select("id,user_id,cookbook_entry_id,stale_status,current_version_id")
        .eq("id", entry.active_variant_id)
        .eq("cookbook_entry_id", entry.id)
        .maybeSingle();

      if (variantError) {
        return NextResponse.json(
          { error: variantError.message },
          { status: 500 },
        );
      }

      if (variant) {
        variantState = {
          id: variant.id,
          user_id: variant.user_id,
          cookbook_entry_id: variant.cookbook_entry_id,
          stale_status: toNullableString(variant.stale_status),
          current_version_id: variant.current_version_id,
        };
        resolvedVariantId = variant.id;
      }
    }

    const ownerUserId = variantState?.user_id ?? entry.user_id;
    const [{ data: user }, { data: currentVersion }] = await Promise.all([
      client.from("users").select("email").eq("id", ownerUserId).maybeSingle(),
      variantState?.current_version_id
        ? client
            .from("user_recipe_variant_versions")
            .select("id,derivation_kind")
            .eq("id", variantState.current_version_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const userEmail = toNullableString(user?.email);
    if (!userEmail) {
      return NextResponse.json(
        { error: "Variant owner email is unavailable for preview" },
        { status: 409 },
      );
    }

    try {
      token = await getBearerTokenForEmail(userEmail);
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Unable to acquire variant preview bearer token",
        },
        { status: 500 },
      );
    }

    source = buildCookbookEntrySource({
      cookbookEntryId: entry.id,
      canonicalRecipeId: toNullableString(entry.canonical_recipe_id),
      canonicalStatus: toNullableString(entry.canonical_status),
      sourceKind: toNullableString(entry.source_kind),
      canonicalFailureReason: toNullableString(entry.canonical_failure_reason),
      sourceChatId: toNullableString(entry.source_chat_id),
      userEmail,
      variantId: resolvedVariantId,
      variantStatus: variantState?.stale_status ?? null,
      derivationKind: toNullableString(currentVersion?.derivation_kind),
      adaptationSummary: "",
      personalizedAt: null,
    });
  }

  try {
    const previewEntries = await Promise.all(
      RECIPE_RENDER_VERBOSITIES.map(async (verbosity) => {
        const path = buildRenderPath({
          recipeId,
          verbosity,
          units,
          groupBy,
          inlineMeasurements,
          temperatureUnit,
          cookbookEntryId: source.kind === "cookbook_entry" ? source.cookbook_entry_id : null,
        });
        const payload = await fetchUpstreamJson(apiBase, token, path);

        if (source.kind === "canonical") {
          return [verbosity, normalizeRecipePreview(payload)] as const;
        }

        const record = isRecord(payload) ? payload : {};
        const recipe = normalizeRecipePreview(record["recipe"]);
        if (verbosity === "balanced") {
          source = buildCookbookEntrySource({
            cookbookEntryId: source.cookbook_entry_id,
            canonicalRecipeId:
              toNullableString(record["canonical_recipe_id"]) ??
              source.canonical_recipe_id,
            canonicalStatus:
              toNullableString(record["canonical_status"]) ??
              source.canonical_status,
            sourceKind: source.source_kind,
            canonicalFailureReason: source.canonical_failure_reason,
            sourceChatId: source.source_chat_id,
            userEmail: source.user_email,
            variantId:
              toNullableString(record["variant_id"]) ??
              source.variant_id,
            variantStatus:
              toNullableString(record["variant_status"]) ??
              source.variant_status,
            derivationKind:
              toNullableString(record["derivation_kind"]) ??
              source.derivation_kind,
            adaptationSummary: toString(record["adaptation_summary"]),
            personalizedAt: toNullableString(record["personalized_at"]),
          });
        }
        return [verbosity, recipe] as const;
      }),
    );

    const previews = Object.fromEntries(previewEntries) as Record<
      RecipeRenderVerbosity,
      RecipeRenderPreview
    >;
    const response: RecipeRenderInspectorResponse = {
      source,
      options: {
        units,
        group_by: groupBy,
        inline_measurements: inlineMeasurements,
        temperature_unit: temperatureUnit,
      },
      previews,
    };

    return NextResponse.json(response, {
      headers: {
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Recipe render preview failed",
      },
      { status: 502 },
    );
  }
}
