import "server-only";
import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache";
import { getFilterOptions, queryProducts, type ProductQuery } from "@/services/catalog";

/**
 * Listing pages read the URL (filters, sort, page), so they render per request.
 * Their data is cached by query, though: the same filter combination hits the
 * database at most once per hour, or again after an admin change.
 */
export const cachedQueryProducts = unstable_cache(async (q: ProductQuery) => queryProducts(q), ["product-query"], {
  tags: [CACHE_TAGS.catalog],
  revalidate: 3600,
});

export const cachedFilterOptions = unstable_cache(
  async (category: string | null) => getFilterOptions(category),
  ["filter-options"],
  { tags: [CACHE_TAGS.catalog], revalidate: 3600 },
);
