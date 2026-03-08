import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { JsonValue } from "../../_shared/types.ts";
import { getExploreForYouFeed } from "../recipe-search.ts";
import { runInBackground } from "./background-tasks.ts";
import { buildSafetyExclusions, getPreferences } from "./preferences.ts";
import { getActiveMemories, getMemorySnapshot } from "./user-profile.ts";

type InstallUserRow = {
  install_id: string | null;
  user_id: string;
};

export const lookupUserIdsForInstallIds = async (params: {
  serviceClient: SupabaseClient;
  installIds: string[];
}): Promise<Map<string, string>> => {
  const installIds = Array.from(
    new Set(params.installIds.map((value) => value.trim()).filter((value) => value.length > 0)),
  );
  if (installIds.length === 0) {
    return new Map();
  }

  const { data, error } = await params.serviceClient
    .from("user_acquisition_profiles")
    .select("install_id,user_id")
    .in("install_id", installIds);

  if (error) {
    console.error("explore_preload_install_lookup_failed", error);
    return new Map();
  }

  const mapping = new Map<string, string>();
  for (const row of (data ?? []) as InstallUserRow[]) {
    if (!row.install_id || mapping.has(row.install_id)) {
      continue;
    }
    mapping.set(row.install_id, row.user_id);
  }

  return mapping;
};

export const scheduleExploreForYouPreload = (params: {
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  presetId?: string | null;
}): void => {
  const task = (async () => {
    const [preferences, memorySnapshot, activeMemories] = await Promise.all([
      getPreferences(params.serviceClient, params.userId),
      getMemorySnapshot(params.serviceClient, params.userId),
      getActiveMemories(params.serviceClient, params.userId, 12),
    ]);

    await getExploreForYouFeed({
      serviceClient: params.serviceClient,
      userId: params.userId,
      requestId: params.requestId,
      cursor: null,
      limit: 10,
      presetId: params.presetId ?? null,
      preferences: preferences as Record<string, JsonValue>,
      memorySnapshot,
      activeMemories: activeMemories as unknown as JsonValue,
      safetyExclusions: buildSafetyExclusions(preferences),
    });
  })().catch((error) => {
    console.error("explore_preload_failed", {
      request_id: params.requestId,
      user_id: params.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  runInBackground(task);
};
