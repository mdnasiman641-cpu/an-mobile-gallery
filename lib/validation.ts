import { z } from "zod";
import { MEMORY_SPEC_NAME, withMemoryUnit } from "@/lib/utils";

// Shared input validation (server actions validate everything again here,
// and the database enforces its own constraints on top).

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const money = z.coerce.number().min(0, "Price can't be negative").max(100_000_000);
const optionalMoney = z
  .union([z.literal(""), z.null(), z.undefined(), z.coerce.number().min(0).max(100_000_000)])
  .transform((v) => (v === "" || v === null || v === undefined ? null : Number(v)));

export const bdPhone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, "").replace(/^\+?88/, ""))
  .refine((v) => /^01[3-9]\d{8}$/.test(v), "Enter a valid Bangladeshi mobile number (01XXXXXXXXX)");

export const productSchema = z
  .object({
    name: z.string().trim().min(2, "Product name is required").max(200),
    slug: optionalText(140),
    model: optionalText(120),
    brand_id: z.string().uuid().nullable().or(z.literal("").transform(() => null)),
    category_id: z.string().uuid().nullable().or(z.literal("").transform(() => null)),
    sku: optionalText(80),
    barcode: optionalText(32),
    mpn: optionalText(80),
    short_description: optionalText(500),
    description: optionalText(20000),
    price: money,
    sale_price: optionalMoney,
    cost_price: optionalMoney,
    stock_quantity: z.coerce.number().int().min(0).max(1_000_000),
    low_stock_threshold: z.coerce.number().int().min(0).max(10_000),
    condition: z.enum(["new", "used", "refurbished"]),
    status: z.enum(["active", "draft", "out_of_stock", "archived"]),
    featured: z.boolean(),
    is_new: z.boolean(),
    is_offer: z.boolean(),
    is_best_seller: z.boolean(),
    warranty: optionalText(200),
    meta_title: optionalText(120),
    meta_description: optionalText(320),
    canonical_url: optionalText(500).refine((v) => !v || /^https?:\/\//.test(v), "Canonical URL must start with https://"),
  })
  .refine((d) => d.sale_price === null || d.sale_price < d.price, {
    message: "Sale price must be lower than the regular price",
    path: ["sale_price"],
  });

export const variantSchema = z
  .object({
    id: z.string().uuid().optional().nullable(),
    sku: optionalText(80),
    // "6" → "6GB" so cards, filters and specs show the same unit
    storage: optionalText(40).transform((v) => (v ? withMemoryUnit(v) : v)),
    ram: optionalText(40).transform((v) => (v ? withMemoryUnit(v) : v)),
    color: optionalText(60),
    color_hex: z
      .string()
      .trim()
      .regex(/^#[0-9A-Fa-f]{6}$/, "Colour must look like #1A2B3C")
      .optional()
      .or(z.literal("").transform(() => undefined))
      .transform((v) => v ?? null),
    price: money,
    sale_price: optionalMoney,
    stock: z.coerce.number().int().min(0).max(1_000_000),
    image_url: optionalText(1000),
    status: z.enum(["active", "inactive"]),
  })
  .refine((d) => d.sale_price === null || d.sale_price < d.price, {
    message: "Variant sale price must be lower than its price",
    path: ["sale_price"],
  })
  .refine((d) => d.storage || d.ram || d.color, {
    message: "Give each variant at least a storage, RAM or colour",
    path: ["storage"],
  });

export const specSchema = z
  .object({
    group_name: z.string().trim().max(60).default("General").transform((v) => v || "General"),
    name: z.string().trim().min(1, "Specification name is required").max(80),
    value: z.string().trim().min(1, "Specification value is required").max(500),
  })
  // RAM "6" / Storage "128" are saved as 6GB / 128GB
  .transform((s) => (MEMORY_SPEC_NAME.test(s.name) ? { ...s, value: withMemoryUnit(s.value) } : s));

export const featureSchema = z.string().trim().min(1).max(300);

export const taxonomySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  slug: optionalText(120),
  description: optionalText(2000),
  meta_title: optionalText(120),
  meta_description: optionalText(320),
  is_featured: z.boolean(),
  is_active: z.boolean(),
  sort_order: z.coerce.number().int().min(-1000).max(10000),
  parent_id: z.string().uuid().nullable().optional(),
});

export const bannerSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(120),
  subtitle: optionalText(240),
  image_url: z.string().trim().min(1, "Upload a banner image"),
  // Nullable in the database and not editable in the banner form, so an
  // existing banner sends null here; it is carried through unchanged.
  mobile_image_url: z
    .string()
    .trim()
    .max(1000)
    .nullish()
    .transform((v) => v || null),
  button_text: optionalText(40),
  button_url: optionalText(500).refine((v) => !v || v.startsWith("/") || /^https?:\/\//.test(v), "Link must start with / or https://"),
  placement: z.enum(["hero", "promo"]),
  is_active: z.boolean(),
  sort_order: z.coerce.number().int().min(0).max(1000),
  starts_at: optionalText(40),
  ends_at: optionalText(40),
});

export const couponSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{3,30}$/, "Use 3–30 letters, numbers, - or _"),
    description: optionalText(200),
    discount_type: z.enum(["percent", "fixed"]),
    discount_value: z.coerce.number().positive("Discount must be more than 0"),
    min_order_amount: z.coerce.number().min(0).default(0),
    max_discount_amount: optionalMoney,
    starts_at: optionalText(40),
    ends_at: optionalText(40),
    usage_limit: z
      .union([z.literal(""), z.null(), z.undefined(), z.coerce.number().int().positive()])
      .transform((v) => (v === "" || v === null || v === undefined ? null : Number(v))),
    is_active: z.boolean(),
  })
  .refine((d) => d.discount_type !== "percent" || d.discount_value <= 100, {
    message: "A percentage discount can't be more than 100",
    path: ["discount_value"],
  });

export const checkoutSchema = z.object({
  /** One random id per checkout attempt: a retry never creates a second order. */
  request_id: z.string().uuid().optional(),
  customer_name: z.string().trim().min(2, "Enter your full name").max(100),
  phone: bdPhone,
  email: z
    .string()
    .trim()
    .email("Enter a valid email or leave it empty")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  address: z.string().trim().max(500),
  city: optionalText(80),
  area: optionalText(80),
  delivery_zone: z.enum(["inside_dhaka", "outside_dhaka", "store_pickup"]),
  note: optionalText(500),
  coupon_code: optionalText(30),
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        variant_id: z.string().uuid().nullable(),
        quantity: z.number().int().min(1).max(10),
        // only used to refresh that product's cached page; must look like a slug
        slug: z.string().max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional().catch(undefined),
      }),
    )
    .min(1, "Your cart is empty")
    .max(20),
});

export const reviewSchema = z.object({
  product_id: z.string().uuid(),
  rating: z.coerce.number().int().min(1, "Choose a rating").max(5),
  title: optionalText(120),
  body: z.string().trim().min(10, "Write at least 10 characters").max(2000),
});

export function firstFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
