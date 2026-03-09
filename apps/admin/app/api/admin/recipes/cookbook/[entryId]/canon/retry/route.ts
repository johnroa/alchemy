import { NextResponse } from "next/server";
import { normalizeApiBase } from "@/lib/admin-api-base";
import { proxyJsonRequest } from "@/lib/admin-http";
import { getBearerTokenForEmail } from "@/lib/admin-simulation-token";
import { getAdminClient, requireCloudflareAccess } from "@/lib/supabase-admin";

const toNullableString = (value: unknown): string | null => (
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null
);

export async function POST(
  _request: Request,
  context: { params: Promise<{ entryId: string }> },
): Promise<NextResponse> {
  await requireCloudflareAccess();

  const { entryId } = await context.params;
  if (!entryId?.trim()) {
    return NextResponse.json({ error: "entryId is required" }, { status: 400 });
  }

  const client = getAdminClient();
  const { data: entry, error: entryError } = await client
    .from("cookbook_entries")
    .select("id,user_id")
    .eq("id", entryId)
    .maybeSingle();

  if (entryError) {
    return NextResponse.json({ error: entryError.message }, { status: 500 });
  }
  if (!entry) {
    return NextResponse.json({ error: "Cookbook entry not found" }, { status: 404 });
  }

  const { data: user, error: userError } = await client
    .from("users")
    .select("email")
    .eq("id", entry.user_id)
    .maybeSingle();

  if (userError) {
    return NextResponse.json({ error: userError.message }, { status: 500 });
  }

  const userEmail = toNullableString(user?.email);
  if (!userEmail) {
    return NextResponse.json(
      { error: "Cookbook entry owner email is unavailable for retry" },
      { status: 409 },
    );
  }

  let token: string;
  try {
    token = await getBearerTokenForEmail(userEmail);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to acquire retry bearer token",
      },
      { status: 500 },
    );
  }

  const apiBase = normalizeApiBase(process.env["API_BASE_URL"]);
  return await proxyJsonRequest({
    apiBase,
    token,
    path: `/recipes/cookbook/${encodeURIComponent(entryId)}/canon/retry`,
    method: "POST",
    errorMessage: "Cookbook canon retry failed",
  });
}
