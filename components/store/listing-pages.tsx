import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getBrandBySlug, getCategoryBySlug, getSlugRedirect } from "@/services/catalog";
import { ProductListing } from "@/components/store/product-listing";
import { Breadcrumbs } from "@/components/ui/misc";
import { RichText } from "@/components/ui/rich-text";
import { JsonLd } from "@/components/seo/json-ld";
import { breadcrumbJsonLd } from "@/lib/jsonld";
import { buildMetadata, taxonomySeoDescription, taxonomySeoTitle } from "@/lib/seo";
import { withSiteDefaults } from "@/lib/page-metadata";
import { hasActiveFilters, parseListingParams, type RawSearchParams } from "@/lib/listing";

/**
 * Listing pages are served two ways from the same public URL:
 *  - no filter/sort/page parameters -> a cached (ISR) page, e.g. /brands/apple
 *  - with parameters -> rendered per request through an internal rewrite to
 *    /browse/... (see LISTING_QUERY_KEYS in next.config.ts)
 * Both use these views, so markup, metadata and links are identical.
 */

function pageNumber(sp: RawSearchParams): number {
  const raw = Array.isArray(sp.page) ? sp.page[0] : sp.page;
  return Math.max(1, Number(raw) || 1);
}

function listingMeta(base: { title: string; description: string; path: string; image?: string | null }, sp: RawSearchParams): Promise<Metadata> {
  const page = pageNumber(sp);
  return withSiteDefaults(buildMetadata({
    title: page > 1 ? `${base.title} — Page ${page}` : base.title,
    description: base.description,
    path: page > 1 ? `${base.path}?page=${page}` : base.path,
    image: base.image,
    noIndex: hasActiveFilters(sp),
  }));
}

// ---------------------------------------------------------------- /products

const FLAG_TITLES: Record<string, string> = {
  featured: "Featured phones",
  new: "New arrivals",
  best_seller: "Best sellers",
  offer: "Phone offers",
  used: "Used & refurbished phones",
};

export function productsMetadata(sp: RawSearchParams): Promise<Metadata> {
  return listingMeta(
    {
      title: "All Mobile Phones Price in Bangladesh",
      description:
        "Browse every phone and gadget in stock with up-to-date prices in Bangladesh. Filter by brand, RAM, storage, price and condition.",
      path: "/products",
    },
    sp,
  );
}

export async function ProductsView({ sp }: { sp: RawSearchParams }) {
  const query = parseListingParams(sp);
  const flag = typeof sp.flag === "string" ? sp.flag : undefined;
  const heading = (flag && FLAG_TITLES[flag]) || "All products";
  return (
    <div className="container-page py-5 lg:py-8">
      <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: heading }]} />
      <h1 className="mt-3 text-2xl font-bold md:text-3xl">{heading}</h1>
      <div className="mt-5">
        <ProductListing query={query} searchParams={sp} pathname="/products" />
      </div>
      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Products", path: "/products" }])} />
    </div>
  );
}

// ------------------------------------------------------------------ /offers

export function offersMetadata(sp: RawSearchParams): Promise<Metadata> {
  return listingMeta(
    {
      title: "Mobile Phone Offers & Discounts in Bangladesh",
      description: "Current discounts on smartphones, used phones and accessories. Prices updated whenever offers change.",
      path: "/offers",
    },
    sp,
  );
}

export async function OffersView({ sp }: { sp: RawSearchParams }) {
  const query = parseListingParams(sp, { flag: "offer", sort: "popular" });
  query.flag = "offer";
  return (
    <div className="container-page py-5 lg:py-8">
      <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Offers" }]} />
      <h1 className="mt-3 text-2xl font-bold md:text-3xl">
        Offers <span className="bn ml-1 text-xl font-medium text-ink-soft">অফার</span>
      </h1>
      <p className="mt-1 text-ink-soft">Every product here is discounted right now.</p>
      <div className="mt-5">
        <ProductListing
          query={query}
          searchParams={sp}
          pathname="/offers"
          emptyTitle="No offers running right now"
          emptyDescription="New offers are added often. Check back soon or browse all products."
        />
      </div>
      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Offers", path: "/offers" }])} />
    </div>
  );
}

