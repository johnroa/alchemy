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
  recipeId: string;
  verbosity: RecipeRenderVerbosity;
  units: RecipeRenderUnits;
  groupBy: RecipeRenderGroupBy;
  inlineMeasurements: boolean;
  temperatureUnit: RecipeRenderTemperatureUnit;
  variantId: string | null;
}): string => {
  const query = new URLSearchParams();
  query.set("units", params.units);
  query.set("group_by", params.groupBy);
  query.set("inline_measurements", params.inlineMeasurements ? "true" : "false");
  query.set("verbosity", params.verbosity);
  query.set("temperature_unit", params.temperatureUnit);

  const suffix = params.variantId ? "/variant" : "";
  return `/recipes/${encodeURIComponent(params.recipeId)}${suffix}?${query.toString()}`;
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

const buildVariantSource = (params: {
  variantId: string;
  userEmail: string | null;
  variantStatus: string | null;
  derivationKind: string | null;
  adaptationSummary: string;
  personalizedAt: string | null;
}): RecipeRenderSource => ({
  kind: "variant",
  label: params.userEmail
    ? `Variant · ${params.userEmail}`
    : `Variant · ${params.variantId.slice(0, 8)}`,
  variant_id: params.variantId,
  user_email: params.userEmail,
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
  const variantId = toNullableString(url.searchParams.get("variant_id"));

  const apiBase = normalizeApiBase(process.env["API_BASE_URL"]);

  let token: string;
  let source: RecipeRenderSource;

  if (!variantId) {
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
    const { data: variant, error: variantError } = await client
      .from("user_recipe_variants")
      .select("id,user_id,canonical_recipe_id,stale_status,current_version_id")
      .eq("id", variantId)
      .eq("canonical_recipe_id", recipeId)
      .maybeSingle();

    if (variantError) {
      return NextResponse.json(
        { error: variantError.message },
        { status: 500 },
      );
    }
    if (!variant || !variant.current_version_id) {
      return NextResponse.json(
        { error: "Variant not found for this recipe" },
        { status: 404 },
      );
    }

    const [{ data: user }, { data: currentVersion }] = await Promise.all([
      client.from("users").select("email").eq("id", variant.user_id).maybeSingle(),
      client
        .from("user_recipe_variant_versions")
        .select("id,derivation_kind")
        .eq("id", variant.current_version_id)
        .maybeSingle(),
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

    source = buildVariantSource({
      variantId,
      userEmail,
      variantStatus: toNullableString(variant.stale_status),
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
          variantId,
        });
        const payload = await fetchUpstreamJson(apiBase, token, path);

        if (!variantId) {
          return [verbosity, normalizeRecipePreview(payload)] as const;
        }

        const record = isRecord(payload) ? payload : {};
        const recipe = normalizeRecipePreview(record["recipe"]);
        if (verbosity === "balanced") {
          source = buildVariantSource({
            variantId,
            userEmail: source.kind === "variant" ? source.user_email : null,
            variantStatus:
              source.kind === "variant" ? source.variant_status : null,
            derivationKind:
              source.kind === "variant" ? source.derivation_kind : null,
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
