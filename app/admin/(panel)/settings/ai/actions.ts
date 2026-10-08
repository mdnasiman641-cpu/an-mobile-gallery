"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { encryptSecret, encryptionAvailable, keyHint } from "@/lib/ai/crypto";
import { AiSetupError, resetModelHealth, runAi } from "@/lib/ai/engine";
import { sanitizeMessage } from "@/lib/ai/errors";
import { AI_CAPABILITIES, PROVIDER_TYPES, ROUTING_STRATEGIES } from "@/lib/ai/types";
import { AiProviderError } from "@/lib/ai/errors";
import { decryptSecret } from "@/lib/ai/crypto";
import { discoverModels, normalizeBaseUrl, type DiscoveredModel } from "@/lib/ai/model-discovery";
import type { ActionResult } from "@/types";

const PATH = "/admin/settings/ai";
const KEY_STORE_UNAVAILABLE = "The secure key store is not available. On Cloudflare it uses the Worker's R2 binding; when running locally, set AI_KEYS_ENCRYPTION_SECRET.";
const uuid = z.string().uuid();
const optionalInt = (min: number, max: number) =>
  z
    .union([z.literal(""), z.null(), z.undefined(), z.coerce.number().int().min(min).max(max)])
    .transform((v) => (v === "" || v === null || v === undefined ? null : Number(v)));
const optionalNum = z
  .union([z.literal(""), z.null(), z.undefined(), z.coerce.number().min(0).max(100000)])
  .transform((v) => (v === "" || v === null || v === undefined ? null : Number(v)));

