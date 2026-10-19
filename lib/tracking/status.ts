import type { DestinationKind } from "@/lib/tracking/routing";

/**
 * Status labels for Admin → Analytics & Tracking. "Connected" only ever comes
 * from a real verification (an API answer from Meta, or the admin confirming
 * they saw the test event in GA4 / GTM / Events Manager) — never from an ID
 * or token merely being saved. Plain logic (tested).
 */

export type StatusCode = "not_configured" | "disabled" | "pending" | "connected" | "error" | "last_failed";

export const STATUS_LABEL: Record<StatusCode, string> = {
  not_configured: "Not configured",
  disabled: "Disabled",
  pending: "Configuration saved — verification pending",
  connected: "Connected",
  error: "Error",
  last_failed: "Last event failed",
};

export const STATUS_TONE: Record<StatusCode, "neutral" | "signal" | "warn" | "deal"> = {
  not_configured: "neutral",
  disabled: "neutral",
  pending: "warn",
  connected: "signal",
  error: "deal",
  last_failed: "deal",
};

export interface DestinationView {
  id: string;
  kind: DestinationKind;
  name: string;
  isEnabled: boolean;
  isDefault: boolean;
  publicId: string;
  conversionLabel: string | null;
  serverContainerUrl: string | null;
  businessId: string | null;
  adAccountId: string | null;
  browserEnabled: boolean;
  serverEnabled: boolean;
  ga4Delivery: "gtag" | "gtm";
  debug: boolean;
  enhanced: boolean;
  advancedMatching: boolean;
  testEventCode: string | null;
  hasSecret: boolean;
  secretHint: string | null;
  secretUpdatedAt: string | null;
  verificationStatus: "unverified" | "connected" | "error";
  verificationMethod: "api" | "test_event" | "manual" | null;
  verificationMessage: string | null;
  verifiedAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  failedCount: number;
  createdAt: string;
  updatedAt: string;
}

const t = (s: string | null) => (s ? Date.parse(s) : 0);

export function destinationStatus(d: DestinationView): StatusCode {
  if (!d.isEnabled) return "disabled";
  if (d.verificationStatus === "error") return "error";
  if (d.lastErrorAt && t(d.lastErrorAt) > t(d.lastSuccessAt) && t(d.lastErrorAt) > t(d.verifiedAt)) return "last_failed";
  if (d.verificationStatus === "connected") return "connected";
  return "pending";
}

/** Status of a kind as a whole (overview card). */
export function kindStatus(list: DestinationView[]): StatusCode {
  if (!list.length) return "not_configured";
  const enabled = list.filter((d) => d.isEnabled);
  if (!enabled.length) return "disabled";
  const codes = enabled.map(destinationStatus);
  for (const c of ["error", "last_failed", "pending"] as const) if (codes.includes(c)) return c;
  return "connected";
}

/** Meta Conversions API card: only Meta accounts with server sending on. */
export function capiStatus(list: DestinationView[]): StatusCode {
  const server = list.filter((d) => d.kind === "meta" && d.serverEnabled);
  if (!server.length) return "not_configured";
  if (server.some((d) => d.isEnabled && !d.hasSecret)) return "error";
  return kindStatus(server);
}

export const KIND_LABEL: Record<DestinationKind, string> = {
  gtm: "Google Tag Manager (web container)",
  ga4: "Google Analytics 4",
  meta: "Meta Pixel / Dataset",
  google_ads: "Google Ads conversion",
};

/** Format checks (same rules as the database). */
export const ID_FORMAT: Record<DestinationKind, { re: RegExp; example: string; hint: string }> = {
  gtm: { re: /^GTM-[A-Z0-9]{4,12}$/, example: "GTM-ABC1234", hint: "Tag Manager → your container → the ID next to the container name." },
  ga4: { re: /^G-[A-Z0-9]{4,16}$/, example: "G-ABCDE12345", hint: "GA4 → Admin → Data streams → your web stream → Measurement ID." },
  meta: { re: /^[0-9]{6,20}$/, example: "123456789012345", hint: "Meta Events Manager → Data sources → your dataset (Pixel) → Dataset ID." },
  google_ads: { re: /^AW-[0-9]{6,15}$/, example: "AW-123456789", hint: "Google Ads → Goals → Conversions → your conversion → Tag setup → Conversion ID." },
};
