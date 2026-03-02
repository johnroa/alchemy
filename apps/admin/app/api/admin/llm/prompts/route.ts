import { NextResponse } from "next/server";
import { getAdminClient, requireCloudflareAccess } from "@/lib/supabase-admin";

type PromptActionBody =
  | { action: "activate"; prompt_id: string }
  | { action: "create"; scope: string; name: string; template: string };

export async function GET(): Promise<NextResponse> {
  await requireCloudflareAccess();
  const client = getAdminClient();

  const { data, error } = await client
    .from("llm_prompts")
    .select("id,scope,version,name,template,is_active,created_at")
    .order("scope", { ascending: true })
    .order("version", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ prompts: data ?? [] });
}

export async function POST(request: Request): Promise<NextResponse> {
  await requireCloudflareAccess();
  const client = getAdminClient();
  const body = (await request.json()) as PromptActionBody;

  if (body.action === "activate") {
    const { data: target, error: targetError } = await client
      .from("llm_prompts")
      .select("id,scope")
      .eq("id", body.prompt_id)
      .single();

    if (targetError || !target) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    const { error: deactivateError } = await client
      .from("llm_prompts")
      .update({ is_active: false })
      .eq("scope", target.scope)
      .eq("is_active", true);

    if (deactivateError) {
      return NextResponse.json({ error: deactivateError.message }, { status: 500 });
    }

    const { error: activateError } = await client
      .from("llm_prompts")
      .update({ is_active: true })
      .eq("id", body.prompt_id);

    if (activateError) {
      return NextResponse.json({ error: activateError.message }, { status: 500 });
    }
  }

  if (body.action === "create") {
    const { data: latest } = await client
      .from("llm_prompts")
      .select("version")
      .eq("scope", body.scope)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextVersion = (latest?.version ?? 0) + 1;

    const { error: insertError } = await client.from("llm_prompts").insert({
      scope: body.scope,
      version: nextVersion,
      name: body.name,
      template: body.template,
      is_active: false
    });

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
  }

  const { data: prompts, error } = await client
    .from("llm_prompts")
    .select("id,scope,version,name,template,is_active,created_at")
    .order("scope", { ascending: true })
    .order("version", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ prompts: prompts ?? [] });
}
