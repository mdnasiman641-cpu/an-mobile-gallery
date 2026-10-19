"use server";

// Admin → Analytics & Tracking. Admins only (checked here AND by RLS).
// Secrets (Meta access token, GA4 API secret) are write-only: encrypted on
// this server before they reach the database and never sent back to the
// browser. Every change is written to tracking_audit_log (field names only).

import { z } from "zod";
import { assertStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { decryptSecret, encryptSecret, encryptionAvailable, keyHint } from "@/lib/ai/crypto";
import { getSiteUrl } from "@/lib/env";
import { invalidateTracking } from "@/lib/cache";
import { getPublicClient } from "@/lib/supabase/public";
import { TRACKED_EVENTS } from "@/lib/tracking/events";
import { sanitizeRoutes } from "@/lib/tracking/routing";
import { ID_FORMAT } from "@/lib/tracking/status";
import { ensureServerKeyRegistered, VIEW_COLUMNS, type DestinationRow } from "@/lib/tracking/server/admin";
import { resetServerConfigCache } from "@/lib/tracking/server/config";
import { deliverOutbox } from "@/lib/tracking/server/delivery";
import { verifyGa4 } from "@/lib/tracking/server/ga4";
import { getServerKey } from "@/lib/tracking/server/key";
import { verifyMeta } from "@/lib/tracking/server/meta";
import type { ActionResult } from "@/types";

const MIGRATION = "Analytics & tracking need database migration 0015 (supabase/migrations/20261019000015_tracking.sql). Run it in the Supabase SQL editor first.";
const KEY_STORE_UNAVAILABLE = "The secure key store is not available. On Cloudflare it uses the Worker's R2 binding; when running locally, set AI_KEYS_ENCRYPTION_SECRET.";

function dbError(message: string, code?: string): string {
  if (/does not exist|schema cache|tracking_/i.test(message) && !/duplicate|violates/i.test(message)) return MIGRATION;
  if (code === "23505") return message.includes("one_default") ? "Another account of this kind is already the default." : "This ID is already added.";
  if (code === "23514") return "A value has the wrong format. Check the IDs.";
  return "Couldn't save. Please try again.";
}

async function admin() {
  const session = await assertStaff("admin");
  if ("error" in session) return { error: session.error } as const;
  return { session, supabase: await createClient() } as const;
}

async function audit(actor: string, action: string, target: string | null, fields: string[] = []) {
  const supabase = await createClient();
  await supabase.from("tracking_audit_log").insert({ actor, action, target, details: { fields } });
}

function changed() {
  invalidateTracking();
  resetServerConfigCache();
}

async function registerKey() {
  const supabase = await createClient();
  const { data } = await supabase.from("tracking_settings").select("server_key_hash").eq("id", 1).maybeSingle();
  await ensureServerKeyRegistered((data as { server_key_hash: string | null } | null)?.server_key_hash ?? null);
}

// ---------------------------------------------------------------------------
// Accounts (destinations)
// ---------------------------------------------------------------------------

const opt = (re: RegExp, msg: string) =>
  z
    .union([z.string().trim(), z.null(), z.undefined()])
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || re.test(v), msg);

