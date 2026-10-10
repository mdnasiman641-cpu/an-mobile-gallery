"use server";

// Admin-only: the client calls router.refresh() after these actions, so they
// don't call revalidatePath() (that re-renders the page inside the action
// request and doubles the CPU on Workers). All rules (one active shipment per
// order, unique consignment IDs, order status sync, admin-only) are enforced
// again in the database functions of migration 0014.

import { z } from "zod";
import { assertStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { COURIERS, MANUAL_NEXT_STATUSES, isSafeTrackingUrl } from "@/lib/couriers";
import { CourierApiError } from "@/lib/couriers/pathao";
import { pathaoClient } from "@/lib/couriers/config";
import type { ActionResult } from "@/types";

const COURIER_KEYS = COURIERS.map((c) => c.key) as [string, ...string[]];
const uuid = z.string().uuid();
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));
const trackingUrl = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isSafeTrackingUrl(v), "The tracking link must start with https://");
// The browser sends an ISO time; a missing value means "now".
const pastTime = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || !Number.isNaN(Date.parse(v)), "Enter a valid date and time")
  .refine((v) => v === null || Date.parse(v) <= Date.now() + 10 * 60_000, "The time can't be in the future");

function dbMessage(error: { code?: string; message: string } | null, fallback: string): string {
  if (!error) return fallback;
  if (error.code === "P0001" || error.code === "42501") return error.message;
  if (/function .* does not exist|relation .* does not exist|schema cache/i.test(error.message)) {
    return "Shipments need database migration 0014. Run it in Supabase (see docs/DEPLOY-CLOUDFLARE.md).";
  }
  return fallback;
}

async function admin() {
  const session = await assertStaff("admin");
  return "error" in session ? { error: session.error } : { session };
}

// ---------------------------------------------------------------- manual -----

const manualSchema = z
  .object({
    order_id: uuid,
    courier: z.enum(COURIER_KEYS),
    courier_name: optText(60),
    consignment_id: optText(80),
    tracking_reference: optText(120),
    tracking_url: trackingUrl,
    shipped_at: pastTime,
    cod_amount: z
      .union([z.literal(""), z.null(), z.undefined(), z.coerce.number().min(0).max(10_000_000)])
      .transform((v) => (v === "" || v === null || v === undefined ? null : Number(v))),
    note: optText(1000),
  })
  .refine((d) => d.consignment_id || d.tracking_reference, { message: "Enter the consignment ID or a tracking reference.", path: ["consignment_id"] })
  .refine((d) => d.courier !== "other" || (d.courier_name && d.courier_name.length >= 2), { message: "Enter the courier's name.", path: ["courier_name"] });

export async function createManualShipmentAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const a = await admin();
  if ("error" in a) return { ok: false, message: a.error };
  const parsed = manualSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Please check the shipment details." };
  const d = parsed.data;
  const name = d.courier === "other" ? (d.courier_name as string) : (COURIERS.find((c) => c.key === d.courier)?.name ?? d.courier);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_create_shipment", {
    p_order_id: d.order_id,
    p_courier: d.courier,
    p_courier_name: name,
    p_consignment_id: d.consignment_id,
    p_tracking_reference: d.tracking_reference,
    p_tracking_url: d.tracking_url,
    p_shipped_at: d.shipped_at,
    p_cod_amount: d.cod_amount,
    p_note: d.note,
    p_source: "manual",
  });
  if (error || !data) return { ok: false, message: dbMessage(error, "The shipment couldn't be saved.") };
  return { ok: true, message: "Shipment saved. The order is now marked shipped.", data: { id: data as string } };
}

// ---------------------------------------------------------------- status -----

const statusSchema = z.object({
  shipment_id: uuid,
  status: z.enum(MANUAL_NEXT_STATUSES as [string, ...string[]]),
  note: optText(500),
  occurred_at: pastTime,
});

export async function updateShipmentStatusAction(input: unknown): Promise<ActionResult> {
  const a = await admin();
  if ("error" in a) return { ok: false, message: a.error };
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid status update." };
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_shipment_status", {
    p_shipment_id: d.shipment_id,
    p_status: d.status,
    p_note: d.note,
    p_occurred_at: d.occurred_at,
  });
  if (error) return { ok: false, message: dbMessage(error, "The status couldn't be updated.") };
  const msg =
    d.status === "delivered"
      ? "Marked delivered. The order is now delivered."
      : d.status === "cancelled"
        ? "Shipment cancelled. You can create a new one for this order."
        : "Shipment status updated";
  return { ok: true, message: msg };
}

