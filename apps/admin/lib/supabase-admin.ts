import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { headers } from "next/headers";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export const getAdminClient = (): SupabaseClient => {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];

  if (!url || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
};

export const requireCloudflareAccess = async (): Promise<{ email: string }> => {
  const requestHeaders = await headers();
  const email = requestHeaders.get("cf-access-authenticated-user-email");

  if (process.env.NODE_ENV === "development") {
    return { email: email ?? "local-admin@cookwithalchemy.com" };
  }

  if (!email) {
    throw new Error("Cloudflare Access identity header is required");
  }

  return { email };
};

export const toRecord = (value: Json): Record<string, Json> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, Json>;
};
