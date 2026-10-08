import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { BadgeCheck, Banknote, ShieldCheck, Truck } from "lucide-react";
import { getBanners, getBrands, getCategories, getHomeSections, getRecentReviews } from "@/services/catalog";
import { getSeoSettings, getSiteSettings } from "@/services/settings";
import { HomeHero } from "@/components/store/home-hero";
import { ProductGrid } from "@/components/store/product-card";
import { RatingStars } from "@/components/store/product-bits";
import { SectionHeading } from "@/components/ui/misc";
import { buildMetadata } from "@/lib/seo";
import { isSvg, nowLabel, whatsappLink } from "@/lib/utils";
import type { ProductCard } from "@/types";

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

function Rail({ title, subtitle, href, products }: { title: string; subtitle?: string; href: string; products: ProductCard[] }) {
  if (products.length === 0) return null;
  return (
    <section className="container-page mt-12" aria-label={title}>
      <SectionHeading title={title} subtitle={subtitle} href={href} />
      <ProductGrid products={products.slice(0, 10)} />
    </section>
  );
}

export default async function HomePage() {
  const [sections, heroBanners, promoBanners, categories, brands, reviews, settings] = await Promise.all([
    getHomeSections(),
    getBanners("hero"),
    getBanners("promo"),
    getCategories(),
    getBrands(),
    getRecentReviews(6),
    getSiteSettings(),
  ]);

  const featuredCategories = categories.filter((c) => c.is_featured).slice(0, 8);
  const popularBrands = brands.filter((b) => b.is_featured).slice(0, 12);
  const boardProducts = (sections.featured.length ? sections.featured : sections.latest).slice(0, 7);
  const wa = whatsappLink(settings.whatsapp, `Hello ${settings.store_name}, I want to know the price of `);

  return (
    <>
      <h1 className="sr-only">
        {settings.store_name} — {settings.tagline}
      </h1>

      <div className="container-page pt-4 lg:pt-6">
        <HomeHero banners={heroBanners} boardProducts={boardProducts} updatedAt={nowLabel()} />
      </div>

      {featuredCategories.length ? (
        <section className="container-page mt-10" aria-labelledby="home-categories">
          <h2 id="home-categories" className="mb-4 text-xl font-bold md:text-2xl">
            Shop by category
          </h2>
          <ul className="no-scrollbar -mx-4 flex gap-2.5 overflow-x-auto px-4 md:mx-0 md:grid md:grid-cols-4 md:px-0 lg:grid-cols-8">
            {featuredCategories.map((c) => (
              <li key={c.id} className="shrink-0">
                <Link
                  href={`/categories/${c.slug}`}
                  className="flex h-full min-w-36 flex-col items-center gap-2 rounded-[var(--radius-card)] border border-line bg-surface px-3 py-4 text-center hover:border-ink"
                >
                  {c.image_url ? (
                    <span className="relative h-14 w-14">
                      <Image src={c.image_url} alt="" fill sizes="56px" className="object-contain" unoptimized={isSvg(c.image_url)} />
                    </span>
                  ) : (
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-signal-tint text-xl font-bold text-signal-dark" aria-hidden>
                      {c.name.charAt(0)}
                    </span>
                  )}
                  <span className="text-sm font-semibold text-ink">{c.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Rail title="Featured phones" subtitle="Hand-picked by our team" href="/products?flag=featured" products={sections.featured} />

      {popularBrands.length ? (
        <section className="container-page mt-12" aria-labelledby="home-brands">
          <SectionHeading id="home-brands" title="Popular brands" href="/brands" linkLabel="All brands" />
          <ul className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
            {popularBrands.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/brands/${b.slug}`}
                  className="flex h-16 items-center justify-center rounded-[var(--radius-card)] border border-line bg-surface px-3 hover:border-ink"
                >
                  {b.logo_url ? (
                    <span className="relative h-8 w-24">
                      <Image src={b.logo_url} alt={b.name} fill sizes="96px" className="object-contain" unoptimized={isSvg(b.logo_url)} />
                    </span>
                  ) : (
                    <span className="text-[15px] font-bold tracking-tight text-ink">{b.name}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Rail title="Special offers" subtitle="Discounted right now" href="/offers" products={sections.offers} />

      {promoBanners.length ? (
        <section className="container-page mt-12 grid gap-3 md:grid-cols-2" aria-label="Promotions">
          {promoBanners.slice(0, 2).map((b) => (
            <Link
              key={b.id}
              href={b.button_url || "/offers"}
              className="relative flex min-h-36 overflow-hidden rounded-[var(--radius-card)] bg-ink"
            >
              <Image src={b.image_url} alt="" fill sizes="(min-width: 768px) 50vw, 100vw" className="object-cover opacity-70" unoptimized={isSvg(b.image_url)} />
              <span className="relative flex flex-col justify-center p-6 text-white">
                <span className="text-xl font-bold">{b.title}</span>
                {b.subtitle ? <span className="mt-1 text-sm text-white/85">{b.subtitle}</span> : null}
                {b.button_text ? <span className="mt-3 text-sm font-semibold underline">{b.button_text}</span> : null}
              </span>
            </Link>
          ))}
        </section>
      ) : null}

      <Rail title="Best sellers" subtitle="What customers buy most" href="/products?flag=best_seller" products={sections.bestSellers} />
      <Rail
        title="Used & refurbished phones"
        subtitle="Checked, with battery health and condition stated"
        href="/categories/used-phones"
        products={sections.used}
      />
      <Rail title="New arrivals" href="/products?flag=new" products={sections.newArrivals} />
      <Rail title="Latest products" href="/products?sort=newest" products={sections.latest} />

      <section className="container-page mt-14" aria-labelledby="why-us">
        <h2 id="why-us" className="text-xl font-bold md:text-2xl">
          Why buy from {settings.store_name}
        </h2>
        <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { Icon: BadgeCheck, title: "Original products", text: "Every phone is checked before it leaves the shop." },
            { Icon: Banknote, title: "The price you see is the price", text: "Prices in Taka with no hidden charges at checkout." },
            { Icon: Truck, title: "Cash on delivery", text: "Pay when the phone reaches you, anywhere in Bangladesh." },
            { Icon: ShieldCheck, title: "Warranty in writing", text: "Warranty terms are shown on every product page." },
          ].map(({ Icon, title, text }) => (
            <li key={title} className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
              <Icon className="h-6 w-6 text-signal" aria-hidden />
              <p className="mt-3 font-semibold text-ink">{title}</p>
              <p className="mt-1 text-sm text-ink-soft">{text}</p>
            </li>
          ))}
        </ul>
      </section>

      {reviews.length ? (
        <section className="container-page mt-14" aria-labelledby="home-reviews">
          <h2 id="home-reviews" className="text-xl font-bold md:text-2xl">
            What customers say
          </h2>
          <ul className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
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

      <section className="container-page mt-14">
        <div className="flex flex-col items-start gap-4 rounded-[var(--radius-card)] bg-signal p-6 text-white sm:p-8 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xl font-bold sm:text-2xl">Can&rsquo;t find the phone you want?</p>
            <p className="bn mt-1 text-white/85">আপনার পছন্দের ফোনটি খুঁজে না পেলে আমাদের জানান</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {wa ? (
              <a
                href={wa}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-11 items-center rounded-[var(--radius-control)] bg-white px-5 font-semibold text-ink"
              >
                Ask on WhatsApp
              </a>
            ) : null}
            <Link
              href="/contact"
              className="inline-flex h-11 items-center rounded-[var(--radius-control)] border border-white/40 px-5 font-semibold text-white hover:border-white"
            >
              Contact the shop
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