// ------------------------------------------------------------ correction -----

const correctSchema = z
  .object({
    shipment_id: uuid,
    consignment_id: optText(80),
    tracking_reference: optText(120),
    tracking_url: trackingUrl,
    reason: z.string().trim().min(3, "Give a short reason for the correction.").max(300),
  })
  .refine((d) => d.consignment_id || d.tracking_reference, { message: "Enter the consignment ID or a tracking reference.", path: ["consignment_id"] });

export async function correctShipmentAction(input: unknown): Promise<ActionResult> {
  const a = await admin();
  if ("error" in a) return { ok: false, message: a.error };
  const parsed = correctSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Please check the details." };
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_correct_shipment", {
    p_shipment_id: d.shipment_id,
    p_consignment_id: d.consignment_id,
    p_tracking_reference: d.tracking_reference,
    p_tracking_url: d.tracking_url,
    p_reason: d.reason,
  });
  if (error) return { ok: false, message: dbMessage(error, "The correction couldn't be saved.") };
  return { ok: true, message: "Shipment details corrected (the old value is kept in the history)" };
}

// ------------------------------------- API shipment waiting for an answer -----

const resolveSchema = z.discriminatedUnion("outcome", [
  z.object({ shipment_id: uuid, outcome: z.literal("found"), consignment_id: z.string().trim().min(1, "Enter the consignment ID from the Pathao panel.").max(80) }),
  z.object({ shipment_id: uuid, outcome: z.literal("not_created") }),
]);

/**
 * When Pathao didn't answer clearly, the shipment stays "Sending to courier"
 * so nobody sends the parcel twice. After checking the Pathao panel the admin
 * records the consignment ID, or releases the reservation.
 */
export async function resolvePendingShipmentAction(input: unknown): Promise<ActionResult> {
  const a = await admin();
  if ("error" in a) return { ok: false, message: a.error };
  const parsed = resolveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_complete_api_shipment", {
    p_shipment_id: d.shipment_id,
    p_ok: d.outcome === "found",
    p_consignment_id: d.outcome === "found" ? d.consignment_id : null,
    p_courier_fee: null,
    p_provider_status: null,
    p_error: d.outcome === "found" ? null : "Not created at the courier (checked by staff)",
  });
  if (error) return { ok: false, message: dbMessage(error, "Couldn't update the shipment.") };
  return { ok: true, message: d.outcome === "found" ? "Consignment recorded. The order is now marked shipped." : "Reservation released. You can create the shipment again." };
}

// ------------------------------------------------------------------ Pathao -----

function courierMessage(e: unknown): string {
  if (e instanceof CourierApiError) return e.message;
  return "Couldn't reach Pathao. Please try again.";
}

const lookupSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cities") }),
  z.object({ kind: z.literal("zones"), parent: z.coerce.number().int().positive() }),
  z.object({ kind: z.literal("areas"), parent: z.coerce.number().int().positive() }),
]);

/** Pathao's own city / zone / area lists (their IDs are required to create a parcel). */
export async function pathaoLookupAction(input: unknown): Promise<ActionResult<{ id: number; name: string }[]>> {
  const a = await admin();
  if ("error" in a) return { ok: false, message: a.error };
  const parsed = lookupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid lookup." };
  const c = await pathaoClient();
  if (!c.ok) return { ok: false, message: c.message };
  try {
    const d = parsed.data;
    const list = d.kind === "cities" ? await c.client.cities() : d.kind === "zones" ? await c.client.zones(d.parent) : await c.client.areas(d.parent);
    return { ok: true, data: list.map((x) => ({ id: x.id, name: x.name })) };
  } catch (e) {
    return { ok: false, message: courierMessage(e) };
  }
}

const pathaoSchema = z.object({
  order_id: uuid,
  city_id: z.coerce.number().int().positive("Choose the Pathao city."),
  zone_id: z.coerce.number().int().positive("Choose the Pathao zone."),
  area_id: z
    .union([z.literal(""), z.null(), z.undefined(), z.coerce.number().int().positive()])
    .transform((v) => (v === "" || v === null || v === undefined ? null : Number(v))),
  delivery_type: z.union([z.literal(12), z.literal(24), z.literal(48)]),
  item_type: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  item_weight: z.coerce.number().min(0.1, "Weight must be at least 0.1 kg").max(50),
  item_quantity: z.coerce.number().int().min(1).max(100),
  amount_to_collect: z.coerce.number().int("Amount to collect must be in whole taka").min(0).max(10_000_000),
  item_description: optText(250),
  special_instruction: optText(250),
});

