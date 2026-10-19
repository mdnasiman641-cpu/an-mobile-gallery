import { after, NextResponse } from "next/server";
import { SERVER_COPY_EVENTS, trackEventSchema, type TrackEvent } from "@/lib/tracking/events";
import { relayBrowserEvent } from "@/lib/tracking/server/delivery";

/**
 * Browser → server copy of a storefront event for the Meta Conversions API
 * (same event_id as the Pixel event, so Meta keeps one).
 *
 * Only accepted from this site's own pages, only for the events listed in
 * SERVER_COPY_EVENTS (never purchase or refund: those are created by the
 * server itself), only with the visitor's advertising consent (checked from
 * the consent cookie in relayBrowserEvent), small bodies only, and rate
 * limited per visitor. The answer is sent at once; delivery happens after.
 */
export const dynamic = "force-dynamic";

const MAX_BODY = 8_000;
const LIMIT_PER_MINUTE = 60;
// Best effort per Worker instance (no shared state on Cloudflare Free): stops loops and floods from one visitor.
const hits = new Map<string, { n: number; reset: number }>();

function limited(ip: string): boolean {
  const now = Date.now();
  if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  const h = hits.get(ip);
  if (!h || h.reset < now) {
    hits.set(ip, { n: 1, reset: now + 60_000 });
    return false;
  }
  h.n++;
  return h.n > LIMIT_PER_MINUTE;
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  let sameOrigin = false;
  try {
    sameOrigin = Boolean(origin) && new URL(origin as string).host === new URL(request.url).host;
  } catch {
    sameOrigin = false;
  }
  if (!sameOrigin || (site && site !== "same-origin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const ip = (request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown").trim();
  if (limited(ip)) return NextResponse.json({ error: "Too many events" }, { status: 429 });

  const raw = await request.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const result = trackEventSchema.safeParse(parsed);
  if (!result.success) return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  const event = result.data as TrackEvent;
  if (!SERVER_COPY_EVENTS.includes(event.name)) return NextResponse.json({ error: "This event is not accepted here" }, { status: 400 });

  const headers = new Headers(request.headers);
  after(() => relayBrowserEvent(event, headers).then(() => undefined, () => undefined));
  return NextResponse.json({ accepted: true }, { status: 202 });
}
