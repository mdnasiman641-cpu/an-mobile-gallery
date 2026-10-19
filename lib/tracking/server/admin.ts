import "server-only";
import { createClient } from "@/lib/supabase/server";
import { encryptionAvailable } from "@/lib/ai/crypto";
import { DEFAULT_CONSENT_SETTINGS, type ConsentSettings } from "@/lib/tracking/consent";
import { sanitizeRoutes, type Routes } from "@/lib/tracking/routing";
import type { DestinationView } from "@/lib/tracking/status";
import { getServerKey, serverKeyHash, serverKeySource } from "@/lib/tracking/server/key";

/**
 * Admin-side reads for Admin → Analytics & Tracking, with the signed-in
 * admin's own session (RLS: admins only). Secrets are never part of what is
 * returned: only whether one is saved, its last 4 characters and when.
 */

export interface DestinationRow {
  id: string;
  kind: DestinationView["kind"];
  name: string;
  is_enabled: boolean;
  is_default: boolean;
  public_id: string;
  conversion_label: string | null;
  server_container_url: string | null;
  business_id: string | null;
  ad_account_id: string | null;
  browser_enabled: boolean;
  server_enabled: boolean;
  ga4_browser_delivery: "gtag" | "gtm";
  debug_mode: boolean;
  enhanced_conversions: boolean;
  advanced_matching: boolean;
  test_event_code: string | null;
  secret_ciphertext: string | null;
  secret_hint: string | null;
  secret_updated_at: string | null;
  verification_status: DestinationView["verificationStatus"];
  verification_method: DestinationView["verificationMethod"];
  verification_message: string | null;
  verified_at: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error_code: string | null;
  failed_count: number;
  created_at: string;
  updated_at: string;
}

/** Everything except the ciphertext (the column is never selected for the page). */
export const VIEW_COLUMNS =
  "id, kind, name, is_enabled, is_default, public_id, conversion_label, server_container_url, business_id, ad_account_id, browser_enabled, server_enabled, ga4_browser_delivery, debug_mode, enhanced_conversions, advanced_matching, test_event_code, secret_hint, secret_updated_at, verification_status, verification_method, verification_message, verified_at, last_success_at, last_error_at, last_error_code, failed_count, created_at, updated_at";