const destinationSchema = z
  .object({
    id: z.string().uuid().optional(),
    kind: z.enum(["gtm", "ga4", "meta", "google_ads"]),
    name: z.string().trim().min(1, "Enter a name for this account").max(80),
    public_id: z.string().trim().max(40),
    is_enabled: z.boolean(),
    is_default: z.boolean().optional(),
    conversion_label: opt(/^[A-Za-z0-9_-]{4,64}$/, "The conversion label has the wrong format."),
    server_container_url: opt(/^https:\/\/[A-Za-z0-9.-]+(:[0-9]{2,5})?(\/[^\s]*)?$/, "The server container URL must start with https://"),
    business_id: opt(/^[0-9]{5,25}$/, "The Business ID is digits only."),
    ad_account_id: opt(/^(act_)?[0-9]{5,25}$/, "The Ad account ID is digits only (optionally starting with act_)."),
    browser_enabled: z.boolean().default(true),
    server_enabled: z.boolean().default(false),
    ga4_browser_delivery: z.enum(["gtag", "gtm"]).default("gtag"),
    debug_mode: z.boolean().default(false),
    enhanced_conversions: z.boolean().default(false),
    advanced_matching: z.boolean().default(false),
    test_event_code: opt(/^[A-Za-z0-9]{3,40}$/, "The Test Event Code is letters and digits only (e.g. TEST12345)."),
    /** New secret; empty = keep the saved one. Never returned. */
    secret: z.string().trim().max(500).optional(),
    clear_secret: z.boolean().optional(),
  })
  .transform((v) => ({ ...v, public_id: v.kind === "meta" ? v.public_id.replace(/\s/g, "") : v.public_id.toUpperCase().replace(/\s/g, "") }))
  .superRefine((v, ctx) => {
    if (!ID_FORMAT[v.kind].re.test(v.public_id)) ctx.addIssue({ code: "custom", message: `The ID has the wrong format (example: ${ID_FORMAT[v.kind].example}).`, path: ["public_id"] });
    if (v.secret) {
      const ok = v.kind === "meta" ? /^[A-Za-z0-9_-]{20,500}$/.test(v.secret) : v.kind === "ga4" ? /^[A-Za-z0-9_-]{8,100}$/.test(v.secret) : false;
      if (!ok) ctx.addIssue({ code: "custom", message: v.kind === "meta" ? "The access token doesn't look right (copy it again from Events Manager)." : v.kind === "ga4" ? "The API secret doesn't look right." : "This account type has no secret.", path: ["secret"] });
    }
  });

/** Fields that belong to each kind (others are reset, so nothing stale is kept). */
function kindFields(v: z.infer<typeof destinationSchema>) {
  const base = { kind: v.kind, name: v.name, public_id: v.public_id, is_enabled: v.is_enabled };
  if (v.kind === "gtm") return { ...base, server_container_url: v.server_container_url, browser_enabled: true, server_enabled: false };
  if (v.kind === "ga4")
    return { ...base, browser_enabled: v.browser_enabled, server_enabled: v.server_enabled, ga4_browser_delivery: v.ga4_browser_delivery, debug_mode: v.debug_mode };
  if (v.kind === "meta")
    return {
      ...base,
      browser_enabled: v.browser_enabled,
      server_enabled: v.server_enabled,
      debug_mode: v.debug_mode,
      advanced_matching: v.advanced_matching,
      test_event_code: v.test_event_code,
      business_id: v.business_id,
      ad_account_id: v.ad_account_id,
    };
  return { ...base, conversion_label: v.conversion_label, enhanced_conversions: v.enhanced_conversions, browser_enabled: true, server_enabled: false };
}

