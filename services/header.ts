import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { getPublicClient } from "@/lib/supabase/public";
import { CACHE_TAGS } from "@/lib/cache";
import { EMPTY_HEADER, readHeaderConfig, type HeaderConfig } from "@/lib/header-config";

/** Table missing = migration 0018 not run yet. */
export function isMissingHeaderTable(error: { code?: string; message?: string }): boolean {
  return error.code === "42P01" || error.code === "PGRST205" || /storefront_header/.test(error.message ?? "");
}

// Read on every storefront page: cached across requests (tag "header") and
// refreshed only when an admin saves Admin → Settings.
const loadHeaderConfig = unstable_cache(
  async (): Promise<HeaderConfig> => {
    const supabase = getPublicClient();
    if (!supabase) return EMPTY_HEADER;
    let { data, error } = await supabase.from("storefront_header").select("bar, messages, outlets, nav").eq("id", 1).maybeSingle();
    if (error && /nav/.test(error.message) && (error.code === "42703" || /column/i.test(error.message))) {
      // migration 0020 not run yet: built-in menu
      ({ data, error } = await supabase.from("storefront_header").select("bar, messages, outlets").eq("id", 1).maybeSingle());
    }
    if (error) {
      if (isMissingHeaderTable(error)) return EMPTY_HEADER; // nothing configured yet
      throw new Error(`storefront_header: ${error.message}`); // temporary: not cached
    }
    const row = data as { bar: unknown; messages: unknown; outlets: unknown; nav?: unknown } | null;
    return { ...readHeaderConfig(row), nav: row?.nav ?? null };
  },
  ["storefront-header-v1"],
  { tags: [CACHE_TAGS.header], revalidate: 86400 },
);

/** Never throws: an unreachable database just means no bar and no Locations. */
export const getHeaderConfig = cache(async (): Promise<HeaderConfig> => {
  try {
    return await loadHeaderConfig();
  } catch (e) {
    console.error("[header] not shown:", e);
    return EMPTY_HEADER;
  }
});

/** Server time of this render (pages are cached; the browser re-checks schedules). */
export function renderTime(): number {
  return Date.now();
}
