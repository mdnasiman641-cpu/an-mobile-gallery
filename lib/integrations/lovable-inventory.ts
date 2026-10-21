import "server-only";
import { getServiceClient } from "@/lib/supabase/admin";
import { normalizeCondition, normalizeMemory, type StockItem } from "@/lib/integrations/stock-sync";
import { conditionFromName } from "@/lib/utils";

/**
 * Pull sync from the shop's Lovable inventory API (Admin → Inventory →
 * "Sync Lovable Stock Now"). Runs only when an admin presses the button —
 * never while serving customers, no polling.
 *
 *   GET {LOVABLE_INVENTORY_API_URL}/api/public/inventory?page=&per_page=[&updated_since=]
 *   X-API-Key: {LOVABLE_INVENTORY_API_KEY}            (server-side only)
 *
 * Items go through the existing import (stock_sync_apply, migration 0010):
 * matched by the source's product id (product_external_sources), never
 * duplicated, new items become DRAFTS, stock is updated, the source price is
 * kept for reference only, nothing is ever deleted.
 *
 * The response format is read defensively (several common shapes) and shown
 * to the admin by "Check connection" before anything is imported.
 */

export const LOVABLE_SOURCE = "lovable";
const ENDPOINT_PATH = "/api/public/inventory";
const TIMEOUT_MS = 15_000;
/** Bounded work per click (Cloudflare Workers Free: CPU and sub-request limits). */
export const PER_PAGE = 50;
export const MAX_PAGES_PER_RUN = 4;
const LOCK_TTL_MS = 5 * 60_000;
/** Incremental sync looks back a little before the last run, so nothing is missed at the boundary. */
const CHECKPOINT_OVERLAP_MS = 10 * 60_000;
const MAX_BODY_CHARS = 5_000_000;

// ---------------------------------------------------------------------------
// Configuration (server only; the key never leaves this module)
// ---------------------------------------------------------------------------

export interface LovableConfig {
  endpoint: string;
  key: string;
}

export function lovableConfig(env: Record<string, string | undefined> = process.env): { ok: true; config: LovableConfig } | { ok: false; message: string } {
  const base = (env.LOVABLE_INVENTORY_API_URL ?? "").trim();
  const key = (env.LOVABLE_INVENTORY_API_KEY ?? "").trim();
  if (!base) return { ok: false, message: "LOVABLE_INVENTORY_API_URL is not set on the server." };
  let origin: string;
  try {
    const u = new URL(base);
    if (u.protocol !== "https:" || u.username || u.password) throw new Error("bad");
    origin = u.origin;
  } catch {
    return { ok: false, message: "LOVABLE_INVENTORY_API_URL must be an https:// address, e.g. https://khadijatelecom1.lovable.app" };
  }
  if (key.length < 16) return { ok: false, message: "LOVABLE_INVENTORY_API_KEY is not set on the server (as a secret)." };
  return { ok: true, config: { endpoint: `${origin}${ENDPOINT_PATH}`, key } };
}

// ---------------------------------------------------------------------------
// Fetching one page
// ---------------------------------------------------------------------------

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface PageMeta {
  page: number | null;
  perPage: number | null;
  total: number | null;
  totalPages: number | null;
  hasMore: boolean | null;
}

export type PageResult =
  | { ok: true; items: unknown[]; meta: PageMeta; listKey: string; body: unknown }
  | { ok: false; kind: "auth" | "http" | "timeout" | "network" | "malformed"; status?: number; message: string };

const num = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/** Finds the product list and the pagination fields in the common response shapes. */
export function readListBody(body: unknown): { items: unknown[]; meta: PageMeta; listKey: string } | null {
  if (Array.isArray(body)) return { items: body, meta: { page: null, perPage: null, total: null, totalPages: null, hasMore: null }, listKey: "(top-level array)" };
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const listKey = ["data", "items", "products", "inventory", "results", "records"].find((k) => Array.isArray(b[k]));
  if (!listKey) return null;
  const p = (["pagination", "meta", "page_info", "paging"].map((k) => b[k]).find((v) => v && typeof v === "object" && !Array.isArray(v)) ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      if (p[k] !== undefined) return p[k];
      if (b[k] !== undefined) return b[k];
    }
    return undefined;
  };
  const hasMoreRaw = pick("has_more", "hasMore", "has_next", "hasNext", "has_next_page");
  return {
    items: b[listKey] as unknown[],
    listKey,
    meta: {
      page: num(pick("page", "current_page", "currentPage")),
      perPage: num(pick("per_page", "perPage", "page_size", "pageSize", "limit")),
      total: num(pick("total", "total_count", "totalCount", "count", "total_items")),
      totalPages: num(pick("total_pages", "totalPages", "last_page", "pages", "page_count")),
      hasMore: typeof hasMoreRaw === "boolean" ? hasMoreRaw : null,
    },
  };
}

