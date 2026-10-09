import type { ProductFlag, ProductQuery, SortOption } from "@/services/catalog";

export type RawSearchParams = Record<string, string | string[] | undefined>;

const SORTS: SortOption[] = ["relevance", "price_asc", "price_desc", "newest", "popular"];
const FLAGS: ProductFlag[] = ["featured", "new", "offer", "best_seller", "used"];
const CONDITIONS = ["new", "used", "refurbished"];

export const SORT_LABELS: Record<SortOption, string> = {
  relevance: "Relevance",
  price_asc: "Price: low to high",
  price_desc: "Price: high to low",
  newest: "Newest",
  popular: "Popular",
};

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function list(v: string | string[] | undefined, max = 12): string[] {
  const raw = one(v);
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);
}

function num(v: string | string[] | undefined): number | null {
  const raw = one(v);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Parse URL search params into a validated ProductQuery. */
export function parseListingParams(sp: RawSearchParams, defaults: Partial<ProductQuery> = {}): ProductQuery {
  const sort = one(sp.sort) as SortOption | undefined;
  const flag = one(sp.flag) as ProductFlag | undefined;
  const stock = one(sp.stock);
  const page = Math.min(Math.max(Number.parseInt(one(sp.page) ?? "1", 10) || 1, 1), 500);

  return {
    query: one(sp.q)?.slice(0, 100) || defaults.query || null,
    brands: list(sp.brand).length ? list(sp.brand).map((b) => b.toLowerCase()) : (defaults.brands ?? []),
    category: one(sp.category) || defaults.category || null,
    minPrice: num(sp.min),
    maxPrice: num(sp.max),
    ram: list(sp.ram).map((v) => v.toUpperCase()),
    storage: list(sp.storage).map((v) => v.toUpperCase()),
    conditions: list(sp.condition).filter((c) => CONDITIONS.includes(c)),
    inStock: stock === "in" ? true : stock === "out" ? false : null,
    flag: flag && FLAGS.includes(flag) ? flag : (defaults.flag ?? null),
    sort: sort && SORTS.includes(sort) ? sort : (defaults.sort ?? (one(sp.q) ? "relevance" : "relevance")),
    page,
    perPage: 24,
  };
}

/** True when the visitor applied filters (such pages are noindex to avoid thin duplicates). */
export function hasActiveFilters(sp: RawSearchParams): boolean {
  return ["brand", "category", "q", "min", "max", "ram", "storage", "condition", "stock", "sort", "flag"].some((k) => Boolean(one(sp[k])));
}

/** Rebuild a URL keeping current params and applying changes (null removes a key). */
export function buildListingHref(pathname: string, sp: RawSearchParams, changes: Record<string, string | number | null>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const val = one(v);
    if (val) params.set(k, val);
  }
  for (const [k, v] of Object.entries(changes)) {
    if (v === null || v === "") params.delete(k);
    else params.set(k, String(v));
  }
  if (params.get("page") === "1") params.delete("page");
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
