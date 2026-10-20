import "server-only";
import { revalidatePath, revalidateTag } from "next/cache";

/**
 * Caching strategy (cost control)
 * --------------------------------
 * - Public catalog pages are statically rendered and cached (ISR). They read
 *   through a cookie-less client so they can be cached at all.
 * - Long time-based fallbacks below; real freshness comes from on-demand
 *   invalidation whenever an admin saves something or an order changes stock.
 * - Shared data used on every page (settings, menu) is cached with tags so
 *   even dynamic pages (search, account) don't re-query it on each request.
 */
export const REVALIDATE = {
  home: 1800, // 30 min (fallback only; changes refresh it immediately)
  catalog: 3600, // 1 hour — product, brand, category pages
  static: 86400, // 1 day — about, contact, pages
} as const;

export const CACHE_TAGS = {
  settings: "settings",
  navigation: "navigation", // brands + categories
  catalog: "catalog",
  homepage: "homepage",
  tracking: "tracking", // public tracking IDs + consent settings (Admin → Analytics & Tracking)
  header: "header", // announcement bar + Locations (Admin → Settings)
} as const;

type Tag = (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS];

function expireTags(tags: Tag[]) {
  // expire: 0 = drop the cached data now, so the very next request reads the
  // database (a stale-while-revalidate profile would serve old prices once).
  for (const tag of tags) revalidateTag(tag, { expire: 0 });
}

/**
 * Stale-while-revalidate for data that every storefront page reads (site
 * settings, menus, tracking IDs). Every cached page carries these tags, so
 * expiring them (or revalidatePath("/", "layout")) forced a full server render
 * of EVERY page on its next visit, all inside visitors' requests. On Workers
 * Free that burst exceeded the CPU limit (Error 1102 right after admin saves
 * on 2026-10-20). With "max", each page is served once more from cache and
 * regenerated in the background (OpenNext queue, one render per page); the
 * regeneration waits for fresh data, so the next visitor sees the change.
 * Not used for prices or stock: those keep expireTags().
 */
function staleTags(tags: Tag[]) {
  for (const tag of tags) revalidateTag(tag, "max");
}

/**
 * Dynamic pages that show money from site settings (delivery charges). Their
 * own path tag is expired, so their next render reads the settings fresh
 * instead of the stale copy. They are rendered per request anyway (no cached
 * page), so this adds no render work.
 */
const SETTINGS_MONEY_PATHS = ["/cart", "/checkout"] as const;

/**
 * Pages that list products. A product change refreshes these, not the whole
 * site: revalidatePath("/", "layout") used to mark EVERY cached page stale
 * (all product, brand, category and info pages), and on Cloudflare Workers
 * Free each of those then needed a full server render on its next visit.
 */
const PRODUCT_LIST_PATHS = ["/", "/products", "/offers", "/brands", "/categories", "/sitemap.xml", "/feeds/google-merchant.xml"] as const;
// Every brand / category page (route pattern). The route group is listed too,
// since the pattern Next.js matches depends on how the route is resolved.
const PRODUCT_LIST_PATTERNS = ["/brands/[slug]", "/categories/[slug]", "/(store)/brands/[slug]", "/(store)/categories/[slug]"] as const;

/**
 * Product created/updated/deleted, stock or price changed.
 * Refreshes the product's own page(s), every page that lists products and the
 * cached listing data. Other products' pages keep their "related products"
 * cards until their own hourly refresh (REVALIDATE.catalog); checkout always
 * re-checks price and stock in the database.
 */
export function invalidateProduct(slugs: (string | null | undefined)[] = []) {
  expireTags([CACHE_TAGS.catalog]);
  for (const slug of new Set(slugs)) if (slug) revalidatePath(`/products/${slug}`);
  for (const path of PRODUCT_LIST_PATHS) revalidatePath(path);
  for (const pattern of PRODUCT_LIST_PATTERNS) revalidatePath(pattern, "page");
}

/**
 * Stock changed by an order: refresh those product pages, the home page and
 * the cached listing data. Unfiltered listing pages catch up within
 * REVALIDATE.catalog; checkout always re-checks stock in the database.
 */
export function invalidateStock(slugs: (string | null | undefined)[]) {
  expireTags([CACHE_TAGS.catalog]);
  for (const slug of slugs) if (slug) revalidatePath(`/products/${slug}`);
  revalidatePath("/");
}

/**
 * Brand or category changed. Product listings (catalog) refresh now; menus on
 * every other page refresh in the background (see staleTags).
 */
export function invalidateTaxonomy() {
  expireTags([CACHE_TAGS.catalog]);
  staleTags([CACHE_TAGS.navigation]);
}

/**
 * Site/SEO settings, banners, pages or favicon changed: every page refreshes
 * in the background (see staleTags); cart and checkout read them fresh.
 */
export function invalidateContent() {
  staleTags([CACHE_TAGS.settings]);
  for (const path of SETTINGS_MONEY_PATHS) revalidatePath(path);
}

/** Homepage Management saved: refresh only the homepage. */
export function invalidateHomepage() {
  expireTags([CACHE_TAGS.homepage]);
  revalidatePath("/");
}

/** Tracking IDs, routing or consent settings changed: every storefront page embeds them. */
export function invalidateTracking() {
  staleTags([CACHE_TAGS.tracking]);
}

/**
 * Announcement bar / Locations saved: only the header data. Pages refresh in
 * the background (see staleTags); the bar's schedule is checked again in
 * the visitor's browser, so a cached page never shows an ended offer.
 */
export function invalidateHeader() {
  staleTags([CACHE_TAGS.header]);
}
