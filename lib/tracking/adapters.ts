import { CURRENCY, type TrackEvent, type TrackItem, type TrackedEvent } from "@/lib/tracking/events";

/**
 * One internal event → each destination's format. Pure functions (tested).
 *
 * GA4 / GTM: official recommended ecommerce event names and parameters.
 * Meta: standard events where one exists; events without a Meta standard
 * equivalent are not sent to Meta (no invented custom events).
 */

const round = (n: number) => Math.round(n * 100) / 100;

export function ga4Item(i: TrackItem) {
  return {
    item_id: i.item_id,
    item_name: i.item_name,
    ...(i.item_brand ? { item_brand: i.item_brand } : {}),
    ...(i.item_category ? { item_category: i.item_category } : {}),
    ...(i.item_variant ? { item_variant: i.item_variant } : {}),
    ...(i.price !== undefined ? { price: round(i.price) } : {}),
    quantity: i.quantity,
    ...(i.index !== undefined ? { index: i.index } : {}),
  };
}

/** GA4 event parameters (gtag / Measurement Protocol / dataLayer ecommerce object). */
export function ga4Params(e: TrackEvent): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (e.items?.length || e.value !== undefined) p.currency = e.currency ?? CURRENCY;
  if (e.value !== undefined) p.value = round(e.value);
  if (e.transaction_id) p.transaction_id = e.transaction_id;
  if (e.items?.length) p.items = e.items.map(ga4Item);
  if (e.search_term) p.search_term = e.search_term;
  if (e.item_list_id) p.item_list_id = e.item_list_id;
  if (e.item_list_name) p.item_list_name = e.item_list_name;
  if (e.shipping_tier) p.shipping_tier = e.shipping_tier;
  if (e.payment_type) p.payment_type = e.payment_type;
  if (e.coupon) p.coupon = e.coupon;
  if (e.shipping !== undefined) p.shipping = round(e.shipping);
  if (e.discount !== undefined && e.discount > 0) p.discount = round(e.discount);
  if (e.method) p.method = e.method;
  return p;
}

const ECOMMERCE: ReadonlySet<TrackedEvent> = new Set([
  "view_item_list",
  "select_item",
  "view_item",
  "add_to_wishlist",
  "add_to_cart",
  "remove_from_cart",
  "view_cart",
  "begin_checkout",
  "add_shipping_info",
  "add_payment_info",
  "purchase",
  "refund",
]);

/** GTM dataLayer message (GA4 ecommerce format, as GTM's GA4 tags expect). */
export function dataLayerMessage(e: TrackEvent): Record<string, unknown> {
  const params = ga4Params(e);
  return ECOMMERCE.has(e.name) ? { event: e.name, event_id: e.event_id, ecommerce: params } : { event: e.name, event_id: e.event_id, ...params };
}

export const META_STANDARD: Partial<Record<TrackedEvent, string>> = {
  view_item: "ViewContent",
  search: "Search",
  add_to_cart: "AddToCart",
  add_to_wishlist: "AddToWishlist",
  begin_checkout: "InitiateCheckout",
  add_payment_info: "AddPaymentInfo",
  purchase: "Purchase",
  phone_click: "Contact",
  whatsapp_click: "Contact",
};

/** Meta custom_data (same for Pixel and Conversions API). */
export function metaCustomData(e: TrackEvent): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (e.items?.length) {
    d.content_ids = e.items.map((i) => i.item_id);
    d.content_type = "product";
    d.contents = e.items.map((i) => ({ id: i.item_id, quantity: i.quantity, ...(i.price !== undefined ? { item_price: round(i.price) } : {}) }));
    d.num_items = e.items.reduce((n, i) => n + i.quantity, 0);
    if (e.items.length === 1) d.content_name = e.items[0].item_name;
    const cat = e.items[0].item_category;
    if (cat && e.items.every((i) => i.item_category === cat)) d.content_category = cat;
  }
  if (e.value !== undefined) {
    d.value = round(e.value);
    d.currency = e.currency ?? CURRENCY;
  }
  if (e.transaction_id) d.order_id = e.transaction_id;
  if (e.search_term) d.search_string = e.search_term;
  if (e.method) d.contact_method = e.method;
  return d;
}

/** The Meta event for an internal event, or null when Meta has no standard equivalent. */
export function metaEvent(e: TrackEvent): { name: string; data: Record<string, unknown> } | null {
  const name = META_STANDARD[e.name];
  return name ? { name, data: metaCustomData(e) } : null;
}

/** Google Ads conversion (purchase only). */
export function googleAdsConversion(e: TrackEvent, conversionId: string, label: string) {
  return {
    send_to: `${conversionId}/${label}`,
    value: round(e.value ?? 0),
    currency: e.currency ?? CURRENCY,
    ...(e.transaction_id ? { transaction_id: e.transaction_id } : {}),
  };
}