export async function fetchInventoryPage(
  config: LovableConfig,
  q: { page: number; perPage: number; updatedSince?: string | null },
  fetchImpl: FetchLike = fetch,
): Promise<PageResult> {
  const url = new URL(config.endpoint);
  url.searchParams.set("page", String(q.page));
  url.searchParams.set("per_page", String(q.perPage));
  if (q.updatedSince) url.searchParams.set("updated_since", q.updatedSince);
  let res: Response;
  try {
    res = await fetchImpl(url.toString(), {
      method: "GET",
      headers: { "X-API-Key": config.key, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, kind: timeout ? "timeout" : "network", message: timeout ? `The inventory API did not answer within ${TIMEOUT_MS / 1000} seconds.` : "The inventory API could not be reached." };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, kind: "auth", status: res.status, message: "The inventory API rejected the API key (check LOVABLE_INVENTORY_API_KEY)." };
  if (!res.ok) return { ok: false, kind: "http", status: res.status, message: `The inventory API answered with HTTP ${res.status}.` };
  let text: string;
  try {
    text = await res.text();
  } catch {
    return { ok: false, kind: "network", message: "The inventory API response could not be read." };
  }
  if (text.length > MAX_BODY_CHARS) return { ok: false, kind: "malformed", message: "The inventory API response is too large. Use a smaller page size." };
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, kind: "malformed", message: "The inventory API did not return JSON." };
  }
  const list = readListBody(body);
  if (!list) return { ok: false, kind: "malformed", message: "The inventory API response has no product list (expected data / items / products)." };
  return { ok: true, ...list, body };
}

// ---------------------------------------------------------------------------
// Field mapping
// ---------------------------------------------------------------------------

/** Website field → source field names accepted (first one present wins). Purchase/cost fields are never read. */
export const FIELD_ALIASES = {
  id: ["id", "product_id", "uuid", "inventory_id", "item_id"],
  name: ["name", "product_name", "title", "model_name"],
  brand: ["brand", "brand_name", "manufacturer"],
  model: ["model", "model_name"],
  model_number: ["model_number", "model_no", "model_code"],
  sku: ["sku", "code", "product_code", "barcode"],
  ram: ["ram", "ram_gb", "memory", "ram_size"],
  storage: ["rom", "storage", "rom_gb", "storage_gb", "internal_storage"],
  condition: ["condition", "product_condition", "device_condition", "status_condition"],
  color: ["color", "colour"],
  category: ["category", "category_name", "type", "product_type"],
  quantity: ["stock_quantity", "quantity", "stock", "qty", "available_quantity", "in_stock_quantity"],
  sale_price: ["selling_price", "sale_price", "price", "retail_price", "sell_price"],
  image_url: ["image_url", "image", "photo_url", "thumbnail", "images"],
  updated_at: ["updated_at", "updatedAt", "last_updated", "modified_at"],
} as const;
type FieldName = keyof typeof FIELD_ALIASES;

const NEVER_READ = /cost|purchase|buy(ing)?_?price|profit|margin|supplier/i;

function pickField(r: Record<string, unknown>, field: FieldName): { key: string | null; value: unknown } {
  for (const k of FIELD_ALIASES[field]) {
    if (r[k] !== undefined && r[k] !== null && r[k] !== "") return { key: k, value: r[k] };
  }
  return { key: null, value: undefined };
}

const str = (v: unknown, max = 200): string | null => {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (v && typeof v === "object" && !Array.isArray(v) && typeof (v as { name?: unknown }).name === "string") return str((v as { name: string }).name, max);
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
};

export interface MappedItem {
  item: StockItem & { image_url: string | null };
  sourceUpdatedAt: string | null;
}

