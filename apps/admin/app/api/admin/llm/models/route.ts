import { NextResponse } from "next/server";
import { getAdminClient, requireCloudflareAccess } from "@/lib/supabase-admin";

type ModelRow = {
  id: string;
  provider: string;
  model: string;
  display_name: string;
  input_cost_per_1m_tokens: number;
  output_cost_per_1m_tokens: number;
  context_window_tokens: number | null;
  max_output_tokens: number | null;
  is_available: boolean;
  notes: string | null;
};

export async function GET(): Promise<NextResponse> {
  await requireCloudflareAccess();
  const client = getAdminClient();
  const { data, error } = await client
    .from("llm_model_registry")
    .select("id,provider,model,display_name,input_cost_per_1m_tokens,output_cost_per_1m_tokens,context_window_tokens,max_output_tokens,is_available,notes")
    .order("provider")
    .order("display_name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ models: (data ?? []) as ModelRow[] });
}

export async function POST(request: Request): Promise<NextResponse> {
  await requireCloudflareAccess();
  const client = getAdminClient();
  const body = (await request.json().catch(() => ({}))) as Partial<ModelRow>;

  if (!body.provider?.trim() || !body.model?.trim() || !body.display_name?.trim()) {
    return NextResponse.json({ error: "provider, model, and display_name are required" }, { status: 400 });
  }

  const { error } = await client.from("llm_model_registry").insert({
    provider: body.provider.trim(),
    model: body.model.trim(),
    display_name: body.display_name.trim(),
    input_cost_per_1m_tokens: Number(body.input_cost_per_1m_tokens ?? 0),
    output_cost_per_1m_tokens: Number(body.output_cost_per_1m_tokens ?? 0),
    context_window_tokens: body.context_window_tokens ?? null,
    max_output_tokens: body.max_output_tokens ?? null,
    is_available: body.is_available ?? true,
    notes: body.notes ?? null
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const { data } = await client
    .from("llm_model_registry")
    .select("id,provider,model,display_name,input_cost_per_1m_tokens,output_cost_per_1m_tokens,context_window_tokens,max_output_tokens,is_available,notes")
    .order("provider")
    .order("display_name");

  return NextResponse.json({ models: (data ?? []) as ModelRow[] });
}

export async function PATCH(request: Request): Promise<NextResponse> {
  await requireCloudflareAccess();
  const client = getAdminClient();
  const body = (await request.json().catch(() => ({}))) as Partial<ModelRow> & { id: string };

  if (!body.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const update: Partial<ModelRow> & { updated_at?: string } = { updated_at: new Date().toISOString() };
  if (body.display_name !== undefined) {
    const displayName = body.display_name.trim();
    if (!displayName) {
      return NextResponse.json({ error: "display_name cannot be empty" }, { status: 400 });
    }
    update.display_name = displayName;
  }
  if (body.model !== undefined) {
    const model = body.model.trim();
    if (!model) {
      return NextResponse.json({ error: "model cannot be empty" }, { status: 400 });
    }
    update.model = model;
  }
  if (body.input_cost_per_1m_tokens !== undefined) update.input_cost_per_1m_tokens = Number(body.input_cost_per_1m_tokens);
  if (body.output_cost_per_1m_tokens !== undefined) update.output_cost_per_1m_tokens = Number(body.output_cost_per_1m_tokens);
  if (body.context_window_tokens !== undefined) update.context_window_tokens = body.context_window_tokens;
  if (body.max_output_tokens !== undefined) update.max_output_tokens = body.max_output_tokens;
  if (body.is_available !== undefined) update.is_available = body.is_available;
  if (body.notes !== undefined) update.notes = body.notes;

  const { error } = await client.from("llm_model_registry").update(update).eq("id", body.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const { data } = await client
    .from("llm_model_registry")
    .select("id,provider,model,display_name,input_cost_per_1m_tokens,output_cost_per_1m_tokens,context_window_tokens,max_output_tokens,is_available,notes")
    .order("provider")
    .order("display_name");

  return NextResponse.json({ models: (data ?? []) as ModelRow[] });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  await requireCloudflareAccess();
  const client = getAdminClient();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id query param is required" }, { status: 400 });
  }

  const { error } = await client.from("llm_model_registry").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const { data } = await client
    .from("llm_model_registry")
    .select("id,provider,model,display_name,input_cost_per_1m_tokens,output_cost_per_1m_tokens,context_window_tokens,max_output_tokens,is_available,notes")
    .order("provider")
    .order("display_name");

  return NextResponse.json({ models: (data ?? []) as ModelRow[] });
}
