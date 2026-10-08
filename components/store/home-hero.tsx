import Link from "next/link";
import Image from "next/image";
import type { Banner, ProductCard } from "@/types";
import { effectivePrice, formatPrice, isSvg } from "@/lib/utils";

function BannerSlide({ banner, priority }: { banner: Banner; priority: boolean }) {
  const content = (
    <div className="relative aspect-[16/10] w-full overflow-hidden rounded-[var(--radius-card)] bg-ink sm:aspect-[21/9] lg:aspect-auto lg:h-full lg:min-h-[340px]">
      <Image
        src={banner.image_url}
        alt=""
        fill
        priority={priority}
        sizes="(min-width: 1024px) 66vw, 100vw"
        className="object-cover"
        unoptimized={isSvg(banner.image_url)}
      />
      <div className="absolute inset-0 bg-gradient-to-r from-ink/80 via-ink/40 to-transparent" aria-hidden />
      <div className="absolute inset-0 flex flex-col justify-end p-5 sm:p-8 lg:justify-center lg:p-10">
        <h2 className="max-w-md text-2xl font-bold leading-tight text-white sm:text-3xl lg:text-4xl">{banner.title}</h2>
        {banner.subtitle ? <p className="mt-2 max-w-md text-sm text-white/85 sm:text-base">{banner.subtitle}</p> : null}
        {banner.button_text && banner.button_url ? (
          <span className="mt-4 inline-flex h-11 w-fit items-center rounded-[var(--radius-control)] bg-white px-5 text-[15px] font-semibold text-ink">
            {banner.button_text}
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

/** "Today's price board" — the way phone shops in Bangladesh show prices on the wall. */
function PriceBoard({ products, updatedAt }: { products: ProductCard[]; updatedAt: string }) {
  return (
    <section
      aria-labelledby="price-board-title"
      className="flex h-full flex-col rounded-[var(--radius-card)] bg-ink p-5 text-white sm:p-6"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="price-board-title" className="text-lg font-bold">
          Today&rsquo;s prices <span className="bn ml-1 text-base font-medium text-white/70">আজকের দাম</span>
        </h2>
      </div>
      <p className="mt-0.5 text-xs text-white/55">Updated {updatedAt}</p>

      {products.length === 0 ? (
        <p className="mt-6 text-sm text-white/70">Prices appear here once featured products are added.</p>
      ) : (
        <ul className="mt-4 flex-1 divide-y divide-white/10">
          {products.map((p) => {
            const final = effectivePrice(p.price, p.sale_price);
            const soldOut = p.stock_quantity <= 0 || p.status === "out_of_stock";
            return (
              <li key={p.id}>
                <Link href={`/products/${p.slug}`} className="group flex items-baseline gap-2 py-2.5">
                  <span className="min-w-0 truncate text-[15px] text-white/90 group-hover:text-white group-hover:underline">
                    {p.name}
                  </span>
                  <span className="mb-1 min-w-4 flex-1 border-b border-dotted border-white/25" aria-hidden />
                  <span className="price shrink-0 text-[15px] font-bold text-[#F2C14E]">
                    {soldOut ? <span className="text-sm font-medium text-white/50">Sold out</span> : formatPrice(final)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <Link
        href="/products"
        className="mt-4 inline-flex h-10 items-center justify-center rounded-[var(--radius-control)] border border-white/25 text-sm font-semibold hover:border-white"
      >
        See every price
      </Link>
    </section>
  );
}

export function HomeHero({
  banners,
  boardProducts,
  updatedAt,
}: {
  banners: Banner[];
  boardProducts: ProductCard[];
  updatedAt: string;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:gap-4">
      {banners.length > 0 ? (
        <div
          className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto"
          role="region"
          aria-label="Featured promotions"
          tabIndex={0}
        >
          {banners.map((b, i) => (
            <div key={b.id} className="w-full shrink-0 snap-start">
              <BannerSlide banner={b} priority={i === 0} />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex min-h-[260px] flex-col justify-center rounded-[var(--radius-card)] bg-signal p-8 text-white">
          <h1 className="max-w-lg text-3xl font-bold leading-tight lg:text-4xl">Original phones at honest prices</h1>
          <p className="bn mt-2 text-lg text-white/85">আসল ফোন, সঠিক দাম</p>
          <Link
            href="/products"
            className="mt-6 inline-flex h-11 w-fit items-center rounded-[var(--radius-control)] bg-white px-5 font-semibold text-ink"
          >
            Browse phones
          </Link>
        </div>
      )}
      <PriceBoard products={boardProducts} updatedAt={updatedAt} />
    </div>
  );
}
