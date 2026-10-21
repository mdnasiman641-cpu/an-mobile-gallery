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
 * Each source record is one purchase BATCH. Batches of the same phone (brand + model,
 * RAM, ROM, condition → group key) become ONE website product whose stock is the sum of
 * its batches (migration 0023: stock_source_batches / stock_source_groups). Groups with
 * 0 stock create nothing; a group that looks like an existing website product waits for
 * an admin to link it; existing products are never linked automatically. New groups
 * become DRAFTS with price 0, the source price is kept for reference only, nothing is
 * ever deleted.
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
/**
 * Version of the field mapping. A checkpoint made under another version is ignored
 * (the next sync reads every page again), so records that failed under an older
 * mapping are not skipped by an incremental sync.
 */
export const MAPPING_VERSION = 3;

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
  item: StockItem & {
    image_url: string | null;
    /** Website brand the draft gets (exact brand name; see websiteBrandFor). */
    website_brand: string | null;
    /** Text compared with existing website product names to find possible matches. */
    match_model: string | null;
  };
  /** Same phone + memory + condition → same key → one website product. */
  groupKey: string;
  sourceUpdatedAt: string | null;
  /** How the product name was obtained (shown in the preview). */
  nameRule: "name field" | "brand + model" | "model only";
}

// ---------------------------------------------------------------------------
// Lovable inventory semantics (verified against the live API on 2026-10-21, 187 records):
//   * there is no name field; the item is described by `brand` + `model`
//     (brand "Redmi", model "15C"; brand "Techno Spark", model "Go 3")
//   * older records carry RAM/ROM and the purchase date in the brand label:
//     "Redmi 4/64 30/05/26" = brand Redmi, 4GB RAM / 64GB ROM, bought 30/05/26
//   * `category` holds the condition: "new", "used" or "exchange" (a trade-in, i.e. used)
//   * `ram` / `rom` are plain numbers ("4", "64") or with units ("6GB", "128 GB")
// ---------------------------------------------------------------------------

const DATE_IN_LABEL = /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g;
/** "4/64", "6/128", "12/512": RAM (GB) / ROM (GB). ROM must be a real storage size, so dates and fractions don't match. */
const MEMORY_IN_LABEL = /\b(\d{1,2})\s*\/\s*(16|32|64|128|256|512|1024)\b/;
const squash = (v: string) => v.replace(/\s+/g, " ").trim();

/** Brand label → clean brand text plus any RAM/ROM written in it. The purchase date is dropped (not needed on the website). */
export function parseBrandLabel(label: string | null): { brand: string | null; ram: string | null; storage: string | null } {
  if (!label) return { brand: null, ram: null, storage: null };
  let rest = label.replace(DATE_IN_LABEL, " ");
  let ram: string | null = null;
  let storage: string | null = null;
  const mem = MEMORY_IN_LABEL.exec(rest);
  if (mem) {
    ram = `${mem[1]}GB`;
    storage = `${mem[2]}GB`;
    rest = rest.replace(mem[0], " ");
  }
  const brand = squash(rest.replace(/[,;|]+/g, " "));
  return { brand: brand.length ? brand.slice(0, 80) : null, ram, storage };
}

/** The source's condition, from a condition field or (Lovable) the category field. */
const CONDITION_WORDS: Record<string, StockItem["condition"]> = {
  new: "new",
  intact: "new",
  used: "used",
  "pre-owned": "used",
  preowned: "used",
  "pre owned": "used",
  "second hand": "used",
  exchange: "used",
  refurbished: "refurbished",
};
const conditionWord = (v: string | null): StockItem["condition"] | undefined => (v ? CONDITION_WORDS[v.trim().toLowerCase()] : undefined);

/**
 * Product name when the source has no name field: brand + model, without repeating
 * words ("Redmi Note" + "Note 15" → "Redmi Note 15"; "Oppo" + "Oppo A6s" → "Oppo A6s"),
 * plus RAM/ROM so different variants stay apart ("Redmi 15C 6GB/128GB").
 */
