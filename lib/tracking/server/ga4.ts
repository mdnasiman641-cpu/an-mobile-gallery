import "server-only";
import { ga4Params } from "@/lib/tracking/adapters";
import type { TrackEvent } from "@/lib/tracking/events";
import { isResult, redact, timedFetch, type DeliveryResult, type FetchLike } from "@/lib/tracking/server/http";

/**
 * GA4 Measurement Protocol (server events).
 * https://developers.google.com/analytics/devguides/collection/protocol/ga4
 *
 * Used only where the server is the right sender: refunds (decided in the
 * admin panel, no customer browser involved) and — if the admin chooses it —
 * the purchase INSTEAD of the browser purchase. Never both, so a conversion
 * is not counted twice.
 *
 * Google's API requires the API secret in the URL; that URL is never logged
 * or stored. The production endpoint always answers 2xx without validating
 * anything, so a 2xx is reported as "sent", not as "verified".
 */
const MP = "https://www.google-analytics.com/mp/collect";
const MP_DEBUG = "https://www.google-analytics.com/debug/mp/collect";

export function randomClientId(): string {
  const a = crypto.getRandomValues(new Uint32Array(2));
  return `${a[0]}.${Math.floor(Date.now() / 1000)}`;
}

export function buildGa4Body(
  e: TrackEvent,
  ctx: { clientId: string | null; sessionId?: string | null; eventTime: number; adConsent: boolean; debug: boolean },
): Record<string, unknown> {
  const params: Record<string, unknown> = { ...ga4Params(e), engagement_time_msec: 1 };
  if (ctx.sessionId) params.session_id = ctx.sessionId;
  if (ctx.debug) params.debug_mode = true;
  return {
    client_id: ctx.clientId ?? randomClientId(),
    timestamp_micros: ctx.eventTime * 1000,
    consent: { ad_user_data: ctx.adConsent ? "GRANTED" : "DENIED", ad_personalization: ctx.adConsent ? "GRANTED" : "DENIED" },
    events: [{ name: e.name, params }],
  };
}

function url(base: string, measurementId: string, secret: string) {
  return `${base}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(secret)}`;
}

export async function sendGa4(dest: { publicId: string; secret: string }, body: Record<string, unknown>, fetchImpl: FetchLike = fetch): Promise<DeliveryResult> {
  const res = await timedFetch(fetchImpl, url(MP, dest.publicId, dest.secret), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (isResult(res)) return res;
  if (res.status >= 200 && res.status < 300) return { ok: true, summary: `HTTP ${res.status} (sent; GA4 doesn't confirm processing)` };
  return {
    ok: false,
    retryable: res.status >= 500 || res.status === 429,
    code: `HTTP_${res.status}`,
    message: redact(`GA4 Measurement Protocol answered HTTP ${res.status}`, [dest.secret]),
  };
}

/**
 * Validation server: checks the request FORMAT only (Google doesn't check the
 * API secret here). Optionally sends one real test event in debug mode, which
 * shows in GA4 → Admin → DebugView only.
 */
export async function verifyGa4(
  dest: { publicId: string; secret: string },
  opts: { sendDebugEvent: boolean },
  fetchImpl: FetchLike = fetch,
): Promise<{ ok: boolean; message: string }> {
  const sample = buildGa4Body(
    { name: "add_to_cart", event_id: "verify.check0001", currency: "BDT", value: 1, items: [{ item_id: "verification", item_name: "Verification", price: 1, quantity: 1 }] },
    { clientId: randomClientId(), eventTime: Date.now(), adConsent: false, debug: true },
  );
  const res = await timedFetch(fetchImpl, url(MP_DEBUG, dest.publicId, dest.secret), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sample) });
  if (isResult(res)) return { ok: false, message: res.ok ? "" : `${res.code}: ${res.message}` };
  const b = (await res.json().catch(() => null)) as { validationMessages?: { description?: string; validationCode?: string }[] } | null;
  if (!res.ok || !b) return { ok: false, message: `GA4 validation server answered HTTP ${res.status}.` };
  if (b.validationMessages?.length) return { ok: false, message: redact(`Request format problem: ${b.validationMessages.map((m) => m.description ?? m.validationCode).join("; ")}`, [dest.secret]) };
  let message = "Request format accepted by GA4's validation server (this does not check the API secret).";
  if (opts.sendDebugEvent) {
    const debugEvent = {
      client_id: randomClientId(),
      timestamp_micros: Date.now() * 1000,
      events: [{ name: "tracking_test", params: { debug_mode: true, engagement_time_msec: 1, source: "admin_verification" } }],
    };
    const sent = await sendGa4(dest, debugEvent, fetchImpl);
    message += sent.ok ? " A test event “tracking_test” was sent in debug mode: confirm it appears in GA4 → Admin → DebugView, then mark this property as checked." : ` Sending the test event failed (${sent.code}).`;
  }
  return { ok: true, message };
}
