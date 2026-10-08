"use server";

import { createClient } from "@/lib/supabase/server";
import { invalidateStock } from "@/lib/cache";
import { checkoutSchema, firstFieldErrors } from "@/lib/validation";
import type { ActionResult } from "@/types";

export interface OrderConfirmation {
  order_number: string;
  subtotal: number;
  discount: number;
  delivery_charge: number;
  total: number;
}

/**
 * Places an order through the place_order() database function, which
 * re-prices every item from the database, checks and reserves stock and
 * applies the coupon in one transaction. The browser's prices are ignored.
 */
export async function placeOrderAction(input: unknown): Promise<ActionResult<OrderConfirmation>> {
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Please check the highlighted fields.", fieldErrors: firstFieldErrors(parsed.error) };
  }
  const d = parsed.data;
  if (d.delivery_zone !== "store_pickup" && d.address.length < 5) {
    return { ok: false, message: "Please enter your full delivery address.", fieldErrors: { address: "Enter your full address" } };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("place_order", {
    p_order: {
      customer_name: d.customer_name,
      phone: d.phone,
      email: d.email ?? null,
      address: d.address,
      city: d.city,
      area: d.area,
      delivery_zone: d.delivery_zone,
      note: d.note,
      payment_method: "cod",
      coupon_code: d.coupon_code,
      items: d.items.map((i) => ({ product_id: i.product_id, variant_id: i.variant_id, quantity: i.quantity })),
    },
  });

  if (error) {
    // P0001 = our own checked messages from place_order(); safe to show.
    if (error.code === "P0001") return { ok: false, message: error.message };
    console.error("[checkout] place_order failed:", error);
    return { ok: false, message: "We couldn't place your order right now. Please try again or call the shop." };
  }

  // Stock changed: refresh just these product pages (and home).
  invalidateStock(d.items.map((i) => i.slug));

  const r = data as OrderConfirmation;
  return {
    ok: true,
    data: {
      order_number: r.order_number,
      subtotal: Number(r.subtotal),
      discount: Number(r.discount),
      delivery_charge: Number(r.delivery_charge),
      total: Number(r.total),
    },
  };
}

export async function checkCouponAction(code: string, subtotal: number): Promise<ActionResult<{ code: string; discount: number }>> {
  const clean = String(code ?? "").trim().toUpperCase().slice(0, 30);
  if (!clean) return { ok: false, message: "Enter a coupon code." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("validate_coupon", { p_code: clean, p_subtotal: Math.max(0, Number(subtotal) || 0) });
  if (error) return { ok: false, message: "Couldn't check this coupon right now." };
  const r = data as { valid: boolean; code: string | null; discount: number; message: string };
  if (!r.valid) return { ok: false, message: r.message };
  return { ok: true, message: r.message, data: { code: r.code ?? clean, discount: Number(r.discount) } };
}

export interface CartLineStatus {
  key: string;
  available: boolean;
  price: number;
  maxQuantity: number;
}

/**
 * Current price and stock for the items in the browser cart, read straight
 * from the database (no cache) when checkout opens, so the summary the
 * customer confirms matches what place_order() will charge.
 */
export async function refreshCartAction(
  lines: { key: string; productId: string; variantId: string | null }[],
): Promise<CartLineStatus[]> {
  const clean = lines
    .filter((l) => /^[0-9a-f-]{36}$/i.test(l.productId) && (l.variantId === null || /^[0-9a-f-]{36}$/i.test(l.variantId)))
    .slice(0, 20);
  if (!clean.length) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, price, sale_price, stock_quantity, status, product_variants(id, price, sale_price, stock, status)")
    .in("id", Array.from(new Set(clean.map((l) => l.productId))));
  if (error) return [];

  type Row = {
    id: string;
    price: number;
    sale_price: number | null;
    stock_quantity: number;
    status: string;
    product_variants: { id: string; price: number; sale_price: number | null; stock: number; status: string }[];
  };
  const rows = (data ?? []) as Row[];
  const final = (price: number, sale: number | null) => (sale !== null && Number(sale) < Number(price) ? Number(sale) : Number(price));

  return clean.map((l) => {
    const p = rows.find((r) => r.id === l.productId);
    if (!p || p.status !== "active") return { key: l.key, available: false, price: 0, maxQuantity: 0 };
    const activeVariants = p.product_variants.filter((v) => v.status === "active");
    if (l.variantId) {
      const v = activeVariants.find((x) => x.id === l.variantId);
      if (!v) return { key: l.key, available: false, price: 0, maxQuantity: 0 };
      return { key: l.key, available: v.stock > 0, price: final(v.price, v.sale_price), maxQuantity: Math.min(v.stock, 10) };
    }
    if (activeVariants.length) return { key: l.key, available: false, price: 0, maxQuantity: 0 }; // option must be chosen
    return { key: l.key, available: p.stock_quantity > 0, price: final(p.price, p.sale_price), maxQuantity: Math.min(p.stock_quantity, 10) };
  });
}
