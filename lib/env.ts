/**
 * Central access to public configuration. Never read secrets here —
 * the service-role key lives only in lib/supabase/admin.ts (server-only).
 */

function stripTrailingSlash(url: string) {
  return url.replace(/\/+$/, "");
}

/** Base URL for canonical links, sitemap, Open Graph and JSON-LD. */
export function getSiteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv && /^https?:\/\//.test(fromEnv)) return stripTrailingSlash(fromEnv);
  // Vercel preview deployments expose their host automatically.
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey);
}
