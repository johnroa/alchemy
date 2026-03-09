import { NextResponse } from "next/server";
import {
  isFeatureFlagEnvironment,
  isFeatureFlagKey,
  normalizeFeatureFlagKey,
  type FeatureFlagEnvironment,
} from "../../../../../../../packages/shared/src/feature-flags";
import {
  loadFeatureFlagsAdminSnapshot,
  previewFeatureFlags,
} from "@/lib/feature-flags-admin";
import { getAdminClient, requireCloudflareAccess } from "@/lib/supabase-admin";

type PreviewFlagsBody = {
  environment?: string;
  keys?: string[];
};

export async function POST(request: Request): Promise<NextResponse> {
  await requireCloudflareAccess();
  const body = (await request.json()) as PreviewFlagsBody;
  const environment = typeof body.environment === "string"
    ? body.environment.trim().toLowerCase()
    : "";
  if (!isFeatureFlagEnvironment(environment)) {
    return NextResponse.json(
      { error: "environment must be development or production" },
      { status: 400 },
    );
  }
  if (
    !Array.isArray(body.keys) ||
    body.keys.length === 0 ||
    body.keys.some((key) => typeof key !== "string")
  ) {
    return NextResponse.json(
      { error: "keys must be a non-empty array" },
      { status: 400 },
    );
  }

  const keys = body.keys.map((key) => normalizeFeatureFlagKey(key));
  if (keys.some((key) => !isFeatureFlagKey(key))) {
    return NextResponse.json(
      { error: "keys contain an invalid feature flag key" },
      { status: 400 },
    );
  }

  const client = getAdminClient();
  const snapshot = await loadFeatureFlagsAdminSnapshot(client);
  const resolution = previewFeatureFlags({
    snapshot,
    environment: environment as FeatureFlagEnvironment,
    keys,
  });

  return NextResponse.json({ ok: true, resolution });
}
