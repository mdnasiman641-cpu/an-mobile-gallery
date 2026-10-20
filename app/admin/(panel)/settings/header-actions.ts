"use server";

// Admin → Settings → Announcement bar, messages & offers, Locations.
// Admins only (checked here AND by the table's RLS policy). Uses the admin's
// own session; no service-role key.

import { assertStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { invalidateHeader } from "@/lib/cache";
import { MAX_OUTLETS, headerErrors, headerSchema, type HeaderConfig } from "@/lib/header-config";
import type { ActionResult } from "@/types";

const MIGRATION =
  "The announcement bar and Locations need database migration 0018 (supabase/migrations/20261021000018_storefront_header.sql). Run it in the Supabase SQL editor first.";

export async function saveHeaderSettingsAction(raw: unknown): Promise<ActionResult<HeaderConfig>> {
  const session = await assertStaff("admin");
  if ("error" in session) return { ok: false, message: session.error };

  // explicit limit message before anything else
  const outletsIn = (raw as { outlets?: unknown } | null)?.outlets;
  if (Array.isArray(outletsIn) && outletsIn.length > MAX_OUTLETS) {
    return { ok: false, message: `You can add at most ${MAX_OUTLETS} outlets.`, fieldErrors: { outlets: `At most ${MAX_OUTLETS} outlets` } };
  }

  const parsed = headerSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors = headerErrors(parsed.error);
    return { ok: false, message: `Please fix the highlighted fields. ${Object.values(fieldErrors)[0] ?? ""}`.trim(), fieldErrors };
  }
  const config = parsed.data;
  const ids = [...config.messages.map((m) => m.id), ...config.outlets.map((o) => o.id)];
  if (new Set(ids).size !== ids.length) return { ok: false, message: "Two items have the same id. Reload the page and try again." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("storefront_header")
    .update({ bar: config.bar, messages: config.messages, outlets: config.outlets, updated_at: new Date().toISOString(), updated_by: session.userId })
    .eq("id", 1)
    .select("id");
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205" || /storefront_header/.test(error.message)) return { ok: false, message: MIGRATION };
    return { ok: false, message: "The header settings couldn't be saved. Please try again." };
  }
  if (!data || data.length === 0) return { ok: false, message: "The header settings couldn't be saved (no permission, or migration 0018 not run)." };

  invalidateHeader();
  return { ok: true, message: "Header and Locations saved", data: config };
}
