import { NextResponse } from "next/server";
import { getAdminClient, requireCloudflareAccess } from "@/lib/supabase-admin";

export async function POST(request: Request): Promise<NextResponse> {
  const identity = await requireCloudflareAccess();
  const body = (await request.json()) as { recipe_id: string; version_id: string };

  if (!body.recipe_id || !body.version_id) {
    return NextResponse.json({ error: "recipe_id and version_id are required" }, { status: 400 });
  }

  const client = getAdminClient();

  const { data: actor } = await client.from("users").select("id").eq("email", identity.email).maybeSingle();
  const actorId = actor?.id;

  if (!actorId) {
    return NextResponse.json({ error: "Actor user record not found" }, { status: 403 });
  }

  const { error } = await client.rpc("admin_revert_recipe_version", {
    target_recipe_id: body.recipe_id,
    target_version_id: body.version_id,
    actor_id: actorId
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
