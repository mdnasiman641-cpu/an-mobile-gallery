import type { Metadata } from "next";
import Link from "next/link";
import {
  getBanners,
  getBrands,
  getCategories,
  getHomeSections,
  getProductBySlug,
  getPublishedPages,
  getRecentReviews,
  queryProducts,
} from "@/services/catalog";
import { getSeoSettings, getSiteSettings } from "@/services/settings";
import { HomeHero, type HeroSpotlight } from "@/components/store/home-hero";
import {
  BrandStrip,
  CategoryShowcase,
  ExchangeAndEmi,
  HomeSectionHeader,
  ProductRail,
  PromoBanners,
  TrustStrip,
  WhyUs,
  type PromoLink,
} from "@/components/store/home-sections";
import { RatingStars } from "@/components/store/product-bits";
import { buildMetadata } from "@/lib/seo";
import { EMI_PROMO, EXCHANGE_PROMO } from "@/lib/storefront";
import { nowLabel, whatsappLink } from "@/lib/utils";
import type { Category, ProductCard } from "@/types";

// Static page, refreshed at most every 10 minutes (and immediately when an
// admin changes products, banners or settings).
export const revalidate = 600;

export async function generateMetadata(): Promise<Metadata> {
  const seo = await getSeoSettings();
  return buildMetadata({
    title: seo.site_title,
    description: seo.site_description,
    path: "/",
    image: seo.default_og_image,
    absoluteTitle: true,
  });
}

function findAccessories(categories: Category[]): Category | undefined {
  return categories.find((c) => c.slug === "accessories") ?? categories.find((c) => !c.parent_id && /accessor/i.test(c.name));
}

/** Link for a promo button: a published page (Admin → Pages), else WhatsApp, else the contact page. */
function promoLink(
  publishedSlugs: Set<string>,
  pageSlugs: readonly string[],
  pageLabel: string,
  fallbackLabel: string,
  whatsapp: string | null,
  message: string,
): PromoLink {
  const page = pageSlugs.find((s) => publishedSlugs.has(s));
  if (page) return { href: `/pages/${page}`, label: pageLabel, external: false };
  const wa = whatsappLink(whatsapp, message);
  if (wa) return { href: wa, label: fallbackLabel, external: true };
  return { href: "/contact", label: fallbackLabel, external: false };
}

function dedupe(list: ProductCard[], skip: Set<string>): ProductCard[] {
  return list.filter((p) => !skip.has(p.id));
}

