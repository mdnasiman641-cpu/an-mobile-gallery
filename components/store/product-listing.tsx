import { Suspense } from "react";
import { queryProducts, type ProductQuery } from "@/services/catalog";
import { cachedFilterOptions, cachedQueryProducts } from "@/services/listing";
import { ProductGrid } from "@/components/store/product-card";
import { FilterSidebar, MobileFilterButton, SortSelect } from "@/components/store/filters";
import { EmptyState, Pagination } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { buildListingHref, type RawSearchParams } from "@/lib/listing";

/** Shared listing body: filters + sort + grid + crawlable pagination. */
export async function ProductListing({
  query,
  searchParams,
  pathname,
  facetCategory = null,
  hideBrandFilter = false,
  fresh = false,
  emptyTitle = "No products match these filters",
  emptyDescription = "Try removing a filter or searching for something else.",
}: {
  query: ProductQuery;
  searchParams: RawSearchParams;
  /** Public URL of this listing; filter and page links are built from it. */
  pathname: string;
  facetCategory?: string | null;
  hideBrandFilter?: boolean;
  /** Read straight from the database (search) instead of the shared data cache. */
  fresh?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const [result, options] = await Promise.all([
    fresh ? queryProducts(query) : cachedQueryProducts(query),
    cachedFilterOptions(facetCategory),
  ]);

  return (
    <div className="flex gap-6">
      <Suspense fallback={<div className="hidden w-64 shrink-0 lg:block" />}>
        <FilterSidebar options={options} hideBrand={hideBrandFilter} basePath={pathname} />
      </Suspense>
      <div className="min-w-0 flex-1">
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-sm text-ink-soft" aria-live="polite">
            {result.total === 1 ? "1 product" : `${result.total.toLocaleString("en-IN")} products`}
          </p>
          <div className="flex items-center gap-2">
            <Suspense fallback={null}>
              <MobileFilterButton options={options} hideBrand={hideBrandFilter} basePath={pathname} />
              <SortSelect showRelevance={Boolean(query.query)} basePath={pathname} />
            </Suspense>
          </div>
        </div>

        {result.items.length ? (
          <>
            <ProductGrid products={result.items} priorityCount={4} className="xl:grid-cols-4" />
            <Pagination
              page={result.page}
              totalPages={result.totalPages}
              buildHref={(p) => buildListingHref(pathname, searchParams, { page: p })}
            />
          </>
        ) : (
          <EmptyState
            title={emptyTitle}
            description={emptyDescription}
            action={
              <ButtonLink href={pathname} variant="outline">
                Clear filters
              </ButtonLink>
            }
          />
        )}
      </div>
    </div>
  );
}
