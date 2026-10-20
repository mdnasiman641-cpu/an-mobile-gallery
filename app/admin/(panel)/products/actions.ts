"use server";

import { z } from "zod";
import { assertStaff, hasRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { invalidateProduct } from "@/lib/cache";
import { featureSchema, firstFieldErrors, productSchema, specSchema, variantSchema } from "@/lib/validation";
import type { ActionResult } from "@/types";

const imageSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  url: z.string().min(1).max(1000),
  storage_path: z.string().max(500).nullable().optional(),
  alt_text: z.string().trim().max(200).nullable().optional(),
  width: z.number().int().nullable().optional(),
  height: z.number().int().nullable().optional(),
});

const payloadSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  product: z.unknown(),
  variants: z.array(z.unknown()).max(60),
  specs: z.array(specSchema).max(120),
  features: z.array(featureSchema).max(40),
  images: z.array(imageSchema).max(15),
});

export type ProductPayload = z.input<typeof payloadSchema>;

type Db = Awaited<ReturnType<typeof createClient>>;

const BOX_MIGRATION =
  "Box availability needs database migration 0017 (supabase/migrations/20261021000017_product_box.sql). Run it in the Supabase SQL editor first.";

/** products.box_included doesn't exist yet (migration 0017 not run). */
function withoutBox<T extends { box_included?: boolean | null }>(row: T): Omit<T, "box_included"> {
  const copy: Partial<T> = { ...row };
  delete copy.box_included;
  return copy as Omit<T, "box_included">;
}

function isMissingBoxColumn(error: { code?: string; message?: string }): boolean {
  return /box_included/.test(error.message ?? "") && (error.code === "42703" || error.code === "PGRST204" || /column|schema cache/i.test(error.message ?? ""));
}

/** Remove storage files that no product image row references any more. */
async function removeOrphanFiles(supabase: Db, paths: string[]) {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (!unique.length) return;
  const { data } = await supabase.from("product_images").select("storage_path").in("storage_path", unique);
  const stillUsed = new Set(((data ?? []) as { storage_path: string }[]).map((r) => r.storage_path));
  const removable = unique.filter((p) => !stillUsed.has(p));
  if (removable.length) await supabase.storage.from("media").remove(removable);
}

async function adjust(supabase: Db, productId: string, variantId: string | null, change: number, reason: "initial" | "adjustment") {
  if (!change) return null;
  const { error } = await supabase.rpc("admin_adjust_stock", {
    p_product_id: productId,
    p_variant_id: variantId,
    p_change: change,
    p_reason: reason,
    p_note: "Set in product editor",
  });
  return error?.message ?? null;
}