interface OrderForParcel {
  id: string;
  order_number: string;
  customer_name: string;
  phone: string;
  address: string;
  area: string | null;
  city: string | null;
  status: string;
}

/**
 * Create the parcel at Pathao. Order of steps (so a parcel is never created twice):
 *  1. reserve the shipment in the database (fails if the order already has one)
 *  2. one request to Pathao
 *  3. record the answer; if the answer is unclear the reservation stays pending
 */
export async function createPathaoShipmentAction(input: unknown): Promise<ActionResult<{ consignmentId?: string; pending?: boolean }>> {
  const a = await admin();
  if ("error" in a) return { ok: false, message: a.error };
  const parsed = pathaoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Please check the parcel details." };
  const d = parsed.data;

  const c = await pathaoClient();
  if (!c.ok) return { ok: false, message: c.message };
  if (!c.row?.is_enabled) return { ok: false, message: "Pathao is switched off. Turn it on in Settings → Courier, or record the shipment manually." };
  if (!c.row.store_id) return { ok: false, message: "Choose the Pathao store (pickup point) in Settings → Courier." };

  const supabase = await createClient();
  const { data: orderData } = await supabase
    .from("orders")
    .select("id, order_number, customer_name, phone, address, area, city, status")
    .eq("id", d.order_id)
    .maybeSingle();
  const order = orderData as OrderForParcel | null;
  if (!order) return { ok: false, message: "Order not found." };

  // 1. reserve
  const { data: reserved, error: reserveError } = await supabase.rpc("admin_create_shipment", {
    p_order_id: order.id,
    p_courier: "pathao",
    p_courier_name: "Pathao",
    p_consignment_id: null,
    p_tracking_reference: null,
    p_tracking_url: null,
    p_shipped_at: null,
    p_cod_amount: d.amount_to_collect,
    p_note: null,
    p_source: "api",
  });
  if (reserveError || !reserved) return { ok: false, message: dbMessage(reserveError, "The shipment couldn't be reserved.") };
  const shipmentId = reserved as string;

  // 2. one request to Pathao
  const address = [order.address, order.area, order.city].filter(Boolean).join(", ");
  let result: { consignmentId: string; deliveryFee: number | null; providerStatus: string | null };
  try {
    result = await c.client.createParcel({
      merchantOrderId: order.order_number,
      recipientName: order.customer_name,
      recipientPhone: order.phone,
      recipientAddress: address,
      cityId: d.city_id,
      zoneId: d.zone_id,
      areaId: d.area_id,
      deliveryType: d.delivery_type,
      itemType: d.item_type,
      itemQuantity: d.item_quantity,
      itemWeight: d.item_weight,
      amountToCollect: d.amount_to_collect,
      itemDescription: d.item_description ?? undefined,
      specialInstruction: d.special_instruction ?? undefined,
    });
  } catch (e) {
    const message = courierMessage(e);
    if (e instanceof CourierApiError && e.ambiguous) {
      // Pathao may have created it: keep the reservation so it isn't sent twice.
      return {
        ok: false,
        data: { pending: true },
        message: `${message} Pathao may still have created the parcel. Check the Pathao panel for order ${order.order_number}, then record the consignment ID here or release the reservation.`,
      };
    }
    await supabase.rpc("admin_complete_api_shipment", {
      p_shipment_id: shipmentId,
      p_ok: false,
      p_consignment_id: null,
      p_courier_fee: null,
      p_provider_status: null,
      p_error: message.slice(0, 450),
    });
    return { ok: false, message: `Pathao didn't create the parcel: ${message}` };
  }

  // 3. record the answer
  const { error: completeError } = await supabase.rpc("admin_complete_api_shipment", {
    p_shipment_id: shipmentId,
    p_ok: true,
    p_consignment_id: result.consignmentId,
    p_courier_fee: result.deliveryFee,
    p_provider_status: result.providerStatus,
    p_error: null,
  });
  if (completeError) {
    return {
      ok: false,
      data: { consignmentId: result.consignmentId, pending: true },
      message: `Pathao created consignment ${result.consignmentId}, but saving it failed. Record it with "Record consignment ID" below.`,
    };
  }
  return { ok: true, message: `Pathao parcel created: ${result.consignmentId}`, data: { consignmentId: result.consignmentId } };
}
