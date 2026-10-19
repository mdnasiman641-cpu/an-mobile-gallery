/**
 * Customer-matching data for ad platforms: normalised, then SHA-256 hashed.
 * Only the email address and the mobile number are ever hashed; names,
 * addresses, passwords and payment data are never sent anywhere.
 * Raw values never leave this module.
 *
 * Normalisation follows Meta's and Google's published rules:
 *  - email: trimmed, lower-case;
 *  - phone: digits only with the country code, no leading zeros or "+"
 *    (Bangladeshi 01XXXXXXXXX → 8801XXXXXXXXX). Google wants E.164 with "+"
 *    before hashing, so it gets its own form.
 */

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function normalizeEmail(email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
}

/** Digits with country code (Meta). Bangladeshi numbers only; anything else is not used. */
export function normalizePhone(phone: string | null | undefined): string | null {
  let d = (phone ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (/^01[3-9][0-9]{8}$/.test(d)) d = `88${d}`;
  return /^8801[3-9][0-9]{8}$/.test(d) ? d : null;
}

/** Hashed matching values, or nothing when the input isn't a valid email / BD mobile number. */
export async function hashedMatchData(input: { email?: string | null; phone?: string | null }): Promise<{ em?: string; ph?: string; googleEmail?: string; googlePhone?: string }> {
  const out: { em?: string; ph?: string; googleEmail?: string; googlePhone?: string } = {};
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  if (email) {
    out.em = await sha256Hex(email);
    out.googleEmail = out.em;
  }
  if (phone) {
    out.ph = await sha256Hex(phone);
    out.googlePhone = await sha256Hex(`+${phone}`);
  }
  return out;
}
