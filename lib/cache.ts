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
  home: 600, // 10 min
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

/** Product created/updated/deleted, stock or price changed. */
export function invalidateProduct(slugs: (string | null | undefined)[] = []) {
  expireTags([CACHE_TAGS.catalog]);
  for (const slug of slugs) if (slug) revalidatePath(`/products/${slug}`);
  revalidatePath("/", "layout");
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
