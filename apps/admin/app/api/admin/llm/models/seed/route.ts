import { NextResponse } from "next/server";
import { getAdminClient, requireCloudflareAccess } from "@/lib/supabase-admin";

const DEFAULT_MODELS = [
  { provider: "openai",    model: "gpt-5.1",             display_name: "GPT-5.1",          input_cost_per_1m_tokens: 1.25,  output_cost_per_1m_tokens: 10.00, context_window_tokens: 400000,  max_output_tokens: 128000, notes: "Current flagship GPT-5 model" },
  { provider: "openai",    model: "gpt-5",               display_name: "GPT-5",            input_cost_per_1m_tokens: 1.25,  output_cost_per_1m_tokens: 10.00, context_window_tokens: 400000,  max_output_tokens: 128000, notes: "High-quality GPT-5 model" },
  { provider: "openai",    model: "gpt-5-mini",          display_name: "GPT-5 Mini",       input_cost_per_1m_tokens: 0.25,  output_cost_per_1m_tokens: 2.00,  context_window_tokens: 400000,  max_output_tokens: 128000, notes: "Fast cost-efficient GPT-5 variant" },
  { provider: "openai",    model: "gpt-5-nano",          display_name: "GPT-5 Nano",       input_cost_per_1m_tokens: 0.05,  output_cost_per_1m_tokens: 0.40,  context_window_tokens: 400000,  max_output_tokens: 128000, notes: "Lowest-latency GPT-5 variant" },
  { provider: "openai",    model: "gpt-4.1",             display_name: "GPT-4.1",          input_cost_per_1m_tokens: 2.00,  output_cost_per_1m_tokens: 8.00,  context_window_tokens: 1000000, max_output_tokens: 32768,  notes: "Stable GPT-4.1 fallback" },
  { provider: "openai",    model: "gpt-4.1-mini",        display_name: "GPT-4.1 Mini",     input_cost_per_1m_tokens: 0.40,  output_cost_per_1m_tokens: 1.60,  context_window_tokens: 1000000, max_output_tokens: 32768,  notes: "Cost-efficient GPT-4.1 variant" },
  { provider: "openai",    model: "gpt-image-1.5",       display_name: "GPT Image 1.5",    input_cost_per_1m_tokens: 5.00,  output_cost_per_1m_tokens: 10.00, context_window_tokens: null,    max_output_tokens: null,   notes: "Latest OpenAI image generation model" },
  { provider: "openai",    model: "gpt-image-1",         display_name: "GPT Image 1",      input_cost_per_1m_tokens: 5.00,  output_cost_per_1m_tokens: 40.00, context_window_tokens: null,    max_output_tokens: null,   notes: "Legacy OpenAI image generation model" },
  { provider: "anthropic", model: "claude-opus-4-6",     display_name: "Claude Opus 4.6",  input_cost_per_1m_tokens: 15.00, output_cost_per_1m_tokens: 75.00, context_window_tokens: 200000,  max_output_tokens: 32000,  notes: "Most capable Claude model" },
  { provider: "anthropic", model: "claude-sonnet-4-6",   display_name: "Claude Sonnet 4.6",input_cost_per_1m_tokens: 3.00,  output_cost_per_1m_tokens: 15.00, context_window_tokens: 200000,  max_output_tokens: 64000,  notes: "Balanced Claude Sonnet" },
  { provider: "anthropic", model: "claude-haiku-4-5",    display_name: "Claude Haiku 4.5", input_cost_per_1m_tokens: 0.80,  output_cost_per_1m_tokens: 4.00,  context_window_tokens: 200000,  max_output_tokens: 16000,  notes: "Fast Claude Haiku" },
];

const REMOVED_OPENAI_MODELS = ["gpt-4o", "gpt-4o-mini", "o3", "o4-mini"] as const;

export async function POST(): Promise<NextResponse> {
  await requireCloudflareAccess();
  const client = getAdminClient();

  const { error } = await client.from("llm_model_registry").upsert(
    DEFAULT_MODELS.map((m) => ({ ...m, is_available: true })),
    { onConflict: "provider,model" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { error: deleteError } = await client
    .from("llm_model_registry")
    .delete()
    .eq("provider", "openai")
    .in("model", [...REMOVED_OPENAI_MODELS]);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  const nowIso = new Date().toISOString();
  const { error: fallbackRouteError } = await client
    .from("llm_model_routes")
    .update({ model: "gpt-5-mini", updated_at: nowIso })
    .eq("provider", "openai")
    .in("model", [...REMOVED_OPENAI_MODELS])
    .neq("scope", "generate")
    .neq("scope", "image");

  if (fallbackRouteError) {
    return NextResponse.json({ error: fallbackRouteError.message }, { status: 500 });
  }

  const { error: generateRouteError } = await client
    .from("llm_model_routes")
    .update({ model: "gpt-5", updated_at: nowIso })
    .eq("provider", "openai")
    .eq("scope", "generate")
    .in("model", [...REMOVED_OPENAI_MODELS]);

  if (generateRouteError) {
    return NextResponse.json({ error: generateRouteError.message }, { status: 500 });
  }

  const { data } = await client
    .from("llm_model_registry")
    .select("id,provider,model,display_name,input_cost_per_1m_tokens,output_cost_per_1m_tokens,context_window_tokens,max_output_tokens,is_available,notes")
    .order("provider")
    .order("display_name");

  return NextResponse.json({ models: data ?? [] });
}
