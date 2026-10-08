import "server-only";
import { getServiceClient } from "@/lib/supabase/admin";

/**
 * One-way stock import from the shop's stock system (Lovable) into
 * AN MOBILE GALLERY. The stock system only provides basic stock facts; it
 * never controls prices, images, content, SEO or publishing here, and the
 * website never calls it while serving customers.
 *
 * Contract (see docs/STOCK-INTEGRATION.md):
 *   POST /api/integrations/stock/webhook
 *     x-stock-timestamp: <unix seconds>
 *     x-stock-signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>">
 *     body: { "event": "product.created" | "product.updated" | "product.deleted",
 *             "product": { ...StockItem } }  or  { "products": [ ...StockItem ] }
 *   Manual sync: GET STOCK_EXPORT_URL (Bearer STOCK_EXPORT_TOKEN) → { "products": [...] }
 */

export const STOCK_SOURCE = (process.env.STOCK_SOURCE_NAME || "lovable").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) || "lovable";
const MAX_ITEMS_PER_REQUEST = 200;
const MAX_ITEMS_PER_SYNC = 1000;
const SIGNATURE_WINDOW_SECONDS = 300;

/** The normalized item stored and matched on the website side. */
export interface StockItem {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  model_number: string | null;
  sku: string | null;
  ram: string | null;
  storage: string | null;
  condition: "new" | "used" | "refurbished" | null;
  color: string | null;
  category: string | null;
  quantity: number;
  /** Reference only. Never becomes the website's selling price. */
  sale_price: number | null;
  notes: string | null;
  removed: boolean;
}

function text(v: unknown, max = 200): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

/** "12" / "12 gb" / "12GB" → "12GB"; "1 tb" → "1TB". */
export function normalizeMemory(v: unknown): string | null {
  const s = text(v, 30);
  if (!s) return null;
  const m = /^(\d+(?:\.\d+)?)\s*(gb|tb|mb)?$/i.exec(s);
  return m ? `${m[1]}${(m[2] ?? "GB").toUpperCase()}` : s;
}

export function normalizeCondition(v: unknown): StockItem["condition"] {
  const s = (text(v, 40) ?? "").toLowerCase();
  if (!s) return null;
  if (/refurb|renew/.test(s)) return "refurbished";
  if (/used|second|pre-?owned|old/.test(s)) return "used";
  if (/new|intact|sealed|boxed/.test(s)) return "new";
  return null;
}

/** Validate and normalize one incoming product. Returns null if unusable. */
export function normalizeStockItem(raw: unknown, removed = false): StockItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = text(r.id, 200);
  const name = text(r.name, 200);
  if (!id || !name || name.length < 2) return null;
  const qty = Number(r.quantity ?? 0);
  const price = r.sale_price === null || r.sale_price === undefined || r.sale_price === "" ? null : Number(r.sale_price);
  return {
    id,
    name,
    brand: text(r.brand, 80),
    model: text(r.model, 120),
    model_number: text(r.model_number, 80),
    sku: text(r.sku, 80),
    ram: normalizeMemory(r.ram),
    storage: normalizeMemory(r.storage ?? r.rom),
    condition: normalizeCondition(r.condition),
    color: text(r.color, 60),
    category: text(r.category, 80),
    quantity: Number.isFinite(qty) ? Math.max(0, Math.min(100000, Math.trunc(qty))) : 0,
    sale_price: price !== null && Number.isFinite(price) && price >= 0 ? price : null,
    notes: text(r.notes, 500),
    removed: removed || r.removed === true || r.deleted === true,
  };
}

