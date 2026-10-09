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
} as const;

type Tag = (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS];

function expireTags(tags: Tag[]) {
  // expire: 0 = drop the cached data now, so the very next request reads the
  // database (a stale-while-revalidate profile would serve old prices once).
  for (const tag of tags) revalidateTag(tag, { expire: 0 });
}

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

/** Brand or category changed (also affects menus). */
export function invalidateTaxonomy() {
  expireTags([CACHE_TAGS.navigation, CACHE_TAGS.catalog]);
  revalidatePath("/", "layout");
}

/** Site/SEO settings, banners or pages changed. */
export function invalidateContent() {
  expireTags([CACHE_TAGS.settings]);
  revalidatePath("/", "layout");
}

/** Homepage Management saved: refresh only the homepage. */
export function invalidateHomepage() {
  expireTags([CACHE_TAGS.homepage]);
  revalidatePath("/");
}
