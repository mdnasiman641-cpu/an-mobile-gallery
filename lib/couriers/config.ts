import "server-only";
import { createClient } from "@/lib/supabase/server";
import { decryptSecret, encryptSecret, encryptionAvailable } from "@/lib/ai/crypto";
import { PathaoClient, type PathaoEnvironment } from "@/lib/couriers/pathao";

/**
 * Pathao settings as the server uses them. Read with the signed-in admin's
 * session (RLS: admins only). The client secret and the cached access token
 * are AES-GCM ciphertext in the database; the key is in the Worker's private
 * R2 bucket (same store as the AI provider keys).
 */
export interface PathaoSettingsRow {
  provider: "pathao";
  is_enabled: boolean;
  environment: PathaoEnvironment;
  client_id: string | null;
  client_secret_ciphertext: string | null;
  client_secret_hint: string | null;
  store_id: number | null;
  webhook_secret_hash: string | null;
  default_delivery_type: 12 | 24 | 48;
  default_item_type: 1 | 2 | 3;
  default_weight: number | string;
  token_ciphertext: string | null;
  token_expires_at: string | null;
}

/** What the admin pages may show (never the secret or token). */
export interface PathaoSettingsView {
  configured: boolean;
  isEnabled: boolean;
  environment: PathaoEnvironment;
  clientId: string;
  secretHint: string | null;
  storeId: number | null;
  hasWebhookSecret: boolean;
  defaultDeliveryType: 12 | 24 | 48;
  defaultItemType: 1 | 2 | 3;
  defaultWeight: number;
  migrationMissing: boolean;
}

export async function readPathaoSettings(): Promise<{ row: PathaoSettingsRow | null; view: PathaoSettingsView }> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("courier_settings").select("*").eq("provider", "pathao").maybeSingle();
  const row = (data as PathaoSettingsRow | null) ?? null;
  return {
    row,
    view: {
      configured: Boolean(row?.client_id && row.client_secret_ciphertext && row.store_id),
      isEnabled: Boolean(row?.is_enabled),
      environment: row?.environment ?? "live",
      clientId: row?.client_id ?? "",
      secretHint: row?.client_secret_hint ?? null,
      storeId: row?.store_id ?? null,
      hasWebhookSecret: Boolean(row?.webhook_secret_hash),
      defaultDeliveryType: row?.default_delivery_type ?? 48,
      defaultItemType: row?.default_item_type ?? 2,
      defaultWeight: Number(row?.default_weight ?? 0.5),
      migrationMissing: Boolean(error),
    },
  };
}

/** A ready Pathao client, or an explanation of what is missing. */
export async function pathaoClient(overrides: Partial<{ environment: PathaoEnvironment; clientId: string; clientSecret: string; storeId: number | null }> = {}): Promise<
  { ok: true; client: PathaoClient; row: PathaoSettingsRow | null } | { ok: false; message: string }
> {
  const { row } = await readPathaoSettings();
  const clientId = overrides.clientId ?? row?.client_id ?? "";
  let clientSecret = overrides.clientSecret ?? "";
  if (!clientSecret && row?.client_secret_ciphertext) {
    try {
      clientSecret = await decryptSecret(row.client_secret_ciphertext);
    } catch {
      return { ok: false, message: "The saved Pathao client secret can't be read any more. Enter it again in Settings → Courier." };
    }
  }
  if (!clientId || !clientSecret) return { ok: false, message: "Pathao isn't set up yet. Enter the client ID and client secret in Settings → Courier." };

  let cachedToken: { token: string; expiresAt: number } | null = null;
  const usingSaved = !overrides.clientId && !overrides.clientSecret && !overrides.environment;
  if (usingSaved && row?.token_ciphertext && row.token_expires_at) {
    try {
      cachedToken = { token: await decryptSecret(row.token_ciphertext), expiresAt: Date.parse(row.token_expires_at) };
    } catch {
      cachedToken = null;
    }
  }
  const client = new PathaoClient(
    { environment: overrides.environment ?? row?.environment ?? "live", clientId, clientSecret, storeId: overrides.storeId ?? row?.store_id ?? null },
    {
      cachedToken,
      onToken: usingSaved
        ? async (token, expiresAt) => {
            if (!(await encryptionAvailable())) return;
            const supabase = await createClient();
            await supabase
              .from("courier_settings")
              .update({ token_ciphertext: await encryptSecret(token), token_expires_at: new Date(expiresAt).toISOString() })
              .eq("provider", "pathao");
          }
        : undefined,
    },
  );
  return { ok: true, client, row };
}
