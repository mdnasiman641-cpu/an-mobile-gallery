"use server";

import { z } from "zod";
import { assertStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { invalidateProduct } from "@/lib/cache";
import type { ActionResult } from "@/types";

const schema = z.object({
  product_id: z.string().uuid(),
  variant_id: z.string().uuid().nullable(),
  change: z.coerce.number().int().refine((n) => n !== 0, "Enter a quantity other than 0").refine((n) => Math.abs(n) <= 100000, "Quantity is too large"),
  reason: z.enum(["restock", "return", "adjustment", "damage"]),
  note: z.string().trim().max(200).optional(),
});

export async function adjustStockAction(input: unknown): Promise<ActionResult<{ stock: number }>> {
  const session = await assertStaff("editor");
  if ("error" in session) return { ok: false, message: session.error };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid quantity." };
  const d = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_adjust_stock", {
    p_product_id: d.product_id,
    p_variant_id: d.variant_id,
    p_change: d.change,
    p_reason: d.reason,
    p_note: d.note ?? null,
  });
  if (error) return { ok: false, message: error.code === "P0001" ? error.message : "Stock couldn't be updated." };

  const { data: product } = await supabase.from("products").select("slug").eq("id", d.product_id).single();
  invalidateProduct([(product as { slug: string } | null)?.slug]);
  return { ok: true, message: `Stock updated to ${data as number}`, data: { stock: data as number } };
}
