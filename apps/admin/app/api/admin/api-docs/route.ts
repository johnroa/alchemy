import { NextResponse } from "next/server";
import spec from "@/lib/openapi-spec.json";
import { ADMIN_ROUTES } from "@/lib/admin-routes";
import { requireCloudflareAccess } from "@/lib/supabase-admin";

/**
 * Serves the OpenAPI spec and admin route inventory as JSON.
 * Both are static imports bundled at build time — no filesystem needed.
 */
export async function GET(): Promise<NextResponse> {
  await requireCloudflareAccess();
  return NextResponse.json({ spec, adminRoutes: ADMIN_ROUTES });
}
