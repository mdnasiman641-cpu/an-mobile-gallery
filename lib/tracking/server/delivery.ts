import "server-only";
import { decryptSecret } from "@/lib/ai/crypto";
import { getSiteUrl } from "@/lib/env";
import { getPublicClient } from "@/lib/supabase/public";
import { CURRENCY, itemId, purchaseEventId, refundEventId, SERVER_COPY_EVENTS, type TrackEvent, type TrackItem } from "@/lib/tracking/events";
import { hashedMatchData } from "@/lib/tracking/hash";
import { destinationsFor, routeFor } from "@/lib/tracking/routing";
import { getServerTrackingConfig, type ServerDestination, type ServerTrackingConfig } from "@/lib/tracking/server/config";
import { requestContext, type RequestContext } from "@/lib/tracking/server/context";
import { buildGa4Body, sendGa4 } from "@/lib/tracking/server/ga4";
import { type DeliveryResult, type FetchLike } from "@/lib/tracking/server/http";
import { buildMetaServerEvent, sendMetaEvents, type MetaUserData } from "@/lib/tracking/server/meta";

/**
 * Server-side event delivery.
 *
 * Conversions (purchase, refund) go through a durable outbox in Supabase
 * (tracking_outbox): queued in the same request that created them, delivered
 * right after the response (Next.js after() = Cloudflare waitUntil), and
 * retried with back-off when the provider had a temporary problem. Retries
 * run when the next conversion is processed or when an admin opens the
 * tracking page — no always-running job is needed on Cloudflare Workers Free.
 *
 * Browser-event copies for Meta (view_item, add_to_cart, …) are sent once,
 * directly, without the outbox (best effort, no database write per event).
 *
 * Nothing here can make checkout fail: every function catches its errors.
 */

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

function rpc(): Rpc | null {
  const supabase = getPublicClient();
  if (!supabase) return null;
  return async (fn, args) => {
    const { data, error } = await supabase.rpc(fn, args);
    return { data, error };
  };
}

