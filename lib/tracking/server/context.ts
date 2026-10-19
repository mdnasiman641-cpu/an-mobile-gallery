import "server-only";
import { CONSENT_COOKIE, effectiveConsent, readCookie, type ConsentSettings, type EffectiveConsent } from "@/lib/tracking/consent";

/**
 * What the server may use from the visitor's request for server events.
 * Consent is read from the visitor's own consent cookie (same rule as the
 * browser). Meta cookies (_fbp/_fbc) and the GA client id are used only when
 * the matching category is allowed.
 */
export interface RequestContext {
  consent: EffectiveConsent;
  ip: string | null;
  userAgent: string | null;
  fbp: string | null;
  fbc: string | null;
  gaClientId: string | null;
  /** GA4 session ids by measurement id ("G-ABC123" → "1700000000"). */
  gaSessions: Record<string, string>;
  pageUrl: string | null;
}

/** "_ga=GA1.1.123456789.1700000000" → "123456789.1700000000" */
export function parseGaClientId(raw: string | null): string | null {
  if (!raw) return null;
  const m = /^GA1\.\d+\.(\d{1,20}\.\d{1,20})$/.exec(raw.trim());
  return m ? m[1] : null;
}

/** "_ga_ABC123=GS1.1.1700000000.3.1…" or "GS2.1.s1700000000$o3$g1…" → "1700000000" */
export function parseGaSessionId(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.trim();
  const gs2 = /^GS2\.\d+\.s(\d{1,20})/.exec(v);
  if (gs2) return gs2[1];
  const gs1 = /^GS1\.\d+\.(\d{1,20})\./.exec(v);
  return gs1 ? gs1[1] : null;
}

const FBP_RE = /^fb\.[0-9]\.[0-9]{10,16}\.[0-9]{1,30}$/;
const FBC_RE = /^fb\.[0-9]\.[0-9]{10,16}\.[A-Za-z0-9_-]{10,500}$/;

export function requestContext(headers: Headers, consentSettings: ConsentSettings, siteUrl: string): RequestContext {
  const cookie = headers.get("cookie");
  const consent = effectiveConsent(consentSettings, readCookie(cookie, CONSENT_COOKIE));
  const ip = (headers.get("cf-connecting-ip") ?? headers.get("x-forwarded-for")?.split(",")[0] ?? "").trim() || null;
  const ua = (headers.get("user-agent") ?? "").slice(0, 400) || null;
  const fbp = readCookie(cookie, "_fbp");
  const fbc = readCookie(cookie, "_fbc");
  const gaSessions: Record<string, string> = {};
  for (const part of (cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    const name = part.slice(0, i).trim();
    const m = /^_ga_([A-Z0-9]{4,16})$/.exec(name);
    if (m) {
      const sid = parseGaSessionId(part.slice(i + 1));
      if (sid) gaSessions[`G-${m[1]}`] = sid;
    }
  }
  const referer = headers.get("referer");
  const sameSite = referer && referer.startsWith(siteUrl) ? referer.slice(0, 500) : null;
  return {
    consent,
    ip: consent.advertising ? ip : null,
    userAgent: consent.advertising ? ua : null,
    fbp: consent.advertising && fbp && FBP_RE.test(fbp) ? fbp : null,
    fbc: consent.advertising && fbc && FBC_RE.test(fbc) ? fbc : null,
    gaClientId: consent.analytics ? parseGaClientId(readCookie(cookie, "_ga")) : null,
    gaSessions: consent.analytics ? gaSessions : {},
    pageUrl: sameSite,
  };
}
