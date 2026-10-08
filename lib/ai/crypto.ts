import "server-only";

/**
 * AI provider API keys are entered in Admin → Settings → AI and stored
 * encrypted (AES-256-GCM) in the database. They are never sent back to the
 * browser. Uses Web Crypto (works on Cloudflare Workers and Node).
 *
 * Encryption key, in order of preference:
 *  1. AI_KEYS_ENCRYPTION_SECRET (optional, 32+ characters), or
 *  2. derived (HKDF) from SUPABASE_SERVICE_ROLE_KEY, the server secret the
 *     site already needs for imports and AI. No extra Cloudflare setup.
 * Each stored value records which source encrypted it ("v1:" / "s1:"), so
 * adding the optional secret later does not break keys saved before.
 * If the source secret is rotated, saved API keys must be entered again.
 */

type Source = "v1" | "s1";
const HKDF_INFO = "an-mobile-gallery/ai-provider-keys/v1";

function explicitSecret(): string | null {
  const s = process.env.AI_KEYS_ENCRYPTION_SECRET;
  return s && s.length >= 32 ? s : null;
}

function serviceSecret(): string | null {
  const s = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return s && s.length >= 20 ? s : null;
}

/** Can keys be saved and used on this server? */
export function isEncryptionConfigured(): boolean {
  return explicitSecret() !== null || serviceSecret() !== null;
}

async function keyFor(source: Source): Promise<CryptoKey> {
  const enc = new TextEncoder();
  if (source === "v1") {
    const s = explicitSecret();
    if (!s) throw new Error("This API key was saved with AI_KEYS_ENCRYPTION_SECRET, which is no longer set. Enter the key again.");
    const digest = await crypto.subtle.digest("SHA-256", enc.encode(s));
    return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  }
  const s = serviceSecret();
  if (!s) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set on the server.");
  const base = await crypto.subtle.importKey("raw", enc.encode(s), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("an-mobile-gallery"), info: enc.encode(HKDF_INFO) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function toB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encryptSecret(plain: string): Promise<string> {
  const source: Source = explicitSecret() ? "v1" : "s1";
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFor(source), new TextEncoder().encode(plain));
  return `${source}:${toB64(iv)}:${toB64(new Uint8Array(ct))}`;
}

export async function decryptSecret(stored: string): Promise<string> {
  const [source, iv, ct] = stored.split(":");
  if ((source !== "v1" && source !== "s1") || !iv || !ct) throw new Error("Unrecognised key format");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, await keyFor(source), fromB64(ct));
  return new TextDecoder().decode(plain);
}

/** "…ab12" — enough for the admin to recognise a key, never enough to use it. */
export function keyHint(plain: string): string {
  return `…${plain.trim().slice(-4)}`;
}
