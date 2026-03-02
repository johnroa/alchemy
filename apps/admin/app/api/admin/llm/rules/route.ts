import { NextResponse } from "next/server";
import { getAdminClient, requireCloudflareAccess } from "@/lib/supabase-admin";

type RuleActionBody =
  | { action: "activate"; rule_id: string }
  | { action: "create"; scope: string; name: string; rule: Record<string, unknown> };

export async function GET(): Promise<NextResponse> {
  await requireCloudflareAccess();
  const client = getAdminClient();

  const { data, error } = await client
    .from("llm_rules")
    .select("id,scope,version,name,rule,is_active,created_at")
    .order("scope", { ascending: true })
    .order("version", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rules: data ?? [] });
}

export async function POST(request: Request): Promise<NextResponse> {
  await requireCloudflareAccess();
  const client = getAdminClient();
  const body = (await request.json()) as RuleActionBody;

  if (body.action === "activate") {
    const { data: target, error: targetError } = await client
      .from("llm_rules")
      .select("id,scope")
      .eq("id", body.rule_id)
      .single();

    if (targetError || !target) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }

    const { error: deactivateError } = await client
      .from("llm_rules")
      .update({ is_active: false })
      .eq("scope", target.scope)
      .eq("is_active", true);

    if (deactivateError) {
      return NextResponse.json({ error: deactivateError.message }, { status: 500 });
    }

    const { error: activateError } = await client
      .from("llm_rules")
      .update({ is_active: true })
      .eq("id", body.rule_id);

    if (activateError) {
      return NextResponse.json({ error: activateError.message }, { status: 500 });
    }
  }

  if (body.action === "create") {
    if (body.scope === "classify") {
      const acceptLabels = body.rule["accept_labels"];
      if (!Array.isArray(acceptLabels) || acceptLabels.length === 0) {
        return NextResponse.json(
          { error: "classify rules must define accept_labels[] so gateway can determine allowed labels" },
          { status: 400 }
        );
      }
    }

    const { data: latest } = await client
      .from("llm_rules")
      .select("version")
      .eq("scope", body.scope)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextVersion = (latest?.version ?? 0) + 1;

    const { error: insertError } = await client.from("llm_rules").insert({
      scope: body.scope,
      version: nextVersion,
      name: body.name,
      rule: body.rule,
      is_active: false
    });

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
  }

  const { data: rules, error } = await client
    .from("llm_rules")
    .select("id,scope,version,name,rule,is_active,created_at")
    .order("scope", { ascending: true })
    .order("version", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rules: rules ?? [] });
}
