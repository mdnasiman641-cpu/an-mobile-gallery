/**
 * Couriers, shipment statuses and what a customer sees.
 * Plain data (no secrets); used by the admin panel, the tracking page and
 * the server. Keep the status list in sync with migration 0014.
 */

export const COURIERS = [
  { key: "pathao", name: "Pathao" },
  { key: "steadfast", name: "Steadfast" },
  { key: "redx", name: "RedX" },
  { key: "paperfly", name: "Paperfly" },
  { key: "ecourier", name: "eCourier" },
  { key: "sundarban", name: "Sundarban Courier" },
  { key: "sa_paribahan", name: "SA Paribahan" },
  { key: "other", name: "Other" },
] as const;
export type CourierKey = (typeof COURIERS)[number]["key"];

export const SHIPMENT_STATUSES = [
  "pending",
  "created",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "failed_delivery",
  "on_hold",
  "returned",
  "cancelled",
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const SHIPMENT_STATUS_LABEL: Record<ShipmentStatus, string> = {
  pending: "Sending to courier",
  created: "Handed to courier",
  picked_up: "Picked up",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  failed_delivery: "Delivery attempt failed",
  on_hold: "On hold",
  returned: "Returned",
  cancelled: "Shipment cancelled",
};

/** Statuses an admin can set by hand (pending is internal; created is set when the shipment is saved). */
export const MANUAL_NEXT_STATUSES: ShipmentStatus[] = ["picked_up", "in_transit", "out_for_delivery", "delivered", "failed_delivery", "on_hold", "returned", "cancelled"];

export const FINAL_SHIPMENT_STATUSES: ShipmentStatus[] = ["delivered", "returned", "cancelled"];

export type OrderStatusKey = "pending" | "confirmed" | "processing" | "shipped" | "delivered" | "cancelled";

/** The steps shown to customers. */
export const TRACKING_STEPS = ["Order placed", "Confirmed", "Processing", "Shipped", "In transit", "Out for delivery", "Delivered"] as const;

/**
 * One customer-facing status from the order status and the shipment status.
 * "Delivered" is shown only when the order or shipment is delivered (set by an
 * admin or a verified courier update), never inferred.
 */
export function customerStatus(order: OrderStatusKey, shipment: ShipmentStatus | null): { label: string; step: number; tone: "signal" | "warn" | "deal" | "neutral" } {
  if (order === "cancelled") return { label: "Cancelled", step: -1, tone: "deal" };
  if (order === "delivered" || shipment === "delivered") return { label: "Delivered", step: 6, tone: "signal" };
  if (shipment === "returned") return { label: "Returned", step: -1, tone: "deal" };
  if (order === "shipped" || (shipment && shipment !== "pending" && shipment !== "cancelled")) {
    if (shipment === "out_for_delivery") return { label: "Out for delivery", step: 5, tone: "signal" };
    if (shipment === "in_transit" || shipment === "picked_up") return { label: "In transit", step: 4, tone: "signal" };
    if (shipment === "failed_delivery") return { label: "Delivery attempt failed — the courier will contact you", step: 4, tone: "warn" };
    if (shipment === "on_hold") return { label: "Shipment on hold", step: 4, tone: "warn" };
    return { label: "Shipped", step: 3, tone: "signal" };
  }
  if (order === "processing") return { label: "Processing", step: 2, tone: "signal" };
  if (order === "confirmed") return { label: "Confirmed", step: 1, tone: "signal" };
  return { label: "Order placed", step: 0, tone: "neutral" };
}

/** Pathao webhook events → our shipment status (null = informational only). From Pathao's official plugin. */
export const PATHAO_EVENT_STATUS: Record<string, ShipmentStatus | null> = {
  "order.created": null,
  "order.updated": null,
  "order.pickup-requested": null,
  "order.assigned-for-pickup": null,
  "order.picked": "picked_up",
  "order.pickup-failed": "on_hold",
  "order.pickup-cancelled": "cancelled",
  "order.at-the-sorting-hub": "in_transit",
  "order.in-transit": "in_transit",
  "order.received-at-last-mile-hub": "in_transit",
  "order.assigned-for-delivery": "out_for_delivery",
  "order.delivered": "delivered",
  "order.partial-delivery": null, // needs a person to decide; recorded as the courier status
  "order.returned": "returned",
  "order.paid-return": "returned",
  "order.delivery-failed": "failed_delivery",
  "order.on-hold": "on_hold",
  "order.exchanged": null,
  "order.paid": null,
};

export function isSafeTrackingUrl(url: string): boolean {
  return /^https:\/\/[^\s]+$/.test(url) && url.length <= 500;
}

export function courierName(key: string): string {
  return COURIERS.find((c) => c.key === key)?.name ?? key;
}

/** A shipment as the admin panel shows it. */
export interface ShipmentRow {
  id: string;
  order_id: string;
  courier: string;
  courier_name: string;
  source: "manual" | "api";
  consignment_id: string | null;
  tracking_reference: string | null;
  tracking_url: string | null;
  status: ShipmentStatus;
  is_active: boolean;
  shipped_at: string;
  cod_amount: number | string | null;
  courier_fee: number | string | null;
  note: string | null;
  provider_status: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShipmentEventRow {
  id: string;
  shipment_id: string;
  status: ShipmentStatus;
  source: "manual" | "api" | "webhook";
  provider_status: string | null;
  note: string | null;
  occurred_at: string;
}

export const SHIPMENT_COLUMNS =
  "id, order_id, courier, courier_name, source, consignment_id, tracking_reference, tracking_url, status, is_active, shipped_at, cod_amount, courier_fee, note, provider_status, last_error, created_at, updated_at";

/** What track_order() returns: only what the customer may see. */
export interface TrackingResult {
  order_number: string;
  status: OrderStatusKey;
  placed_at: string;
  updated_at: string;
  total: number | string;
  delivery_zone: "inside_dhaka" | "outside_dhaka" | "store_pickup";
  items: { name: string; variant: string | null; quantity: number }[];
  shipment: {
    courier_name: string;
    consignment_id: string | null;
    tracking_reference: string | null;
    tracking_url: string | null;
    status: ShipmentStatus;
    active: boolean;
    shipped_at: string;
    events: { status: ShipmentStatus; at: string }[];
  } | null;
}
