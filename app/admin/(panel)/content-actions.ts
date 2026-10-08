"use server";

import { z } from "zod";
import { assertStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { invalidateContent, invalidateProduct } from "@/lib/cache";
import { bannerSchema, couponSchema, firstFieldErrors } from "@/lib/validation";
import type { ActionResult } from "@/types";

/** datetime-local value ("2026-10-08T10:00") entered in Bangladesh time -> ISO. */
function dhakaToIso(v: string | null | undefined): string | null {
  if (!v) return null;
  const withTz = /[zZ]|[+-]\d{2}:\d{2}$/.test(v) ? v : `${v.length === 16 ? `${v}:00` : v}+06:00`;
  const d = new Date(withTz);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const uuid = z.string().uuid();

// ------------------------------------------------------------------ coupons
export async function saveCouponAction(id: string | null, values: unknown): Promise<ActionResult> {
  const session = await assertStaff("admin");
  if ("error" in session) return { ok: false, message: session.error };
  const parsed = couponSchema.safeParse(values);
  if (!parsed.success) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: firstFieldErrors(parsed.error) };
  const row = { ...parsed.data, starts_at: dhakaToIso(parsed.data.starts_at), ends_at: dhakaToIso(parsed.data.ends_at) };
  if (row.starts_at && row.ends_at && row.ends_at <= row.starts_at) {
    return { ok: false, message: "The end date must be after the start date.", fieldErrors: { ends_at: "Must be after the start" } };
  }
  const supabase = await createClient();
  const { error } = id && uuid.safeParse(id).success
    ? await supabase.from("coupons").update(row).eq("id", id)
    : await supabase.from("coupons").insert(row);
  if (error) {
    if (error.code === "23505") return { ok: false, message: "That coupon code already exists.", fieldErrors: { code: "Already exists" } };
    return { ok: false, message: "The coupon couldn't be saved." };
  }
  return { ok: true, message: id ? "Coupon saved" : "Coupon created" };
}

export async function deleteCouponAction(id: string): Promise<ActionResult> {
  const session = await assertStaff("admin");
  if ("error" in session) return { ok: false, message: session.error };
  const supabase = await createClient();
  const { error } = await supabase.from("coupons").delete().eq("id", id);
  if (error) return { ok: false, message: "The coupon couldn't be deleted." };
  return { ok: true, message: "Coupon deleted" };
}

// ------------------------------------------------------------------ banners
export async function saveBannerAction(id: string | null, values: unknown): Promise<ActionResult> {
  const session = await assertStaff("editor");
  if ("error" in session) return { ok: false, message: session.error };
  const parsed = bannerSchema.safeParse(values);
  if (!parsed.success) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: firstFieldErrors(parsed.error) };
  const row = { ...parsed.data, starts_at: dhakaToIso(parsed.data.starts_at), ends_at: dhakaToIso(parsed.data.ends_at) };
  const supabase = await createClient();
  const { error } = id && uuid.safeParse(id).success
    ? await supabase.from("banners").update(row).eq("id", id)
    : await supabase.from("banners").insert(row);
  if (error) return { ok: false, message: "The banner couldn't be saved." };
  invalidateContent();
  return { ok: true, message: id ? "Banner saved" : "Banner added" };
}

export async function deleteBannerAction(id: string): Promise<ActionResult> {
  const session = await assertStaff("editor");
  if ("error" in session) return { ok: false, message: session.error };
  const supabase = await createClient();
  const { error } = await supabase.from("banners").delete().eq("id", id);
  if (error) return { ok: false, message: "The banner couldn't be deleted." };
  invalidateContent();
  return { ok: true, message: "Banner deleted" };
}

// -------------------------------------------------------------------- pages
const pageSchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9-]{2,80}$/, "Use lowercase letters, numbers and hyphens"),
  title: z.string().trim().min(2, "Title is required").max(150),
  content: z.string().max(50000),
  meta_title: z.string().trim().max(120).optional().transform((v) => v || null),
  meta_description: z.string().trim().max(320).optional().transform((v) => v || null),
  is_published: z.boolean(),
});

