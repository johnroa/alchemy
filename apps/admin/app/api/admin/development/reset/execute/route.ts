import { NextResponse } from "next/server";
import { isDevelopmentResetPreset } from "@/lib/development-reset";
import { getAdminClient, requireCloudflareAccess } from "@/lib/supabase-admin";

type Body = {
  preset?: string;
  confirm_text?: string;
  reason?: string;
};

export async function POST(request: Request): Promise<NextResponse> {
  const identity = await requireCloudflareAccess();
  const body = (await request.json().catch(() => ({}))) as Body;

  const preset = typeof body.preset === "string" ? body.preset.trim().toLowerCase() : "";
  const confirmText = typeof body.confirm_text === "string" ? body.confirm_text.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (!isDevelopmentResetPreset(preset)) {
    return NextResponse.json(
      {
        error:
          "Invalid preset. Expected one of: recipes_domain_reset, ingredients_ontology_reset, graph_reset, full_food_reset",
      },
      { status: 400 },
    );
  }

  if (!confirmText) {
    return NextResponse.json(
      { error: "confirm_text is required" },
      { status: 400 },
    );
  }

  const client = getAdminClient();
  const { data, error } = await client.rpc("admin_dev_food_data_wipe", {
    preset,
    confirm_text: confirmText,
    reason: reason.length > 0 ? reason : null,
    actor_email: identity.email,
  });

  if (error) {
    return NextResponse.json(
      {
        error: error.message,
        details: error.details,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    result: data,
  });
}
