import type { Metadata } from "next";
import Link from "next/link";
import {
  getBanners,
  getBrands,
  getCategories,
  getProductBySlug,
  getPublishedPages,
  getRecentReviews,
  queryProducts,
  type ProductQuery,
} from "@/services/catalog";
import { getSeoSettings, getSiteSettings } from "@/services/settings";
import { getHomepageSections, getProductCardsByIds } from "@/services/homepage";
import { DealsBoard, HomeHero, type HeroSpotlight } from "@/components/store/home-hero";
import {
  BrandStrip,
  CategoryShowcase,
  ExchangeAndEmi,
  FooterPromo,
  HomeSectionHeader,
  ProductRail,
  PromoBanners,
  TrustStrip,
  WhyUs,
  type PromoLink,
} from "@/components/store/home-sections";
import { RatingStars } from "@/components/store/product-bits";
import { buildMetadata } from "@/lib/seo";
import { SECTION_DEFS, sectionLimit, sectionText, type HomepageSection, type SectionKey } from "@/lib/homepage";
import { EMI_PROMO, EXCHANGE_PROMO } from "@/lib/storefront";
import { nowLabel, whatsappLink } from "@/lib/utils";
import type { Banner, Category, ProductCard } from "@/types";
import { withSiteDefaults } from "@/lib/page-metadata";

// Static page. Refreshed immediately when an admin changes products, stock,
// banners, settings or Homepage Management (on-demand invalidation). The
// time-based refresh is only a fallback (e.g. a banner's start/end time) and
// runs every 30 minutes: each refresh is a full server render, which on
// Cloudflare Workers Free can exceed the 10 ms CPU limit.
export const revalidate = 1800;

export async function generateMetadata(): Promise<Metadata> {
  const seo = await getSeoSettings();
  return withSiteDefaults(buildMetadata({
    title: seo.site_title,
    description: seo.site_description,
    path: "/",
    image: seo.default_og_image,
    absoluteTitle: true,
  }));
}

function findAccessories(categories: Category[]): Category | undefined {
  return categories.find((c) => c.slug === "accessories") ?? categories.find((c) => !c.parent_id && /accessor/i.test(c.name));
}

