import "server-only";
import { secretBucket } from "@/lib/ai/crypto";
import { sha256Hex } from "@/lib/tracking/hash";

/**
 * The tracking "server key": proves to the database functions (tracking_*)
 * that a call comes from this website's server, so server-side delivery works
 * WITHOUT the Supabase service-role key.
 *
 * On Cloudflare it is a random 256-bit value kept in the Worker's private R2
 * bucket (next to the key that encrypts the stored API tokens) and created the
 * first time an admin saves tracking settings. The database stores only its
 * SHA-256 (tracking_settings.server_key_hash). The browser never sees it.
 *
 * Outside Cloudflare (local development, tests): TRACKING_SERVER_KEY (32+
 * characters) if set. Nothing is generated or hard-coded otherwise.
 *
 * Do not delete the object at KEY_PATH: if it is lost, open Admin → Analytics
 * & Tracking once (a new key is created and registered automatically).
 */
const KEY_PATH = "__app-secrets/tracking/server-key.v1";

let cached: { key: string | null; at: number } | null = null;

function envKey(): string | null {
  const k = process.env.TRACKING_SERVER_KEY;
  return k && k.length >= 32 && k.length <= 200 ? k : null;
}

function randomKey(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** The server key, or null when none exists yet (create: make one in R2 if missing). */
export async function getServerKey({ create = false }: { create?: boolean } = {}): Promise<string | null> {
  if (!create && cached && Date.now() - cached.at < 5 * 60_000) return cached.key;
  let key: string | null = null;
  const bucket = await secretBucket();
  if (bucket) {
    let obj = await bucket.get(KEY_PATH);
    if (!obj && create) {
      await bucket.put(KEY_PATH, randomKey(), { customMetadata: { purpose: "Tracking server key (hash stored in Supabase tracking_settings). Do not delete." } });
      obj = await bucket.get(KEY_PATH); // read back: two simultaneous first saves end up with one key
    }
    const text = obj ? (await obj.text()).trim() : "";
    key = /^[0-9a-f]{64}$/.test(text) ? text : null;
  } else {
    key = envKey();
  }
  cached = { key, at: Date.now() };
  return key;
}

export async function serverKeyHash(key: string): Promise<string> {
  return sha256Hex(key);
}

/** Where the key lives (shown in the admin diagnostics; never the key itself). */
export async function serverKeySource(): Promise<"r2" | "env" | "none"> {
  if (await secretBucket()) return "r2";
  return envKey() ? "env" : "none";
}

/** Tests only. */
export function __resetServerKeyCache() {
  cached = null;
}
