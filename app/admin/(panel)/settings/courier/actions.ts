"use server";

// Admin-only. The client calls router.refresh() afterwards (no revalidatePath).
// The client secret is encrypted before it reaches the database and is never
// sent back to the browser; the webhook secret is stored only as a SHA-256 hash.

import { z } from "zod";
import { assertStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { encryptSecret, encryptionAvailable, keyHint } from "@/lib/ai/crypto";
import { pathaoClient, readPathaoSettings } from "@/lib/couriers/config";
import { CourierApiError } from "@/lib/couriers/pathao";
import type { ActionResult } from "@/types";

const KEY_STORE_UNAVAILABLE = "The secure key store is not available. On Cloudflare it uses the Worker's R2 binding; when running locally, set AI_KEYS_ENCRYPTION_SECRET.";

function dbError(message: string) {
  return /does not exist|courier_settings|schema cache/i.test(message) ? "Courier settings need database migration 0014." : "Couldn't save. Please try again.";
}

const settingsSchema = z.object({
  is_enabled: z.boolean(),
  environment: z.enum(["live", "sandbox"]),
  client_id: z.string().trim().max(200),
  client_secret: z.string().trim().max(500).optional(),
  store_id: z
    .union([z.literal(""), z.null(), z.undefined(), z.coerce.number().int().positive()])
    .transform((v) => (v === "" || v === null || v === undefined ? null : Number(v))),
  default_delivery_type: z.union([z.literal(12), z.literal(24), z.literal(48)]),
  default_item_type: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  default_weight: z.coerce.number().min(0.1).max(50),
});

export async function saveCourierSettingsAction(values: unknown): Promise<ActionResult> {
  const session = await assertStaff("admin");
  if ("error" in session) return { ok: false, message: session.error };
  const parsed = settingsSchema.safeParse(values);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Please check the fields." };
  const { client_secret, ...v } = parsed.data;

  const { row: current, view } = await readPathaoSettings();
  if (view.migrationMissing) return { ok: false, message: "Courier settings need database migration 0014." };

  const row: Record<string, unknown> = { provider: "pathao", ...v, client_id: v.client_id || null, updated_by: session.userId };
  if (client_secret) {
    if (!(await encryptionAvailable())) return { ok: false, message: KEY_STORE_UNAVAILABLE };
    row.client_secret_ciphertext = await encryptSecret(client_secret);
    row.client_secret_hint = keyHint(client_secret);
  }
  // New credentials or another environment: the saved login token is no longer valid.
  if (client_secret || v.client_id !== (current?.client_id ?? "") || v.environment !== (current?.environment ?? "live")) {
    row.token_ciphertext = null;
    row.token_expires_at = null;
  }
  const hasSecret = Boolean(client_secret || current?.client_secret_ciphertext);
  if (v.is_enabled && (!v.client_id || !hasSecret || !v.store_id)) {
    return { ok: false, message: "To turn Pathao on, enter the client ID, client secret and store, then save." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("courier_settings").upsert(row, { onConflict: "provider" });
  if (error) return { ok: false, message: dbError(error.message) };
  return { ok: true, message: "Courier settings saved" };
}

const testSchema = z.object({
  environment: z.enum(["live", "sandbox"]),
  client_id: z.string().trim().max(200),
  client_secret: z.string().trim().max(500).optional(),
});

/**
 * A real request to Pathao: log in and list the merchant's stores. Uses the
 * values in the form (an empty secret means "the saved one").
 */
export async function testPathaoAction(values: unknown): Promise<ActionResult<{ stores: { id: number; name: string; address: string | null; active: boolean }[] }>> {
  const session = await assertStaff("admin");
  if ("error" in session) return { ok: false, message: session.error };
  const parsed = testSchema.safeParse(values);
  if (!parsed.success) return { ok: false, message: "Please check the fields." };
  const d = parsed.data;
  const c = await pathaoClient({ environment: d.environment, clientId: d.client_id, ...(d.client_secret ? { clientSecret: d.client_secret } : {}) });
  if (!c.ok) return { ok: false, message: c.message };
  try {
    const stores = await c.client.stores();
    return {
      ok: true,
      message: stores.length ? `Connected to Pathao (${d.environment}). ${stores.length} store(s) found.` : `Connected to Pathao (${d.environment}), but the account has no stores yet. Add one in the Pathao merchant panel.`,
      data: { stores },
    };
  } catch (e) {
    return { ok: false, message: e instanceof CourierApiError ? e.message : "Couldn't reach Pathao." };
  }
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const webhookSchema = z.object({
  secret: z
    .string()
    .trim()
    .max(200)
    .optional()
    .refine((v) => !v || v.length >= 16, "Use at least 16 characters, or leave it empty to generate one."),
});

/**
 * Set the webhook secret Pathao sends in X-PATHAO-Signature. Only its hash is
 * stored, so the secret is shown once (copy it into the Pathao panel).
 */
export async function setWebhookSecretAction(values: unknown): Promise<ActionResult<{ secret: string }>> {
  const session = await assertStaff("admin");
  if ("error" in session) return { ok: false, message: session.error };
  const parsed = webhookSchema.safeParse(values);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid secret." };
  const secret = parsed.data.secret || randomSecret();
  const supabase = await createClient();
  const { data: existing, error: readError } = await supabase.from("courier_settings").select("provider").eq("provider", "pathao").maybeSingle();
  if (readError) return { ok: false, message: dbError(readError.message) };
  const hash = await sha256Hex(secret);
  const { error } = existing
    ? await supabase.from("courier_settings").update({ webhook_secret_hash: hash, updated_by: session.userId }).eq("provider", "pathao")
    : await supabase.from("courier_settings").insert({ provider: "pathao", webhook_secret_hash: hash, updated_by: session.userId });
  if (error) return { ok: false, message: dbError(error.message) };
  return { ok: true, message: "Webhook secret saved. Copy it now: it won't be shown again.", data: { secret } };
}
