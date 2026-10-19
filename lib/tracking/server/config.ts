import "server-only";
import { unstable_cache } from "next/cache";
import { getPublicClient } from "@/lib/supabase/public";
import { CACHE_TAGS } from "@/lib/cache";
import { DEFAULT_CONSENT_SETTINGS, type ConsentSettings } from "@/lib/tracking/consent";
import { DESTINATION_KINDS, sanitizeRoutes, type DestinationKind, type PublicDestination, type PublicTrackingConfig, type Routes } from "@/lib/tracking/routing";
import { getServerKey } from "@/lib/tracking/server/key";

/**
 * Tracking configuration as the website uses it.
 *  - Public (storefront): IDs only, cached across requests (tag "tracking"),
 *    so no database query on each page view. Null when nothing is set up or
 *    migration 0015 hasn't been run: then no tag loads and no banner shows.
 *  - Server: includes the encrypted secrets; read with the server key and
 *    kept in memory for 30 seconds per Worker instance.
 */

function consentFrom(raw: unknown): ConsentSettings {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const ver = typeof c.version === "string" && /^[A-Za-z0-9._-]{1,20}$/.test(c.version) ? c.version : DEFAULT_CONSENT_SETTINGS.version;
  return {
    banner: c.banner !== false,
    analytics: c.analytics !== false,
    advertising: c.advertising !== false,
    defaultAnalytics: c.defaultAnalytics === "granted" ? "granted" : "denied",
    defaultAdvertising: c.defaultAdvertising === "granted" ? "granted" : "denied",
    version: ver,
  };
}

const kindOf = (v: unknown): DestinationKind | null => (DESTINATION_KINDS as string[]).includes(String(v)) ? (v as DestinationKind) : null;

export function parsePublicConfig(raw: unknown): PublicTrackingConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const destinations: PublicDestination[] = [];
  for (const d of Array.isArray(r.destinations) ? r.destinations : []) {
    const o = (d ?? {}) as Record<string, unknown>;
    const kind = kindOf(o.kind);
    if (!kind || typeof o.id !== "string" || typeof o.publicId !== "string") continue;
    destinations.push({
      id: o.id,
      kind,
      publicId: o.publicId,
      isDefault: o.isDefault === true,
      conversionLabel: typeof o.conversionLabel === "string" ? o.conversionLabel : null,
      ga4Delivery: o.ga4Delivery === "gtm" ? "gtm" : kind === "ga4" ? "gtag" : null,
      debug: o.debug === true,
      enhanced: o.enhanced === true,
      serverCopy: o.serverCopy === true,
    });
  }
  return { consent: consentFrom(r.consent), routes: sanitizeRoutes(r.routes, new Set(destinations.map((d) => d.id))), destinations };
}

const loadPublic = unstable_cache(
  async (): Promise<PublicTrackingConfig | null> => {
    const supabase = getPublicClient();
    if (!supabase) return null;
    const { data, error } = await supabase.rpc("tracking_public_config");
    if (error) {
      // migration 0015 not run yet: tracking stays off (cached; an admin save refreshes it)
      if (error.code === "PGRST202" || /could not find the function|does not exist/i.test(error.message)) return null;
      throw new Error("tracking config unavailable"); // temporary problem: not cached, tried again next time
    }
    return parsePublicConfig(data);
  },
  ["tracking-public-config-v1"],
  { tags: [CACHE_TAGS.tracking], revalidate: 86400 },
);

/** Storefront config, or null when there is nothing to load (no destinations, no banner needed). */
export async function getPublicTrackingConfig(): Promise<PublicTrackingConfig | null> {
  try {
    const cfg = await loadPublic();
    return cfg && cfg.destinations.length ? cfg : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------

export interface ServerDestination {
  id: string;
  kind: DestinationKind;
  name: string;
  publicId: string;
  isDefault: boolean;
  browserEnabled: boolean;
  serverEnabled: boolean;
  ga4Delivery: "gtag" | "gtm";
  /** Test mode: Meta events carry the Test Event Code; GA4 events go to DebugView. */
  debug: boolean;
  advancedMatching: boolean;
  testEventCode: string | null;
  secretCiphertext: string | null;
}

export interface ServerTrackingConfig {
  consent: ConsentSettings;
  routes: Routes;
  purchaseTrigger: "order_placed";
  destinations: ServerDestination[];
}

export function parseServerConfig(raw: unknown): ServerTrackingConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const destinations: ServerDestination[] = [];
  for (const d of Array.isArray(r.destinations) ? r.destinations : []) {
    const o = (d ?? {}) as Record<string, unknown>;
    const kind = kindOf(o.kind);
    if (!kind || typeof o.id !== "string" || typeof o.publicId !== "string") continue;
    destinations.push({
      id: o.id,
      kind,
      name: typeof o.name === "string" ? o.name : kind,
      publicId: o.publicId,
      isDefault: o.isDefault === true,
      browserEnabled: o.browserEnabled !== false,
      serverEnabled: o.serverEnabled === true,
      ga4Delivery: o.ga4Delivery === "gtm" ? "gtm" : "gtag",
      debug: o.debug === true,
      advancedMatching: o.advancedMatching === true,
      testEventCode: typeof o.testEventCode === "string" ? o.testEventCode : null,
      secretCiphertext: typeof o.secretCiphertext === "string" ? o.secretCiphertext : null,
    });
  }
  return {
    consent: consentFrom(r.consent),
    routes: sanitizeRoutes(r.routes, new Set(destinations.map((d) => d.id))),
    purchaseTrigger: "order_placed",
    destinations,
  };
}

let serverCache: { cfg: ServerTrackingConfig | null; at: number } | null = null;

/** Full config for server-side delivery, or null (no server key yet / migration missing / no destinations). */
export async function getServerTrackingConfig(): Promise<{ cfg: ServerTrackingConfig; key: string } | null> {
  try {
    const key = await getServerKey();
    if (!key) return null;
    if (!serverCache || Date.now() - serverCache.at > 30_000) {
      const supabase = getPublicClient();
      if (!supabase) return null;
      const { data, error } = await supabase.rpc("tracking_server_config", { p_key: key });
      serverCache = { cfg: error ? null : parseServerConfig(data), at: Date.now() };
    }
    const cfg = serverCache.cfg;
    return cfg && cfg.destinations.length ? { cfg, key } : null;
  } catch {
    return null;
  }
}

export function resetServerConfigCache() {
  serverCache = null;
}
