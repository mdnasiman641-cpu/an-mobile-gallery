"use server";

// Admin → Settings → Header & Navigation. Admins only (checked here AND by
// the storefront_header RLS policy). Uses the admin's own session.

import { assertStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { invalidateHeader } from "@/lib/cache";
import { checkNav, navConfigSchema, type NavConfig } from "@/lib/navigation";
import { firstFieldErrors } from "@/lib/validation";
import type { ActionResult } from "@/types";

const MIGRATION =
  "The menu needs database migration 0020 (supabase/migrations/20261021000020_navigation.sql, after 0018). Run it in the Supabase SQL editor first.";

function isMissingSchema(error: { code?: string; message?: string }): boolean {
  const m = error.message ?? "";
  if (error.code === "42P01" || error.code === "PGRST205") return /storefront_header/.test(m) || error.code === "PGRST205";
  if (error.code === "42703" || error.code === "PGRST204") return /\bnav\b/.test(m);
  return false;
}

/** Save the menu (publish), or `null` to go back to the built-in menu. Categories and products are never changed here. */
export async function saveNavigationAction(raw: unknown): Promise<ActionResult<NavConfig | null>> {
  const session = await assertStaff("admin");
  if ("error" in session) return { ok: false, message: session.error };

  let nav: NavConfig | null = null;
  const supabase = await createClient();
  if (raw !== null) {
    const parsed = navConfigSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, message: "Please fix the highlighted menu items.", fieldErrors: firstFieldErrors(parsed.error) };
    const { data: cats, error: catError } = await supabase.from("categories").select("id");
    if (catError) return { ok: false, message: "Categories couldn't be checked. Please try again." };
    const errors = checkNav(parsed.data, new Set(((cats ?? []) as { id: string }[]).map((c) => c.id)));
    if (Object.keys(errors).length) return { ok: false, message: `Please fix the highlighted menu items. ${Object.values(errors)[0]}`, fieldErrors: errors };
    nav = parsed.data;
  }

  const { data, error } = await supabase.from("storefront_header").update({ nav, updated_at: new Date().toISOString(), updated_by: session.userId }).eq("id", 1).select("id");
  if (error) {
    // Only a missing column / table means a migration is missing. Anything else is reported as it is
    // (admins only; database error texts contain no secrets), so the real cause is never hidden.
    if (isMissingSchema(error)) return { ok: false, message: MIGRATION };
    console.error("[navigation] save failed", error.code, error.message);
    return { ok: false, message: `The menu couldn't be saved (database error ${error.code ?? "unknown"}: ${error.message}).` };
  }
  if (!data?.length) return { ok: false, message: "The menu couldn't be saved (no permission, or migration 0018 not run)." };

  invalidateHeader();
  return { ok: true, message: nav ? "Menu published" : "Built-in menu restored", data: nav };
}