const modelSchema = z.object({
  provider_name: z.string().trim().min(1, "Provider name is required").max(80),
  display_name: z.string().trim().min(1, "Display name is required").max(80),
  provider_type: z.enum(PROVIDER_TYPES),
  api_base_url: z
    .string()
    .trim()
    .max(300)
    .refine((v) => /^https:\/\/[^\s/$.?#].[^\s]*$/.test(v), "API base URL must be a full https:// address"),
  model_name: z.string().trim().min(1, "Model name is required").max(120),
  api_key: z.string().trim().max(500).optional(),
  is_enabled: z.boolean(),
  priority: z.coerce.number().int().min(1).max(10000),
  timeout_seconds: z.coerce.number().int().min(1).max(120),
  max_retries: z.coerce.number().int().min(0).max(3),
  rpm_limit: optionalInt(1, 100000),
  rpd_limit: optionalInt(1, 10000000),
  cost_input_per_million: optionalNum,
  cost_output_per_million: optionalNum,
  quality_score: optionalInt(1, 10),
  capabilities: z.array(z.enum(AI_CAPABILITIES)).min(1, "Pick at least one capability"),
});

function dbError(message: string) {
  return /does not exist|ai_models/i.test(message) ? "AI settings need the latest database migration." : "Couldn't save. Please try again.";
}

export async function saveAiModelAction(id: string | null, values: unknown): Promise<ActionResult<{ id: string }>> {
  const session = await assertStaff("admin");
  if ("error" in session) return { ok: false, message: session.error };
  if (id !== null && !uuid.safeParse(id).success) return { ok: false, message: "Invalid model." };
  const parsed = modelSchema.safeParse(values);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Please check the fields." };
  const { api_key, timeout_seconds, ...v } = parsed.data;

  const row: Record<string, unknown> = { ...v, timeout_ms: timeout_seconds * 1000 };
  if (api_key) {
    if (!(await encryptionAvailable())) return { ok: false, message: KEY_STORE_UNAVAILABLE };
    row.api_key_ciphertext = await encryptSecret(api_key);
    row.api_key_hint = keyHint(api_key);
  } else if (id === null) {
    return { ok: false, message: "Enter the API key for the new model." };
  }

  const supabase = await createClient();
  if (id === null) {
    const { data, error } = await supabase.from("ai_models").insert({ ...row, created_by: session.userId }).select("id").single();
    if (error || !data) return { ok: false, message: dbError(error?.message ?? "") };
    revalidatePath(PATH);
    return { ok: true, message: "Model added", data: { id: (data as { id: string }).id } };
  }
  const { error } = await supabase.from("ai_models").update(row).eq("id", id);
  if (error) return { ok: false, message: dbError(error.message) };
  // New key or new endpoint: start with a clean health record.
  if (api_key) await resetModelHealth(id).catch(() => undefined);
  revalidatePath(PATH);
  return { ok: true, message: "Model saved", data: { id } };
}

export async function deleteAiModelAction(id: string): Promise<ActionResult> {
  const session = await assertStaff("admin");
  if ("error" in session) return { ok: false, message: session.error };
  if (!uuid.safeParse(id).success) return { ok: false, message: "Invalid model." };
  const supabase = await createClient();
  const { error } = await supabase.from("ai_models").delete().eq("id", id);
  if (error) return { ok: false, message: dbError(error.message) };
  revalidatePath(PATH);
  return { ok: true, message: "Model removed" };
}

/** Admin switch. The failover system never turns a disabled model back on. */
export async function setAiModelEnabledAction(id: string, enabled: boolean): Promise<ActionResult> {
  const session = await assertStaff("admin");
  if ("error" in session) return { ok: false, message: session.error };
  if (!uuid.safeParse(id).success) return { ok: false, message: "Invalid model." };
  const supabase = await createClient();
  const { error } = await supabase.from("ai_models").update({ is_enabled: Boolean(enabled) }).eq("id", id);
  if (error) return { ok: false, message: dbError(error.message) };
  revalidatePath(PATH);
  return { ok: true, message: enabled ? "Model enabled" : "Model disabled" };
}

/** Move a model one place up/down in the priority list (renumbers 10, 20, 30…). */
export async function moveAiModelAction(id: string, direction: "up" | "down"): Promise<ActionResult> {
  const session = await assertStaff("admin");
  if ("error" in session) return { ok: false, message: session.error };
  const supabase = await createClient();
  const { data, error } = await supabase.from("ai_models").select("id, priority, display_name").order("priority").order("display_name");
  if (error) return { ok: false, message: dbError(error.message) };
  const list = ((data as { id: string }[]) ?? []).map((m) => m.id);
  const i = list.indexOf(id);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= list.length) return { ok: true, message: "Already at the end" };
  [list[i], list[j]] = [list[j], list[i]];
  const results = await Promise.all(list.map((mid, idx) => supabase.from("ai_models").update({ priority: (idx + 1) * 10 }).eq("id", mid)));
  if (results.some((r) => r.error)) return { ok: false, message: "Couldn't reorder. Please try again." };
  revalidatePath(PATH);
  return { ok: true, message: "Priority updated" };
}

export async function testAiModelAction(id: string): Promise<ActionResult> {
  const session = await assertStaff("admin");
  if ("error" in session) return { ok: false, message: session.error };
  if (!uuid.safeParse(id).success) return { ok: false, message: "Invalid model." };
  try {
    const started = Date.now();
    const res = await runAi(
      { task: "test", system: "You are a connection test.", prompt: "Reply with the single word OK.", json: false, maxOutputTokens: 16 },
      { onlyModelId: id },
    );
    revalidatePath(PATH);
    if (res.ok) return { ok: true, message: `Connected in ${((Date.now() - started) / 1000).toFixed(1)}s. Reply: “${sanitizeMessage(res.response.text).slice(0, 40)}”` };
    const last = res.attempts[res.attempts.length - 1];
    return { ok: false, message: last ? `${last.errorCode}${last.httpStatus ? ` (${last.httpStatus})` : ""}: ${last.message ?? ""}` : res.message };
  } catch (e) {
    return { ok: false, message: e instanceof AiSetupError ? e.message : "Test failed." };
  }
}

export async function resetAiHealthAction(id: string): Promise<ActionResult> {
  const session = await assertStaff("admin");
  if ("error" in session) return { ok: false, message: session.error };
  if (!uuid.safeParse(id).success) return { ok: false, message: "Invalid model." };
  try {
    await resetModelHealth(id);
  } catch (e) {
    return { ok: false, message: e instanceof AiSetupError ? e.message : "Couldn't reset." };
  }
  revalidatePath(PATH);
  return { ok: true, message: "Health reset: the model is eligible again" };
}

export async function saveAiRoutingAction(values: unknown): Promise<ActionResult> {
  const session = await assertStaff("admin");
  if ("error" in session) return { ok: false, message: session.error };
  const parsed = z.object({ routing_strategy: z.enum(ROUTING_STRATEGIES), max_attempts: optionalInt(1, 20) }).safeParse(values);
  if (!parsed.success) return { ok: false, message: "Invalid routing settings." };
  const supabase = await createClient();
  const { error } = await supabase.from("ai_settings").upsert({ id: 1, ...parsed.data, updated_at: new Date().toISOString() });
  if (error) return { ok: false, message: dbError(error.message) };
  revalidatePath(PATH);
  return { ok: true, message: "Routing saved" };
}

// ---------------------------------------------------------------------------
// Load Models → Add Selected Models
// ---------------------------------------------------------------------------

const credentialSchema = z.object({
  provider_type: z.enum(PROVIDER_TYPES),
  api_base_url: z.string().trim().min(8).max(300),
  /** Typed in the form (sent to the server only, never returned). */
  api_key: z.string().trim().max(500).optional(),
  /** Or: reuse the key already saved with this model. */
  use_key_of: z.string().uuid().optional(),
});

/** The API key for a request: the one typed in, or a saved one decrypted on the server. */
async function resolveKey(input: z.infer<typeof credentialSchema>): Promise<string> {
  if (input.api_key) return input.api_key;
  if (!input.use_key_of) throw new AiProviderError("NO_KEY", "Enter the API key, or choose a saved key.");
  // admin session; RLS limits this to staff, and the value is only ciphertext
  const db = await createClient();
  const { data } = await db.from("ai_models").select("api_key_ciphertext").eq("id", input.use_key_of).maybeSingle();
  const stored = (data as { api_key_ciphertext: string | null } | null)?.api_key_ciphertext;
  if (!stored) throw new AiProviderError("NO_KEY", "That model has no saved key.");
  try {
    return await decryptSecret(stored);
  } catch {
    throw new AiProviderError("NO_KEY", "The saved key can't be read any more. Enter the key again.");
  }
}

/** Ask the provider which models this key can use. Only model info is returned, never the key. */
export async function loadProviderModelsAction(values: unknown): Promise<ActionResult<{ models: DiscoveredModel[]; baseUrl: string }>> {
  const session = await assertStaff("admin");
  if ("error" in session) return { ok: false, message: session.error };
  const parsed = credentialSchema.safeParse(values);
  if (!parsed.success) return { ok: false, message: "Choose the provider type and enter the API base URL." };
  try {
    const key = await resolveKey(parsed.data);
    const models = await discoverModels(parsed.data.provider_type, parsed.data.api_base_url, key);
    if (models.length === 0) return { ok: false, message: "The provider returned no models for this key." };
    const usable = models.filter((m) => !m.nonChat).length;
    return {
      ok: true,
      message: `Found ${models.length} model${models.length === 1 ? "" : "s"} (${usable} for text)`,
      data: { models, baseUrl: normalizeBaseUrl(parsed.data.provider_type, parsed.data.api_base_url) },
    };
  } catch (e) {
    if (e instanceof AiProviderError) {
      const hint =
        e.code === "AUTH_ERROR"
          ? " Check the API key."
          : e.code === "MODEL_UNAVAILABLE" || e.code === "BAD_REQUEST" || e.code === "INVALID_RESPONSE"
            ? " Check the API base URL (this provider may not offer a model list; you can add a model by name instead)."
            : "";
      return { ok: false, message: `${e.code === "NO_KEY" ? "" : `${e.code}${e.httpStatus ? ` (${e.httpStatus})` : ""}: `}${e.message}${hint}` };
    }
    return { ok: false, message: "Couldn't load models. Please try again." };
  }
}

const addSchema = credentialSchema.extend({
  provider_name: z.string().trim().min(1).max(80),
  timeout_seconds: z.coerce.number().int().min(1).max(120).default(45),
  max_retries: z.coerce.number().int().min(0).max(3).default(0),
  models: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(120),
        label: z.string().trim().min(1).max(80),
        capabilities: z.array(z.enum(AI_CAPABILITIES)).min(1),
        cost_input_per_million: z.number().min(0).max(100000).nullable(),
        cost_output_per_million: z.number().min(0).max(100000).nullable(),
      }),
    )
    .min(1, "Select at least one model")
    .max(20),
});