export default async function HomePage() {
  const [sections, heroBanners, promoBanners, categories, brands, reviews, settings, pages] = await Promise.all([
    getHomeSections(),
    getBanners("hero"),
    getBanners("promo"),
    getCategories(),
    getBrands(),
    getRecentReviews(6),
    getSiteSettings(),
    getPublishedPages(),
  ]);

  // Hero spotlight: the top featured product with a photo (else the newest).
  const spotlightCard =
    sections.featured.find((p) => p.image_url) ?? sections.latest.find((p) => p.image_url) ?? sections.featured[0] ?? null;
  const accessoriesCategory = findAccessories(categories);
  const [spotlightDetail, accessories] = await Promise.all([
    spotlightCard ? getProductBySlug(spotlightCard.slug) : Promise.resolve(null),
    accessoriesCategory
      ? queryProducts({ category: accessoriesCategory.slug, sort: "newest", perPage: 10 }).then((r) => r.items)
      : Promise.resolve<ProductCard[]>([]),
  ]);
  const spotlight: HeroSpotlight | null = spotlightCard ? { card: spotlightCard, detail: spotlightDetail } : null;

  // Deals board: discounted products; if there are none, today's featured prices.
  const inHero = new Set(spotlightCard ? [spotlightCard.id] : []);
  const offerDeals = dedupe(sections.offers, inHero).slice(0, 4);
  const deals = offerDeals.length ? offerDeals : dedupe(sections.featured, inHero).slice(0, 4);

  // Categories: featured first, then the rest, up to 6.
  const showcase = [...categories.filter((c) => c.is_featured), ...categories.filter((c) => !c.is_featured)].slice(0, 6);
  const popularBrands = (brands.some((b) => b.is_featured) ? brands.filter((b) => b.is_featured) : brands).slice(0, 12);

  // Admin banners: the first hero banner leads the page only when no product can.
  const heroBanner = spotlight ? null : (heroBanners[0] ?? null);
  const promotions = [...heroBanners.filter((b) => b.id !== heroBanner?.id), ...promoBanners].slice(0, 3);

  const publishedSlugs = new Set(pages.map((p) => p.slug));
  const exchangeLink = promoLink(
    publishedSlugs,
    EXCHANGE_PROMO.pageSlugs,
    EXCHANGE_PROMO.cta,
    EXCHANGE_PROMO.cta,
    settings.whatsapp,
    EXCHANGE_PROMO.whatsappMessage,
  );
  const emiLink = promoLink(
    publishedSlugs,
    EMI_PROMO.pageSlugs,
    EMI_PROMO.cta,
    EMI_PROMO.fallbackCta,
    settings.whatsapp,
    EMI_PROMO.whatsappMessage,
  );

  const newArrivals = sections.newArrivals.length ? sections.newArrivals : sections.latest;
  const wa = whatsappLink(settings.whatsapp, `Hello ${settings.store_name}, I want to know the price of `);

  return (
    <>
      <h1 className="sr-only">
        {settings.store_name} — {settings.tagline}
      </h1>

      <div className="container-page pt-4 lg:pt-6">
        <HomeHero
          spotlight={spotlight}
          banner={heroBanner}
          deals={deals}
          dealsAreOffers={offerDeals.length > 0}
          updatedAt={nowLabel()}
          storeName={settings.store_name}
          tagline={settings.tagline}
          taglineBn={settings.tagline_bn}
        />
      </div>

      <TrustStrip emiMonths={EMI_PROMO.months} />
      <CategoryShowcase categories={showcase} />
      <ExchangeAndEmi exchange={exchangeLink} emi={emiLink} />

      <ProductRail id="home-offers" title="Special offers" subtitle="Discounted right now" href="/offers" products={sections.offers} />
      <BrandStrip brands={popularBrands} />
      <ProductRail
        id="home-featured"
        title="Featured phones"
        subtitle="Hand-picked by our team"
        href="/products?flag=featured"
        products={sections.featured}
      />
      <PromoBanners banners={promotions} />
      <ProductRail
        id="home-new"
        title="New arrivals"
        subtitle="Recently added to the shop"
        href="/products?sort=newest"
        products={newArrivals}
      />
      <ProductRail
        id="home-used"
        title="Used & refurbished phones"
        subtitle="Checked and tested, with the condition stated on every listing"
        href="/products?flag=used"
        products={sections.used}
      />
      {accessoriesCategory ? (
        <ProductRail
          id="home-accessories"
          title={accessoriesCategory.name}
          subtitle={accessoriesCategory.description ?? undefined}
          href={`/categories/${accessoriesCategory.slug}`}
          products={accessories}
        />
      ) : null}
      <ProductRail
        id="home-best"
        title="Best sellers"
        subtitle="What customers buy most"
        href="/products?flag=best_seller"
        products={sections.bestSellers}
      />

      {reviews.length ? (
        <section className="container-page mt-14" aria-labelledby="home-reviews">
          <HomeSectionHeader id="home-reviews" title="What customers say" />
          <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {reviews.map((r) => (
              <li key={r.id} className="flex flex-col rounded-[var(--radius-card)] border border-line bg-surface p-5">
                <RatingStars value={r.rating} />
                {r.title ? <p className="mt-2 font-semibold text-ink">{r.title}</p> : null}
                <p className="mt-1 line-clamp-4 text-sm text-ink-soft">{r.body}</p>
                <p className="mt-auto pt-3 text-xs text-ink-mute">
                  {r.customer_name}
                  {r.is_verified_purchase ? " (verified purchase)" : ""}
                  {r.product ? (
                    <>
                      {" on "}
                      <Link href={`/products/${r.product.slug}`} className="underline hover:text-ink">
                        {r.product.name}
                      </Link>
                    </>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <WhyUs storeName={settings.store_name} phone={settings.phone} emiMonths={EMI_PROMO.months} />

      <section className="container-page mt-6">
        <div className="flex flex-col items-start gap-5 rounded-[24px] bg-board p-6 text-white sm:p-8 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xl font-bold tracking-[-0.02em] sm:text-2xl">Can&rsquo;t find the phone you want?</p>
            <p className="bn mt-1 text-white/80">আপনার পছন্দের ফোনটি খুঁজে না পেলে আমাদের জানান</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {wa ? (
              <a
                href={wa}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-11 items-center rounded-full bg-white px-6 font-semibold text-board hover:bg-gold"
              >
                Ask on WhatsApp
              </a>
            ) : null}
            <Link
              href="/contact"
              className="inline-flex h-11 items-center rounded-full border border-white/40 px-6 font-semibold text-white hover:border-white"
            >
              Contact the shop
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