export function toView(r: Omit<DestinationRow, "secret_ciphertext"> & { secret_ciphertext?: string | null }): DestinationView {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    isEnabled: r.is_enabled,
    isDefault: r.is_default,
    publicId: r.public_id,
    conversionLabel: r.conversion_label,
    serverContainerUrl: r.server_container_url,
    businessId: r.business_id,
    adAccountId: r.ad_account_id,
    browserEnabled: r.browser_enabled,
    serverEnabled: r.server_enabled,
    ga4Delivery: r.ga4_browser_delivery,
    debug: r.debug_mode,
    enhanced: r.enhanced_conversions,
    advancedMatching: r.advanced_matching,
    testEventCode: r.test_event_code,
    hasSecret: Boolean(r.secret_hint),
    secretHint: r.secret_hint,
    secretUpdatedAt: r.secret_updated_at,
    verificationStatus: r.verification_status,
    verificationMethod: r.verification_method,
    verificationMessage: r.verification_message,
    verifiedAt: r.verified_at,
    lastSuccessAt: r.last_success_at,
    lastErrorAt: r.last_error_at,
    lastErrorCode: r.last_error_code,
    failedCount: r.failed_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface OutboxView {
  id: number;
  eventName: string;
  channel: "meta_capi" | "ga4_mp";
  destinationId: string;
  transactionId: string | null;
  isTest: boolean;
  status: "pending" | "processing" | "delivered" | "failed";
  attempts: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  responseSummary: string | null;
  createdAt: string;
  deliveredAt: string | null;
  retryable: boolean;
}

export interface TrackingStats {
  byDestination: { destinationId: string; channel: string; status: string; count: number; last: string | null }[];
  testEvents: number;
  purchases: number;
  purchasesWithAdConsent: number;
  refunds: number;
  lastPurchaseAt: string | null;
}

export interface TrackingAdminData {
  migrationMissing: boolean;
  consent: ConsentSettings;
  routes: Routes;
  purchaseTrigger: "order_placed";
  destinations: DestinationView[];
  stats: TrackingStats | null;
  recent: OutboxView[];
  audit: { id: number; action: string; target: string | null; fields: string[]; createdAt: string }[];
  serverKey: { source: "r2" | "env" | "none"; registered: boolean };
  encryptionAvailable: boolean;
}

/** Make sure the Worker's server key exists and the database knows its hash (admin session). */
export async function ensureServerKeyRegistered(currentHash: string | null): Promise<boolean> {
  try {
    const key = await getServerKey({ create: true });
    if (!key) return false;
    const hash = await serverKeyHash(key);
    if (hash === currentHash) return true;
    const supabase = await createClient();
    const { error } = await supabase.from("tracking_settings").update({ server_key_hash: hash }).eq("id", 1);
    return !error;
  } catch {
    return false;
  }
}

export async function readTrackingAdmin(): Promise<TrackingAdminData> {
  const supabase = await createClient();
  const [settingsRes, destRes, statsRes, recentRes, auditRes] = await Promise.all([
    supabase.from("tracking_settings").select("*").eq("id", 1).maybeSingle(),
    supabase.from("tracking_destinations").select(VIEW_COLUMNS).order("kind").order("created_at"),
    supabase.rpc("tracking_stats"),
    supabase
      .from("tracking_outbox")
      .select("id, event_name, channel, destination_id, transaction_id, is_test, status, attempts, last_error_code, last_error_message, response_summary, created_at, delivered_at")
      .order("created_at", { ascending: false })
      .limit(25),
    supabase.from("tracking_audit_log").select("id, action, target, details, created_at").order("created_at", { ascending: false }).limit(20),
  ]);
  const migrationMissing = Boolean(settingsRes.error) || !settingsRes.data;
  const s = (settingsRes.data ?? {}) as Record<string, unknown>;
  const destinations = ((destRes.data ?? []) as unknown as DestinationRow[]).map(toView);
  const consent: ConsentSettings = {
    banner: s.consent_banner_enabled !== false,
    analytics: s.consent_analytics_enabled !== false,
    advertising: s.consent_advertising_enabled !== false,
    defaultAnalytics: s.consent_default_analytics === "granted" ? "granted" : "denied",
    defaultAdvertising: s.consent_default_advertising === "granted" ? "granted" : "denied",
    version: typeof s.consent_policy_version === "string" ? s.consent_policy_version : DEFAULT_CONSENT_SETTINGS.version,
  };
  const registered = migrationMissing ? false : await ensureServerKeyRegistered((s.server_key_hash as string | null) ?? null);
  type RecentRow = {
    id: number;
    event_name: string;
    channel: "meta_capi" | "ga4_mp";
    destination_id: string;
    transaction_id: string | null;
    is_test: boolean;
    status: OutboxView["status"];
    attempts: number;
    last_error_code: string | null;
    last_error_message: string | null;
    response_summary: string | null;
    created_at: string;
    delivered_at: string | null;
  };
  return {
    migrationMissing,
    consent,
    routes: sanitizeRoutes(s.routes, new Set(destinations.map((d) => d.id))),
    purchaseTrigger: "order_placed",
    destinations,
    stats: statsRes.error ? null : (statsRes.data as TrackingStats),
    recent: ((recentRes.data ?? []) as unknown as RecentRow[]).map((r) => ({
      id: r.id,
      eventName: r.event_name,
      channel: r.channel,
      destinationId: r.destination_id,
      transactionId: r.transaction_id,
      isTest: r.is_test,
      status: r.status,
      attempts: r.attempts,
      lastErrorCode: r.last_error_code,
      lastErrorMessage: r.last_error_message,
      responseSummary: r.response_summary,
      createdAt: r.created_at,
      deliveredAt: r.delivered_at,
      retryable: r.status === "failed" && Date.now() - Date.parse(r.created_at) < 7 * 86_400_000 && r.last_error_code !== "EXPIRED",
    })),
    audit: ((auditRes.data ?? []) as { id: number; action: string; target: string | null; details: { fields?: unknown } | null; created_at: string }[]).map((a) => ({
      id: a.id,
      action: a.action,
      target: a.target,
      fields: Array.isArray(a.details?.fields) ? (a.details.fields as unknown[]).filter((f): f is string => typeof f === "string") : [],
      createdAt: a.created_at,
    })),
    serverKey: { source: await serverKeySource(), registered },
    encryptionAvailable: await encryptionAvailable(),
  };
}