/** Parse a webhook / export body into items (single product or a list). */
export function itemsFromBody(body: unknown): { items: StockItem[]; rejected: number } {
  const b = (body ?? {}) as { event?: unknown; product?: unknown; products?: unknown };
  const removedEvent = typeof b.event === "string" && /delete|remove/i.test(b.event);
  const list: unknown[] = Array.isArray(b.products) ? b.products : b.product ? [b.product] : [];
  const items: StockItem[] = [];
  let rejected = 0;
  for (const raw of list.slice(0, MAX_ITEMS_PER_SYNC)) {
    const item = normalizeStockItem(raw, removedEvent);
    if (item) items.push(item);
    else rejected++;
  }
  return { items, rejected: rejected + Math.max(0, list.length - MAX_ITEMS_PER_SYNC) };
}

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signPayload(secret: string, timestamp: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `sha256=${hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`)))}`;
}

/** Check the HMAC signature and timestamp (replay window 5 minutes). */
export async function verifyWebhook(
  secret: string | undefined,
  timestamp: string | null,
  signature: string | null,
  rawBody: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!secret || secret.length < 32) return { ok: false, status: 503, error: "Webhook is not configured" };
  if (!timestamp || !signature) return { ok: false, status: 401, error: "Missing signature" };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > SIGNATURE_WINDOW_SECONDS) return { ok: false, status: 401, error: "Stale or invalid timestamp" };
  const expected = await signPayload(secret, timestamp, rawBody);
  if (!safeEqual(expected, signature.trim().toLowerCase())) return { ok: false, status: 401, error: "Invalid signature" };
  return { ok: true };
}

export interface SyncSummary {
  imported: number;
  updated: number;
  skipped: number;
  failed: number;
  jobIds: string[];
}

/** Apply items in batches (one database call per batch). */
export async function applyStockItems(items: StockItem[], trigger: "webhook" | "manual"): Promise<SyncSummary> {
  const db = getServiceClient();
  if (!db) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set on the server.");
  const total: SyncSummary = { imported: 0, updated: 0, skipped: 0, failed: 0, jobIds: [] };
  for (let i = 0; i < items.length; i += MAX_ITEMS_PER_REQUEST) {
    const { data, error } = await db.rpc("stock_sync_apply", { p_source: STOCK_SOURCE, p_trigger: trigger, p_items: items.slice(i, i + MAX_ITEMS_PER_REQUEST) });
    if (error) throw new Error(error.message.includes("stock_sync_apply") ? "The stock sync function is missing. Run the latest database migration." : error.message);
    const r = data as { imported: number; updated: number; skipped: number; failed: number; job_ids: string[] };
    total.imported += r.imported;
    total.updated += r.updated;
    total.skipped += r.skipped;
    total.failed += r.failed;
    total.jobIds.push(...(r.job_ids ?? []));
  }
  return total;
}

/** "Sync stock now": pull the full list from the stock system's export endpoint. */
export async function syncFromExportUrl(): Promise<{ ok: boolean; message: string; summary?: SyncSummary }> {
  const url = process.env.STOCK_EXPORT_URL;
  const token = process.env.STOCK_EXPORT_TOKEN;
  if (!url || !/^https:\/\//.test(url)) {
    return { ok: false, message: "Manual sync needs STOCK_EXPORT_URL (https) and STOCK_EXPORT_TOKEN set as server variables. Webhook imports work without them." };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let body: unknown;
  try {
    const res = await fetch(url, { headers: { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, signal: controller.signal });
    if (!res.ok) return { ok: false, message: `The stock system answered with HTTP ${res.status}. Nothing was changed.` };
    body = await res.json();
  } catch (e) {
    return { ok: false, message: controller.signal.aborted ? "The stock system did not answer within 20 seconds. Nothing was changed." : `Couldn't reach the stock system (${(e as Error).name}). Nothing was changed.` };
  } finally {
    clearTimeout(timer);
  }
  const { items, rejected } = itemsFromBody(body);
  if (items.length === 0) return { ok: false, message: `The stock system returned no usable products${rejected ? ` (${rejected} without id/name)` : ""}.` };
  try {
    const s = await applyStockItems(items, "manual");
    s.failed += rejected;
    return {
      ok: true,
      summary: s,
      message: `Imported ${s.imported}, updated ${s.updated}, skipped ${s.skipped}, failed ${s.failed}.${s.imported ? " New drafts are queued for AI (AI Products → Process queue)." : ""}`,
    };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
