"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { invalidateHomepage } from "@/lib/cache";
import { SECTION_DEFS, SECTION_KEYS, sectionLimit, type SectionKey } from "@/lib/homepage";
import type { ActionResult } from "@/types";

const keySchema = z.enum(SECTION_KEYS);
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
// Internal paths, or https links. No javascript:/data: URLs.
const urlField = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^\/(?!\/)/.test(v) || /^https:\/\//.test(v), "Use a path like /offers or a full https:// link");

const sectionSchema = z.object({
  title: optional(120),
  subtitle: optional(240),
  description: optional(1000),
  image_url: urlField,
  button_text: optional(60),
  button_url: urlField,
  mode: z.enum(["auto", "manual"]),
  item_limit: z.coerce.number().int().min(1).max(24).nullish(),
  items: z.array(z.object({ title: z.string().trim().min(1).max(80), text: z.string().trim().max(160) })).max(8).optional(),
  item_ids: z.array(z.string().uuid()).max(24),
});

function migrationHint(message: string) {
  return /relation .* does not exist|homepage_sections/i.test(message) ? "Homepage settings need the latest database migration." : "Couldn't save. Please try again.";
}

/** Save the order (keys top → bottom). Rows that don't exist yet are created. */
export async function saveHomepageOrderAction(keys: string[]): Promise<ActionResult> {
  const session = await assertStaff("editor");
  if ("error" in session) return { ok: false, message: session.error };
  const parsed = z.array(keySchema).safeParse(keys);
  if (!parsed.success || new Set(parsed.data).size !== SECTION_KEYS.length) return { ok: false, message: "Invalid order." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("homepage_sections")
    .upsert(parsed.data.map((key, i) => ({ key, position: i + 1, updated_by: session.userId })), { onConflict: "key" });
  if (error) return { ok: false, message: migrationHint(error.message) };
  invalidateHomepage();
  revalidatePath("/admin/homepage");
  return { ok: true, message: "Order saved" };
}

export async function toggleHomepageSectionAction(key: string, enabled: boolean): Promise<ActionResult> {
  const session = await assertStaff("editor");
  if ("error" in session) return { ok: false, message: session.error };
  const k = keySchema.safeParse(key);
  if (!k.success) return { ok: false, message: "Unknown section." };
  const supabase = await createClient();
  const { error } = await supabase.from("homepage_sections").update({ is_enabled: Boolean(enabled), updated_by: session.userId }).eq("key", k.data);
  if (error) return { ok: false, message: migrationHint(error.message) };
  invalidateHomepage();
  revalidatePath("/admin/homepage");
  return { ok: true, message: `${SECTION_DEFS[k.data].label} ${enabled ? "shown" : "hidden"}` };
}

export async function saveHomepageSectionAction(key: string, values: unknown): Promise<ActionResult> {
  const session = await assertStaff("editor");
  if ("error" in session) return { ok: false, message: session.error };
  const k = keySchema.safeParse(key);
  if (!k.success) return { ok: false, message: "Unknown section." };
  const parsed = sectionSchema.safeParse(values);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Please check the fields." };
  const def = SECTION_DEFS[k.data as SectionKey];
  const v = parsed.data;
  const mode = def.itemType ? v.mode : "auto";
  const limit = v.item_limit ? Math.min(v.item_limit, def.maxLimit ?? 24) : null;

  const supabase = await createClient();
  const { data: existing } = await supabase.from("homepage_sections").select("config").eq("key", k.data).maybeSingle();
  const config = { ...((existing as { config: Record<string, unknown> } | null)?.config ?? {}) };
  if (def.hasTextItems) {
    if (v.items && v.items.length) config.items = v.items;
    else delete config.items;
  }
  const { error } = await supabase
    .from("homepage_sections")
    .update({
      title: def.fields.includes("title") ? v.title : null,
      subtitle: def.fields.includes("subtitle") ? v.subtitle : null,
      description: def.fields.includes("description") ? v.description : null,
      image_url: def.fields.includes("image") ? v.image_url : null,
      button_text: def.fields.includes("button") ? v.button_text : null,
      button_url: def.fields.includes("button") ? v.button_url : null,
      mode,
      item_limit: limit,
      config,
      updated_by: session.userId,
    })
    .eq("key", k.data);
  if (error) return { ok: false, message: migrationHint(error.message) };

  // Manual picks: replace the list (prices are never changed here).
  if (def.itemType) {
    const ids = Array.from(new Set(v.item_ids)).slice(0, sectionLimit({ ...defaultLike(k.data), itemLimit: limit }));
    const del = await supabase.from("homepage_section_items").delete().eq("section_key", k.data);
    if (del.error) return { ok: false, message: migrationHint(del.error.message) };
    if (ids.length) {
      const ins = await supabase
        .from("homepage_section_items")
        .insert(ids.map((item_id, i) => ({ section_key: k.data, item_type: def.itemType, item_id, position: i })));
      if (ins.error) return { ok: false, message: migrationHint(ins.error.message) };
    }
  }
  invalidateHomepage();
  revalidatePath("/admin/homepage");
  return { ok: true, message: `${def.label} saved` };
}

/** Back to the built-in text and automatic content. */
export async function resetHomepageSectionAction(key: string): Promise<ActionResult> {
  const session = await assertStaff("editor");
  if ("error" in session) return { ok: false, message: session.error };
  const k = keySchema.safeParse(key);
  if (!k.success) return { ok: false, message: "Unknown section." };
  const supabase = await createClient();
  const def = SECTION_DEFS[k.data];
  const { error } = await supabase
    .from("homepage_sections")
    .update({ title: null, subtitle: null, description: null, image_url: null, button_text: null, button_url: null, mode: "auto", item_limit: def.defaultLimit ?? null, config: {}, updated_by: session.userId })
    .eq("key", k.data);
  if (error) return { ok: false, message: migrationHint(error.message) };
  await supabase.from("homepage_section_items").delete().eq("section_key", k.data);
  invalidateHomepage();
  revalidatePath("/admin/homepage");
  return { ok: true, message: `${def.label} reset to default` };
}

function defaultLike(key: SectionKey) {
  return { key, position: 0, isEnabled: true, title: null, subtitle: null, description: null, imageUrl: null, buttonText: null, buttonUrl: null, mode: "manual" as const, itemLimit: null, config: {}, itemIds: [] };
}
