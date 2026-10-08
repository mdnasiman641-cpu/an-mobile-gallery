import "server-only";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabaseAnonKey, supabaseUrl } from "@/lib/env";

let client: SupabaseClient | null = null;

/**
 * Cookie-less anonymous client for public catalog reads.
 * Because it never touches cookies, pages using it can be statically
 * generated and revalidated (ISR), which keeps the storefront fast.
 * Returns null when Supabase is not configured (e.g. first build).
 */
export function getPublicClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!client) {
    client = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return client;
}
