/**
 * Visitor consent, stored in one first-party cookie ("amg_consent") so the
 * browser AND the server read the same choice:
 *   - the browser loads GTM / GA4 / Meta Pixel / Google Ads tags only for the
 *     categories allowed, and stops sending events when a choice is withdrawn;
 *   - the server (checkout, event relay) reads the cookie from the request and
 *     sends Meta Conversions API / GA4 Measurement Protocol events only when
 *     the same category is allowed. Server events never bypass the choice.
 *
 * The cookie itself is "necessary" (it remembers the choice). No tracking
 * cookie is set before the matching category is allowed.
 *
 * Plain logic: used in the browser and on the server.
 */

export const CONSENT_COOKIE = "amg_consent";
/** 6 months, then the visitor is asked again. */
export const CONSENT_MAX_AGE_DAYS = 180;

export interface ConsentSettings {
  banner: boolean;
  /** Category offered at all (off = never granted). */
  analytics: boolean;
  advertising: boolean;
  defaultAnalytics: "denied" | "granted";
  defaultAdvertising: "denied" | "granted";
  /** Changing it asks everyone again. */
  version: string;
}

export const DEFAULT_CONSENT_SETTINGS: ConsentSettings = {
  banner: true,
  analytics: true,
  advertising: true,
  defaultAnalytics: "denied",
  defaultAdvertising: "denied",
  version: "1",
};

export interface ConsentChoice {
  analytics: boolean;
  advertising: boolean;
}

export interface EffectiveConsent extends ConsentChoice {
  /** The visitor made a choice for the current policy version. */
  decided: boolean;
  /** Show the banner (asked for and not yet decided). */
  ask: boolean;
}

export function serializeConsent(choice: ConsentChoice, version: string, now = Date.now()): string {
  return `v:${version}|a:${choice.analytics ? 1 : 0}|m:${choice.advertising ? 1 : 0}|t:${Math.floor(now / 1000)}`;
}

export function parseConsent(raw: string | null | undefined): (ConsentChoice & { version: string; at: number }) | null {
  if (!raw) return null;
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const m = /^v:([A-Za-z0-9._-]{1,20})\|a:([01])\|m:([01])\|t:([0-9]{1,12})$/.exec(value.trim());
  if (!m) return null;
  return { version: m[1], analytics: m[2] === "1", advertising: m[3] === "1", at: Number(m[4]) * 1000 };
}

/** Read one cookie from a Cookie header / document.cookie string. */
export function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/**
 * The consent that applies right now. A category switched off by the admin is
 * never granted; a stored choice for an older policy version is ignored.
 */
export function effectiveConsent(settings: ConsentSettings, raw: string | null | undefined, now = Date.now()): EffectiveConsent {
  const stored = parseConsent(raw);
  const valid = stored && stored.version === settings.version && now - stored.at < CONSENT_MAX_AGE_DAYS * 86_400_000 && stored.at <= now + 86_400_000;
  const base: ConsentChoice = valid
    ? { analytics: stored.analytics, advertising: stored.advertising }
    : { analytics: settings.defaultAnalytics === "granted", advertising: settings.defaultAdvertising === "granted" };
  return {
    analytics: settings.analytics && base.analytics,
    advertising: settings.advertising && base.advertising,
    decided: Boolean(valid),
    ask: settings.banner && !valid && (settings.analytics || settings.advertising),
  };
}

/** Google Consent Mode v2 signals for a consent state. */
export function googleConsentState(c: ConsentChoice) {
  const g = (b: boolean) => (b ? "granted" : "denied");
  return {
    analytics_storage: g(c.analytics),
    ad_storage: g(c.advertising),
    ad_user_data: g(c.advertising),
    ad_personalization: g(c.advertising),
  } as const;
}
