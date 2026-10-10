import { NextResponse } from "next/server";
import { getPublicClient } from "@/lib/supabase/public";
import { PATHAO_EVENT_STATUS } from "@/lib/couriers";
import { PATHAO_WEBHOOK_RESPONSE_HEADER } from "@/lib/couriers/pathao";

/**
 * Pathao → website shipment status updates.
 *
 * Pathao sends the webhook secret configured in its merchant panel in the
 * X-PATHAO-Signature header (as in Pathao's official plugin). The secret is
 * checked inside the database (courier_webhook_apply compares its SHA-256 with
 * the stored hash), so this route needs no service-role key: it calls one
 * narrowly scoped function with the anonymous client. Replays are ignored
 * (dedupe key per event), unknown parcels are acknowledged and ignored, and a
 * delivered / returned shipment never changes again.
 */
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64_000;

function accepted(body: Record<string, unknown>) {
  return NextResponse.json(body, { status: 202, headers: PATHAO_WEBHOOK_RESPONSE_HEADER });
}

function str(v: unknown, max: number): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

/** Event time from the payload if it is a sane past time, otherwise now. */
function eventTime(body: Record<string, unknown>): { iso: string; raw: string | null } {
  const raw = str(body.updated_at, 40) ?? str(body.timestamp, 40) ?? str(body.created_at, 40);
  const t = raw ? Date.parse(raw) : Number.NaN;
  const now = Date.now();
  const ok = Number.isFinite(t) && t <= now + 10 * 60_000 && t > now - 90 * 86_400_000;
  return { iso: new Date(ok ? t : now).toISOString(), raw };
}

export async function POST(request: Request) {
  const secret = request.headers.get("x-pathao-signature");
  if (!secret || secret.length < 16 || secret.length > 500) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  const supabase = getPublicClient();
  if (!supabase) return NextResponse.json({ error: "Not configured" }, { status: 503 });

  const event = str(body.event, 60) ?? "";
  const consignmentId = str(body.consignment_id, 80);
  const merchantOrderId = str(body.merchant_order_id, 40);
  const isSetup = event === "webhook_integration";
  const status = isSetup ? null : (PATHAO_EVENT_STATUS[event] ?? null);
  const providerStatus = str(body.order_status, 60) ?? (event ? event.replace(/^order\./, "").slice(0, 60) : null);
  const fee = Number(body.delivery_fee);
  const time = eventTime(body);

  const { data, error } = await supabase.rpc("courier_webhook_apply", {
    p_provider: "pathao",
    p_secret: secret,
    // the setup ping only proves the secret: it matches no parcel
    p_consignment_id: isSetup ? null : consignmentId,
    p_merchant_order_id: isSetup ? null : merchantOrderId,
    p_status: status,
    p_provider_status: providerStatus,
    p_occurred_at: time.iso,
    p_courier_fee: Number.isFinite(fee) && fee >= 0 && body.delivery_fee !== null && body.delivery_fee !== "" ? fee : null,
    p_dedupe_key: status && consignmentId ? `pathao:${consignmentId}:${event}:${time.raw ?? ""}`.slice(0, 200) : null,
  });

  if (error) {
    if (error.code === "42501") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // A rejected status (e.g. the shipment was cancelled here) is final: acknowledge it.
    if (error.code === "P0001") return accepted({ ok: true, result: "ignored" });
    // database unavailable: let Pathao retry
    return NextResponse.json({ error: "Temporarily unavailable" }, { status: 503 });
  }
  return accepted({ ok: true, result: isSetup ? "integrated" : String(data ?? "ok") });
}

export function GET() {
  return NextResponse.json({ error: "Use POST" }, { status: 405 });
}