/** Save each selected model as its own configuration (same provider, same key, separate health). */
export async function addSelectedModelsAction(values: unknown): Promise<ActionResult<{ added: number; skipped: number }>> {
  const session = await assertStaff("admin");
  if ("error" in session) return { ok: false, message: session.error };
  const parsed = addSchema.safeParse(values);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Please check the selection." };
  if (!(await encryptionAvailable())) return { ok: false, message: KEY_STORE_UNAVAILABLE };
  const v = parsed.data;

  let key: string;
  let base: string;
  try {
    key = await resolveKey(v);
    base = normalizeBaseUrl(v.provider_type, v.api_base_url);
  } catch (e) {
    return { ok: false, message: e instanceof AiProviderError ? e.message : "Couldn't read the API key." };
  }

  const supabase = await createClient();
  const { data: existingRows, error: listError } = await supabase.from("ai_models").select("provider_type, api_base_url, model_name, priority");
  if (listError) return { ok: false, message: dbError(listError.message) };
  const existing = (existingRows as { provider_type: string; api_base_url: string; model_name: string; priority: number }[]) ?? [];
  const already = new Set(existing.map((m) => `${m.provider_type}|${m.api_base_url.replace(/\/+$/, "")}|${m.model_name}`));
  let priority = existing.reduce((max, m) => Math.max(max, m.priority), 0);

  const hint = keyHint(key);
  const rows = [];
  let skipped = 0;
  for (const m of v.models) {
    if (already.has(`${v.provider_type}|${base}|${m.id}`)) {
      skipped++;
      continue;
    }
    priority += 10;
    rows.push({
      provider_name: v.provider_name,
      display_name: m.label.slice(0, 80),
      provider_type: v.provider_type,
      api_base_url: base,
      model_name: m.id,
      // each configuration keeps its own encrypted copy of the key
      api_key_ciphertext: await encryptSecret(key),
      api_key_hint: hint,
      is_enabled: true,
      priority: Math.min(priority, 10000),
      timeout_ms: v.timeout_seconds * 1000,
      max_retries: v.max_retries,
      cost_input_per_million: m.cost_input_per_million,
      cost_output_per_million: m.cost_output_per_million,
      capabilities: m.capabilities,
      created_by: session.userId,
    });
  }
  if (rows.length === 0) return { ok: true, message: "All selected models are already added.", data: { added: 0, skipped } };
  const { error } = await supabase.from("ai_models").insert(rows);
  if (error) return { ok: false, message: dbError(error.message) };
  revalidatePath(PATH);
  return {
    ok: true,
    message: `Added ${rows.length} model${rows.length === 1 ? "" : "s"}${skipped ? ` (${skipped} already added)` : ""}. They are tried in the order shown.`,
    data: { added: rows.length, skipped },
  };
}
