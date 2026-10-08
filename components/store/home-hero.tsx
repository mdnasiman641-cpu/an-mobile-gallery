import Link from "next/link";
import Image from "next/image";
import { ArrowRight, CircleCheck, Flame } from "lucide-react";
import type { Banner, ProductCard, ProductDetail } from "@/types";
import { discountPercent, effectivePrice, formatPrice, isSvg } from "@/lib/utils";

/** The featured product shown large in the hero (real catalog data). */
export interface HeroSpotlight {
  card: ProductCard;
  detail: ProductDetail | null;
}

function Spotlight({ spotlight }: { spotlight: HeroSpotlight }) {
  const { card, detail } = spotlight;
  const image = detail?.images[0]?.url ?? card.image_url;
  const imageAlt = detail?.images[0]?.alt_text || card.image_alt || card.name;
  const final = effectivePrice(card.price, card.sale_price);
  const off = discountPercent(card.price, card.sale_price);
  const hasOptions = (detail?.variants.length ?? 0) > 1;
  const soldOut = card.status === "out_of_stock" || card.stock_quantity <= 0;

  // Highlights: the product's own feature list, else its memory options.
  const highlights =
    detail && detail.features.length
      ? detail.features.slice(0, 3).map((f) => f.feature)
      : [
          card.ram_options.length ? `${card.ram_options.join(" / ")} RAM` : null,
          card.storage_options.length ? `${card.storage_options.join(" / ")} storage` : null,
          card.condition !== "new" ? `${card.condition === "used" ? "Used" : "Refurbished"}, checked` : null,
        ].filter((h): h is string => Boolean(h));

  return (
    <section
      aria-labelledby="hero-product"
      className="relative overflow-hidden rounded-[24px] border border-brand/25 bg-[radial-gradient(120%_120%_at_88%_18%,#cdeee2_0%,#eaf7f2_42%,#ffffff_100%)]"
    >
      <div className="grid items-center gap-2 p-5 sm:p-8 md:grid-cols-[1.05fr_1fr] lg:p-10">
        <div className="order-2 md:order-1">
          <div className="flex flex-wrap items-center gap-2">
            {card.is_new ? (
              <span className="rounded-full bg-signal px-3 py-1 text-xs font-semibold text-white">New arrival</span>
            ) : null}
            {card.brand_name ? <span className="text-sm font-semibold text-signal">{card.brand_name}</span> : null}
          </div>
          <h2
            id="hero-product"
            className="mt-3 text-[2rem] font-extrabold leading-[1.04] tracking-[-0.035em] text-ink sm:text-[2.6rem] lg:text-[3.25rem]"
          >
            {card.name}
          </h2>
          {detail?.short_description ? (
            <p className="mt-3 line-clamp-2 max-w-md text-[15px] leading-relaxed text-ink-soft">{detail.short_description}</p>
          ) : null}
          {highlights.length ? (
            <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2">
              {highlights.map((h) => (
                <li key={h} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink">
                  <CircleCheck className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                  {h}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-6 flex flex-wrap items-end gap-x-3 gap-y-1">
            {hasOptions ? <span className="pb-1 text-sm text-ink-mute">From</span> : null}
            <span className="price text-[2rem] font-extrabold leading-none tracking-[-0.03em] text-ink sm:text-[2.4rem]">
              {formatPrice(final)}
            </span>
            {off > 0 ? (
              <>
                <span className="price pb-1 text-lg text-ink-mute line-through">
                  <span className="sr-only">Regular price </span>
                  {formatPrice(card.price)}
                </span>
                <span className="mb-1 rounded-full bg-deal-tint px-2.5 py-0.5 text-xs font-bold text-deal">−{off}%</span>
              </>
            ) : null}
          </div>
          {soldOut ? <p className="mt-2 text-sm font-semibold text-deal">Out of stock right now</p> : null}

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              href={`/products/${card.slug}`}
              className="inline-flex h-12 items-center gap-2 rounded-full bg-signal px-7 text-[15px] font-semibold text-white shadow-[var(--shadow-lift)] hover:bg-board"
            >
              Shop now
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link href="/offers" className="inline-flex h-12 items-center px-2 text-[15px] font-semibold text-ink hover:text-signal hover:underline">
              See all offers
            </Link>
          </div>
        </div>

        <div className="relative order-1 mx-auto aspect-[16/11] w-full max-w-[300px] sm:max-w-[380px] md:order-2 md:aspect-square md:max-w-[460px]">
          <span aria-hidden className="absolute inset-[8%] rounded-full bg-white/70 ring-1 ring-brand/15" />
          {image ? (
            <Image
              src={image}
              alt={imageAlt}
              fill
              priority
              sizes="(min-width: 1024px) 460px, (min-width: 768px) 40vw, 90vw"
              className="object-contain p-2 mix-blend-multiply sm:p-6"
              unoptimized={isSvg(image)}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function BannerHero({ banner }: { banner: Banner }) {
  const content = (
    <div className="relative aspect-[16/10] w-full overflow-hidden rounded-[24px] bg-board sm:aspect-[21/9] lg:aspect-auto lg:h-full lg:min-h-[420px]">
      <Image
        src={banner.image_url}
        alt=""
        fill
        priority
        sizes="(min-width: 1024px) 70vw, 100vw"
        className="object-cover"
        unoptimized={isSvg(banner.image_url)}
      />
      <div className="absolute inset-0 bg-gradient-to-r from-board/85 via-board/40 to-transparent" aria-hidden />
      <div className="absolute inset-0 flex flex-col justify-end p-5 sm:p-8 lg:justify-center lg:p-12">
        <h2 className="max-w-md text-2xl font-extrabold leading-tight tracking-[-0.03em] text-white sm:text-3xl lg:text-[2.75rem]">
          {banner.title}
        </h2>
        {banner.subtitle ? <p className="mt-2 max-w-md text-sm text-white/85 sm:text-base">{banner.subtitle}</p> : null}
        {banner.button_text && banner.button_url ? (
          <span className="mt-5 inline-flex h-12 w-fit items-center gap-2 rounded-full bg-white px-6 text-[15px] font-semibold text-board">
            {banner.button_text}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </span>
        ) : null}
      </div>
    </div>
  );
  return banner.button_url ? (
    <Link href={banner.button_url} className="block h-full" aria-label={`${banner.title}${banner.button_text ? ` — ${banner.button_text}` : ""}`}>
      {content}
    </Link>
  ) : (
    content
  );
}

function BrandHero({ storeName, tagline, taglineBn }: { storeName: string; tagline: string | null; taglineBn: string | null }) {
  return (
    <div className="flex min-h-[300px] flex-col justify-center rounded-[24px] bg-[radial-gradient(120%_120%_at_88%_18%,#cdeee2_0%,#eaf7f2_42%,#ffffff_100%)] p-8 lg:p-12">
      <h2 className="max-w-lg text-[2.25rem] font-extrabold leading-[1.05] tracking-[-0.035em] text-ink lg:text-5xl">{storeName}</h2>
      {tagline ? <p className="mt-3 text-lg text-ink-soft">{tagline}</p> : null}
      {taglineBn ? <p className="bn mt-1 text-lg text-signal">{taglineBn}</p> : null}
      <Link
        href="/products"
        className="mt-7 inline-flex h-12 w-fit items-center gap-2 rounded-full bg-signal px-7 font-semibold text-white hover:bg-board"
      >
        Browse phones
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </div>
  );
}

/** "Today's best deals" — styled after the price boards on phone-shop walls. */
function DealsBoard({ products, updatedAt, offers }: { products: ProductCard[]; updatedAt: string; offers: boolean }) {
  return (
    <section aria-labelledby="deals-title" className="flex h-full flex-col rounded-[24px] bg-board p-5 text-white sm:p-6">
      <div className="flex items-start gap-2.5">
        <Flame className="mt-0.5 h-6 w-6 shrink-0 text-[#fbbf24]" aria-hidden />
        <div>
          <h2 id="deals-title" className="text-xl font-bold tracking-[-0.02em]">
            {offers ? <>Today&rsquo;s best deals</> : <>Today&rsquo;s prices</>}
          </h2>
          <p className="bn text-sm text-white/70">{offers ? "আজকের সেরা অফার" : "আজকের দাম"}</p>
          <p className="mt-0.5 text-xs text-white/50">Prices updated {updatedAt}</p>
        </div>
      </div>

      <ul className="mt-4 flex-1 divide-y divide-dashed divide-white/15">
        {products.map((p) => {
          const final = effectivePrice(p.price, p.sale_price);
          const off = discountPercent(p.price, p.sale_price);
          const soldOut = p.stock_quantity <= 0 || p.status === "out_of_stock";
          return (
            <li key={p.id}>
              <Link href={`/products/${p.slug}`} className="group flex items-center gap-3 py-3">
                <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-white">
                  {p.image_url ? (
                    <Image src={p.image_url} alt="" fill sizes="56px" className="object-contain p-1.5" unoptimized={isSvg(p.image_url)} />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[14px] font-medium leading-snug text-white/90 group-hover:text-white group-hover:underline">
                    {p.name}
                  </span>
                  {off > 0 && !soldOut ? (
                    <span className="price mt-0.5 block text-xs text-white/45 line-through">{formatPrice(p.price)}</span>
                  ) : null}
                </span>
                <span className="price shrink-0 text-right text-[16px] font-bold text-gold">
                  {soldOut ? <span className="text-sm font-medium text-white/55">Sold out</span> : formatPrice(final)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <Link
        href="/offers"
        className="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-full bg-white text-sm font-semibold text-board hover:bg-gold"
      >
        View all offers
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </section>
  );
}

export function HomeHero({
  spotlight,
  banner,
  deals,
  dealsAreOffers,
  updatedAt,
  storeName,
  tagline,
  taglineBn,
}: {
  spotlight: HeroSpotlight | null;
  banner: Banner | null;
  deals: ProductCard[];
  dealsAreOffers: boolean;
  updatedAt: string;
  storeName: string;
  tagline: string | null;
  taglineBn: string | null;
}) {
  const main = spotlight ? (
    <Spotlight spotlight={spotlight} />
  ) : banner ? (
    <BannerHero banner={banner} />
  ) : (
    <BrandHero storeName={storeName} tagline={tagline} taglineBn={taglineBn} />
  );

  if (deals.length === 0) return main;
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)] lg:gap-4">
      {main}
      <DealsBoard products={deals} updatedAt={updatedAt} offers={dealsAreOffers} />
    </div>
  );
}
