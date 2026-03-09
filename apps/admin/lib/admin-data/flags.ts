import type { FeatureFlagsAdminSnapshot } from "@/lib/feature-flags-admin";
import { loadFeatureFlagsAdminSnapshot } from "@/lib/feature-flags-admin";
import { getAdminClient } from "@/lib/supabase-admin";

export const getFeatureFlagsData = async (): Promise<FeatureFlagsAdminSnapshot> => {
  const client = getAdminClient();
  return await loadFeatureFlagsAdminSnapshot(client);
};
