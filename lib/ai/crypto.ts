import "server-only";

/**
 * API keys for AI providers are stored encrypted (AES-256-GCM). The key is
 * derived from AI_KEYS_ENCRYPTION_SECRET, a server-only secret set in
 * Cloudflare (Worker → Settings → Variables and Secrets, type "Secret").
 * Without it, keys can't be saved or used. Uses Web Crypto (Workers + Node).
 */

const VERSION = "v1";

function secret(): string | null {
  const s = process.env.AI_KEYS_ENCRYPTION_SECRET;
  return s && s.length >= 32 ? s : null;
}

export function isEncryptionConfigured(): boolean {
  return secret() !== null;
}

async function cryptoKey(): Promise<CryptoKey> {
  const s = secret();
  if (!s) throw new Error("AI_KEYS_ENCRYPTION_SECRET is not set (at least 32 characters).");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
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
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cryptoKey(), new TextEncoder().encode(plain));
  return `${VERSION}:${toB64(iv)}:${toB64(new Uint8Array(ct))}`;
}

export async function decryptSecret(stored: string): Promise<string> {
  const [version, iv, ct] = stored.split(":");
  if (version !== VERSION || !iv || !ct) throw new Error("Unrecognised key format");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, await cryptoKey(), fromB64(ct));
  return new TextDecoder().decode(plain);
}

/** "…ab12" — enough for the admin to recognise a key, never enough to use it. */
export function keyHint(plain: string): string {
  return `…${plain.trim().slice(-4)}`;
}
