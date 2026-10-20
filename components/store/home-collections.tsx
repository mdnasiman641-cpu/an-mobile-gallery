import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Smartphone } from "lucide-react";
import type { CollectionSummary } from "@/services/collections";
import { formatPrice, isSvg } from "@/lib/utils";

/**
 * Homepage "Shop by collection": the page's headline (H1) with the main
 * calls to action, next to cards for the collections the catalog really has
 * (in-stock count and lowest price from the database).
 */
export function HomeCollections({
  heading,
  text,
  primary,
  secondary,
  collections,
  storeName,
}: {
  heading: string;
  text: string | null;
  primary: { label: string; href: string };
  secondary: { label: string; href: string } | null;
  collections: CollectionSummary[];
  storeName: string;
}) {
  return (
    <section className="container-page pt-4 lg:pt-6" aria-labelledby="home-heading">
      <div className="overflow-hidden rounded-[24px] border border-brand/25 bg-[radial-gradient(120%_120%_at_88%_10%,#cdeee2_0%,#eaf7f2_45%,#ffffff_100%)]">
        <div className="grid gap-6 p-5 sm:p-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center lg:gap-10 lg:p-10">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-signal">{storeName}</p>
            <h1 id="home-heading" className="mt-2 text-[1.9rem] font-extrabold leading-[1.06] tracking-[-0.035em] text-ink [overflow-wrap:anywhere] sm:text-[2.4rem] lg:text-[3rem]">
              {heading}
            </h1>
            {text ? <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-ink-soft sm:text-base">{text}</p> : null}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link
                href={primary.href}
                className="inline-flex h-12 items-center gap-2 rounded-full bg-signal px-7 text-[15px] font-semibold text-white shadow-[var(--shadow-lift)] hover:bg-board"
              >
                {primary.label}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              {secondary ? (
                <Link
                  href={secondary.href}
                  className="inline-flex h-12 items-center rounded-full border border-signal px-6 text-[15px] font-semibold text-signal hover:bg-signal hover:text-white"
                >
                  {secondary.label}
                </Link>
              ) : null}
            </div>
          </div>

          {collections.length ? (
            <nav aria-label="Shop by collection" className="min-w-0">
              <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3">
                {collections.map((c, i) => (
                  <li key={c.key} className="min-w-0">
                    <Link
                      href={c.href}
                      className="group flex h-full flex-col rounded-[18px] border border-line bg-surface/90 p-3 transition-[border-color,box-shadow] hover:border-brand/50 hover:shadow-[var(--shadow-soft)] sm:p-3.5"
                    >
                      <span className="relative block aspect-[4/3] overflow-hidden rounded-xl bg-paper">
                        {c.image ? (
                          <Image
                            src={c.image}
                            alt={c.imageAlt}
                            fill
                            sizes="(min-width: 1024px) 180px, (min-width: 640px) 30vw, 45vw"
                            className="object-contain p-2 mix-blend-multiply transition-transform duration-300 group-hover:scale-[1.04]"
                            priority={i < 2}
                            unoptimized={isSvg(c.image)}
                          />
                        ) : (
                          <Smartphone className="absolute inset-0 m-auto h-9 w-9 text-signal" strokeWidth={1.6} aria-hidden />
                        )}
                      </span>
                      <span className="mt-2.5 flex items-center justify-between gap-2">
                        <span className="min-w-0 text-[14px] font-bold leading-tight text-ink sm:text-[15px]">{c.label}</span>
                        <ArrowRight className="h-4 w-4 shrink-0 text-signal transition-transform group-hover:translate-x-0.5" aria-hidden />
                      </span>
                      <span className="mt-0.5 text-xs text-ink-mute">
                        {c.count} in stock
                        {c.fromPrice !== null ? (
                          <>
                            {" · from "}
                            <span className="price font-semibold text-ink">{formatPrice(c.fromPrice)}</span>
                          </>
                        ) : null}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
        </div>
      </div>
    </section>
  );
}