export async function saveDestinationAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const a = await admin();
  if ("error" in a) return { ok: false, message: a.error };
  const parsed = destinationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Please check the fields." };
  const v = parsed.data;
  const { supabase, session } = a;

  let current: DestinationRow | null = null;
  if (v.id) {
    const { data, error } = await supabase.from("tracking_destinations").select(`${VIEW_COLUMNS}, secret_ciphertext`).eq("id", v.id).maybeSingle();
    if (error) return { ok: false, message: dbError(error.message, error.code) };
    current = data as unknown as DestinationRow | null;
    if (!current) return { ok: false, message: "This account no longer exists." };
    if (current.kind !== v.kind) return { ok: false, message: "The account type can't be changed. Add a new account instead." };
  }

  const row: Record<string, unknown> = { ...kindFields(v), updated_by: session.userId };
  const secretCapable = v.kind === "meta" || v.kind === "ga4";
  if (secretCapable && v.secret) {
    if (!(await encryptionAvailable())) return { ok: false, message: KEY_STORE_UNAVAILABLE };
    row.secret_ciphertext = await encryptSecret(v.secret);
    row.secret_hint = keyHint(v.secret);
    row.secret_updated_at = new Date().toISOString();
  } else if (v.clear_secret || !secretCapable) {
    row.secret_ciphertext = null;
    row.secret_hint = null;
    row.secret_updated_at = v.clear_secret ? new Date().toISOString() : null;
  }
  const hasSecret = secretCapable && (Boolean(v.secret) || (!v.clear_secret && Boolean(current?.secret_hint)));
  if (row.server_enabled && !hasSecret) {
    return { ok: false, message: v.kind === "meta" ? "To send Conversions API events, enter the access token." : "To send Measurement Protocol events, enter the API secret." };
  }
  if (v.kind === "google_ads" && v.is_enabled && !v.conversion_label) return { ok: false, message: "Enter the conversion label to turn this Google Ads conversion on." };

  // anything that changes what is being verified needs a new verification
  const identityChanged = !current || current.public_id !== v.public_id || Boolean(v.secret) || Boolean(v.clear_secret) || (v.kind === "meta" && current.test_event_code !== v.test_event_code);
  if (identityChanged) {
    row.verification_status = "unverified";
    row.verification_method = null;
    row.verified_at = null;
    row.verification_message = current ? "Changed — verify again." : null;
  }

  // default account of its kind: the first one, or when asked
  const { data: sameKind } = await supabase.from("tracking_destinations").select("id, is_default").eq("kind", v.kind);
  const others = ((sameKind ?? []) as { id: string; is_default: boolean }[]).filter((d) => d.id !== v.id);
  const makeDefault = v.is_default === true || (!others.some((d) => d.is_default) && (current?.is_default ?? true));
  if (makeDefault && others.some((d) => d.is_default)) {
    const { error } = await supabase.from("tracking_destinations").update({ is_default: false }).eq("kind", v.kind).neq("id", v.id ?? "00000000-0000-0000-0000-000000000000");
    if (error) return { ok: false, message: dbError(error.message, error.code) };
  }
  row.is_default = makeDefault || (v.is_default === undefined && Boolean(current?.is_default));

  let id = v.id ?? null;
  if (current) {
    const { error } = await supabase.from("tracking_destinations").update(row).eq("id", current.id);
    if (error) return { ok: false, message: dbError(error.message, error.code) };
  } else {
    const { data, error } = await supabase.from("tracking_destinations").insert({ ...row, created_by: session.userId }).select("id").single();
    if (error) return { ok: false, message: dbError(error.message, error.code) };
    id = (data as { id: string }).id;
  }

  const fields = current
    ? Object.keys(row).filter((k) => !["updated_by", "secret_ciphertext", "secret_updated_at", "verification_status", "verification_method", "verified_at", "verification_message"].includes(k) && JSON.stringify((current as unknown as Record<string, unknown>)[k] ?? null) !== JSON.stringify(row[k] ?? null))
    : ["created"];
  if (v.secret) fields.push("secret (replaced)");
  if (v.clear_secret) fields.push("secret (removed)");
  await audit(session.userId, current ? "account_updated" : "account_added", `${v.kind}:${v.public_id}`, fields.map((f) => f.replace(/_hint$/, "")));
  await registerKey();
  changed();
  return { ok: true, message: current ? "Account saved" : "Account added", data: { id: id as string } };
}

const idSchema = z.string().uuid();

