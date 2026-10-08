import type { Metadata } from "next";
import { ProductListing } from "@/components/store/product-listing";
import { SearchBox } from "@/components/store/search-box";
import { Breadcrumbs } from "@/components/ui/misc";
import { buildMetadata } from "@/lib/seo";
import { parseListingParams, type RawSearchParams } from "@/lib/listing";

type Props = { searchParams: Promise<RawSearchParams> };

// Search result pages are not indexed: they would duplicate product and
// category pages (Google's guidance on internal search results).
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : "";
  return buildMetadata({
    title: q ? `Search results for “${q}”` : "Search",
    description: "Search phones, brands and gadgets.",
    path: "/search",
    noIndex: true,
  });
}

export default async function SearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const query = parseListingParams(sp);
  const q = query.query ?? "";

  return (
    <div className="container-page py-5 lg:py-8">
      <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Search" }]} />
      <h1 className="mt-3 text-2xl font-bold md:text-3xl">{q ? <>Results for “{q}”</> : "Search products"}</h1>
      <div className="mt-4 max-w-2xl md:hidden">
        <SearchBox key={q} initialQuery={q} />
      </div>
      <div className="mt-5">
        {q || query.brands?.length || query.category ? (
          <ProductListing
            query={query}
            searchParams={sp}
            pathname="/search"
            fresh
            emptyTitle={`Nothing found for “${q}”`}
            emptyDescription="Check the spelling, try a model number like “S25” or “Note 14”, or browse by brand."
          />
        ) : (
          <p className="text-ink-soft">Type a phone name, brand or model number in the search box.</p>
        )}
      </div>
    </div>
  );
}
