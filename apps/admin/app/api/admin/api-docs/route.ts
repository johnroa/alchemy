import { NextResponse } from "next/server";
import spec from "@/lib/openapi-spec.json";
import { ADMIN_ROUTES } from "@/lib/admin-routes";

/**
 * Serves the OpenAPI spec and admin route inventory as JSON.
 * Both are static imports bundled at build time — no filesystem needed.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ spec, adminRoutes: ADMIN_ROUTES });
}
