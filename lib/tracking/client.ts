"use client";

import { dataLayerMessage, ga4Params, googleAdsConversion, metaEvent } from "@/lib/tracking/adapters";
import { CONSENT_COOKIE, CONSENT_MAX_AGE_DAYS, effectiveConsent, googleConsentState, readCookie, serializeConsent, type ConsentChoice, type EffectiveConsent } from "@/lib/tracking/consent";
import { destinationsFor, kindAllowed, routeFor, type PublicDestination, type PublicTrackingConfig } from "@/lib/tracking/routing";
import { CURRENCY, SERVER_COPY_EVENTS, itemId, itemsValue, newEventId, type TrackEvent, type TrackItem } from "@/lib/tracking/events";
import { hashedMatchData } from "@/lib/tracking/hash";
import type { CartItem } from "@/types";

/**
 * Browser side of tracking. One owner per event and destination:
 *  - GTM: one dataLayer message per event (GA4 ecommerce format);
 *  - GA4: sent directly with gtag only for properties set to "gtag" delivery
 *    (properties set to "via GTM" get events only through the dataLayer);
 *  - Meta Pixel: fbq trackSingle per routed pixel, with the event_id that the
 *    server copy (Conversions API) also uses;
 *  - Google Ads: purchase conversion only.
 * Nothing loads and nothing is sent without the matching consent. Tags load
 * once (guarded by id); page views are not doubled on client navigation.
 */

type Gtag = (...args: unknown[]) => void;
interface Fbq {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[];
  push: unknown;
  loaded: boolean;
  version: string;
  disablePushState?: boolean;
}
declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

let config: PublicTrackingConfig | null = null;
let consent: EffectiveConsent = { analytics: false, advertising: false, decided: false, ask: false };
let initialised = false;
const pending: { e: TrackEvent; opts: TrackOptions }[] = [];
const loaded = { gtag: false, gtm: new Set<string>(), gtagIds: new Set<string>(), meta: new Set<string>() };
const listeners = new Set<() => void>();

export interface TrackOptions {
  /** GA4 property ids that get this event from the server instead (purchase). */
  skipGa4?: string[];
  /** Raw email / phone for Google Ads enhanced conversions: hashed here, never sent raw. */
  userData?: { email?: string | null; phone?: string | null };
}

// ---- consent -------------------------------------------------------------------

export function getConsent(): EffectiveConsent {
  return consent;
}
export function getTrackingConfig(): PublicTrackingConfig | null {
  return config;
}
export function onTrackingChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const notify = () => listeners.forEach((l) => l());