export function buildProductName(brand: string | null, model: string | null, ram: string | null, storage: string | null): string | null {
  const b = brand ? squash(brand) : "";
  const m = model ? squash(model) : "";
  let core: string;
  if (b && m) {
    const bl = b.toLowerCase();
    const ml = m.toLowerCase();
    if (ml === bl || ml.startsWith(`${bl} `)) core = m;
    else if (bl.endsWith(` ${ml}`) || bl === ml) core = b;
    else {
      // overlap: last words of the brand = first words of the model
      const bw = b.split(" ");
      const mw = m.split(" ");
      let overlap = 0;
      for (let k = Math.min(bw.length, mw.length); k > 0; k--) {
        if (bw.slice(-k).join(" ").toLowerCase() === mw.slice(0, k).join(" ").toLowerCase()) {
          overlap = k;
          break;
        }
      }
      core = [...bw, ...mw.slice(overlap)].join(" ");
    }
  } else core = b || m;
  // a name needs at least two characters and one letter ("X05" is fine, "9" or "4/64" is not)
  if (core.length < 2 || !/\p{L}/u.test(core)) return null;
  // RAM/ROM keeps variants apart ("Redmi 15C 6GB/128GB" vs "… 8GB/256GB"); not added twice
  const memory = ram && storage ? `${ram}/${storage}` : storage;
  const already = storage !== null && core.toLowerCase().replace(/\s+/g, "").includes(storage.toLowerCase());
  const name = memory && !already ? `${core} ${memory}` : core;
  return name.slice(0, 200);
}

// ---------------------------------------------------------------------------
// Grouping: purchase batches of the same phone → one website product
// ---------------------------------------------------------------------------

/**
 * Spelling variants seen in the source that name the same thing (whole words only).
 * Used for the grouping key and brand lookup; the product name keeps the source text.
 */
const WORD_ALIASES: Record<string, string> = { techno: "tecno", remdi: "redmi", villon: "villion" };
/** First word of the brand → website brand name (website brands are matched by exact name). */
const WEBSITE_BRANDS: Record<string, string> = {
  iphone: "Apple", apple: "Apple",
  redmi: "Xiaomi", poco: "Xiaomi", xiaomi: "Xiaomi", mi: "Xiaomi",
  tecno: "Tecno", infinix: "Infinix", itel: "Itel", oppo: "Oppo", vivo: "Vivo", realme: "Realme",
  samsung: "Samsung", moto: "Motorola", motorola: "Motorola", pixel: "Google", google: "Google", oneplus: "OnePlus",
  symphony: "Symphony", nokia: "Nokia", huawei: "Huawei", honor: "Honor",
};

function aliasWords(text: string): string[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean).map((w) => WORD_ALIASES[w] ?? w);
  // "Xiaomi Redmi Note 14" = "Redmi Note 14"; "Samsung Galaxy A07" = "Samsung A07"
  if (words[0] === "xiaomi" && (words[1] === "redmi" || words[1] === "poco")) words.shift();
  if (words[0] === "samsung" && words[1] === "galaxy") words.splice(1, 1);
  return words;
}

/** Letters and digits only, so "Go 3", "Go-3", "GO3" are the same model ("13" and "13 Pro" stay different). */
export const normKey = (text: string): string => aliasWords(text).join("").replace(/[^a-z0-9]+/g, "");

export function websiteBrandFor(brand: string | null): string | null {
  const first = brand ? aliasWords(brand)[0] : undefined;
  if (!first) return null;
  return WEBSITE_BRANDS[first] ?? squash(brand ?? "").slice(0, 80);
}

/**
 * Group key = normalised brand+model | RAM | ROM | condition, e.g. "redmi15c|6gb|128gb|new".
 * A missing RAM or ROM is "-" (never guessed), so "iPhone 14 128GB" without RAM and
 * "iPhone 14 6GB/128GB" stay apart. New and Used are always different groups.
 */
export function buildGroupKey(core: string, ram: string | null, storage: string | null, condition: StockItem["condition"]): string {
  const mem = (v: string | null) => (v ? v.toLowerCase().replace(/\s+/g, "") : "-");
  return `${normKey(core)}|${mem(ram)}|${mem(storage)}|${condition ?? "unknown"}`.slice(0, 300);
}