/** One source record → the existing import's item. Returns an error text for unusable records. */
export function mapInventoryItem(raw: unknown): { ok: true; value: MappedItem } | { ok: false; id: string | null; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, id: null, error: "Not an object" };
  const r = raw as Record<string, unknown>;
  const id = str(pickField(r, "id").value, 200);
  const name = str(pickField(r, "name").value, 200);
  if (!id) return { ok: false, id: null, error: "Missing product id" };
  if (!name || name.length < 2) return { ok: false, id, error: "Missing product name" };
  const qtyRaw = num(pickField(r, "quantity").value);
  if (qtyRaw === null) return { ok: false, id, error: "Missing or invalid stock quantity" };
  const priceRaw = num(pickField(r, "sale_price").value);
  const img = pickField(r, "image_url").value;
  const imageCandidate = Array.isArray(img) ? (typeof img[0] === "string" ? img[0] : str((img[0] as { url?: unknown })?.url, 1000)) : str(img, 1000);
  const updated = str(pickField(r, "updated_at").value, 60);
  const updatedIso = updated && !Number.isNaN(Date.parse(updated)) ? new Date(updated).toISOString() : null;
  // condition: the source's condition field, else an is_used flag, else the product name ("… Used")
  const conditionRaw = pickField(r, "condition").value;
  const isUsedFlag = typeof r.is_used === "boolean" ? (r.is_used ? "used" : "new") : null;
  const condition = (typeof conditionRaw === "boolean" ? null : normalizeCondition(conditionRaw)) ?? isUsedFlag ?? conditionFromName(name);
  return {
    ok: true,
    value: {
      sourceUpdatedAt: updatedIso,
      item: {
        id,
        name,
        brand: str(pickField(r, "brand").value, 80),
        model: str(pickField(r, "model").value, 120),
        model_number: str(pickField(r, "model_number").value, 80),
        sku: str(pickField(r, "sku").value, 80),
        ram: normalizeMemory(pickField(r, "ram").value),
        storage: normalizeMemory(pickField(r, "storage").value),
        condition,
        color: str(pickField(r, "color").value, 60),
        category: str(pickField(r, "category").value, 80),
        quantity: Math.max(0, Math.min(100_000, Math.trunc(qtyRaw))),
        sale_price: priceRaw !== null && priceRaw >= 0 ? priceRaw : null,
        notes: null,
        removed: r.deleted === true || r.is_deleted === true,
        image_url: imageCandidate && /^https:\/\//.test(imageCandidate) ? imageCandidate : null,
      },
    },
  };
}

/** What "Check connection" shows: field names and how they map (values only for harmless fields). */
export function describeContract(page: Extract<PageResult, { ok: true }>) {
  const first = page.items[0];
  const keys = first && typeof first === "object" && !Array.isArray(first) ? Object.keys(first as object) : [];
  const r = (first ?? {}) as Record<string, unknown>;
  const mapping = Object.fromEntries((Object.keys(FIELD_ALIASES) as FieldName[]).map((f) => [f, pickField(r, f).key]));
  const sample: Record<string, string> = {};
  for (const k of keys) {
    if (NEVER_READ.test(k)) {
      sample[k] = "(not read)";
      continue;
    }
    const v = r[k];
    sample[k] = v === null || v === undefined ? "null" : typeof v === "object" ? (Array.isArray(v) ? `array(${v.length})` : "object") : String(v).slice(0, 80);
  }
  const mapped = first ? mapInventoryItem(first) : null;
  return {
    listKey: page.listKey,
    meta: page.meta,
    itemCount: page.items.length,
    fields: keys,
    sample,
    mapping,
    firstItemUsable: mapped ? mapped.ok : false,
    firstItemError: mapped && !mapped.ok ? mapped.error : null,
  };
}

// ---------------------------------------------------------------------------
// Sync run (lock, pages, checkpoint)
// ---------------------------------------------------------------------------

export interface RunSummary {
  mode: "test" | "full" | "incremental";
  pages: number;
  received: number;
  imported: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
  finished: boolean;
  nextPage: number | null;
  errors: { id: string | null; error: string }[];
  /** Website products whose stock or link changed (to refresh their pages). */
  changedProductIds: string[];
}

type Db = NonNullable<ReturnType<typeof getServiceClient>>;
interface SyncState {
  source: string;
  running_token: string | null;
  running_since: string | null;
  resume_page: number | null;
  full_pass_started_at: string | null;
  checkpoint: string | null;
  incremental_supported: boolean | null;
  last_success_at: string | null;
  last_summary: unknown;
  last_error: string | null;
}

