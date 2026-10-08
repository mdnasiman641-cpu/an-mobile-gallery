"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { assertStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { invalidateStock } from "@/lib/cache";
import type { ActionResult } from "@/types";

const schema = z.object({
  id: z.string().uuid(),
  status: z.enum(["pending", "confirmed", "processing", "shipped", "delivered", "cancelled"]),
  payment_status: z.enum(["unpaid", "paid", "partially_paid", "refunded"]),
  admin_note: z.string().trim().max(1000).optional(),
});

export async function updateOrderAction(input: unknown): Promise<ActionResult> {
  const session = await assertStaff("admin");
  if ("error" in session) return { ok: false, message: session.error };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid order update." };
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_order", {
    p_order_id: d.id,
    p_status: d.status,
    p_payment_status: d.payment_status,
    p_admin_note: d.admin_note ?? null,
  });
  if (error) return { ok: false, message: error.code === "P0001" ? error.message : "The order couldn't be updated." };

  if (d.status === "cancelled") {
    // stock was returned: refresh those product pages
    const { data } = await supabase.from("order_items").select("product_slug").eq("order_id", d.id);
    invalidateStock(((data ?? []) as { product_slug: string | null }[]).map((r) => r.product_slug));
  }
  revalidatePath(`/admin/orders/${d.id}`);
  return { ok: true, message: d.status === "cancelled" ? "Order cancelled and stock returned" : "Order updated" };
}
