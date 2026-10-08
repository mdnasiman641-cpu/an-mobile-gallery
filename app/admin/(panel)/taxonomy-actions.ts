"use server";

import { z } from "zod";
import { assertStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { invalidateTaxonomy } from "@/lib/cache";
import { firstFieldErrors, taxonomySchema } from "@/lib/validation";
import type { ActionResult } from "@/types";

const imageUrl = z
  .string()
  .trim()
  .max(1000)
  .nullable()
  .optional()
  .transform((v) => v || null);

export async function saveTaxonomyAction(
  kind: "brand" | "category",
  id: string | null,
  values: unknown,
): Promise<ActionResult<{ id: string }>> {
  const session = await assertStaff("editor");
  if ("error" in session) return { ok: false, message: session.error };

  const parsed = taxonomySchema.extend({ image: imageUrl }).safeParse(values);
  if (!parsed.success) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: firstFieldErrors(parsed.error) };
  const { image, parent_id, slug, ...rest } = parsed.data;

  if (kind === "category" && id && parent_id === id) {
    return { ok: false, message: "A category can't be its own parent.", fieldErrors: { parent_id: "Choose another parent" } };
  }

  const supabase = await createClient();
  const base = { ...rest, slug: slug ?? "" };

  // One fully typed query per kind (brands.logo_url vs categories.image_url +
  // parent_id), so Supabase checks each row against a single, known shape.
  let res: { data: { id: string } | null; error: { message: string } | null };
  if (kind === "brand") {
    const row = { ...base, logo_url: image };
    res = id
      ? await supabase.from("brands").update(row).eq("id", id).select("id").single()
      : await supabase.from("brands").insert(row).select("id").single();
  } else {
    const row = { ...base, image_url: image, parent_id: parent_id ?? null };
    res = id
      ? await supabase.from("categories").update(row).eq("id", id).select("id").single()
      : await supabase.from("categories").insert(row).select("id").single();
  }
  if (res.error || !res.data) {
    return { ok: false, message: `${kind === "brand" ? "Brand" : "Category"} couldn't be saved: ${res.error?.message ?? "no row returned"}` };
  }

  invalidateTaxonomy();
  return { ok: true, message: id ? "Saved" : `${kind === "brand" ? "Brand" : "Category"} added`, data: { id: res.data.id } };
}

export async function deleteTaxonomyAction(kind: "brand" | "category", id: string): Promise<ActionResult> {
  const session = await assertStaff("editor");
  if ("error" in session) return { ok: false, message: session.error };
  const supabase = await createClient();
  const column = kind === "brand" ? "brand_id" : "category_id";
  const { count } = await supabase.from("products").select("id", { count: "exact", head: true }).eq(column, id);
  if (count && count > 0) {
    return {
      ok: false,
      message: `${count} product${count === 1 ? " uses" : "s use"} this ${kind}. Move ${count === 1 ? "it" : "them"} first, or hide the ${kind} instead.`,
    };
  }
  const { error } = await supabase.from(kind === "brand" ? "brands" : "categories").delete().eq("id", id);
  if (error) return { ok: false, message: `The ${kind} couldn't be deleted.` };
  invalidateTaxonomy();
  return { ok: true, message: `${kind === "brand" ? "Brand" : "Category"} deleted` };
}