interface OutboxEvent {
  event_id: string;
  event_name: string;
  destination_id: string;
  channel: "meta_capi" | "ga4_mp";
  transaction_id?: string;
  is_test: boolean;
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Delivery of queued events
// ---------------------------------------------------------------------------

interface ClaimedRow {
  id: number;
  event_id: string;
  event_name: string;
  destination_id: string;
  channel: "meta_capi" | "ga4_mp";
  is_test: boolean;
  payload: Record<string, unknown> | null;
  attempts: number;
}

async function secretOf(dest: ServerDestination): Promise<string | null> {
  if (!dest.secretCiphertext) return null;
  try {
    return await decryptSecret(dest.secretCiphertext);
  } catch {
    return null;
  }
}

export async function sendOne(dest: ServerDestination, row: { channel: "meta_capi" | "ga4_mp"; is_test: boolean; payload: Record<string, unknown> | null }, fetchImpl: FetchLike = fetch): Promise<DeliveryResult> {
  if (!row.payload) return { ok: false, retryable: false, code: "NO_PAYLOAD", message: "Event data was already removed." };
  if (!dest.serverEnabled) return { ok: false, retryable: false, code: "SERVER_OFF", message: "Server-side sending is off for this account." };
  const secret = await secretOf(dest);
  if (!secret) return { ok: false, retryable: false, code: "SECRET_MISSING", message: "The access token / API secret is missing or can't be read. Enter it again." };
  if (row.channel === "meta_capi") {
    const ev = row.payload.event;
    if (!ev || typeof ev !== "object") return { ok: false, retryable: false, code: "BAD_PAYLOAD", message: "Invalid event data." };
    return sendMetaEvents({ publicId: dest.publicId, token: secret, testEventCode: row.is_test ? dest.testEventCode : null }, [ev as Record<string, unknown>], fetchImpl);
  }
  const body = row.payload.body;
  if (!body || typeof body !== "object") return { ok: false, retryable: false, code: "BAD_PAYLOAD", message: "Invalid event data." };
  return sendGa4({ publicId: dest.publicId, secret }, body as Record<string, unknown>, fetchImpl);
}

/** Deliver the given queued events (or the ones due for a retry). Never throws. */
export async function deliverOutbox(opts: { ids?: number[]; limit?: number; fetchImpl?: FetchLike } = {}): Promise<{ delivered: number; retry: number; failed: number }> {
  const totals = { delivered: 0, retry: 0, failed: 0 };
  try {
    const sc = await getServerTrackingConfig();
    const call = rpc();
    if (!sc || !call) return totals;
    const { data, error } = await call("tracking_claim", { p_key: sc.key, p_ids: opts.ids?.length ? opts.ids : null, p_limit: opts.limit ?? 5 });
    if (error || !Array.isArray(data)) return totals;
    for (const row of data as ClaimedRow[]) {
      const dest = sc.cfg.destinations.find((d) => d.id === row.destination_id);
      const result: DeliveryResult = dest
        ? await sendOne(dest, row, opts.fetchImpl).catch(() => ({ ok: false as const, retryable: true, code: "INTERNAL", message: "Unexpected error while sending" }))
        : { ok: false, retryable: false, code: "DISABLED", message: "This account is disabled or was removed." };
      const outcome = result.ok ? "delivered" : result.retryable ? "retry" : "failed";
      const { data: final } = await call("tracking_report", {
        p_key: sc.key,
        p_id: row.id,
        p_outcome: outcome,
        p_code: result.ok ? null : result.code,
        p_message: result.ok ? null : result.message,
        p_summary: result.ok ? result.summary : null,
      });
      if (final === "delivered") totals.delivered++;
      else if (final === "retry") totals.retry++;
      else if (final === "failed") totals.failed++;
    }
  } catch {
    /* never break the caller */
  }
  return totals;
}

async function enqueue(key: string, conversion: Record<string, unknown> | null, events: OutboxEvent[]): Promise<{ duplicate: boolean; ids: number[] } | null> {
  const call = rpc();
  if (!call) return null;
  const { data, error } = await call("tracking_enqueue", { p_key: key, p_conversion: conversion, p_events: events });
  if (error || !data || typeof data !== "object") return null;
  const d = data as { duplicate?: boolean; ids?: unknown };
  return { duplicate: d.duplicate === true, ids: Array.isArray(d.ids) ? d.ids.map(Number).filter(Number.isFinite) : [] };
}

// ---------------------------------------------------------------------------
// Purchase (definition: an order successfully created by place_order — a COD
// order accepted by the shop's system; see docs/ANALYTICS-AND-TRACKING.md)
// ---------------------------------------------------------------------------

interface OrderSnapshot {
  orderId: string;
  orderNumber: string;
  isDemo: boolean;
  subtotal: number;
  discount: number;
  deliveryCharge: number;
  total: number;
  couponCode: string | null;
  items: { productId: string | null; variantId: string | null; name: string; variantLabel: string | null; quantity: number; unitPrice: number; brand: string | null; category: string | null }[];
}

export function purchaseEventFromSnapshot(s: OrderSnapshot): TrackEvent {
  const items: TrackItem[] = s.items.map((i, index) => ({
    item_id: itemId(i.productId ?? i.name, i.variantId),
    item_name: i.name,
    ...(i.brand ? { item_brand: i.brand } : {}),
    ...(i.category ? { item_category: i.category } : {}),
    ...(i.variantLabel ? { item_variant: i.variantLabel } : {}),
    price: Number(i.unitPrice),
    quantity: Number(i.quantity),
    index,
  }));
  return {
    name: "purchase",
    event_id: purchaseEventId(s.orderNumber),
    transaction_id: s.orderNumber,
    currency: CURRENCY,
    value: Number(s.total),
    shipping: Number(s.deliveryCharge),
    ...(Number(s.discount) > 0 ? { discount: Number(s.discount) } : {}),
    ...(s.couponCode ? { coupon: s.couponCode } : {}),
    payment_type: "Cash on Delivery",
    items,
  };
}

/** What the checkout page needs to send the browser copy of the purchase. */
export interface BrowserPurchase {
  event: TrackEvent;
  /** GA4 properties that receive this purchase from the server: the browser must not send it to them. */
  ga4ServerIds: string[];
}

async function metaUser(dest: ServerDestination, ctx: RequestContext, contact: { email?: string | null; phone?: string | null }): Promise<MetaUserData> {
  const user: MetaUserData = {
    ...(ctx.ip ? { client_ip_address: ctx.ip } : {}),
    ...(ctx.userAgent ? { client_user_agent: ctx.userAgent } : {}),
    ...(ctx.fbp ? { fbp: ctx.fbp } : {}),
    ...(ctx.fbc ? { fbc: ctx.fbc } : {}),
  };
  if (dest.advancedMatching && ctx.consent.advertising) {
    const h = await hashedMatchData(contact);
    if (h.em) user.em = [h.em];
    if (h.ph) user.ph = [h.ph];
  }
  return user;
}

export function serverEventsFor(
  cfg: ServerTrackingConfig,
  e: TrackEvent,
  ctx: RequestContext,
): { meta: ServerDestination[]; ga4: ServerDestination[] } {
  const route = routeFor(cfg.routes, e.name);
  const meta =
    ctx.consent.advertising && route.metaServer
      ? destinationsFor(cfg.destinations, cfg.routes, e.name, "meta").filter((d) => d.serverEnabled && d.secretCiphertext)
      : [];
  const ga4 =
    ctx.consent.analytics && route.ga4Server
      ? destinationsFor(cfg.destinations, cfg.routes, e.name, "ga4").filter((d) => d.serverEnabled && d.secretCiphertext)
      : [];
  return { meta, ga4 };
}

/**
 * Record the purchase once (durable idempotency per order), queue its server
 * events and return the browser copy. `deliver` sends the queued events; call
 * it after the response. Never throws; on any problem the order is unaffected.
 */
export async function preparePurchase(input: {
  orderId: string;
  orderNumber: string;
  total: number;
  contact: { email?: string | null; phone?: string | null };
  headers: Headers;
  now?: number;
}): Promise<{ browser: BrowserPurchase | null; deliver: () => Promise<void> }> {
  const noop = async () => undefined;
  try {
    const sc = await getServerTrackingConfig();
    const call = rpc();
    if (!sc || !call) {
      // no server key / nothing configured: the browser still gets the real totals (no item details)
      return { browser: { event: { name: "purchase", event_id: purchaseEventId(input.orderNumber), transaction_id: input.orderNumber, currency: CURRENCY, value: input.total }, ga4ServerIds: [] }, deliver: noop };
    }
    const { cfg, key } = sc;
    const { data: snap } = await call("tracking_order_snapshot", { p_key: key, p_order_id: input.orderId });
    if (!snap || typeof snap !== "object") return { browser: null, deliver: noop };
    const s = snap as OrderSnapshot;
    if (s.isDemo || s.orderNumber !== input.orderNumber) return { browser: null, deliver: noop };

    const event = purchaseEventFromSnapshot(s);
    const ctx = requestContext(input.headers, cfg.consent, getSiteUrl());
    const now = input.now ?? Date.now();
    const { meta, ga4 } = serverEventsFor(cfg, event, ctx);
    const events: OutboxEvent[] = [];
    for (const d of meta) {
      const ev = buildMetaServerEvent(event, { eventTime: now, sourceUrl: ctx.pageUrl ?? `${getSiteUrl()}/checkout`, user: await metaUser(d, ctx, input.contact) });
      if (ev) events.push({ event_id: event.event_id, event_name: "purchase", destination_id: d.id, channel: "meta_capi", transaction_id: s.orderNumber, is_test: d.debug, payload: { event: ev } });
    }
    for (const d of ga4) {
      events.push({
        event_id: event.event_id,
        event_name: "purchase",
        destination_id: d.id,
        channel: "ga4_mp",
        transaction_id: s.orderNumber,
        is_test: d.debug,
        payload: { body: buildGa4Body(event, { clientId: ctx.gaClientId, sessionId: ctx.gaSessions[d.publicId] ?? null, eventTime: now, adConsent: ctx.consent.advertising, debug: d.debug }) },
      });
    }
    // GA4 properties that get this purchase at all (browser or server): a later refund goes only there
    const ga4All = ctx.consent.analytics ? destinationsFor(cfg.destinations, cfg.routes, "purchase", "ga4").map((d) => d.id) : [];
    const queued = await enqueue(
      key,
      {
        order_id: s.orderId,
        transaction_id: s.orderNumber,
        purchase_event_id: event.event_id,
        currency: CURRENCY,
        consent_analytics: ctx.consent.analytics,
        consent_advertising: ctx.consent.advertising,
        ga_client_id: ctx.gaClientId,
        ga_session_id: ga4[0] ? (ctx.gaSessions[ga4[0].publicId] ?? null) : null,
        ga4_destinations: ga4All,
      },
      events,
    );
    const ids = queued && !queued.duplicate ? queued.ids : [];
    return {
      browser: { event, ga4ServerIds: ga4.map((d) => d.id) },
      deliver: async () => {
        if (ids.length) await deliverOutbox({ ids });
        await deliverOutbox({ limit: 3 }); // pending retries ride along (bounded)
      },
    };
  } catch {
    return { browser: null, deliver: noop };
  }
}

/**
 * Cancelled or refunded order → GA4 refund (full order), once, only to the
 * GA4 properties that received the purchase and only if the visitor allowed
 * analytics when buying. Meta has no refund event: nothing is sent there.
 */
export async function prepareRefund(input: { orderId: string; orderNumber: string; now?: number }): Promise<() => Promise<void>> {
  const noop = async () => undefined;
  try {
    const sc = await getServerTrackingConfig();
    const call = rpc();
    if (!sc || !call) return noop;
    const eventId = refundEventId(input.orderNumber);
    const { data } = await call("tracking_begin_refund", { p_key: sc.key, p_order_id: input.orderId, p_event_id: eventId });
    if (!data || typeof data !== "object") return noop;
    const conv = data as { transaction_id: string; value: number | string; currency: string; consent_analytics: boolean; consent_advertising: boolean; ga_client_id: string | null; ga_session_id: string | null; ga4_destinations: string[] };
    if (!conv.consent_analytics || !conv.ga4_destinations?.length) return noop;
    const event: TrackEvent = { name: "refund", event_id: eventId, transaction_id: conv.transaction_id, currency: CURRENCY, value: Number(conv.value) };
    const dests = sc.cfg.destinations.filter((d) => d.kind === "ga4" && conv.ga4_destinations.includes(d.id) && d.serverEnabled && d.secretCiphertext);
    const events: OutboxEvent[] = dests.map((d) => ({
      event_id: eventId,
      event_name: "refund",
      destination_id: d.id,
      channel: "ga4_mp",
      transaction_id: conv.transaction_id,
      is_test: d.debug,
      payload: { body: buildGa4Body(event, { clientId: conv.ga_client_id, sessionId: conv.ga_session_id, eventTime: input.now ?? Date.now(), adConsent: conv.consent_advertising, debug: d.debug }) },
    }));
    if (!events.length) return noop;
    const queued = await enqueue(sc.key, null, events);
    const ids = queued?.ids ?? [];
    return async () => {
      if (ids.length) await deliverOutbox({ ids });
    };
  } catch {
    return noop;
  }
}

// ---------------------------------------------------------------------------
// Browser-event copies for Meta (same event_id as the Pixel event)
// ---------------------------------------------------------------------------

const lastHealth = new Map<string, number>();

async function recordHealth(key: string, destId: string, result: DeliveryResult) {
  const call = rpc();
  if (!call) return;
  const now = Date.now();
  if (result.ok) {
    // successes are written at most every 10 minutes per account (no write per event)
    if (now - (lastHealth.get(destId) ?? 0) < 600_000) return;
    lastHealth.set(destId, now);
  }
  await call("tracking_health", { p_key: key, p_destination_id: destId, p_ok: result.ok, p_code: result.ok ? null : result.code });
}

/**
 * Send the server copy of a browser event to Meta. Returns what happened per
 * account (for tests); errors are recorded on the account, never thrown.
 */
export async function relayBrowserEvent(e: TrackEvent, headers: Headers, fetchImpl: FetchLike = fetch): Promise<{ sent: number; skipped: string | null }> {
  if (!SERVER_COPY_EVENTS.includes(e.name)) return { sent: 0, skipped: "not a server-copy event" };
  const sc = await getServerTrackingConfig();
  if (!sc) return { sent: 0, skipped: "not configured" };
  const ctx = requestContext(headers, sc.cfg.consent, getSiteUrl());
  if (!ctx.consent.advertising) return { sent: 0, skipped: "no advertising consent" };
  const { meta } = serverEventsFor(sc.cfg, e, ctx);
  if (!meta.length) return { sent: 0, skipped: "no Meta account gets a server copy of this event" };
  let sent = 0;
  const source = e.page_location && e.page_location.startsWith(getSiteUrl()) ? e.page_location : ctx.pageUrl;
  for (const d of meta) {
    const ev = buildMetaServerEvent(e, { eventTime: Date.now(), sourceUrl: source, user: await metaUser({ ...d, advancedMatching: false }, ctx, {}) });
    if (!ev) continue;
    const result = await sendOne(d, { channel: "meta_capi", is_test: d.debug, payload: { event: ev } }, fetchImpl).catch(
      (): DeliveryResult => ({ ok: false, retryable: true, code: "INTERNAL", message: "Unexpected error" }),
    );
    if (result.ok) sent++;
    await recordHealth(sc.key, d.id, result).catch(() => undefined);
  }
  return { sent, skipped: null };
}