function writeConsentCookie(choice: ConsentChoice, version: string) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(serializeConsent(choice, version))}; Max-Age=${CONSENT_MAX_AGE_DAYS * 86400}; Path=/; SameSite=Lax${secure}`;
}

/** Remove analytics / advertising cookies set on this site when consent is withdrawn. */
function clearTrackingCookies(which: { analytics: boolean; advertising: boolean }) {
  const names = document.cookie.split(";").map((c) => c.split("=")[0].trim());
  const host = location.hostname;
  const domains = ["", host, `.${host}`, `.${host.split(".").slice(-2).join(".")}`];
  for (const n of names) {
    const isAnalytics = /^_ga($|_)|^_gid$|^_gat/.test(n);
    const isAds = /^_fbp$|^_fbc$|^_gcl_/.test(n);
    if ((which.analytics && isAnalytics) || (which.advertising && isAds)) {
      for (const d of domains) document.cookie = `${n}=; Max-Age=0; Path=/${d ? `; Domain=${d}` : ""}`;
    }
  }
}

/** Save the visitor's choice and apply it now (load or stop tags). */
export function saveConsent(choice: ConsentChoice) {
  if (!config) return;
  const before = consent;
  const allowed = { analytics: config.consent.analytics && choice.analytics, advertising: config.consent.advertising && choice.advertising };
  writeConsentCookie(allowed, config.consent.version);
  consent = { ...allowed, decided: true, ask: false };
  if (window.gtag) window.gtag("consent", "update", googleConsentState(consent));
  if (window.fbq && loaded.meta.size) window.fbq("consent", consent.advertising ? "grant" : "revoke");
  if (window.dataLayer) window.dataLayer.push({ event: "amg_consent_update", analytics: consent.analytics, advertising: consent.advertising });
  clearTrackingCookies({ analytics: before.analytics && !consent.analytics, advertising: before.advertising && !consent.advertising });
  loadAllowedTags();
  notify();
}

// ---- tag loading ------------------------------------------------------------------

function ensureGtagStub(): Gtag {
  window.dataLayer = window.dataLayer ?? [];
  if (!window.gtag) {
    window.gtag = function gtag() {
      // gtag.js / GTM read the Arguments object itself
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments);
    };
    window.gtag("consent", "default", { ...googleConsentState(consent), wait_for_update: 500 });
  }
  return window.gtag;
}

function addScript(id: string, src: string) {
  if (document.getElementById(id)) return;
  const s = document.createElement("script");
  s.id = id;
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
}

function loadGtag(dest: PublicDestination) {
  const gtag = ensureGtagStub();
  if (!loaded.gtag) {
    loaded.gtag = true;
    gtag("js", new Date());
    addScript("amg-gtag", `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(dest.publicId)}`);
  }
  if (loaded.gtagIds.has(dest.publicId)) return;
  loaded.gtagIds.add(dest.publicId);
  if (dest.kind === "ga4") gtag("config", dest.publicId, dest.debug ? { debug_mode: true } : {});
  else gtag("config", dest.publicId, dest.enhanced ? { allow_enhanced_conversions: true } : {});
}

function loadGtm(dest: PublicDestination) {
  if (loaded.gtm.has(dest.publicId)) return;
  loaded.gtm.add(dest.publicId);
  ensureGtagStub();
  window.dataLayer!.push({ "gtm.start": Date.now(), event: "gtm.js" });
  addScript(`amg-gtm-${dest.publicId}`, `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(dest.publicId)}`);
}

function loadMeta(dest: PublicDestination) {
  if (!window.fbq) {
    const fbq = function (...args: unknown[]) {
      if (fbq.callMethod) fbq.callMethod(...args);
      else fbq.queue.push(args);
    } as Fbq;
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = "2.0";
    fbq.queue = [];
    // page views are sent by this site on each navigation; Meta's own history tracking would double them
    fbq.disablePushState = true;
    window.fbq = fbq;
    window._fbq = fbq;
    addScript("amg-fbevents", "https://connect.facebook.net/en_US/fbevents.js");
    fbq("consent", "grant");
  }
  if (loaded.meta.has(dest.publicId)) return;
  loaded.meta.add(dest.publicId);
  window.fbq("init", dest.publicId);
  window.fbq("trackSingle", dest.publicId, "PageView");
}

function loadAllowedTags() {
  if (!config) return;
  for (const d of config.destinations) {
    if (!kindAllowed(d.kind, consent)) continue;
    if (d.kind === "gtm") loadGtm(d);
    else if (d.kind === "ga4" && d.ga4Delivery !== "gtm") loadGtag(d);
    else if (d.kind === "google_ads") loadGtag(d);
    else if (d.kind === "meta") loadMeta(d);
  }
}

// ---- setup / page views -----------------------------------------------------------

/** Called once by <TrackingRoot>. Queued events from the first render are sent (or dropped) now. */
export function initTracking(cfg: PublicTrackingConfig | null) {
  if (initialised) return;
  initialised = true;
  config = cfg;
  consent = cfg ? effectiveConsent(cfg.consent, readCookie(document.cookie, CONSENT_COOKIE)) : consent;
  if (cfg) loadAllowedTags();
  const queued = pending.splice(0);
  if (cfg) for (const q of queued) dispatch(q.e, q.opts);
  notify();
}

let lastPage: string | null = null;
/** Client-side navigation. GA4 counts these itself (enhanced measurement); GTM and Meta get one message each. */
export function trackPageView(path: string) {
  if (!config || path === lastPage) return;
  const first = lastPage === null;
  lastPage = path;
  if (first) return; // the first page view is sent when each tag loads
  if (loaded.gtm.size && kindAllowed("gtm", consent)) window.dataLayer?.push({ event: "amg_page_view", page_location: location.href, page_path: path, page_title: document.title });
  if (window.fbq && consent.advertising) for (const id of loaded.meta) window.fbq("trackSingle", id, "PageView");
}

// ---- events -------------------------------------------------------------------------

function sendServerCopy(e: TrackEvent) {
  try {
    const body = JSON.stringify({ ...e, page_location: location.href.slice(0, 500) });
    void fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true, credentials: "same-origin" }).catch(() => undefined);
  } catch {
    /* never break the page */
  }
}

function dispatch(e: TrackEvent, opts: TrackOptions) {
  if (!config) return;
  const { routes, destinations } = config;
  try {
    // GTM (one dataLayer for every container)
    if (loaded.gtm.size && kindAllowed("gtm", consent) && destinationsFor(destinations, routes, e.name, "gtm").length) {
      window.dataLayer!.push({ ecommerce: null });
      window.dataLayer!.push(dataLayerMessage(e));
    }
    // GA4 direct (gtag)
    if (consent.analytics && window.gtag) {
      for (const d of destinationsFor(destinations, routes, e.name, "ga4")) {
        if (d.ga4Delivery === "gtm" || !loaded.gtagIds.has(d.publicId)) continue;
        // the server sent this one (Measurement Protocol): never both
        if (opts.skipGa4?.includes(d.id)) continue;
        window.gtag("event", e.name, { ...ga4Params(e), event_id: e.event_id, send_to: d.publicId });
      }
    }
    // Meta Pixel (+ server copy with the same event_id)
    const m = metaEvent(e);
    if (m && consent.advertising) {
      const pixels = destinationsFor(destinations, routes, e.name, "meta");
      if (window.fbq) for (const d of pixels) if (loaded.meta.has(d.publicId)) window.fbq("trackSingle", d.publicId, m.name, m.data, { eventID: e.event_id });
      if (routeFor(routes, e.name).metaServer && SERVER_COPY_EVENTS.includes(e.name) && pixels.some((d) => d.serverCopy)) sendServerCopy(e);
    }
    // Google Ads: purchase conversion
    if (e.name === "purchase" && consent.advertising && window.gtag) {
      const ads = destinationsFor(destinations, routes, e.name, "google_ads").filter((d) => d.conversionLabel && loaded.gtagIds.has(d.publicId));
      if (ads.length) {
        const send = () => {
          for (const d of ads) window.gtag!("event", "conversion", googleAdsConversion(e, d.publicId, d.conversionLabel as string));
        };
        if (opts.userData && ads.some((d) => d.enhanced)) {
          // enhanced conversions: only SHA-256 hashes leave the browser
          void hashedMatchData(opts.userData)
            .then((h) => {
              const user: Record<string, string> = {};
              if (h.googleEmail) user.sha256_email_address = h.googleEmail;
              if (h.googlePhone) user.sha256_phone_number = h.googlePhone;
              if (Object.keys(user).length) window.gtag!("set", "user_data", user);
            })
            .catch(() => undefined)
            .finally(send);
        } else send();
      }
    }
  } catch {
    /* tracking never breaks the page */
  }
}

/** Send one storefront event to every allowed, routed destination. */
export function track(input: Omit<TrackEvent, "event_id"> & { event_id?: string }, opts: TrackOptions = {}) {
  if (typeof window === "undefined") return;
  const e: TrackEvent = { ...input, event_id: input.event_id ?? newEventId(input.name) };
  if (!initialised) {
    if (pending.length < 30) pending.push({ e, opts });
    return;
  }
  dispatch(e, opts);
}

/** Purchase from the checkout result: sent once per order in this browser (refresh / back never repeats it). */
export function trackPurchase(event: TrackEvent, opts: TrackOptions) {
  if (typeof window === "undefined" || event.name !== "purchase" || !event.transaction_id) return;
  const key = `amg-tx-${event.transaction_id}`;
  try {
    if (sessionStorage.getItem(key) || localStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    localStorage.setItem(key, "1");
  } catch {
    /* storage blocked: the shared event_id / transaction_id still lets Meta and GA4 drop repeats */
  }
  track(event, { ...opts, skipGa4: opts.skipGa4 ?? [] });
}

// ---- helpers for components ---------------------------------------------------------

export function productItem(p: {
  productId: string;
  variantId?: string | null;
  name: string;
  price?: number | null;
  quantity?: number;
  brand?: string | null;
  category?: string | null;
  variant?: string | null;
  index?: number;
}): TrackItem {
  return {
    item_id: itemId(p.productId, p.variantId),
    item_name: p.name.slice(0, 200),
    ...(p.brand ? { item_brand: p.brand.slice(0, 80) } : {}),
    ...(p.category ? { item_category: p.category.slice(0, 80) } : {}),
    ...(p.variant ? { item_variant: p.variant.slice(0, 120) } : {}),
    ...(p.price !== undefined && p.price !== null && Number.isFinite(Number(p.price)) ? { price: Math.max(0, Number(p.price)) } : {}),
    quantity: Math.max(1, Math.min(100, p.quantity ?? 1)),
    ...(p.index !== undefined ? { index: p.index } : {}),
  };
}

/** Tracking item for a cart line (price as stored in the cart; checkout re-prices on the server). */
export function cartTrackItem(i: CartItem, quantity = i.quantity): TrackItem {
  return productItem({ productId: i.productId, variantId: i.variantId, name: i.name, variant: i.variantLabel, price: i.price, quantity });
}

export function itemsEvent(name: TrackEvent["name"], items: TrackItem[], extra: Partial<TrackEvent> = {}): Omit<TrackEvent, "event_id"> {
  const value = itemsValue(items);
  return { name, currency: CURRENCY, ...(value !== undefined ? { value } : {}), items, ...extra };
}

/** Tests only. */
export function __resetTrackingForTests() {
  config = null;
  consent = { analytics: false, advertising: false, decided: false, ask: false };
  initialised = false;
  pending.length = 0;
  loaded.gtag = false;
  loaded.gtm.clear();
  loaded.gtagIds.clear();
  loaded.meta.clear();
  lastPage = null;
}
