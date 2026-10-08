import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  CalendarCheck,
  CircleCheck,
  CreditCard,
  Headphones,
  Keyboard,
  LayoutGrid,
  LockKeyhole,
  RefreshCcw,
  ShieldCheck,
  Smartphone,
  Store,
  Tablet,
  Truck,
  Watch,
} from "lucide-react";
import type { Banner, Brand, Category, ProductCard } from "@/types";
import { ProductGrid } from "@/components/store/product-card";
import { EMI_PROMO, EXCHANGE_PROMO, STORE_AREA } from "@/lib/storefront";
import { cn, isSvg } from "@/lib/utils";

export function HomeSectionHeader({
  id,
  title,
  subtitle,
  href,
  linkLabel = "View all",
}: {
  id: string;
  title: string;
  subtitle?: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h2 id={id} className="section-title">
          {title}
        </h2>
        {subtitle ? <p className="mt-1 text-sm text-ink-mute md:text-[15px]">{subtitle}</p> : null}
      </div>
      {href ? (
        <Link
          href={href}
          className="inline-flex shrink-0 items-center gap-1 rounded-full px-1 text-sm font-semibold text-signal hover:underline"
        >
          {linkLabel}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

/** Product row on the home page; hidden when there are no products. */
export function ProductRail({
  id,
  title,
  subtitle,
  href,
  products,
  note,
}: {
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  products: ProductCard[];
  note?: React.ReactNode;
}) {
  if (products.length === 0) return null;
  return (
    <section className="container-page mt-14" aria-labelledby={id}>
      <HomeSectionHeader id={id} title={title} subtitle={subtitle} href={href} />
      {note}
      <ProductGrid products={products.slice(0, 10)} rails />
    </section>
  );
}

export function TrustStrip({ emiMonths }: { emiMonths: string }) {
  const items = [
    { Icon: ShieldCheck, title: "Original products", text: "Checked before sale" },
    { Icon: CreditCard, title: "EMI installment", text: emiMonths },
    { Icon: RefreshCcw, title: "Buy | Sell | Exchange", text: "Old phone to new" },
    { Icon: Truck, title: "Fast delivery", text: "Across Bangladesh" },
    { Icon: Store, title: "Trusted shop", text: STORE_AREA },
  ];
  return (
    <section aria-label="Our services" className="container-page mt-4">
      <ul className="no-scrollbar -mx-4 flex gap-2.5 overflow-x-auto px-4 md:mx-0 md:grid md:grid-cols-5 md:gap-3 md:px-0">
        {items.map(({ Icon, title, text }) => (
          <li
            key={title}
            className="flex min-w-[210px] items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3.5 md:min-w-0"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-signal-tint text-signal">
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-[14px] font-semibold leading-tight text-ink">{title}</span>
              <span className="mt-0.5 block truncate text-[13px] text-ink-mute">{text}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Icon for a category without an uploaded image, chosen from its name/slug. */
function categoryIcon(c: Category) {
  const key = `${c.slug} ${c.name}`.toLowerCase();
  if (/access|charger|cable|earbud|case|cover/.test(key)) return Headphones;
  if (/used|refurb|second/.test(key)) return RefreshCcw;
  if (/feature|button|keypad/.test(key)) return Keyboard;
  if (/tablet|ipad|tab\b/.test(key)) return Tablet;
  if (/watch|wear/.test(key)) return Watch;
  if (/phone|iphone|android|mobile|smart/.test(key)) return Smartphone;
  return LayoutGrid;
}

export function CategoryShowcase({ categories }: { categories: Category[] }) {
  if (categories.length === 0) return null;
  return (
    <section className="container-page mt-14" aria-labelledby="home-categories">
      <HomeSectionHeader id="home-categories" title="Shop by category" href="/categories" linkLabel="All categories" />
      <ul className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-3 md:px-0 lg:grid-cols-6">
        {categories.map((c) => {
          const Icon = categoryIcon(c);
          return (
            <li key={c.id} className="shrink-0">
              <Link
                href={`/categories/${c.slug}`}
                className="group flex h-full w-40 flex-col items-center rounded-[20px] border border-line bg-surface px-3 pb-4 pt-5 text-center transition-[border-color,box-shadow] hover:border-brand/50 hover:shadow-[var(--shadow-soft)] md:w-auto"
              >
                <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-b from-signal-tint to-[#f3fbf8]">
                  {c.image_url ? (
                    <Image src={c.image_url} alt="" fill sizes="80px" className="object-contain p-2.5" unoptimized={isSvg(c.image_url)} />
                  ) : (
                    <Icon className="h-9 w-9 text-signal transition-transform group-hover:scale-110" strokeWidth={1.6} aria-hidden />
                  )}
                </span>
                <span className="mt-3 text-[15px] font-semibold text-ink">{c.name}</span>
                {c.description ? <span className="mt-0.5 line-clamp-2 text-xs leading-snug text-ink-mute">{c.description}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A CTA target: an Admin → Pages page if one is published, else WhatsApp, else the contact page. */
export interface PromoLink {
  href: string;
  label: string;
  external: boolean;
}

function PromoButton({ link, tone }: { link: PromoLink; tone: "solid" | "outline" }) {
  const cls = cn(
    "mt-6 inline-flex h-11 w-fit items-center gap-2 rounded-full px-6 text-[15px] font-semibold",
    tone === "solid" ? "bg-signal text-white hover:bg-board" : "border border-signal text-signal hover:bg-signal hover:text-white",
  );
  const body = (
    <>
      {link.label}
      <ArrowRight className="h-4 w-4" aria-hidden />
    </>
  );
  return link.external ? (
    <a href={link.href} target="_blank" rel="noopener noreferrer" className={cls}>
      {body}
    </a>
  ) : (
    <Link href={link.href} className={cls}>
      {body}
    </Link>
  );
}

export function ExchangeAndEmi({ exchange, emi }: { exchange: PromoLink; emi: PromoLink }) {
  return (
    <section aria-label="Exchange and EMI" className="container-page mt-14 grid gap-3 md:grid-cols-2 md:gap-4">
      <div className="relative overflow-hidden rounded-[24px] bg-[linear-gradient(135deg,#e3f5ee_0%,#f4fbf8_60%,#ffffff_100%)] p-6 ring-1 ring-brand/20 sm:p-8">
        <RefreshCcw aria-hidden className="absolute -right-6 -top-6 h-40 w-40 text-brand/10" strokeWidth={1.2} />
        <h2 className="bn relative max-w-sm text-[1.75rem] font-semibold leading-[1.25] text-board sm:text-[2rem]">{EXCHANGE_PROMO.titleBn}</h2>
        <p className="relative mt-2 font-semibold text-signal">{EXCHANGE_PROMO.subtitle}</p>
        <p className="relative mt-2 max-w-sm text-[15px] text-ink-soft">{EXCHANGE_PROMO.text}</p>
        <PromoButton link={exchange} tone="solid" />
      </div>

      <div className="relative overflow-hidden rounded-[24px] border border-line bg-surface p-6 sm:p-8">
        <CalendarCheck aria-hidden className="absolute -right-5 -top-5 h-36 w-36 text-brand/10" strokeWidth={1.2} />
        <h2 className="relative text-[1.6rem] font-extrabold tracking-[-0.03em] text-ink sm:text-[1.9rem]">{EMI_PROMO.title}</h2>
        <p className="relative mt-1 inline-flex rounded-full bg-signal-tint px-3 py-1 text-sm font-semibold text-signal">{EMI_PROMO.months}</p>
        <ul className="relative mt-4 space-y-2">
          {EMI_PROMO.points.map((p) => (
            <li key={p} className="flex items-center gap-2 text-[15px] text-ink">
              <CircleCheck className="h-[18px] w-[18px] shrink-0 text-brand" aria-hidden />
              {p}
            </li>
          ))}
        </ul>
        <PromoButton link={emi} tone="outline" />
      </div>
    </section>
  );
}

export function BrandStrip({ brands }: { brands: Brand[] }) {
  if (brands.length === 0) return null;
  return (
    <section className="container-page mt-14" aria-labelledby="home-brands">
      <HomeSectionHeader id="home-brands" title="Popular brands" href="/brands" linkLabel="All brands" />
      <ul className="no-scrollbar -mx-4 flex gap-2.5 overflow-x-auto px-4 md:mx-0 md:grid md:grid-cols-4 md:gap-3 md:px-0 lg:grid-cols-6">
        {brands.map((b) => (
          <li key={b.id} className="shrink-0">
            <Link
              href={`/brands/${b.slug}`}
              className="flex h-[72px] w-36 items-center justify-center rounded-[var(--radius-card)] border border-line bg-surface px-4 transition-colors hover:border-brand/50 md:w-auto"
            >
              {b.logo_url ? (
                <span className="relative h-9 w-full max-w-28">
                  <Image src={b.logo_url} alt={b.name} fill sizes="112px" className="object-contain" unoptimized={isSvg(b.logo_url)} />
                </span>
              ) : (
                <span className="text-[17px] font-bold tracking-[-0.02em] text-ink">{b.name}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Admin-managed banners (Admin → Banners), shown as promotion cards. */
export function PromoBanners({ banners }: { banners: Banner[] }) {
  if (banners.length === 0) return null;
  return (
    <section aria-label="Promotions" className="container-page mt-14">
      <ul className={cn("grid gap-3 md:gap-4", banners.length === 1 ? "" : banners.length === 2 ? "md:grid-cols-2" : "md:grid-cols-3")}>
        {banners.map((b) => {
          const card = (
            <div className="relative flex aspect-[16/9] overflow-hidden rounded-[20px] bg-board">
              <Image src={b.image_url} alt="" fill sizes="(min-width: 768px) 33vw, 100vw" className="object-cover" unoptimized={isSvg(b.image_url)} />
              <div className="absolute inset-0 bg-gradient-to-t from-board/85 via-board/25 to-transparent" aria-hidden />
              <div className="relative mt-auto p-5 text-white">
                <p className="text-lg font-bold leading-tight tracking-[-0.02em]">{b.title}</p>
                {b.subtitle ? <p className="mt-1 line-clamp-2 text-sm text-white/85">{b.subtitle}</p> : null}
                {b.button_text && b.button_url ? (
                  <span className="mt-2 inline-flex items-center gap-1 text-sm font-semibold underline-offset-2 group-hover:underline">
                    {b.button_text}
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </span>
                ) : null}
              </div>
            </div>
          );
          return (
            <li key={b.id}>
              {b.button_url ? (
                <Link href={b.button_url} className="group block">
                  {card}
                </Link>
              ) : (
                card
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function WhyUs({ storeName, phone, emiMonths }: { storeName: string; phone: string | null; emiMonths: string }) {
  const items = [
    { Icon: ShieldCheck, title: "100% genuine products", text: "Every phone is checked before it leaves the shop." },
    { Icon: LockKeyhole, title: "Secure shopping", text: "Pay cash on delivery. Prices are confirmed again at checkout." },
    { Icon: CreditCard, title: "Easy EMI plans", text: `Pay over ${emiMonths}.` },
    {
      Icon: Headphones,
      title: "Customer support",
      text: phone ? `Call or WhatsApp ${phone} for help before and after you buy.` : "Help before and after you buy.",
    },
    { Icon: RefreshCcw, title: "Buy | Sell | Exchange", text: "Sell your old phone or trade it in for a new one." },
  ];
  return (
    <section className="container-page mt-16" aria-labelledby="why-us">
      <div className="rounded-[24px] border border-line bg-surface p-6 sm:p-8">
        <h2 id="why-us" className="section-title">
          Why {storeName}
        </h2>
        <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-5 lg:gap-0 lg:divide-x lg:divide-line">
          {items.map(({ Icon, title, text }) => (
            <li key={title} className="lg:px-5 lg:first:pl-0 lg:last:pr-0">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-signal-tint text-signal">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <p className="mt-3 font-semibold text-ink">{title}</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-mute">{text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
