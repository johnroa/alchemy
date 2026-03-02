import { NextResponse } from "next/server";
import { getAdminClient, requireCloudflareAccess } from "@/lib/supabase-admin";

type RouteUpdateBody = {
  scope: string;
  provider: string;
  model: string;
  route_name?: string;
  config?: Record<string, unknown>;
};

export async function GET(): Promise<NextResponse> {
  await requireCloudflareAccess();
  const client = getAdminClient();

  const { data, error } = await client
    .from("llm_model_routes")
    .select("id,scope,route_name,provider,model,config,is_active,created_at")
    .order("scope", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ routes: data ?? [] });
}

export async function POST(request: Request): Promise<NextResponse> {
  await requireCloudflareAccess();
  const body = (await request.json()) as RouteUpdateBody;

  if (!body.scope || !body.provider || !body.model) {
    return NextResponse.json({ error: "scope, provider, and model are required" }, { status: 400 });
  }

  const client = getAdminClient();

  const { error: disableError } = await client
    .from("llm_model_routes")
    .update({ is_active: false })
    .eq("scope", body.scope)
    .eq("is_active", true);

  if (disableError) {
    return NextResponse.json({ error: disableError.message }, { status: 500 });
  }

  const routeName = body.route_name ?? `${body.provider}_${body.model}`;
  const { error: upsertError } = await client.from("llm_model_routes").upsert(
    {
      scope: body.scope,
      route_name: routeName,
      provider: body.provider,
      model: body.model,
      config: body.config ?? {},
      is_active: true
    },
    { onConflict: "scope,route_name" }
  );

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  const { data: routes } = await client
    .from("llm_model_routes")
    .select("id,scope,route_name,provider,model,config,is_active,created_at")
    .order("scope", { ascending: true });

  return NextResponse.json({ routes: routes ?? [] });
}
