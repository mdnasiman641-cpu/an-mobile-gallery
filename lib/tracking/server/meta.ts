import "server-only";
import { metaEvent } from "@/lib/tracking/adapters";
import type { TrackEvent } from "@/lib/tracking/events";
import { isResult, redact, timedFetch, type DeliveryResult, type FetchLike } from "@/lib/tracking/server/http";

/**
 * Meta Conversions API (server events).
 * https://developers.facebook.com/docs/marketing-api/conversions-api
 *
 * The access token is sent only in the Authorization header of the request
 * to graph.facebook.com — never in the URL, never logged, never returned.
 * "events_received" in Meta's answer means Meta ACCEPTED the event; it says
 * nothing about ad attribution.
 */
export const META_GRAPH_VERSION = "v26.0";
const GRAPH = "https://graph.facebook.com";

export interface MetaUserData {
  client_ip_address?: string;
  client_user_agent?: string;
  fbp?: string;
  fbc?: string;
  /** SHA-256 of the normalised email / phone (only with advertising consent and Advanced matching on). */
  em?: string[];
  ph?: string[];
}

/** One Conversions API event in Meta's format, or null when Meta has no standard equivalent. */
export function buildMetaServerEvent(e: TrackEvent, ctx: { eventTime: number; sourceUrl?: string | null; user: MetaUserData }): Record<string, unknown> | null {
  const m = metaEvent(e);
  if (!m) return null;
  const user: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx.user)) if (v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length)) user[k] = v;
  return {
    event_name: m.name,
    event_time: Math.floor(ctx.eventTime / 1000),
    event_id: e.event_id,
    action_source: "website",
    ...(ctx.sourceUrl ? { event_source_url: ctx.sourceUrl } : {}),
    user_data: user,
    custom_data: m.data,
  };
}

interface MetaErrorBody {
  error?: { message?: string; type?: string; code?: number; error_subcode?: number; is_transient?: boolean; fbtrace_id?: string };
}

/** Meta error codes that are worth retrying (temporary / rate limits). */
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613, 80004]);

async function readError(res: Response, token: string): Promise<DeliveryResult> {
  let body: MetaErrorBody = {};
  try {
    body = (await res.json()) as MetaErrorBody;
  } catch {
    /* not JSON */
  }
  const err = body.error ?? {};
  const code = err.code ?? 0;
  const retryable = res.status >= 500 || res.status === 429 || err.is_transient === true || TRANSIENT_CODES.has(code);
  const label = code === 190 ? "INVALID_TOKEN" : code === 10 || code === 200 ? "PERMISSION_DENIED" : code === 100 ? "INVALID_PARAMETER" : retryable ? "PROVIDER_ERROR" : "REJECTED";
  return {
    ok: false,
    retryable,
    code: `${label} (HTTP ${res.status}${code ? `, code ${code}` : ""})`,
    message: redact(`${err.message ?? res.statusText ?? "Request failed"}${err.fbtrace_id ? ` · fbtrace_id ${err.fbtrace_id}` : ""}`, [token]),
  };
}

export async function sendMetaEvents(
  dest: { publicId: string; token: string; testEventCode?: string | null },
  events: Record<string, unknown>[],
  fetchImpl: FetchLike = fetch,
): Promise<DeliveryResult> {
  if (!/^[0-9]{6,20}$/.test(dest.publicId)) return { ok: false, retryable: false, code: "CONFIG", message: "The Pixel / Dataset ID is not valid." };
  const res = await timedFetch(fetchImpl, `${GRAPH}/${META_GRAPH_VERSION}/${dest.publicId}/events`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${dest.token}` },
    body: JSON.stringify({ data: events, ...(dest.testEventCode ? { test_event_code: dest.testEventCode } : {}) }),
  });
  if (isResult(res)) return res;
  if (!res.ok) return readError(res, dest.token);
  let body: { events_received?: number; messages?: unknown[]; fbtrace_id?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return { ok: false, retryable: true, code: "INVALID_RESPONSE", message: "Meta answered without JSON." };
  }
  if (typeof body.events_received !== "number" || body.events_received < events.length) {
    return { ok: false, retryable: false, code: "NOT_RECEIVED", message: `Meta received ${body.events_received ?? 0} of ${events.length} event(s).` };
  }
  return { ok: true, summary: `events_received=${body.events_received}${dest.testEventCode ? " (test)" : ""}${body.fbtrace_id ? ` fbtrace_id=${body.fbtrace_id}` : ""}` };
}

/**
 * Verification that really talks to Meta:
 *  1. read the dataset with the token (token valid + has access), and
 *  2. with a Test Event Code: send one test PageView (shows only in Events
 *     Manager → Test events, never in production reporting).
 */
export async function verifyMeta(
  dest: { publicId: string; token: string; testEventCode?: string | null },
  ctx: { siteUrl: string },
  fetchImpl: FetchLike = fetch,
): Promise<{ ok: boolean; method: "api" | "test_event"; message: string }> {
  const res = await timedFetch(fetchImpl, `${GRAPH}/${META_GRAPH_VERSION}/${dest.publicId}?fields=id,name`, {
    method: "GET",
    headers: { authorization: `Bearer ${dest.token}` },
  });
  let readOk = false;
  let readMessage = "";
  if (isResult(res)) readMessage = res.ok ? "" : `${res.code}: ${res.message}`;
  else if (res.ok) {
    const b = (await res.json().catch(() => ({}))) as { id?: string; name?: string };
    readOk = b.id === dest.publicId;
    readMessage = readOk ? `Token can access dataset “${redact(b.name ?? b.id ?? "")}”.` : "Meta answered, but not with this dataset.";
  } else {
    const e = await readError(res, dest.token);
    readMessage = e.ok ? "" : `${e.code}: ${e.message}`;
  }

  if (dest.testEventCode) {
    const ev = {
      event_name: "PageView",
      event_time: Math.floor(Date.now() / 1000),
      event_id: `verify.${crypto.randomUUID()}`,
      action_source: "website",
      event_source_url: ctx.siteUrl,
      user_data: { client_user_agent: "AN MOBILE GALLERY tracking verification" },
    };
    const sent = await sendMetaEvents({ ...dest }, [ev], fetchImpl);
    if (sent.ok) return { ok: true, method: "test_event", message: `Test event accepted by Meta (${sent.summary}). Check Events Manager → Test events for code ${dest.testEventCode}. ${readOk ? readMessage : ""}`.trim() };
    return { ok: false, method: "test_event", message: `Test event refused — ${sent.code}: ${sent.message}` };
  }
  if (readOk) return { ok: true, method: "api", message: `${readMessage} No event was sent (add a Test Event Code to send a test event).` };
  return {
    ok: false,
    method: "api",
    message: `${readMessage || "Couldn't read the dataset."} If the token was generated for the Conversions API only, add a Test Event Code and verify again to test sending.`,
  };
}
