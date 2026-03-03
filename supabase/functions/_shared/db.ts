import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const anonKey =
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  Deno.env.get("SUPABASE_ANON_KEY");
const serviceRoleKey =
  Deno.env.get("SUPABASE_SECRET_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  throw new Error(
    "SUPABASE_URL, (SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY), and (SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY) are required"
  );
}

export const createUserClient = (authHeader: string): SupabaseClient => {
  return createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: authHeader
      }
    }
  });
};

export const createServiceClient = (): SupabaseClient => {
  return createClient(supabaseUrl, serviceRoleKey);
};
