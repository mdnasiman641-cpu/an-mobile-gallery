import { TRACKED_EVENTS, type TrackedEvent } from "@/lib/tracking/events";
import type { ConsentChoice, ConsentSettings } from "@/lib/tracking/consent";

/**
 * Which configured account (destination) receives which event.
 *
 * Without an explicit route an event goes only to the DEFAULT account of each
 * kind (or the only enabled one), so adding a second GA4 property or Pixel
 * never doubles conversions by accident. An admin can pick any enabled
 * accounts per event in Admin → Analytics & Tracking → Event routing.
 *
 * Plain logic: used in the browser and on the server.
 */

export type DestinationKind = "gtm" | "ga4" | "meta" | "google_ads";
export const DESTINATION_KINDS: DestinationKind[] = ["gtm", "ga4", "meta", "google_ads"];

/** What the storefront receives (public IDs only). */
export interface PublicDestination {
  id: string;
  kind: DestinationKind;
  publicId: string;
  isDefault: boolean;
  conversionLabel: string | null;
  ga4Delivery: "gtag" | "gtm" | null;
  debug: boolean;
  enhanced: boolean;
  /** Meta: a server copy (Conversions API) is possible. */
  serverCopy: boolean;
}

export interface EventRoute {
  /** Explicit destination ids; absent = the default account of each kind. */
  destinations?: string[];
  /** Meta: also send this event from the server (Conversions API, same event_id). */
  metaServer?: boolean;
  /** GA4: send from the server (Measurement Protocol) INSTEAD of the browser. Purchase only. */
  ga4Server?: boolean;
}
export type Routes = Partial<Record<TrackedEvent, EventRoute>>;

/** Defaults when the admin hasn't changed an event's routing. */
export const DEFAULT_ROUTE: Partial<Record<TrackedEvent, EventRoute>> = {
  purchase: { metaServer: true, ga4Server: false },
};

export interface PublicTrackingConfig {
  consent: ConsentSettings;
  routes: Routes;
  destinations: PublicDestination[];
}

/** Events that GA4 may receive from the server instead of the browser. */
export const GA4_SERVER_EVENTS: readonly TrackedEvent[] = ["purchase"];

/** Consent category each kind needs. GTM loads with either; its tags must use Consent Mode. */
export function kindAllowed(kind: DestinationKind, c: ConsentChoice): boolean {
  if (kind === "ga4") return c.analytics;
  if (kind === "gtm") return c.analytics || c.advertising;
  return c.advertising; // meta, google_ads
}

export function routeFor(routes: Routes, event: TrackedEvent): EventRoute {
  return { ...(DEFAULT_ROUTE[event] ?? {}), ...(routes[event] ?? {}) };
}

/** Destinations of one kind that receive this event. */
export function destinationsFor<T extends { id: string; kind: DestinationKind; isDefault: boolean }>(
  all: T[],
  routes: Routes,
  event: TrackedEvent,
  kind: DestinationKind,
): T[] {
  const ofKind = all.filter((d) => d.kind === kind);
  const route = routeFor(routes, event);
  if (route.destinations) {
    const wanted = new Set(route.destinations);
    return ofKind.filter((d) => wanted.has(d.id));
  }
  const def = ofKind.find((d) => d.isDefault);
  if (def) return [def];
  return ofKind.length === 1 ? ofKind : [];
}

/** Keep only known events and well-formed values (admin input and stored JSON). */
export function sanitizeRoutes(raw: unknown, destinationIds: Set<string>): Routes {
  const out: Routes = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const event of TRACKED_EVENTS) {
    const r = (raw as Record<string, unknown>)[event];
    if (!r || typeof r !== "object" || Array.isArray(r)) continue;
    const o = r as Record<string, unknown>;
    const route: EventRoute = {};
    if (Array.isArray(o.destinations)) route.destinations = Array.from(new Set(o.destinations.filter((x): x is string => typeof x === "string" && destinationIds.has(x)))).slice(0, 10);
    if (typeof o.metaServer === "boolean") route.metaServer = o.metaServer;
    if (typeof o.ga4Server === "boolean" && (GA4_SERVER_EVENTS as readonly string[]).includes(event)) route.ga4Server = o.ga4Server;
    if (Object.keys(route).length) out[event] = route;
  }
  return out;
}
