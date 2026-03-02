import * as SecureStore from "expo-secure-store";
import { createClient } from "@supabase/supabase-js";

const normalizeSupabaseUrl = (rawUrl: string | undefined): string | null => {
  if (!rawUrl) {
    return null;
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    return new URL(withProtocol).origin;
  } catch {
    return null;
  }
};

const SUPABASE_URL = normalizeSupabaseUrl(process.env["EXPO_PUBLIC_SUPABASE_URL"]);
const SUPABASE_PUBLISHABLE_KEY =
  process.env["EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] ??
  process.env["EXPO_PUBLIC_SUPABASE_ANON_KEY"] ??
  null;

export const supabaseConfigError =
  SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY
    ? null
    : "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.";

export const supabase = createClient(SUPABASE_URL ?? "https://invalid.supabase.co", SUPABASE_PUBLISHABLE_KEY ?? "invalid", {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    storage: {
      getItem: (key: string) => SecureStore.getItemAsync(key),
      setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
      removeItem: (key: string) => SecureStore.deleteItemAsync(key)
    }
  }
});