/** Button target: the admin's URL, else a published page (Admin → Pages), else WhatsApp, else Contact. */
function promoLink(
  custom: { url: string | null; text: string | null },
  publishedSlugs: Set<string>,
  pageSlugs: readonly string[],
  pageLabel: string,
  fallbackLabel: string,
  whatsapp: string | null,
  message: string,
): PromoLink {
  if (custom.url) return { href: custom.url, label: custom.text || pageLabel, external: /^https?:\/\//.test(custom.url) };
  const page = pageSlugs.find((s) => publishedSlugs.has(s));
  if (page) return { href: `/pages/${page}`, label: custom.text || pageLabel, external: false };
  const wa = whatsappLink(whatsapp, message);
  if (wa) return { href: wa, label: custom.text || fallbackLabel, external: true };
  return { href: "/contact", label: custom.text || fallbackLabel, external: false };
}

const PRODUCT_HREF: Partial<Record<SectionKey, string>> = {
  offers: "/offers",
  featured: "/products?flag=featured",
  new_arrivals: "/products?sort=newest",
  used: "/products?flag=used",
  refurbished: "/products?condition=refurbished",
  best_sellers: "/products?flag=best_seller",
};

export default async function HomePage() {
  const [layout, settings] = await Promise.all([getHomepageSections(), getSiteSettings()]);
  const sections = layout.filter((s) => s.isEnabled);
  const enabled = new Set(sections.map((s) => s.key));
  const get = (k: SectionKey) => sections.find((s) => s.key === k);

  // Each query runs at most once, and only for sections that are switched on.
  const memo = new Map<string, Promise<unknown>>();
  const once = <T,>(key: string, load: () => Promise<T>) => {
    if (!memo.has(key)) memo.set(key, load());
    return memo.get(key) as Promise<T>;
  };
  const products = (key: string, q: ProductQuery) => once(key, () => queryProducts({ perPage: 12, ...q }).then((r) => r.items));
  const categories = () => once("categories", getCategories);
  const banners = () => once("banners", () => Promise.all([getBanners("hero"), getBanners("promo")]));

  // All manually picked products, one request.
  const manualIds = Array.from(
    new Set(sections.filter((s) => s.mode === "manual" && SECTION_DEFS[s.key].itemType === "product").flatMap((s) => s.itemIds)),
  );
  const manualCards = once("manual", () => getProductCardsByIds(manualIds));
  const pick = async (s: HomepageSection) => {
    const byId = new Map((await manualCards).map((c) => [c.id, c]));
    return s.itemIds.map((id) => byId.get(id)).filter((c): c is ProductCard => Boolean(c));
  };

  const autoProducts = async (key: SectionKey): Promise<ProductCard[]> => {
    switch (key) {
      case "offers":
        return products("offers", { flag: "offer", sort: "popular" });
      case "featured":
        return products("featured", { flag: "featured", sort: "popular" });
      case "new_arrivals": {
        const fresh = await products("new", { flag: "new", sort: "newest" });
        return fresh.length ? fresh : products("latest", { sort: "newest" });
      }
      case "used":
        return enabled.has("refurbished") ? products("used-only", { conditions: ["used"], sort: "newest" }) : products("used", { flag: "used", sort: "newest" });
      case "refurbished":
        return products("refurbished", { conditions: ["refurbished"], sort: "newest" });
      case "accessories": {
        const cat = findAccessories(await categories());
        return cat ? products("accessories", { category: cat.slug, sort: "newest" }) : [];
      }
      case "best_sellers":
        return products("best", { flag: "best_seller", sort: "popular" });
      default:
        return [];
    }
  };
  const sectionProducts = async (s: HomepageSection) => (s.mode === "manual" ? pick(s) : autoProducts(s.key));

  // Hero spotlight (manual pick, else top featured product with a photo, else newest).
  const heroSection = get("hero");
  const spotlightCard: ProductCard | null = heroSection
    ? heroSection.mode === "manual"
      ? ((await pick(heroSection))[0] ?? null)
      : await (async () => {
          const featured = await products("featured", { flag: "featured", sort: "popular" });
          const latest = await products("latest", { sort: "newest" });
          return featured.find((p) => p.image_url) ?? latest.find((p) => p.image_url) ?? featured[0] ?? null;
        })()
    : null;

  const dealsSection = get("deals");
  const inHero = new Set(spotlightCard ? [spotlightCard.id] : []);

  const [spotlightDetail, dealsData, pages, resolved] = await Promise.all([
    spotlightCard ? getProductBySlug(spotlightCard.slug) : Promise.resolve(null),
    dealsSection
      ? (async () => {
          if (dealsSection.mode === "manual") return { list: (await pick(dealsSection)).slice(0, sectionLimit(dealsSection)), offers: true };
          const offers = (await products("offers", { flag: "offer", sort: "popular" })).filter((p) => !inHero.has(p.id));
          if (offers.length) return { list: offers.slice(0, sectionLimit(dealsSection)), offers: true };
          const featured = (await products("featured", { flag: "featured", sort: "popular" })).filter((p) => !inHero.has(p.id));
          return { list: featured.slice(0, sectionLimit(dealsSection)), offers: false };
        })()
      : Promise.resolve({ list: [] as ProductCard[], offers: false }),
    enabled.has("exchange") || enabled.has("emi") ? getPublishedPages() : Promise.resolve([]),
    Promise.all(
      sections.map(async (s) => {
        const def = SECTION_DEFS[s.key];
        if (def.itemType === "product" && s.key !== "hero" && s.key !== "deals") return [s.key, (await sectionProducts(s)).slice(0, sectionLimit(s))] as const;
        if (s.key === "categories") {
          const all = await categories();
          const list = s.mode === "manual" ? s.itemIds.map((id) => all.find((c) => c.id === id)).filter((c): c is Category => Boolean(c)) : [...all.filter((c) => c.is_featured), ...all.filter((c) => !c.is_featured)];
          return [s.key, list.slice(0, sectionLimit(s))] as const;
        }
        if (s.key === "brands") {
          const all = await once("brands", getBrands);
          const list = s.mode === "manual" ? s.itemIds.map((id) => all.find((b) => b.id === id)).filter((b) => Boolean(b)) : all.some((b) => b.is_featured) ? all.filter((b) => b.is_featured) : all;
          return [s.key, list.slice(0, sectionLimit(s))] as const;
        }
        if (s.key === "promotions") {
          const [hero, promo] = await banners();
          const all: Banner[] = [...hero, ...promo];
          const list = s.mode === "manual" ? s.itemIds.map((id) => all.find((b) => b.id === id)).filter((b): b is Banner => Boolean(b)) : all;
          return [s.key, list] as const;
        }
        if (s.key === "reviews") return [s.key, await getRecentReviews(sectionLimit(s))] as const;
        if (s.key === "accessories") return [s.key, await sectionProducts(s)] as const;
        return [s.key, null] as const;
      }),
    ),
  ]);
  const data = new Map<SectionKey, unknown>(resolved);

  // With no product to show, the first hero banner leads the page.
  const heroBanner = heroSection && !spotlightCard ? ((await banners())[0][0] ?? null) : null;
  const spotlight: HeroSpotlight | null = spotlightCard ? { card: spotlightCard, detail: spotlightDetail } : null;
  const publishedSlugs = new Set(pages.map((p) => p.slug));
  const text = (s: HomepageSection) => sectionText(s, settings.store_name);
  const updatedAt = nowLabel();
  const accessoriesCategory = enabled.has("accessories") ? findAccessories(await categories()) : undefined;

  // Hero + Deals and Exchange + EMI sit side by side when they are next to each other.
  const order = sections.map((s) => s.key);
  const adjacent = (a: SectionKey, b: SectionKey) => Math.abs(order.indexOf(a) - order.indexOf(b)) === 1 && enabled.has(a) && enabled.has(b);
  const heroWithDeals = adjacent("hero", "deals");
  const exchangeWithEmi = adjacent("exchange", "emi");

  const exchangeContent = (s: HomepageSection) => {
    const t = text(s);
    return {
      title: t.title,
      subtitle: t.subtitle,
      description: t.description,
      link: promoLink({ url: t.buttonUrl, text: s.buttonText }, publishedSlugs, EXCHANGE_PROMO.pageSlugs, EXCHANGE_PROMO.cta, EXCHANGE_PROMO.cta, settings.whatsapp, EXCHANGE_PROMO.whatsappMessage),
    };
  };
  const emiContent = (s: HomepageSection) => {
    const t = text(s);
    return {
      title: t.title,
      subtitle: t.subtitle,
      points: t.items.map((i) => i.title).filter(Boolean),
      link: promoLink({ url: t.buttonUrl, text: s.buttonText }, publishedSlugs, EMI_PROMO.pageSlugs, EMI_PROMO.cta, EMI_PROMO.fallbackCta, settings.whatsapp, EMI_PROMO.whatsappMessage),
    };
  };

  const render = (s: HomepageSection): React.ReactNode => {
    const t = text(s);
    switch (s.key) {
      case "hero": {
        const deals = heroWithDeals && dealsSection ? dealsData.list : [];
        return (
          <div key="hero" className="container-page pt-4 lg:pt-6">
            <HomeHero
              spotlight={spotlight}
              banner={heroBanner}
              deals={deals}
              dealsAreOffers={dealsData.offers}
              dealsTitle={dealsSection?.title || null}
              dealsSubtitle={dealsSection?.subtitle || null}
              imageOverride={s.imageUrl}
              updatedAt={updatedAt}
              storeName={settings.store_name}
              tagline={settings.tagline}
              taglineBn={settings.tagline_bn}
            />
          </div>
        );
      }
      case "deals":
        if (heroWithDeals || dealsData.list.length === 0) return null;
        return (
          <div key="deals" className="container-page mt-14">
            <DealsBoard products={dealsData.list} updatedAt={updatedAt} offers={dealsData.offers} title={s.title || null} subtitle={s.subtitle || null} wide />
          </div>
        );
      case "trust":
        return <TrustStrip key="trust" items={t.items} />;
      case "categories":
        return (
          <CategoryShowcase
            key="categories"
            categories={(data.get("categories") as Category[]) ?? []}
            title={t.title}
            href={t.buttonUrl ?? "/categories"}
            linkLabel={t.buttonText ?? undefined}
          />
        );
      case "exchange":
        return <ExchangeAndEmi key="exchange" exchange={exchangeContent(s)} emi={exchangeWithEmi && get("emi") ? emiContent(get("emi")!) : null} />;
      case "emi":
        if (exchangeWithEmi) return null;
        return <ExchangeAndEmi key="emi" exchange={null} emi={emiContent(s)} />;
      case "brands":
        return (
          <BrandStrip
            key="brands"
            brands={(data.get("brands") as Parameters<typeof BrandStrip>[0]["brands"]) ?? []}
            title={t.title}
            href={t.buttonUrl ?? "/brands"}
            linkLabel={t.buttonText ?? undefined}
          />
        );
      case "promotions":
        return <PromoBanners key="promotions" banners={((data.get("promotions") as Banner[]) ?? []).filter((b) => b.id !== heroBanner?.id).slice(0, sectionLimit(s))} />;
      case "reviews": {
        const reviews = (data.get("reviews") as Awaited<ReturnType<typeof getRecentReviews>>) ?? [];
        if (reviews.length === 0) return null;
        return (
          <section key="reviews" className="container-page mt-14" aria-labelledby="home-reviews">
            <HomeSectionHeader id="home-reviews" title={t.title} />
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
        );
      }
      case "why":
        return <WhyUs key="why" title={t.title} items={t.items} />;
      case "footer_promo":
        return (
          <FooterPromo
            key="footer_promo"
            title={t.title}
            subtitle={t.subtitle}
            whatsappHref={whatsappLink(settings.whatsapp, `Hello ${settings.store_name}, I want to know the price of `)}
            buttonText={t.buttonText ?? "Contact the shop"}
            buttonUrl={t.buttonUrl ?? "/contact"}
          />
        );
      default: {
        // product rails
        const list = (data.get(s.key) as ProductCard[]) ?? [];
        let title = t.title;
        let subtitle = t.subtitle ?? undefined;
        let href = t.buttonUrl ?? PRODUCT_HREF[s.key] ?? "/products";
        if (s.key === "used" && !s.title && enabled.has("refurbished")) {
          title = "Used phones";
          subtitle = s.subtitle || "Checked and tested, with the condition stated on every listing";
        }
        if (s.key === "accessories") {
          const cat = accessoriesCategory;
          if (cat) {
            title = s.title || cat.name;
            subtitle = s.subtitle || cat.description || undefined;
            href = t.buttonUrl ?? `/categories/${cat.slug}`;
          }
        }
        return (
          <ProductRail
            key={s.key}
            id={`home-${s.key}`}
            title={title}
            subtitle={subtitle}
            href={href}
            linkLabel={t.buttonText ?? undefined}
            products={list.slice(0, sectionLimit(s))}
          />
        );
      }
    }
  };

  return (
    <>
      <h1 className="sr-only">
        {settings.store_name} — {settings.tagline}
      </h1>
      {sections.map(render)}
    </>
  );
}