export async function setDestinationEnabledAction(id: unknown, enabled: unknown): Promise<ActionResult> {
  const a = await admin();
  if ("error" in a) return { ok: false, message: a.error };
  const pid = idSchema.safeParse(id);
  if (!pid.success || typeof enabled !== "boolean") return { ok: false, message: "Invalid request." };
  const { data: cur } = await a.supabase.from("tracking_destinations").select("kind, public_id, conversion_label, server_enabled, secret_hint").eq("id", pid.data).maybeSingle();
  const c = cur as { kind: string; public_id: string; conversion_label: string | null; server_enabled: boolean; secret_hint: string | null } | null;
  if (!c) return { ok: false, message: "This account no longer exists." };
  if (enabled && c.kind === "google_ads" && !c.conversion_label) return { ok: false, message: "Add the conversion label first (Edit)." };
  if (enabled && c.server_enabled && !c.secret_hint) return { ok: false, message: "Server sending is on but no secret is saved. Edit the account first." };
  const { error } = await a.supabase.from("tracking_destinations").update({ is_enabled: enabled, updated_by: a.session.userId }).eq("id", pid.data);
  if (error) return { ok: false, message: dbError(error.message, error.code) };
  await audit(a.session.userId, enabled ? "account_enabled" : "account_disabled", `${c.kind}:${c.public_id}`);
  changed();
  return { ok: true, message: enabled ? "Account enabled" : "Account disabled" };
}

export async function setDefaultDestinationAction(id: unknown): Promise<ActionResult> {
  const a = await admin();
  if ("error" in a) return { ok: false, message: a.error };
  const pid = idSchema.safeParse(id);
  if (!pid.success) return { ok: false, message: "Invalid request." };
  const { data: cur } = await a.supabase.from("tracking_destinations").select("kind, public_id").eq("id", pid.data).maybeSingle();
  const c = cur as { kind: string; public_id: string } | null;
  if (!c) return { ok: false, message: "This account no longer exists." };
  const r1 = await a.supabase.from("tracking_destinations").update({ is_default: false }).eq("kind", c.kind).neq("id", pid.data);
  if (r1.error) return { ok: false, message: dbError(r1.error.message, r1.error.code) };
  const r2 = await a.supabase.from("tracking_destinations").update({ is_default: true }).eq("id", pid.data);
  if (r2.error) return { ok: false, message: dbError(r2.error.message, r2.error.code) };
  await audit(a.session.userId, "default_changed", `${c.kind}:${c.public_id}`);
  changed();
  return { ok: true, message: "Default account changed" };
}