// ----------------------------------------------------------- /brands/[slug]

export async function brandMetadata(slug: string, sp: RawSearchParams): Promise<Metadata> {
  const brand = await getBrandBySlug(slug);
  if (!brand) return { title: "Brand not found", robots: { index: false } };
  return listingMeta(
    {
      title: taxonomySeoTitle("brand", brand),
      description: taxonomySeoDescription("brand", brand),
      path: `/brands/${brand.slug}`,
      image: brand.logo_url,
    },
    sp,
  );
}

export async function BrandView({ slug, sp }: { slug: string; sp: RawSearchParams }) {
  const brand = await getBrandBySlug(slug);
  if (!brand) {
    const target = await getSlugRedirect("brand", slug);
    if (target) permanentRedirect(`/brands/${target}`);
    notFound();
  }
  const query = parseListingParams(sp, { brands: [brand.slug] });
  query.brands = [brand.slug];
  const path = `/brands/${brand.slug}`;

  return (
    <div className="container-page py-5 lg:py-8">
      <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Brands", href: "/brands" }, { name: brand.name }]} />
      <h1 className="mt-3 text-2xl font-bold md:text-3xl">{brand.name} phones</h1>
      {brand.description ? <RichText content={brand.description} className="mt-1 text-ink-soft" /> : null}
      <div className="mt-5">
        <ProductListing query={query} searchParams={sp} pathname={path} hideBrandFilter />
      </div>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Brands", path: "/brands" },
          { name: brand.name, path },
        ])}
      />
    </div>
  );
}

// ------------------------------------------------------- /categories/[slug]

export async function categoryMetadata(slug: string, sp: RawSearchParams): Promise<Metadata> {
  const data = await getCategoryBySlug(slug);
  if (!data) return { title: "Category not found", robots: { index: false } };
  const { category } = data;
  return listingMeta(
    {
      title: taxonomySeoTitle("category", category),
      description: taxonomySeoDescription("category", category),
      path: `/categories/${category.slug}`,
      image: category.image_url,
    },
    sp,
  );
}

export async function CategoryView({ slug, sp }: { slug: string; sp: RawSearchParams }) {
  const data = await getCategoryBySlug(slug);
  if (!data) {
    const target = await getSlugRedirect("category", slug);
    if (target) permanentRedirect(`/categories/${target}`);
    notFound();
  }
  const { category, parent, children } = data;
  const query = parseListingParams(sp, { category: category.slug });
  query.category = category.slug;
  const path = `/categories/${category.slug}`;

  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Categories", path: "/categories" },
    ...(parent ? [{ name: parent.name, path: `/categories/${parent.slug}` }] : []),
    { name: category.name, path },
  ];

  return (
    <div className="container-page py-5 lg:py-8">
      <Breadcrumbs items={crumbs.map((c, i) => ({ name: c.name, href: i < crumbs.length - 1 ? c.path : undefined }))} />
      <h1 className="mt-3 text-2xl font-bold md:text-3xl">{category.name}</h1>
      {category.description ? <RichText content={category.description} className="mt-1 text-ink-soft" /> : null}
      {children.length ? (
        <ul className="no-scrollbar -mx-4 mt-4 flex gap-1.5 overflow-x-auto px-4">
          {children.map((ch) => (
            <li key={ch.id} className="shrink-0">
              <Link
                href={`/categories/${ch.slug}`}
                className="inline-flex h-9 items-center rounded-full border border-line-strong bg-surface px-3.5 text-sm font-medium hover:border-ink"
              >
                {ch.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-5">
        <ProductListing
          query={query}
          searchParams={sp}
          pathname={path}
          facetCategory={category.slug}
          emptyTitle={`No products in ${category.name} yet`}
        />
      </div>
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
    </div>
  );
}
