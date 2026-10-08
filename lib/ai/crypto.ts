import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * How AI provider API keys are protected
 * ---------------------------------------
 * Keys are typed in Admin → Settings → AI and sent only to this site's server.
 * The server encrypts them (AES-256-GCM, random IV per value) and stores only
 * the ciphertext in Supabase (ai_models.api_key_ciphertext, admin/staff RLS).
 *
 * The encryption key is NOT in the database and NOT in the browser. On
 * Cloudflare it is a random 256-bit key kept in the Worker's own private R2
 * bucket (the existing NEXT_INC_CACHE_R2_BUCKET binding), created
 * automatically the first time a key is saved. Only the Worker can read R2
 * through its binding; the browser and Supabase can't. So:
 *   - no Cloudflare dashboard setup is needed,
 *   - a database leak (or an admin's browser) only ever sees ciphertext.
 *
 * Fallbacks, for running outside Cloudflare (e.g. `next dev`):
 *   v1 = AI_KEYS_ENCRYPTION_SECRET, s1 = derived from SUPABASE_SERVICE_ROLE_KEY.
 * Every stored value is tagged with its source ("r1:" / "v1:" / "s1:"), so
 * values saved earlier keep working.
 *
 * Do not delete the object at MASTER_KEY_PATH from the R2 bucket: saved API
 * keys would have to be entered again.
 */

type Source = "r1" | "v1" | "s1";
const MASTER_KEY_PATH = "__app-secrets/ai-provider-keys/master-key.v1";
const HKDF_INFO = "an-mobile-gallery/ai-provider-keys/v1";

/** The part of an R2 binding used here (avoids depending on workers-types). */
interface SecretBucket {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  put(key: string, value: string, options?: { customMetadata?: Record<string, string> }): Promise<unknown>;
}

let masterKeyPromise: Promise<CryptoKey | null> | null = null;

function toB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function bucket(): Promise<SecretBucket | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const b = (env as unknown as { NEXT_INC_CACHE_R2_BUCKET?: SecretBucket }).NEXT_INC_CACHE_R2_BUCKET;
    return b && typeof b.get === "function" ? b : null;
  } catch {
    return null; // not running on Cloudflare
  }
}

const importAes = (raw: Uint8Array<ArrayBuffer>) => crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);

/** Load (or on first use create) the master key kept in the Worker's R2 bucket. */
async function loadMasterKey(): Promise<CryptoKey | null> {
  const b = await bucket();
  if (!b) return null;
  let obj = await b.get(MASTER_KEY_PATH);
  if (!obj) {
    await b.put(MASTER_KEY_PATH, toB64(crypto.getRandomValues(new Uint8Array(32))), {
      customMetadata: { purpose: "Encrypts AI provider API keys stored in Supabase. Do not delete." },
    });
    // Read back so two simultaneous first saves end up using the same key.
    obj = await b.get(MASTER_KEY_PATH);
    if (!obj) return null;
  }
  const raw = fromB64(await obj.text());
  if (raw.length !== 32) throw new Error("The stored AI key-encryption key is damaged.");
  return importAes(raw);
}

function masterKey(): Promise<CryptoKey | null> {
  masterKeyPromise ??= loadMasterKey().catch((e) => {
    masterKeyPromise = null; // retry next time
    throw e;
  });
  return masterKeyPromise;
}

function explicitSecret(): string | null {
  const s = process.env.AI_KEYS_ENCRYPTION_SECRET;
  return s && s.length >= 32 ? s : null;
}

function serviceSecret(): string | null {
  const s = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return s && s.length >= 20 ? s : null;
}

async function keyFor(source: Source): Promise<CryptoKey> {
  const enc = new TextEncoder();
  if (source === "r1") {
    const k = await masterKey();
    if (!k) throw new Error("The secure key store (Cloudflare R2) is not available here.");
    return k;
  }
  if (source === "v1") {
    const s = explicitSecret();
    if (!s) throw new Error("This API key was saved with AI_KEYS_ENCRYPTION_SECRET, which is not set. Enter the key again.");
    return importAes(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))));
  }
  const s = serviceSecret();
  if (!s) throw new Error("This API key was saved with SUPABASE_SERVICE_ROLE_KEY, which is not set. Enter the key again.");
  const base = await crypto.subtle.importKey("raw", enc.encode(s), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("an-mobile-gallery"), info: enc.encode(HKDF_INFO) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Which protection new keys get here, or null if none is available. */
async function preferredSource(): Promise<Source | null> {
  if (await masterKey().catch(() => null)) return "r1";
  if (explicitSecret()) return "v1";
  if (serviceSecret()) return "s1";
  return null;
}

/** Can API keys be saved on this server? (On Cloudflare: always, via the R2 binding.) */
export async function encryptionAvailable(): Promise<boolean> {
  return (await preferredSource()) !== null;
}

export async function encryptSecret(plain: string): Promise<string> {
  const source = await preferredSource();
  if (!source) throw new Error("No secure key store is available on this server.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFor(source), new TextEncoder().encode(plain));
  return `${source}:${toB64(iv)}:${toB64(new Uint8Array(ct))}`;
}

export async function decryptSecret(stored: string): Promise<string> {
  const [source, iv, ct] = stored.split(":");
  if ((source !== "r1" && source !== "v1" && source !== "s1") || !iv || !ct) throw new Error("Unrecognised key format");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, await keyFor(source), fromB64(ct));
  return new TextDecoder().decode(plain);
}

/** "…ab12" — enough for the admin to recognise a key, never enough to use it. */
export function keyHint(plain: string): string {
  return `…${plain.trim().slice(-4)}`;
}

/** Tests only. */
export function __resetKeyCacheForTests() {
  masterKeyPromise = null;
}