/** One source record → the existing import's item. Returns an error text for unusable records. */
export function mapInventoryItem(raw: unknown): { ok: true; value: MappedItem } | { ok: false; id: string | null; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, id: null, error: "Not an object" };
  const r = raw as Record<string, unknown>;
  const id = str(pickField(r, "id").value, 200);
  if (!id) return { ok: false, id: null, error: "Missing product id" };
  const label = parseBrandLabel(str(pickField(r, "brand").value, 200));
  const model = str(pickField(r, "model").value, 120);
  const ram = normalizeMemory(pickField(r, "ram").value) ?? label.ram;
  const storage = normalizeMemory(pickField(r, "storage").value) ?? label.storage;
  // name: a name field when the source has one; otherwise brand + model (+ RAM/ROM)
  const nameField = str(pickField(r, "name").value, 200);
  const nameRule: MappedItem["nameRule"] = nameField && nameField.length >= 2 ? "name field" : label.brand ? "brand + model" : "model only";
  const name = nameRule === "name field" ? nameField : buildProductName(label.brand, model, ram, storage);
  // brand + model without memory: the phone itself
  const core = buildProductName(label.brand, model, null, null) ?? (nameRule === "name field" ? nameField : null);
  if (!name) return { ok: false, id, error: "Missing product name (no name field, and brand + model don't form a name)" };
  const qtyRaw = num(pickField(r, "quantity").value);
  if (qtyRaw === null) return { ok: false, id, error: "Missing or invalid stock quantity" };
  const priceRaw = num(pickField(r, "sale_price").value);
  const img = pickField(r, "image_url").value;
  const imageCandidate = Array.isArray(img) ? (typeof img[0] === "string" ? img[0] : str((img[0] as { url?: unknown })?.url, 1000)) : str(img, 1000);
  const updated = str(pickField(r, "updated_at").value, 60);
  const updatedIso = updated && !Number.isNaN(Date.parse(updated)) ? new Date(updated).toISOString() : null;
  // condition: the source's condition field, else a category that holds a condition word
  // (Lovable: new / used / exchange), else an is_used flag, else the product name ("… Used")
  const conditionRaw = pickField(r, "condition").value;
  const categoryText = str(pickField(r, "category").value, 80);
  const categoryCondition = conditionWord(categoryText);
  const isUsedFlag = typeof r.is_used === "boolean" ? (r.is_used ? "used" : "new") : null;
  const condition =
    (typeof conditionRaw === "boolean" ? null : (conditionWord(str(conditionRaw, 40)) ?? normalizeCondition(conditionRaw))) ??
    categoryCondition ??
    isUsedFlag ??
    conditionFromName(name);
  const websiteBrand = websiteBrandFor(label.brand);
  // what an existing website product name would contain: the core without its brand word ("iPhone 13 Pro" → "13 Pro")
  const coreWords = (core ?? "").split(" ");
  const matchModel = label.brand && coreWords.length > 1 && WEBSITE_BRANDS[aliasWords(coreWords[0])[0] ?? ""] ? coreWords.slice(1).join(" ") : core;
  return {
    ok: true,
    value: {
      sourceUpdatedAt: updatedIso,
      nameRule,
      groupKey: buildGroupKey(core ?? name, ram, storage, condition),
      item: {
        id,
        name,
        brand: label.brand,
        model,
        model_number: str(pickField(r, "model_number").value, 80),
        sku: str(pickField(r, "sku").value, 80),
        ram,
        storage,
        condition,
        color: str(pickField(r, "color").value, 60),
        // a category that only says new / used is the condition, not a website category
        category: categoryCondition !== undefined ? null : categoryText,
        quantity: Math.max(0, Math.min(100_000, Math.trunc(qtyRaw))),
        sale_price: priceRaw !== null && priceRaw >= 0 ? priceRaw : null,
        notes: null,
        removed: r.deleted === true || r.is_deleted === true,
        image_url: imageCandidate && /^https:\/\//.test(imageCandidate) ? imageCandidate : null,
        website_brand: websiteBrand,
        match_model: matchModel ? matchModel.slice(0, 120) : null,
      },
    },
  };
}