export async function deleteDestinationAction(id: unknown): Promise<ActionResult> {
  const a = await admin();
  if ("error" in a) return { ok: false, message: a.error };
  const pid = idSchema.safeParse(id);
  if (!pid.success) return { ok: false, message: "Invalid request." };
  const { data: cur } = await a.supabase.from("tracking_destinations").select("kind, public_id").eq("id", pid.data).maybeSingle();
  const c = cur as { kind: string; public_id: string } | null;
  if (!c) return { ok: false, message: "This account no longer exists." };
  const { error } = await a.supabase.from("tracking_destinations").delete().eq("id", pid.data);
  if (error) return { ok: false, message: dbError(error.message, error.code) };
  await audit(a.session.userId, "account_removed", `${c.kind}:${c.public_id}`, ["secret (removed)"]);
  changed();
  return { ok: true, message: "Account removed (its saved secret was deleted with it)" };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * A real check against the provider where one exists:
 *  - Meta: the token reads the dataset (Graph API); with a Test Event Code a
 *    test event is sent and must be accepted (shows only under Test events).
 *  - GA4 with an API secret: request format checked by Google's validation
 *    server, plus one debug event for DebugView (the admin confirms it).
 *  - GTM, GA4 browser-only, Google Ads: there is no API to check them without
 *    extra Google sign-in permissions; the page explains how to confirm.
 */
export async function verifyDestinationAction(id: unknown): Promise<ActionResult<{ status: string; message: string }>> {
  const a = await admin();
  if ("error" in a) return { ok: false, message: a.error };
  const pid = idSchema.safeParse(id);
  if (!pid.success) return { ok: false, message: "Invalid request." };
  const { data } = await a.supabase.from("tracking_destinations").select(`${VIEW_COLUMNS}, secret_ciphertext`).eq("id", pid.data).maybeSingle();
  const d = data as unknown as DestinationRow | null;
  if (!d) return { ok: false, message: "This account no longer exists." };

  let secret: string | null = null;
  if (d.secret_ciphertext) {
    try {
      secret = await decryptSecret(d.secret_ciphertext);
    } catch {
      return { ok: false, message: "The saved secret can't be read any more. Enter it again (Edit → Replace)." };
    }
  }

  let update: Record<string, unknown> = {};
  let message: string;
  if (d.kind === "meta") {
    if (!secret) {
      message = "Browser Pixel only (no access token): open Events Manager → Test events, enter this website's address, browse the shop and check that events arrive. Then press “I saw the events”.";
    } else {
      const r = await verifyMeta({ publicId: d.public_id, token: secret, testEventCode: d.test_event_code }, { siteUrl: getSiteUrl() });
      message = r.message;
      update = r.ok
        ? { verification_status: "connected", verification_method: r.method, verified_at: new Date().toISOString(), verification_message: r.message.slice(0, 500) }
        : { verification_status: "error", verification_method: r.method, verification_message: r.message.slice(0, 500) };
    }
  } else if (d.kind === "ga4" && secret) {
    const r = await verifyGa4({ publicId: d.public_id, secret }, { sendDebugEvent: true });
    message = r.message;
    // Google doesn't confirm the API secret: stays "pending" until the admin confirms DebugView
    update = r.ok ? { verification_message: r.message.slice(0, 500) } : { verification_status: "error", verification_message: r.message.slice(0, 500) };
  } else if (d.kind === "ga4") {
    message = "Browser-only property: open GA4 → Reports → Realtime (or Admin → DebugView with Test mode on), accept cookies on the shop and browse a product. When you see the visit, press “I saw the events”.";
  } else if (d.kind === "gtm") {
    message = "Open Tag Manager → Preview, enter this website's address and accept cookies on the shop: the container must show as connected and the shop events (view_item, add_to_cart …) must appear. Then press “I saw the events”.";
  } else {
    message = "Google Ads has no test API for conversions. Place a test order after accepting cookies, then check Google Ads → Goals → Conversions → Diagnostics (it can take hours). Then press “I saw the events”.";
  }
  if (Object.keys(update).length) {
    const { error } = await a.supabase.from("tracking_destinations").update(update).eq("id", d.id);
    if (error) return { ok: false, message: dbError(error.message, error.code) };
    changed();
  }
  await audit(a.session.userId, "account_verified", `${d.kind}:${d.public_id}`, [String(update.verification_status ?? "instructions")]);
  const status = String(update.verification_status ?? d.verification_status);
  return { ok: status !== "error", message, data: { status, message } };
}

/** The admin saw the events in the provider's own tool (GA4 DebugView, GTM Preview, Events Manager). */
export async function confirmDestinationAction(id: unknown): Promise<ActionResult> {
  const a = await admin();
  if ("error" in a) return { ok: false, message: a.error };
  const pid = idSchema.safeParse(id);
  if (!pid.success) return { ok: false, message: "Invalid request." };
  const { data } = await a.supabase.from("tracking_destinations").select("kind, public_id, is_enabled").eq("id", pid.data).maybeSingle();
  const d = data as { kind: string; public_id: string; is_enabled: boolean } | null;
  if (!d) return { ok: false, message: "This account no longer exists." };
  if (!d.is_enabled) return { ok: false, message: "Turn the account on first, then check it." };
  const { error } = await a.supabase
    .from("tracking_destinations")
    .update({
      verification_status: "connected",
      verification_method: "manual",
      verified_at: new Date().toISOString(),
      verification_message: `Confirmed by ${a.session.email ?? "an admin"} in the provider's own test tool.`.slice(0, 500),
    })
    .eq("id", pid.data);
  if (error) return { ok: false, message: dbError(error.message, error.code) };
  await audit(a.session.userId, "account_confirmed_manually", `${d.kind}:${d.public_id}`);
  changed();
  return { ok: true, message: "Marked as checked" };
}

// ---------------------------------------------------------------------------
// Event routing and consent
// ---------------------------------------------------------------------------

export async function saveRoutesAction(input: unknown): Promise<ActionResult> {
  const a = await admin();
  if ("error" in a) return { ok: false, message: a.error };
  if (!input || typeof input !== "object" || Array.isArray(input) || JSON.stringify(input).length > 20000) return { ok: false, message: "Invalid routing." };
  const unknownEvent = Object.keys(input).find((k) => !(TRACKED_EVENTS as readonly string[]).includes(k));
  if (unknownEvent) return { ok: false, message: `Unknown event: ${unknownEvent.slice(0, 40)}` };
  const { data } = await a.supabase.from("tracking_destinations").select("id");
  const routes = sanitizeRoutes(input, new Set(((data ?? []) as { id: string }[]).map((d) => d.id)));
  const { error } = await a.supabase.from("tracking_settings").update({ routes, updated_by: a.session.userId }).eq("id", 1);
  if (error) return { ok: false, message: dbError(error.message, error.code) };
  await audit(a.session.userId, "routing_saved", null, Object.keys(routes));
  changed();
  return { ok: true, message: "Event routing saved" };
}

const consentSchema = z.object({
  banner: z.boolean(),
  analytics: z.boolean(),
  advertising: z.boolean(),
  defaultAnalytics: z.enum(["denied", "granted"]),
  defaultAdvertising: z.enum(["denied", "granted"]),
  version: z.string().trim().regex(/^[A-Za-z0-9._-]{1,20}$/, "The policy version is 1–20 letters, digits, dots or dashes (e.g. 2026-10)."),
});

export async function saveConsentAction(input: unknown): Promise<ActionResult> {
  const a = await admin();
  if ("error" in a) return { ok: false, message: a.error };
  const parsed = consentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Please check the fields." };
  const c = parsed.data;
  const { error } = await a.supabase
    .from("tracking_settings")
    .update({
      consent_banner_enabled: c.banner,
      consent_analytics_enabled: c.analytics,
      consent_advertising_enabled: c.advertising,
      consent_default_analytics: c.defaultAnalytics,
      consent_default_advertising: c.defaultAdvertising,
      consent_policy_version: c.version,
      updated_by: a.session.userId,
    })
    .eq("id", 1);
  if (error) return { ok: false, message: dbError(error.message, error.code) };
  await audit(a.session.userId, "consent_saved", null, Object.keys(c));
  changed();
  return { ok: true, message: "Consent settings saved" };
}

// ---------------------------------------------------------------------------
// Delivery queue
// ---------------------------------------------------------------------------

/** Retry failed server events (only ones that still have their data, max 7 days old). */
export async function retryFailedEventsAction(ids: unknown): Promise<ActionResult<{ requeued: number }>> {
  const a = await admin();
  if ("error" in a) return { ok: false, message: a.error };
  const parsed = z.array(z.number().int().positive()).max(100).safeParse(ids);
  if (!parsed.success || !parsed.data.length) return { ok: false, message: "Nothing selected." };
  const key = await getServerKey();
  const pub = getPublicClient();
  if (!key || !pub) return { ok: false, message: "Server-side delivery isn't set up (no server key)." };
  const { data, error } = await pub.rpc("tracking_requeue", { p_key: key, p_ids: parsed.data });
  if (error) return { ok: false, message: dbError(error.message, error.code) };
  const n = Number(data) || 0;
  await audit(a.session.userId, "events_requeued", null, [String(n)]);
  const result = await deliverOutbox({ ids: parsed.data, limit: 20 });
  return { ok: true, message: `${n} event(s) queued again: ${result.delivered} delivered, ${result.retry} will retry, ${result.failed} failed.`, data: { requeued: n } };
}

/** Send events that are due for a retry now (otherwise they go with the next order). */
export async function processQueueAction(): Promise<ActionResult> {
  const a = await admin();
  if ("error" in a) return { ok: false, message: a.error };
  const r = await deliverOutbox({ limit: 20 });
  return { ok: true, message: r.delivered + r.retry + r.failed ? `Processed: ${r.delivered} delivered, ${r.retry} will retry, ${r.failed} failed.` : "No events were due." };
}
