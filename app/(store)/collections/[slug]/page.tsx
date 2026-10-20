import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, MapPin, MessageCircle } from "lucide-react";
import { getBrands } from "@/services/catalog";
import { cachedQueryProducts } from "@/services/listing";
import { getSiteSettings } from "@/services/settings";
import { getHeaderConfig } from "@/services/header";
import { ProductListing } from "@/components/store/product-listing";
import { Breadcrumbs } from "@/components/ui/misc";
import { JsonLd } from "@/components/seo/json-ld";
import { breadcrumbJsonLd } from "@/lib/jsonld";
import { LANDINGS, LANDING_SLUGS, isLandingSlug, listingHref, type LandingDef } from "@/lib/collections";
import { visibleOutlets } from "@/lib/header-config";
import { absoluteUrl, buildMetadata } from "@/lib/seo";
import { withSiteDefaults } from "@/lib/page-metadata";
import { whatsappLink } from "@/lib/utils";

type Props = { params: Promise<{ slug: string }> };

// A few fixed campaign pages over the real catalog. Cached; refreshed with
// the other listing pages when products change (lib/cache.ts).
export const revalidate = 3600;
export const dynamicParams = false;
export function generateStaticParams() {
  return LANDING_SLUGS.map((slug) => ({ slug }));
}

/**
 * While a collection has no products the page still opens (links never break)
 * but shows an empty state and is kept out of search results and the sitemap.
 */
async function landing(slug: string): Promise<{ def: LandingDef; total: number } | null> {
  if (!isLandingSlug(slug)) return null;
  const def = LANDINGS[slug];
  if (def.brand && !(await getBrands()).some((b) => b.slug === def.brand)) return null;
  const page = await cachedQueryProducts({ ...def.query, perPage: 1 });
  return { def, total: page.total };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const l = await landing(slug);
  if (!l) return { title: "Not found", robots: { index: false } };
  return withSiteDefaults(buildMetadata({ title: l.def.title, description: l.def.description, path: `/collections/${slug}`, noIndex: l.total === 0 }));
}

export default async function CollectionPage({ params }: Props) {
  const { slug } = await params;
  const l = await landing(slug);
  if (!l) notFound();
  const { def, total } = l;
  const [settings, header] = await Promise.all([getSiteSettings(), getHeaderConfig()]);
  const wa = whatsappLink(settings.whatsapp, `Hello ${settings.store_name}, I'm interested in ${def.heading.toLowerCase()}.`);
  const hasLocations = visibleOutlets(header.outlets).length > 0;
  const others = LANDING_SLUGS.filter((s) => s !== def.slug);

  return (
    <div className="container-page py-5 lg:py-8">
      <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: def.heading }]} />
      <header className="mt-3 max-w-3xl">
        <h1 className="text-2xl font-bold md:text-3xl">
          {def.heading}
          {def.headingBn ? <span className="bn ml-2 text-xl font-medium text-ink-soft">{def.headingBn}</span> : null}
        </h1>
        <p className="mt-2 text-ink-soft">{def.intro}</p>
        <div className="mt-4 flex flex-wrap gap-2.5">
          {wa ? (
            <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-2 rounded-full bg-signal px-5 text-sm font-semibold text-white hover:bg-board">
              <MessageCircle className="h-4 w-4" aria-hidden />
              Ask on WhatsApp
            </a>
          ) : null}
          {hasLocations ? (
            <Link href="/shop-locations" className="inline-flex h-11 items-center gap-2 rounded-full border border-line px-5 text-sm font-semibold hover:border-signal hover:text-signal">
              <MapPin className="h-4 w-4" aria-hidden />
              Shop locations
            </Link>
          ) : null}
        </div>
      </header>

      <div className="mt-6">
        <ProductListing
          query={{ ...def.query }}
          searchParams={def.listingParams}
          pathname="/products"
          emptyTitle="Nothing here right now"
          emptyDescription="New stock is added often. Browse all phones in the meantime."
        />
      </div>
      {total > 24 ? (
        <p className="mt-4">
          <Link href={listingHref(def.listingParams)} className="inline-flex items-center gap-1 font-semibold text-signal hover:underline">
            See all {total} with filters <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </p>
      ) : null}

      <section className="mt-10 grid gap-6 rounded-[var(--radius-card)] border border-line bg-surface p-5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] md:p-7" aria-labelledby="collection-tips">
        <div>
          <h2 id="collection-tips" className="text-lg font-bold">
            {def.tipsTitle}
          </h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-ink-soft">
            {def.tips.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
        <nav aria-label="More collections">
          <h2 className="text-lg font-bold">More to browse</h2>
          <ul className="mt-3 space-y-1.5 text-sm">
            {others.map((s) => (
              <li key={s}>
                <Link href={`/collections/${s}`} className="font-semibold text-signal hover:underline">
                  {LANDINGS[s].heading}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/categories" className="font-semibold text-signal hover:underline">All categories</Link>
            </li>
            <li>
              <Link href="/offers" className="font-semibold text-signal hover:underline">Offers</Link>
            </li>
            <li>
              <Link href="/guides" className="font-semibold text-signal hover:underline">Buying guides</Link>
            </li>
          </ul>
        </nav>
      </section>

      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: def.heading, path: `/collections/${def.slug}` },
          ]),
          { "@context": "https://schema.org", "@type": "CollectionPage", name: def.title, description: def.description, url: absoluteUrl(`/collections/${def.slug}`) },
        ]}
      />
    </div>
  );
}
