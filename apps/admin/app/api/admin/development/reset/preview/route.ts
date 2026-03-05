import { NextResponse } from "next/server";
import { getAdminClient, requireCloudflareAccess } from "@/lib/supabase-admin";

const allowedPresets = new Set([
  "recipes_domain_reset",
  "ingredients_ontology_reset",
  "graph_reset",
  "full_food_reset",
]);

type Body = {
  preset?: string;
};

export async function POST(request: Request): Promise<NextResponse> {
  await requireCloudflareAccess();
  const body = (await request.json().catch(() => ({}))) as Body;
  const preset = typeof body.preset === "string" ? body.preset.trim().toLowerCase() : "";

  if (!allowedPresets.has(preset)) {
    return NextResponse.json(
      {
        error:
          "Invalid preset. Expected one of: recipes_domain_reset, ingredients_ontology_reset, graph_reset, full_food_reset",
      },
      { status: 400 },
    );
  }

  const client = getAdminClient();
  const { data, error } = await client.rpc("admin_dev_food_data_preview", {
    preset,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    preset,
    preview: data,
  });
}