/** What "Check connection" shows: field names and how they map (values only for harmless fields). */
export function describeContract(page: Extract<PageResult, { ok: true }>) {
  const first = page.items[0];
  const keys = first && typeof first === "object" && !Array.isArray(first) ? Object.keys(first as object) : [];
  const r = (first ?? {}) as Record<string, unknown>;
  const mapping: Record<string, string | null> = Object.fromEntries((Object.keys(FIELD_ALIASES) as FieldName[]).map((f) => [f, pickField(r, f).key]));
  if (!mapping.name && (mapping.brand || mapping.model)) mapping.name = `${[mapping.brand, mapping.model].filter(Boolean).join(" + ")} (built)`;
  if (!mapping.condition && mapping.category && conditionWord(str(r[mapping.category], 80)) !== undefined) {
    mapping.condition = `${mapping.category} (new / used / exchange)`;
    mapping.category = null;
  }
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
  /** Source records read in this click. */
  received: number;
  /** New website drafts created (one per group). */
  imported: number;
  /** Linked products whose stock changed. */
  updated: number;
  unchanged: number;
  /** Groups with total stock 0 and no website product: nothing created. */
  skipped: number;
  /** Groups that look like an existing website product: waiting for an admin decision. */
  held: number;
  /** Source records that could not be used (see errors). */
  failed: number;
  finished: boolean;
  nextPage: number | null;
  errors: { id: string | null; error: string }[];
  /** Website products whose stock changed (to refresh their pages). */
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
const MIGRATION_23 = "Run database migration 0023 (supabase/migrations/20261021000023_stock_source_groups.sql) first.";
const missingTable = (m: string) => /stock_sync_state/.test(m) && /does not exist|could not find|schema cache/i.test(m);
const missing23 = (m: string) => /stock_source_(stage|finalize|candidates|groups|batches)/.test(m) && /does not exist|could not find|schema cache/i.test(m);
/** Reads every page in one click for the preview and the test import (bounded: 10 pages × 50). */
export const FULL_READ_MAX_PAGES = 10;

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

/** The fields kept per batch (never purchase / cost data). */
function batchItem(m: MappedItem) {
  const it = m.item;
  return {
    name: it.name, brand: it.brand, model: it.model, ram: it.ram, storage: it.storage, condition: it.condition, color: it.color,
    sale_price: it.sale_price, image_url: it.image_url, website_brand: it.website_brand, match_model: it.match_model,
  };
}

/** Stores this click's records. Returns how many records have been seen in this pass so far. */
async function stageBatches(db: Db, pass: string, mapped: MappedItem[], unusableIds: string[]): Promise<number> {
  const { data, error } = await db.rpc("stock_source_stage", {
    p_source: LOVABLE_SOURCE,
    p_pass: pass,
    p_items: mapped.map((m) => ({
      id: m.item.id,
      group_key: m.groupKey,
      quantity: m.item.removed ? 0 : m.item.quantity,
      item: batchItem(m),
      source_updated_at: m.sourceUpdatedAt,
    })),
    p_seen_ids: unusableIds,
  });
  if (error) throw new Error(missing23(error.message) ? MIGRATION_23 : `Saving the source records failed (${error.code ?? "error"}).`);
  return typeof data === "number" ? data : Number(data ?? 0);
}

interface FinalizeResult {
  created: number;
  updated: number;
  unchanged: number;
  skipped_zero: number;
  held: number;
  has_variants: number;
  changed_product_ids: string[];
}

async function finalizeGroups(db: Db, pass: string, full: boolean, createLimit: number | null): Promise<FinalizeResult> {
  const { data, error } = await db.rpc("stock_source_finalize", { p_source: LOVABLE_SOURCE, p_pass: pass, p_full: full, p_create_limit: createLimit });
  if (error) throw new Error(missing23(error.message) ? MIGRATION_23 : `Updating the stock totals failed (${error.code ?? "error"}): ${error.message.slice(0, 200)}`);
  return data as FinalizeResult;
}

/**
 * One click of "Sync Lovable Stock Now" / "Import first 5".
 *
 * Every source record (= purchase batch) is stored with its group key; website stock is the
 * SUM over a group's batches, computed in the database from all stored batches — never from
 * one page. Totals are applied only after a COMPLETE pass (all pages; the number of records
 * seen must reach the total the API reports), or after an incremental read of the changes.
 *
 *   test        reads every page (≤ 10), creates at most 5 drafts, changes nothing else
 *   full        ≤ 4 pages per click; resumes at the next page; applies totals after the last page
 *   incremental changes since the checkpoint (only when verified and a full pass was done)
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

  const prev = (state?.last_summary && typeof state.last_summary === "object" ? state.last_summary : {}) as { mappingVersion?: unknown; passFailed?: unknown };
  const prevVersion = typeof prev.mappingVersion === "number" ? prev.mappingVersion : null;
  const incremental =
    mode === "auto" && !state?.resume_page && Boolean(state?.checkpoint) && state?.incremental_supported === true && prevVersion === MAPPING_VERSION;
  const summary: RunSummary = {
    mode: mode === "test" ? "test" : incremental ? "incremental" : "full",
    pages: 0, received: 0, imported: 0, updated: 0, unchanged: 0, skipped: 0, held: 0, failed: 0,
    finished: false, nextPage: null, errors: [], changedProductIds: [],
  };
  const perPage = PER_PAGE;
  const resuming = summary.mode === "full" && Boolean(state?.resume_page) && Boolean(state?.full_pass_started_at);
  const startPage = resuming ? (state?.resume_page ?? 1) : 1;
  const pass = resuming && state?.full_pass_started_at ? new Date(state.full_pass_started_at).toISOString() : new Date(now()).toISOString();
  const since = incremental && state?.checkpoint ? new Date(state.checkpoint).toISOString() : null;
  const maxPages = summary.mode === "full" ? MAX_PAGES_PER_RUN : FULL_READ_MAX_PAGES;

  let page = startPage;
  let failure: string | null = null;
  let lastMeta: PageMeta | null = null;
  const mapped: MappedItem[] = [];
  const unusable: string[] = [];
  try {
    for (let n = 0; n < maxPages; n++) {
      const res = await fetchInventoryPage(cfg.config, { page, perPage, updatedSince: since }, deps.fetchImpl);
      if (!res.ok) {
        failure = res.message;
        break;
      }
      summary.pages++;
      summary.received += res.items.length;
      lastMeta = res.meta;
      for (const raw of res.items.slice(0, perPage * 2)) {
        const m = mapInventoryItem(raw);
        if (m.ok) mapped.push(m.value);
        else {
          summary.failed++;
          if (m.id) unusable.push(m.id);
          if (summary.errors.length < 25) summary.errors.push({ id: m.id, error: m.error });
        }
      }
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

  // records failed anywhere in this full pass (earlier clicks included)
  const priorPassFailed = resuming && typeof prev.passFailed === "number" ? prev.passFailed : 0;
  const passFailed = summary.mode === "full" ? priorPassFailed + summary.failed : summary.failed;
  let version: number | null = prevVersion;
  const patch: Record<string, unknown> = {};
  let note: string | null = null;

  try {
    // stage what was read (also before a failure, so a resumed pass keeps the pages already done)
    const seen = mapped.length || unusable.length ? await stageBatches(db, pass, mapped, unusable) : 0;

    if (mode === "test") {
      if (!failure && !summary.finished) failure = `The test reads at most ${FULL_READ_MAX_PAGES * perPage} records to compute totals; use Sync instead.`;
      if (!failure && lastMeta?.total !== null && lastMeta?.total !== undefined && seen < lastMeta.total)
        failure = `Only ${seen} of ${lastMeta.total} records were read (the source changed while reading). Try again.`;
      if (!failure) {
        const r = await finalizeGroups(db, pass, false, 5);
        summary.imported = r.created;
        summary.changedProductIds = [];
      }
    } else if (summary.mode === "full") {
      if (failure || !summary.finished) {
        // keep progress: totals are applied only after the last page
        patch.resume_page = page;
        patch.full_pass_started_at = pass;
        if (!failure) note = `More records are waiting — press Sync again to continue from page ${page}. Stock is updated after the last page.`;
      } else if (lastMeta?.total !== null && lastMeta?.total !== undefined && seen < lastMeta.total) {
        // pages shifted while reading: never apply totals from an incomplete pass
        patch.resume_page = null;
        patch.full_pass_started_at = null;
        failure = `Only ${seen} of ${lastMeta.total} source records were read in this pass (the source changed while reading). No stock was changed; press Sync again to start a fresh pass.`;
      } else {
        const r = await finalizeGroups(db, pass, true, null);
        Object.assign(summary, { imported: r.created, updated: r.updated, unchanged: r.unchanged, skipped: r.skipped_zero, held: r.held });
        summary.changedProductIds = (r.changed_product_ids ?? []).slice(0, 500);
        patch.resume_page = null;
        patch.full_pass_started_at = null;
        patch.last_success_at = new Date(now()).toISOString();
        if (passFailed === 0) {
          // every record accepted: incremental syncs may start from here (never past the start of this pass)
          patch.checkpoint = new Date(Date.parse(pass) - CHECKPOINT_OVERLAP_MS).toISOString();
          version = MAPPING_VERSION;
        } else {
          patch.checkpoint = null;
          version = null;
          note = `${passFailed} source record(s) could not be used in this pass; the next sync reads every page again.`;
        }
      }
    } else if (!failure) {
      if (!summary.finished) {
        // too many changes for one click: do a full pass next time instead
        patch.checkpoint = null;
        version = null;
        note = "Many records changed: the next sync reads every page.";
      }
      const r = await finalizeGroups(db, pass, false, null);
      Object.assign(summary, { imported: r.created, updated: r.updated, unchanged: r.unchanged, skipped: r.skipped_zero, held: r.held });
      summary.changedProductIds = (r.changed_product_ids ?? []).slice(0, 500);
      patch.last_success_at = new Date(now()).toISOString();
      if (summary.finished && summary.failed === 0) patch.checkpoint = new Date(Date.parse(pass) - CHECKPOINT_OVERLAP_MS).toISOString();
    }
  } catch (e) {
    failure = (e as Error).message;
    if (summary.mode === "full") {
      patch.resume_page = startPage;
      patch.full_pass_started_at = pass;
    }
  }

  summary.nextPage = summary.mode === "full" && patch.resume_page ? (patch.resume_page as number) : null;
  const at = new Date(now()).toISOString();
  const { changedProductIds: _ids, ...stored } = summary;
  void _ids;
  patch.last_error = failure ? failure.slice(0, 500) : null;
  patch.last_summary = {
    ...stored,
    at,
    mappingVersion: version,
    // a test run must not reset the failure count of an unfinished full pass
    passFailed: mode === "test" ? (typeof prev.passFailed === "number" ? prev.passFailed : 0) : summary.mode === "full" && patch.resume_page ? passFailed : 0,
  };
  await saveState(db, token, patch);

  const counts = `${summary.imported} new draft(s), ${summary.updated} updated, ${summary.unchanged} unchanged, ${summary.skipped} skipped (0 stock), ${summary.held} need a decision, ${summary.failed} record(s) failed`;
  if (failure) return { ok: false, summary, message: `${failure}${summary.pages ? ` (${summary.pages} page(s) read; no stock was changed)` : ""}` };
  if (mode === "test") return { ok: true, summary, message: `Test: read ${summary.received} records, created ${summary.imported} draft(s) (at most 5). Nothing else was changed.` };
  if (note && !summary.finished) return { ok: true, summary, message: `${summary.received} records read. ${note}` };
  return { ok: true, summary, message: `Sync complete (${summary.mode === "incremental" ? "changes since the last sync" : "all products"}): ${counts}.${note ? ` ${note}` : ""}` };
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
// Preview (read-only): reads every page, groups the batches and shows what a sync would do.
// Database access is SELECT only (plus the read-only stock_source_candidates function).
// ---------------------------------------------------------------------------

export type GroupAction = "create" | "skip_zero" | "update" | "unchanged" | "held" | "has_variants";

export interface PreviewGroup {
  key: string;
  name: string;
  condition: string | null;
  ram: string | null;
  storage: string | null;
  batches: number;
  total: number;
  action: GroupAction;
  /** Linked website product (explicit link or created earlier by this sync). */
  product: { id: string; name: string; status: string; stock: number } | null;
  /** Possible existing website products (shown when the group is held). */
  candidates: { id: string; name: string; status: string; stock: number }[];
  decision: "linked" | "create" | null;
}