const MIGRATION = "Run database migration 0022 (supabase/migrations/20261021000022_inventory_sync_state.sql) first.";
const missingTable = (m: string) => /stock_sync_state/.test(m) && /does not exist|could not find|schema cache/i.test(m);

export async function readSyncState(db: Db): Promise<SyncState | null> {
  const { data, error } = await db.from("stock_sync_state").select("*").eq("source", LOVABLE_SOURCE).maybeSingle();
  if (error) throw new Error(missingTable(error.message) ? MIGRATION : `Sync state unavailable (${error.code ?? "error"}).`);
  return (data as SyncState | null) ?? null;
}

/** Atomic: only one run at a time (a crashed run's lock expires after 5 minutes). */
async function acquireLock(db: Db, token: string): Promise<boolean> {
  const ins = await db.from("stock_sync_state").upsert({ source: LOVABLE_SOURCE }, { onConflict: "source", ignoreDuplicates: true });
  if (ins.error) throw new Error(missingTable(ins.error.message) ? MIGRATION : `Sync state unavailable (${ins.error.code ?? "error"}).`);
  const staleBefore = new Date(Date.now() - LOCK_TTL_MS).toISOString();
  const { data, error } = await db
    .from("stock_sync_state")
    .update({ running_token: token, running_since: new Date().toISOString(), last_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("source", LOVABLE_SOURCE)
    .or(`running_token.is.null,running_since.lt.${staleBefore}`)
    .select("source");
  if (error) throw new Error(`Sync lock unavailable (${error.code ?? "error"}).`);
  return Boolean(data?.length);
}

async function saveState(db: Db, token: string, patch: Record<string, unknown>) {
  await db
    .from("stock_sync_state")
    .update({ ...patch, running_token: null, running_since: null, updated_at: new Date().toISOString() })
    .eq("source", LOVABLE_SOURCE)
    .eq("running_token", token);
}

/** Sends one page of mapped items through the existing import (one database call). */
async function applyItems(db: Db, items: MappedItem[], summary: RunSummary) {
  if (!items.length) return;
  const { data, error } = await db.rpc("stock_sync_apply", { p_source: LOVABLE_SOURCE, p_trigger: "manual", p_items: items.map((m) => m.item) });
  if (error) throw new Error(/stock_sync_apply/.test(error.message) ? "The stock import function is missing (migration 0010)." : `Import failed (${error.code ?? "error"}): ${error.message.slice(0, 200)}`);
  const res = data as { items: { id: string; status: string; product_id: string | null; error: string | null }[] };
  const imported: { productId: string; category: string }[] = [];
  for (const r of res.items ?? []) {
    if (r.status === "imported") summary.imported++;
    else if (r.status === "updated" || r.status === "linked" || r.status === "removed_upstream") {
      summary.updated++;
      if (r.product_id && summary.changedProductIds.length < 500) summary.changedProductIds.push(r.product_id);
    }
    else if (r.status === "unchanged") summary.unchanged++;
    else if (r.status === "failed") summary.failed++;
    else summary.skipped++;
    if ((r.status === "failed" || r.status === "skipped" || r.error) && summary.errors.length < 25) summary.errors.push({ id: r.id, error: r.error ?? r.status });
    const cat = items.find((m) => m.item.id === r.id)?.item.category;
    if (r.status === "imported" && r.product_id && cat) imported.push({ productId: r.product_id, category: cat });
  }
  // New drafts only: put them in the matching existing category (by name or slug). Never creates categories.
  if (imported.length) {
    const { data: cats } = await db.from("categories").select("id, name, slug");
    const byName = new Map(((cats ?? []) as { id: string; name: string; slug: string }[]).flatMap((c) => [[c.name.toLowerCase(), c.id], [c.slug.toLowerCase(), c.id]] as [string, string][]));
    const groups = new Map<string, string[]>();
    for (const i of imported) {
      const id = byName.get(i.category.toLowerCase());
      if (id) groups.set(id, [...(groups.get(id) ?? []), i.productId]);
    }
    for (const [categoryId, ids] of groups) await db.from("products").update({ category_id: categoryId }).in("id", ids).is("category_id", null);
  }
}

/**
 * One click of "Sync Lovable Stock Now".
 *   test        first 5 records only; no checkpoint / resume change
 *   full        continues an unfinished pass, else starts at page 1; at most 4 pages per click
 *   incremental changes since the checkpoint (only when the API's updated_since was verified)
 */
export async function runLovableSync(
  mode: "test" | "auto",
  deps: { db?: Db | null; fetchImpl?: FetchLike; env?: Record<string, string | undefined>; now?: () => number } = {},
): Promise<{ ok: boolean; message: string; summary?: RunSummary }> {
  const cfg = lovableConfig(deps.env);
  if (!cfg.ok) return { ok: false, message: cfg.message };
  const db = deps.db === undefined ? getServiceClient() : deps.db;
  if (!db) return { ok: false, message: "SUPABASE_SERVICE_ROLE_KEY is not set on the server." };
  const now = deps.now ?? Date.now;
  const token = crypto.randomUUID();

  let state: SyncState | null;
  try {
    if (!(await acquireLock(db, token))) return { ok: false, message: "A sync is already running. Try again in a few minutes." };
    state = await readSyncState(db);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const incremental = mode === "auto" && !state?.resume_page && Boolean(state?.checkpoint) && state?.incremental_supported === true;
  const summary: RunSummary = {
    mode: mode === "test" ? "test" : incremental ? "incremental" : "full",
    pages: 0,
    received: 0,
    imported: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    finished: false,
    nextPage: null,
    errors: [],
    changedProductIds: [],
  };
  const perPage = mode === "test" ? 5 : PER_PAGE;
  const startPage = mode === "test" || incremental ? 1 : (state?.resume_page ?? 1);
  const passStartedAt = summary.mode === "full" && startPage > 1 && state?.full_pass_started_at ? state.full_pass_started_at : new Date(now()).toISOString();
  // always sent as UTC ISO-8601 (the database may return another offset)
  const since = incremental && state?.checkpoint ? new Date(state.checkpoint).toISOString() : null;
  const maxPages = mode === "test" ? 1 : MAX_PAGES_PER_RUN;

  let page = startPage;
  let failure: string | null = null;
  try {
    for (let n = 0; n < maxPages; n++) {
      const res = await fetchInventoryPage(cfg.config, { page, perPage, updatedSince: since }, deps.fetchImpl);
      if (!res.ok) {
        failure = res.message;
        break;
      }
      summary.pages++;
      summary.received += res.items.length;
      const mapped: MappedItem[] = [];
      for (const raw of res.items.slice(0, perPage * 2)) {
        const m = mapInventoryItem(raw);
        if (m.ok) mapped.push(m.value);
        else {
          summary.failed++;
          if (summary.errors.length < 25) summary.errors.push({ id: m.id, error: m.error });
        }
      }
      await applyItems(db, mapped, summary);
      const { meta } = res;
      const last =
        res.items.length === 0 ||
        meta.hasMore === false ||
        (meta.totalPages !== null && page >= meta.totalPages) ||
        (meta.total !== null && page * perPage >= meta.total) ||
        (meta.hasMore === null && meta.totalPages === null && meta.total === null && res.items.length < perPage);
      if (last) {
        summary.finished = true;
        break;
      }
      page++;
    }
  } catch (e) {
    failure = (e as Error).message;
  }

  if (mode === "test") summary.finished = !failure;
  // `page` is the first page that is not done yet (the failed one, or the next one after the page limit)
  summary.nextPage = summary.finished ? null : page;

  const ok = !failure;
  const at = new Date(now()).toISOString();
  const { changedProductIds: _ids, ...stored } = summary;
  void _ids;
  const patch: Record<string, unknown> = {
    last_summary: { ...stored, at },
    last_error: failure ? failure.slice(0, 500) : null,
  };
  if (mode !== "test") {
    if (ok && summary.finished) {
      // whole pass done: move the checkpoint (never past the start of this pass)
      patch.checkpoint = new Date(Date.parse(passStartedAt) - CHECKPOINT_OVERLAP_MS).toISOString();
      patch.resume_page = null;
      patch.full_pass_started_at = null;
      patch.last_success_at = at;
    } else if (summary.mode === "full") {
      // keep progress: the next click continues at the page that is not done yet
      patch.resume_page = page;
      patch.full_pass_started_at = passStartedAt;
      if (ok) patch.last_success_at = at;
    }
  }
  await saveState(db, token, patch);

  const counts = `${summary.imported} new, ${summary.updated} updated, ${summary.unchanged} unchanged, ${summary.skipped} skipped, ${summary.failed} failed`;
  if (failure) return { ok: false, summary, message: `${failure} Nothing after that point was changed${summary.pages ? `; ${summary.pages} page(s) done before it (${counts})` : ""}.` };
  if (mode === "test") return { ok: true, summary, message: `Test with the first ${perPage} records: ${counts}.` };
  if (!summary.finished) return { ok: true, summary, message: `${counts}. More products are waiting — press Sync again to continue from page ${page}.` };
  return { ok: true, summary, message: `Sync complete (${summary.mode === "incremental" ? "changes since the last sync" : "all products"}): ${counts}.` };
}

/** "Check connection": one small request, plus a test of updated_since. Saves what was found. */
export async function checkLovableConnection(deps: { db?: Db | null; fetchImpl?: FetchLike; env?: Record<string, string | undefined> } = {}) {
  const cfg = lovableConfig(deps.env);
  if (!cfg.ok) return { ok: false as const, message: cfg.message };
  const first = await fetchInventoryPage(cfg.config, { page: 1, perPage: 2 }, deps.fetchImpl);
  if (!first.ok) return { ok: false as const, message: first.message };
  const contract = describeContract(first);
  // updated_since is trusted only if a date in the future returns nothing while the plain request returns records
  let incremental: boolean | null = null;
  if (first.items.length > 0) {
    const future = await fetchInventoryPage(cfg.config, { page: 1, perPage: 2, updatedSince: new Date(Date.now() + 365 * 86_400_000).toISOString() }, deps.fetchImpl);
    incremental = future.ok ? future.items.length === 0 : null;
  }
  const db = deps.db === undefined ? getServiceClient() : deps.db;
  if (db) {
    await db.from("stock_sync_state").upsert({ source: LOVABLE_SOURCE }, { onConflict: "source", ignoreDuplicates: true });
    await db.from("stock_sync_state").update({ contract: { ...contract, checked_at: new Date().toISOString() }, incremental_supported: incremental, updated_at: new Date().toISOString() }).eq("source", LOVABLE_SOURCE);
  }
  return { ok: true as const, message: contract.firstItemUsable || contract.itemCount === 0 ? "Connected." : `Connected, but the first record can't be imported: ${contract.firstItemError}.`, contract, incremental };
}

// ---------------------------------------------------------------------------
// Preview (read-only): shows how source records would be mapped. No database access.
// ---------------------------------------------------------------------------

export const PREVIEW_SIZE = 10;

export interface PreviewRow {
  id: string | null;
  /** Source values as received (purchase / cost fields are never read). */
  source: Record<string, string>;
  /** What the import would receive, or null when the record would fail. */
  proposed: Omit<MappedItem["item"], "id" | "notes" | "removed" | "model_number" | "sku"> | null;
  error: string | null;
}

function harmlessSource(r: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(r)) {
    if (NEVER_READ.test(k)) continue;
    out[k] = v === null || v === undefined ? "" : typeof v === "object" ? (Array.isArray(v) ? `array(${v.length})` : "object") : String(v).slice(0, 120);
  }
  return out;
}

export async function previewLovableInventory(
  page: number,
  deps: { fetchImpl?: FetchLike; env?: Record<string, string | undefined> } = {},
): Promise<{ ok: true; rows: PreviewRow[]; meta: PageMeta; page: number } | { ok: false; message: string }> {
  const cfg = lovableConfig(deps.env);
  if (!cfg.ok) return { ok: false, message: cfg.message };
  const p = Number.isInteger(page) && page >= 1 && page <= 100_000 ? page : 1;
  const res = await fetchInventoryPage(cfg.config, { page: p, perPage: PREVIEW_SIZE }, deps.fetchImpl);
  if (!res.ok) return { ok: false, message: res.message };
  const rows: PreviewRow[] = res.items.slice(0, PREVIEW_SIZE).map((raw) => {
    const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const m = mapInventoryItem(raw);
    if (!m.ok) return { id: m.id, source: harmlessSource(r), proposed: null, error: m.error };
    const { id, notes: _n, removed: _r, model_number: _mn, sku: _s, ...proposed } = m.value.item;
    void _n;
    void _r;
    void _mn;
    void _s;
    return { id, source: harmlessSource(r), proposed, error: null };
  });
  return { ok: true, rows, meta: res.meta, page: p };
}