export async function saveProductAction(raw: ProductPayload): Promise<ActionResult<{ id: string; slug: string }>> {
  const session = await assertStaff("editor");
  if ("error" in session) return { ok: false, message: session.error };

  const payload = payloadSchema.safeParse(raw);
  if (!payload.success) return { ok: false, message: "Some specifications, features or images are invalid.", fieldErrors: firstFieldErrors(payload.error) };

  const productParsed = productSchema.safeParse(payload.data.product);
  if (!productParsed.success) {
    return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: firstFieldErrors(productParsed.error) };
  }

  const variantErrors: Record<string, string> = {};
  const variants = payload.data.variants.map((v, i) => {
    const r = variantSchema.safeParse(v);
    if (!r.success) {
      const first = r.error.issues[0];
      variantErrors[`variants.${i}`] = `Variant ${i + 1}: ${first?.message ?? "invalid"}`;
      return null;
    }
    return r.data;
  });
  if (Object.keys(variantErrors).length) return { ok: false, message: Object.values(variantErrors)[0], fieldErrors: variantErrors };
  const cleanVariants = variants.filter((v): v is NonNullable<typeof v> => v !== null);

  const combos = new Set<string>();
  for (const v of cleanVariants) {
    const key = [v.storage, v.ram, v.color].map((x) => (x ?? "").toLowerCase()).join("|");
    if (combos.has(key)) return { ok: false, message: `Two variants have the same options (${[v.storage, v.ram, v.color].filter(Boolean).join(" / ")}).` };
    combos.add(key);
  }
  const skus = cleanVariants.map((v) => v.sku).filter(Boolean) as string[];
  if (new Set(skus).size !== skus.length) return { ok: false, message: "Two variants share the same SKU." };

  const { cost_price, stock_quantity, ...productFields } = productParsed.data;
  const supabase = await createClient();
  const isNew = !payload.data.id;
  const warnings: string[] = [];

  // ---- previous state (for diffs) -----------------------------------------
  let previousSlug: string | null = null;
  let previousVariants: { id: string; stock: number }[] = [];
  let previousImages: { id: string; storage_path: string | null }[] = [];
  if (!isNew) {
    const { data: prev, error } = await supabase
      .from("products")
      .select("id, slug, product_variants(id, stock), product_images(id, storage_path)")
      .eq("id", payload.data.id!)
      .maybeSingle();
    if (error || !prev) return { ok: false, message: "This product no longer exists." };
    const p = prev as unknown as {
      slug: string;
      product_variants: { id: string; stock: number }[];
      product_images: { id: string; storage_path: string | null }[];
    };
    previousSlug = p.slug;
    previousVariants = p.product_variants;
    previousImages = p.product_images;
  }

  // ---- product row ----------------------------------------------------------
  const row = { ...productFields, slug: productFields.slug ?? "" };
  let productId = payload.data.id ?? "";
  let slug = "";
  if (isNew) {
    let { data, error } = await supabase.from("products").insert({ ...row, stock_quantity: 0 }).select("id, slug").single();
    if (error && isMissingBoxColumn(error) && row.box_included == null) {
      // migration 0017 not run yet and nothing to store: save without the field
      ({ data, error } = await supabase.from("products").insert({ ...withoutBox(row), stock_quantity: 0 }).select("id, slug").single());
    }
    if (error) {
      if (isMissingBoxColumn(error)) return { ok: false, message: BOX_MIGRATION, fieldErrors: { box_included: "Needs database migration 0017" } };
      if (error.code === "23505") return { ok: false, message: "That SKU is already used by another product.", fieldErrors: { sku: "SKU already in use" } };
      return { ok: false, message: `Product couldn't be saved: ${error.message}` };
    }
    productId = (data as { id: string }).id;
    slug = (data as { slug: string }).slug;
  } else {
    let { data, error } = await supabase.from("products").update(row).eq("id", productId).select("slug").single();
    if (error && isMissingBoxColumn(error) && row.box_included == null) {
      ({ data, error } = await supabase.from("products").update(withoutBox(row)).eq("id", productId).select("slug").single());
    }
    if (error) {
      if (isMissingBoxColumn(error)) return { ok: false, message: BOX_MIGRATION, fieldErrors: { box_included: "Needs database migration 0017" } };
      if (error.code === "23505") return { ok: false, message: "That SKU is already used by another product.", fieldErrors: { sku: "SKU already in use" } };
      return { ok: false, message: `Product couldn't be saved: ${error.message}` };
    }
    slug = (data as { slug: string }).slug;
  }

  // ---- variants -------------------------------------------------------------
  const keepIds = new Set(cleanVariants.map((v) => v.id).filter(Boolean) as string[]);
  const removed = previousVariants.filter((v) => !keepIds.has(v.id)).map((v) => v.id);
  if (removed.length) {
    const { error } = await supabase.from("product_variants").delete().in("id", removed);
    if (error) warnings.push("Some removed variants couldn't be deleted.");
  }

  for (let i = 0; i < cleanVariants.length; i++) {
    const { id, stock, ...v } = cleanVariants[i];
    const existing = id ? previousVariants.find((p) => p.id === id) : undefined;
    if (existing) {
      const { error } = await supabase.from("product_variants").update({ ...v, sort_order: i }).eq("id", existing.id);
      if (error) {
        warnings.push(error.code === "23505" ? `Variant ${i + 1}: SKU already in use.` : `Variant ${i + 1} couldn't be saved.`);
        continue;
      }
      const err = await adjust(supabase, productId, existing.id, stock - existing.stock, "adjustment");
      if (err) warnings.push(`Variant ${i + 1} stock: ${err}`);
    } else {
      const { data, error } = await supabase
        .from("product_variants")
        .insert({ ...v, product_id: productId, stock: 0, sort_order: i })
        .select("id")
        .single();
      if (error) {
        warnings.push(error.code === "23505" ? `Variant ${i + 1}: SKU already in use.` : `Variant ${i + 1} couldn't be added.`);
        continue;
      }
      const err = await adjust(supabase, productId, (data as { id: string }).id, stock, "initial");
      if (err) warnings.push(`Variant ${i + 1} stock: ${err}`);
    }
  }

  // ---- base stock (products without variants) ------------------------------
  if (cleanVariants.length === 0) {
    const { data: fresh } = await supabase.from("products").select("stock_quantity").eq("id", productId).single();
    const current = (fresh as { stock_quantity: number } | null)?.stock_quantity ?? 0;
    const err = await adjust(supabase, productId, null, stock_quantity - current, isNew ? "initial" : "adjustment");
    if (err) warnings.push(`Stock: ${err}`);
  }

  // ---- specifications & features (replace) ---------------------------------
  await supabase.from("product_specifications").delete().eq("product_id", productId);
  if (payload.data.specs.length) {
    const { error } = await supabase
      .from("product_specifications")
      .insert(payload.data.specs.map((s, i) => ({ ...s, product_id: productId, sort_order: i })));
    if (error) warnings.push("Specifications couldn't be saved.");
  }
  await supabase.from("product_features").delete().eq("product_id", productId);
  if (payload.data.features.length) {
    const { error } = await supabase
      .from("product_features")
      .insert(payload.data.features.map((feature, i) => ({ feature, product_id: productId, sort_order: i })));
    if (error) warnings.push("Features couldn't be saved.");
  }

  // ---- images (first image = primary) ---------------------------------------
  const images = payload.data.images;
  const keepImageIds = new Set(images.map((i) => i.id).filter(Boolean) as string[]);
  const removedImages = previousImages.filter((i) => !keepImageIds.has(i.id));
  if (removedImages.length) {
    await supabase.from("product_images").delete().in("id", removedImages.map((i) => i.id));
    await removeOrphanFiles(supabase, removedImages.map((i) => i.storage_path ?? ""));
  }
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const fields = {
      url: img.url,
      storage_path: img.storage_path ?? null,
      alt_text: img.alt_text?.trim() || `${productFields.name}${i === 0 ? "" : ` image ${i + 1}`}`,
      is_primary: i === 0,
      sort_order: i,
      width: img.width ?? null,
      height: img.height ?? null,
    };
    const existing = img.id && previousImages.some((p) => p.id === img.id);
    const { error } = existing
      ? await supabase.from("product_images").update(fields).eq("id", img.id!)
      : await supabase.from("product_images").insert({ ...fields, product_id: productId });
    if (error) warnings.push(`Image ${i + 1} couldn't be saved.`);
  }

  // ---- private cost (admins only) -------------------------------------------
  if (hasRole(session, "admin")) {
    await supabase.from("product_costs").upsert({ product_id: productId, cost_price });
  }

  // Refresh the touched product so derived fields (price/stock from variants) are final.
  invalidateProduct([previousSlug, slug]);

  return {
    ok: true,
    message: warnings.length ? `Saved with warnings: ${warnings.join(" ")}` : isNew ? "Product created" : "Product saved",
    data: { id: productId, slug },
  };
}