export interface PreviewResult {
  records: number;
  pages: number;
  complete: boolean;
  failed: { id: string | null; error: string }[];
  groups: PreviewGroup[];
  counts: Record<GroupAction, number>;
  totalStock: number;
}

/** Pure grouping of mapped records (same key → one group; stock is summed). */
export function groupBatches(items: MappedItem[]) {
  const groups = new Map<string, { key: string; rep: MappedItem; batches: number; total: number }>();
  for (const m of items) {
    const g = groups.get(m.groupKey);
    const qty = m.item.removed ? 0 : m.item.quantity;
    if (!g) groups.set(m.groupKey, { key: m.groupKey, rep: m, batches: 1, total: qty });
    else {
      g.batches++;
      g.total += qty;
      // the most recently updated batch names the group (as in the database)
      if ((m.sourceUpdatedAt ?? "") > (g.rep.sourceUpdatedAt ?? "")) g.rep = m;
    }
  }
  return [...groups.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export async function previewLovableInventory(
  deps: { db?: Db | null; fetchImpl?: FetchLike; env?: Record<string, string | undefined> } = {},
): Promise<{ ok: true; result: PreviewResult } | { ok: false; message: string }> {
  const cfg = lovableConfig(deps.env);
  if (!cfg.ok) return { ok: false, message: cfg.message };
  const db = deps.db === undefined ? getServiceClient() : deps.db;
  if (!db) return { ok: false, message: "SUPABASE_SERVICE_ROLE_KEY is not set on the server." };

  const mapped: MappedItem[] = [];
  const failed: { id: string | null; error: string }[] = [];
  let records = 0;
  let pages = 0;
  let complete = false;
  let reported: number | null = null;
  for (let page = 1; page <= FULL_READ_MAX_PAGES; page++) {
    const res = await fetchInventoryPage(cfg.config, { page, perPage: PER_PAGE }, deps.fetchImpl);
    if (!res.ok) return { ok: false, message: res.message };
    pages++;
    records += res.items.length;
    reported = res.meta.total ?? reported;
    for (const raw of res.items.slice(0, PER_PAGE * 2)) {
      const m = mapInventoryItem(raw);
      if (m.ok) mapped.push(m.value);
      else failed.push({ id: m.id, error: m.error });
    }
    const { meta } = res;
    if (
      res.items.length === 0 ||
      meta.hasMore === false ||
      (meta.totalPages !== null && page >= meta.totalPages) ||
      (meta.total !== null && page * PER_PAGE >= meta.total) ||
      (meta.hasMore === null && meta.totalPages === null && meta.total === null && res.items.length < PER_PAGE)
    ) {
      complete = reported === null || records >= reported;
      break;
    }
  }

  const grouped = groupBatches(mapped);
  // what is already stored: links and admin decisions (read only)
  const { data: rows, error } = await db.from("stock_source_groups").select("group_key, product_id, link_decision").eq("source", LOVABLE_SOURCE);
  if (error) return { ok: false, message: missing23(error.message) || /stock_source_groups/.test(error.message) ? MIGRATION_23 : `Reading links failed (${error.code ?? "error"}).` };
  const stored = new Map(((rows ?? []) as { group_key: string; product_id: string | null; link_decision: "linked" | "create" | null }[]).map((r) => [r.group_key, r]));
  const linkedIds = [...stored.values()].map((r) => r.product_id).filter((v): v is string => Boolean(v));
  const products = new Map<string, { id: string; name: string; status: string; stock: number }>();
  if (linkedIds.length) {
    const { data } = await db.from("products").select("id, name, status, stock_quantity").in("id", linkedIds.slice(0, 1000));
    for (const p of (data ?? []) as { id: string; name: string; status: string; stock_quantity: number }[]) products.set(p.id, { id: p.id, name: p.name, status: p.status, stock: p.stock_quantity });
  }
  // possible matches for groups that would otherwise create a draft (one read-only call)
  const needCandidates = grouped.filter((g) => g.total > 0 && !(stored.get(g.key)?.product_id && products.has(stored.get(g.key)?.product_id ?? "")) && stored.get(g.key)?.link_decision !== "create");
  let candidates: Record<string, { id: string; name: string; status: string; stock: number }[]> = {};
  if (needCandidates.length) {
    const { data, error: cErr } = await db.rpc("stock_source_candidates", {
      p_source: LOVABLE_SOURCE,
      p_groups: needCandidates.map((g) => ({ key: g.key, model: g.rep.item.match_model, brand: g.rep.item.website_brand, condition: g.rep.item.condition })),
    });
    if (cErr) return { ok: false, message: missing23(cErr.message) ? MIGRATION_23 : `Looking for matching products failed (${cErr.code ?? "error"}).` };
    candidates = (data ?? {}) as typeof candidates;
  }

  const counts: Record<GroupAction, number> = { create: 0, skip_zero: 0, update: 0, unchanged: 0, held: 0, has_variants: 0 };
  const groups: PreviewGroup[] = grouped.map((g) => {
    const st = stored.get(g.key);
    const product = st?.product_id ? (products.get(st.product_id) ?? null) : null;
    const cands = candidates[g.key] ?? [];
    let action: GroupAction;
    if (product) action = product.stock === g.total ? "unchanged" : "update";
    else if (g.total <= 0) action = "skip_zero";
    else if (st?.link_decision !== "create" && cands.length) action = "held";
    else action = "create";
    counts[action]++;
    const it = g.rep.item;
    return { key: g.key, name: it.name, condition: it.condition, ram: it.ram, storage: it.storage, batches: g.batches, total: g.total, action, product, candidates: action === "held" ? cands : [], decision: st?.link_decision ?? null };
  });
  // linked groups that no longer appear in the source: their stock would become 0
  for (const [key, st] of stored) {
    if (grouped.some((g) => g.key === key)) continue;
    const product = st.product_id ? (products.get(st.product_id) ?? null) : null;
    if (!product) continue;
    const action: GroupAction = product.stock === 0 ? "unchanged" : "update";
    counts[action]++;
    groups.push({ key, name: product.name, condition: null, ram: null, storage: null, batches: 0, total: 0, action, product, candidates: [], decision: st.link_decision });
  }
  return { ok: true, result: { records, pages, complete, failed: failed.slice(0, 50), groups, counts, totalStock: grouped.reduce((n, g) => n + g.total, 0) } };
}

// ---------------------------------------------------------------------------
// Admin decision for one group (explicit, verified mapping)
// ---------------------------------------------------------------------------

const GROUP_KEY = /^[a-z0-9]{2,250}\|[a-z0-9.\-]{1,12}\|[a-z0-9.\-]{1,12}\|(new|used|refurbished|unknown)$/;

export async function decideLovableGroup(
  groupKey: string,
  decision: { type: "link"; productId: string } | { type: "create" } | { type: "clear" },
  userId: string | null,
  deps: { db?: Db | null } = {},
): Promise<{ ok: boolean; message: string }> {
  if (!GROUP_KEY.test(groupKey)) return { ok: false, message: "Invalid group." };
  const db = deps.db === undefined ? getServiceClient() : deps.db;
  if (!db) return { ok: false, message: "SUPABASE_SERVICE_ROLE_KEY is not set on the server." };
  const base = { source: LOVABLE_SOURCE, group_key: groupKey, updated_at: new Date().toISOString() };
  let row: Record<string, unknown>;
  if (decision.type === "link") {
    if (!/^[0-9a-f-]{36}$/i.test(decision.productId)) return { ok: false, message: "Invalid product." };
    const { data: product } = await db.from("products").select("id, name").eq("id", decision.productId).maybeSingle();
    if (!product) return { ok: false, message: "That product no longer exists." };
    const { data: other } = await db.from("stock_source_groups").select("group_key").eq("source", LOVABLE_SOURCE).eq("product_id", decision.productId).neq("group_key", groupKey).maybeSingle();
    if (other) return { ok: false, message: "That product is already linked to another Lovable group." };
    row = { ...base, product_id: decision.productId, link_decision: "linked", linked_by: userId, linked_at: new Date().toISOString(), status: "pending", match_candidates: [] };
  } else if (decision.type === "create") {
    row = { ...base, product_id: null, link_decision: "create", linked_by: userId, linked_at: new Date().toISOString(), status: "pending", match_candidates: [] };
  } else {
    // unlink: the product keeps its current stock; the group waits for a new decision
    row = { ...base, product_id: null, link_decision: null, linked_by: null, linked_at: null, status: "pending" };
  }
  const { error } = await db.from("stock_source_groups").upsert(row, { onConflict: "source,group_key" });
  if (error) return { ok: false, message: missing23(error.message) || /stock_source_groups/.test(error.message) ? MIGRATION_23 : `Saving failed (${error.code ?? "error"}).` };
  return {
    ok: true,
    message:
      decision.type === "link"
        ? "Linked. The next sync sets this product's stock to the group's total (nothing else on the product changes)."
        : decision.type === "create"
          ? "The next sync creates a new draft for this group."
          : "Link removed. The product keeps its current stock.",
  };
}
