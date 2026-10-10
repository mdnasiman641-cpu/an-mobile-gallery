"use server";

import { z } from "zod";
import { getPublicClient } from "@/lib/supabase/public";
import { bdPhone } from "@/lib/validation";
import type { TrackingResult } from "@/lib/couriers";
import type { ActionResult } from "@/types";

const schema = z.object({
  order_number: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => /^[A-Z]{2,6}-\d{6}-\d{1,10}$/.test(v), "Enter the order number exactly as shown in your confirmation (e.g. AMG-261010-1001)."),
  phone: bdPhone,
});

/**
 * Public order tracking. The database function checks that the order number
 * and the mobile number used for the order match, limits wrong guesses, and
 * returns only what the customer may see (no name, address or notes). Wrong
 * order number and wrong phone get the same answer.
 */
export async function trackOrderAction(input: unknown): Promise<ActionResult<TrackingResult>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Please check the details." };
  const supabase = getPublicClient();
  if (!supabase) return { ok: false, message: "Order tracking is not available right now. Please call us." };
  const { data, error } = await supabase.rpc("track_order", { p_order_number: parsed.data.order_number, p_phone: parsed.data.phone });
  if (error) {
    if (error.code === "P0001") return { ok: false, message: error.message };
    return { ok: false, message: "Order tracking is not available right now. Please try again later or call us." };
  }
  if (!data) return { ok: false, message: "We couldn't find an order with that order number and mobile number. Check both and try again." };
  return { ok: true, data: data as TrackingResult };
}
