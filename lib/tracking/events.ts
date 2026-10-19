import { z } from "zod";

/**
 * One internal event schema for every destination (GTM dataLayer, GA4, Meta
 * Pixel / Conversions API, Google Ads). Names and parameters follow GA4's
 * recommended ecommerce events; adapters.ts turns an event into each
 * destination's format, so GA4 and Meta never carry separate business logic.
 *
 * Only actions the website really has are tracked. Not tracked because the
 * feature doesn't exist (no fake buttons were added): lead / contact forms,
 * EMI inquiry form, store locator, promotion impressions.
 *
 * Plain logic (no secrets): used in the browser and on the server.
 */

export const TRACKED_EVENTS = [
  "view_item_list",
  "select_item",
  "view_item",
  "search",
  "add_to_wishlist",
  "add_to_cart",
  "remove_from_cart",
  "view_cart",
  "begin_checkout",
  "add_shipping_info",
  "add_payment_info",
  "purchase",
  "refund",
  "phone_click",
  "whatsapp_click",
  "add_to_compare",
] as const;
export type TrackedEvent = (typeof TRACKED_EVENTS)[number];

/** Shown in Admin → Analytics & Tracking → Event routing. */
export const EVENT_INFO: Record<TrackedEvent, { label: string; where: string; ecommerce: boolean }> = {
  view_item_list: { label: "View product list", where: "Category, brand, search and offer listings", ecommerce: true },
  select_item: { label: "Select product", where: "Clicking a product card", ecommerce: true },
  view_item: { label: "View product", where: "Product page", ecommerce: true },
  search: { label: "Search", where: "Search results page", ecommerce: false },
  add_to_wishlist: { label: "Add to wishlist", where: "Heart button", ecommerce: true },
  add_to_cart: { label: "Add to cart", where: "Add to cart / Buy now", ecommerce: true },
  remove_from_cart: { label: "Remove from cart", where: "Cart page", ecommerce: true },
  view_cart: { label: "View cart", where: "Cart page", ecommerce: true },
  begin_checkout: { label: "Begin checkout", where: "Checkout page opened with items", ecommerce: true },
  add_shipping_info: { label: "Add shipping info", where: "Delivery area chosen at checkout", ecommerce: true },
  add_payment_info: { label: "Add payment info", where: "Order submitted with Cash on Delivery (before the result)", ecommerce: true },
  purchase: { label: "Purchase", where: "Order successfully placed (server-confirmed)", ecommerce: true },
  refund: { label: "Refund", where: "Order cancelled or marked refunded by an admin (server only)", ecommerce: true },
  phone_click: { label: "Phone call click", where: "Any tel: link", ecommerce: false },
  whatsapp_click: { label: "WhatsApp click", where: "Any WhatsApp link (incl. EMI / exchange banners)", ecommerce: false },
  add_to_compare: { label: "Add to compare", where: "Compare button on a product", ecommerce: false },
};

/** Events whose browser copy may also be sent to Meta from the server (same event_id). */
export const SERVER_COPY_EVENTS: readonly TrackedEvent[] = ["view_item", "search", "add_to_wishlist", "add_to_cart", "begin_checkout", "add_payment_info", "phone_click", "whatsapp_click"];

export const CURRENCY = "BDT";

export interface TrackItem {
  item_id: string;
  item_name: string;
  item_brand?: string;
  item_category?: string;
  item_variant?: string;
  /** Unit price actually charged; omitted when the page doesn't know it (never guessed). */
  price?: number;
  quantity: number;
  index?: number;
}

export interface TrackEvent {
  name: TrackedEvent;
  /** One id per logical event, shared by the browser and server copies (Meta deduplication). */
  event_id: string;
  currency?: typeof CURRENCY;
  value?: number;
  items?: TrackItem[];
  transaction_id?: string;
  search_term?: string;
  item_list_id?: string;
  item_list_name?: string;
  shipping_tier?: string;
  payment_type?: string;
  coupon?: string;
  shipping?: number;
  discount?: number;
  /** Contact method for phone / WhatsApp clicks. */
  method?: "phone" | "whatsapp";
  /** Page where it happened (server copies). */
  page_location?: string;
}

const money = z.number().finite().min(0).max(100_000_000);
const text = (max: number) => z.string().trim().min(1).max(max);

export const trackItemSchema = z.object({
  item_id: text(64),
  item_name: text(200),
  item_brand: text(80).optional(),
  item_category: text(80).optional(),
  item_variant: text(120).optional(),
  price: money.optional(),
  quantity: z.number().int().min(1).max(100),
  index: z.number().int().min(0).max(500).optional(),
});

export const EVENT_ID_RE = /^[a-z_]{3,40}\.[A-Za-z0-9-]{6,60}$/;

export const trackEventSchema = z.object({
  name: z.enum(TRACKED_EVENTS),
  event_id: z.string().regex(EVENT_ID_RE),
  currency: z.literal(CURRENCY).optional(),
  value: money.optional(),
  items: z.array(trackItemSchema).max(50).optional(),
  transaction_id: text(60).optional(),
  search_term: text(100).optional(),
  item_list_id: text(80).optional(),
  item_list_name: text(120).optional(),
  shipping_tier: text(60).optional(),
  payment_type: text(60).optional(),
  coupon: text(30).optional(),
  shipping: money.optional(),
  discount: money.optional(),
  method: z.enum(["phone", "whatsapp"]).optional(),
  page_location: z.string().url().max(500).optional(),
});

/** Random event id ("add_to_cart.k3J9…"), created once per logical event. */
export function newEventId(name: TrackedEvent): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const id = Array.from(bytes, (b) => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[b % 62]).join("");
  return `${name}.${id}`;
}

/**
 * Stable ids for order events: the browser Purchase and the server Purchase
 * of the same order always carry the same id, and a repeat never makes a new one.
 */
export function purchaseEventId(orderNumber: string): string {
  return `purchase.${orderNumber.replace(/[^A-Za-z0-9-]/g, "")}`;
}
export function refundEventId(orderNumber: string): string {
  return `refund.${orderNumber.replace(/[^A-Za-z0-9-]/g, "")}`;
}

/** Event value: sum of item price × quantity (what the shop really charges for those items). */
export function itemsValue(items: TrackItem[]): number | undefined {
  if (!items.length || items.some((i) => i.price === undefined)) return undefined;
  return Math.round(items.reduce((n, i) => n + (i.price ?? 0) * i.quantity, 0) * 100) / 100;
}

/** Item id used everywhere: the chosen variant's id, else the product's id. */
export function itemId(productId: string, variantId: string | null | undefined): string {
  return variantId || productId;
}