export async function duplicateProductAction(id: string): Promise<ActionResult<{ id: string }>> {
  const session = await assertStaff("editor");
  if ("error" in session) return { ok: false, message: session.error };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("duplicate_product", { p_product_id: id });
  if (error) return { ok: false, message: "The product couldn't be duplicated." };
  return { ok: true, message: "Copy created as a draft", data: { id: data as string } };
}

export async function deleteProductAction(id: string): Promise<ActionResult> {
  return bulkProductsAction([id], "delete");
}

export async function bulkProductsAction(
  ids: string[],
  op: "active" | "draft" | "archived" | "out_of_stock" | "delete" | "feature" | "unfeature",
): Promise<ActionResult> {
  const session = await assertStaff("editor");
  if ("error" in session) return { ok: false, message: session.error };
  const clean = ids.filter((id) => z.string().uuid().safeParse(id).success).slice(0, 200);
  if (!clean.length) return { ok: false, message: "Select at least one product." };
  const supabase = await createClient();

  const { data: before } = await supabase.from("products").select("slug").in("id", clean);
  const slugs = ((before ?? []) as { slug: string }[]).map((r) => r.slug);

  if (op === "delete") {
    const { data: imgs } = await supabase.from("product_images").select("storage_path").in("product_id", clean);
    const { error } = await supabase.from("products").delete().in("id", clean);
    if (error) return { ok: false, message: "Products couldn't be deleted." };
    await removeOrphanFiles(supabase, ((imgs ?? []) as { storage_path: string | null }[]).map((i) => i.storage_path ?? ""));
  } else {
    const patch =
      op === "feature" ? { featured: true } : op === "unfeature" ? { featured: false } : { status: op };
    const { error } = await supabase.from("products").update(patch).in("id", clean);
    if (error) return { ok: false, message: "Products couldn't be updated." };
  }

  invalidateProduct(slugs);
  const verb = { active: "published", draft: "moved to draft", archived: "archived", out_of_stock: "marked out of stock", delete: "deleted", feature: "featured", unfeature: "unfeatured" }[op];
  return { ok: true, message: `${clean.length} product${clean.length === 1 ? "" : "s"} ${verb}` };
}