export async function savePageAction(id: string | null, values: unknown): Promise<ActionResult<{ id: string }>> {
  const session = await assertStaff("editor");
  if ("error" in session) return { ok: false, message: session.error };
  const parsed = pageSchema.safeParse(values);
  if (!parsed.success) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: firstFieldErrors(parsed.error) };
  const supabase = await createClient();
  const res = id && uuid.safeParse(id).success
    ? await supabase.from("pages").update(parsed.data).eq("id", id).select("id").single()
    : await supabase.from("pages").insert(parsed.data).select("id").single();
  if (res.error) {
    if (res.error.code === "23505") return { ok: false, message: "Another page already uses this URL.", fieldErrors: { slug: "Already in use" } };
    return { ok: false, message: "The page couldn't be saved." };
  }
  invalidateContent();
  return { ok: true, message: "Page saved", data: { id: (res.data as { id: string }).id } };
}

export async function deletePageAction(id: string): Promise<ActionResult> {
  const session = await assertStaff("admin");
  if ("error" in session) return { ok: false, message: session.error };
  const supabase = await createClient();
  const { error } = await supabase.from("pages").delete().eq("id", id);
  if (error) return { ok: false, message: "The page couldn't be deleted." };
  invalidateContent();
  return { ok: true, message: "Page deleted" };
}

// ------------------------------------------------------- site & SEO settings
const text = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);
const url = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) => v || null)
  .refine((v) => !v || /^https?:\/\//.test(v), "Must start with https://");

const siteSchema = z.object({
  store_name: z.string().trim().min(2, "Store name is required").max(80),
  store_name_bn: text(80),
  tagline: text(160),
  tagline_bn: text(160),
  logo_url: text(1000),
  phone: text(30),
  whatsapp: text(30),
  email: z.string().trim().max(120).optional().transform((v) => v || null).refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Enter a valid email"),
  address: text(300),
  address_bn: text(300),
  map_url: url,
  facebook_url: url,
  instagram_url: url,
  youtube_url: url,
  tiktok_url: url,
  opening_hours: text(120),
  delivery_charge_inside_dhaka: z.coerce.number().min(0).max(10000),
  delivery_charge_outside_dhaka: z.coerce.number().min(0).max(10000),
  free_delivery_threshold: z.coerce.number().min(0).max(10_000_000),
  currency: z.string().trim().regex(/^[A-Z]{3}$/, "Use a 3-letter code like BDT"),
  currency_symbol: z.string().trim().min(1).max(4),
  return_days: z.coerce.number().int().min(0).max(365),
  return_policy: text(5000),
  shipping_note: text(1000),
});

export async function saveSiteSettingsAction(values: unknown): Promise<ActionResult> {
  const session = await assertStaff("admin");
  if ("error" in session) return { ok: false, message: session.error };
  const parsed = siteSchema.safeParse(values);
  if (!parsed.success) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: firstFieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("site_settings").update(parsed.data).eq("id", 1);
  if (error) return { ok: false, message: "Settings couldn't be saved." };
  invalidateContent();
  invalidateProduct(); // delivery charges & store name appear on product pages
  return { ok: true, message: "Settings saved" };
}

const seoSchema = z.object({
  site_title: z.string().trim().min(2, "Site title is required").max(120),
  site_description: z.string().trim().min(20, "Write at least 20 characters").max(320),
  default_keywords: text(500),
  default_og_image: text(1000),
  google_site_verification: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => {
      // accept either the token or the full <meta ... content="TOKEN"> tag
      const m = v?.match(/content=["']([^"']+)["']/);
      return (m ? m[1] : v) || null;
    }),
  facebook_domain_verification: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => {
      const m = v?.match(/content=["']([^"']+)["']/);
      return (m ? m[1] : v) || null;
    }),
  twitter_handle: z.string().trim().max(40).optional().transform((v) => (v ? (v.startsWith("@") ? v : `@${v}`) : null)),
  organization_name: text(120),
  organization_legal_name: text(160),
  organization_logo: text(1000),
  organization_founding_year: z
    .union([z.literal(""), z.null(), z.undefined(), z.coerce.number().int().min(1950).max(2100)])
    .transform((v) => (v === "" || v === null || v === undefined ? null : Number(v))),
});

export async function saveSeoSettingsAction(values: unknown): Promise<ActionResult> {
  const session = await assertStaff("admin");
  if ("error" in session) return { ok: false, message: session.error };
  const parsed = seoSchema.safeParse(values);
  if (!parsed.success) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: firstFieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("seo_settings").update(parsed.data).eq("id", 1);
  if (error) return { ok: false, message: "SEO settings couldn't be saved." };
  invalidateContent();
  return { ok: true, message: "SEO settings saved" };
}