// ---------------------------------------------------------------------------
// Bulk: change category / condition / box availability (admins only)
// ---------------------------------------------------------------------------

const bulkFieldSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("category"), categoryId: z.string().uuid() }),
  z.object({ field: z.literal("condition"), value: z.enum(["new", "used"]) }),
  z.object({ field: z.literal("box"), value: z.enum(["with", "without"]) }),
]);
export type BulkFieldChange = z.input<typeof bulkFieldSchema>;

export interface BulkFieldResult {
  requested: number;
  updated: number;
  failed: number;
}

const BULK_MAX = 200;
const plural = (n: number) => `${n} product${n === 1 ? "" : "s"}`;

/**
 * Sets ONE field (category_id, condition or box_included) on the selected
 * products with a single UPDATE. No other column is sent, so prices, stock,
 * images, variants, specs, warranty and SEO stay as they are. Rows that
 * weren't updated (deleted meanwhile, or not visible) are reported as failed.
 */
export async function bulkSetProductFieldAction(ids: unknown, change: unknown): Promise<ActionResult<BulkFieldResult>> {
  const session = await assertStaff("admin");
  if ("error" in session) return { ok: false, message: session.error };

  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, message: "Select at least one product." };
  if (ids.length > BULK_MAX) return { ok: false, message: `Select at most ${BULK_MAX} products at a time.` };
  const clean = Array.from(new Set(ids.filter((id): id is string => typeof id === "string" && z.string().uuid().safeParse(id).success)));
  if (clean.length !== ids.length) return { ok: false, message: "The selection is invalid. Reload the page and try again." };

  const parsed = bulkFieldSchema.safeParse(change);
  if (!parsed.success) return { ok: false, message: "Choose a value to apply." };
  const c = parsed.data;
  const supabase = await createClient();

  let patch: { category_id: string } | { condition: "new" | "used" } | { box_included: boolean };
  let label: string;
  if (c.field === "category") {
    const { data: cat, error } = await supabase.from("categories").select("id, name").eq("id", c.categoryId).maybeSingle();
    if (error) return { ok: false, message: "Categories couldn't be checked. Please try again." };
    if (!cat) return { ok: false, message: "That category no longer exists. Reload the page and choose another." };
    patch = { category_id: c.categoryId };
    label = `moved to “${(cat as { name: string }).name}”`;
  } else if (c.field === "condition") {
    patch = { condition: c.value };
    label = `set to ${c.value === "new" ? "New" : "Used / Pre-owned"}`;
  } else {
    patch = { box_included: c.value === "with" };
    label = `set to ${c.value === "with" ? "With box" : "Without box"}`;
  }

  const { data, error } = await supabase.from("products").update(patch).in("id", clean).select("id, slug");
  if (error) {
    if (c.field === "box" && isMissingBoxColumn(error)) return { ok: false, message: BOX_MIGRATION };
    return { ok: false, message: "No products were updated: the database refused the change. Please try again." };
  }

  const rows = (data ?? []) as { id: string; slug: string }[];
  const result: BulkFieldResult = { requested: clean.length, updated: rows.length, failed: clean.length - rows.length };
  if (rows.length) invalidateProduct(rows.map((r) => r.slug)); // bounded: these pages + listing pages

  if (result.updated === 0) return { ok: false, message: "No products were updated. They may have been deleted. Reload the page.", data: result };
  if (result.failed > 0) {
    return {
      ok: false,
      message: `Only ${plural(result.updated)} of ${result.requested} ${label}. ${plural(result.failed)} couldn't be updated (deleted or no longer available). Reload to check.`,
      data: result,
    };
  }
  return { ok: true, message: `${plural(result.updated)} ${label}`, data: result };
}
