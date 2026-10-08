import Link from "next/link";
import Image from "next/image";
import { ChevronDown, Clock, GitCompareArrows, LayoutGrid, MapPin, Phone, ShieldCheck } from "lucide-react";
import { buildCategoryTree, getBrands, getCategories } from "@/services/catalog";
import { getSiteSettings } from "@/services/settings";
import { SearchBox } from "@/components/store/search-box";
import { AccountLink, CartLink, CompareLink, MobileMenu } from "@/components/store/header-actions";
import { STORE_AREA, STORE_SERVICES, TOP_BAR_HIGHLIGHTS } from "@/lib/storefront";
import { isSvg } from "@/lib/utils";

/** "AN MOBILE GALLERY" → "AN"; "Star Phones" → "SP". */
function brandInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words[0].length <= 3) return words[0].toUpperCase();
  return (words[0][0] + (words[1]?.[0] ?? "")).toUpperCase();
}

/** Uploaded logo (Admin → Settings) or a typographic mark built from the store name. */
export function Logo({
  name,
  logoUrl,
  subline,
  inverted = false,
}: {
  name: string;
  logoUrl: string | null;
  subline?: string | null;
  inverted?: boolean;
}) {
  if (logoUrl) {
    return (
      <Image
        src={logoUrl}
        alt={name}
        width={180}
        height={44}
        priority={!inverted}
        className="h-10 w-auto object-contain lg:h-11"
        unoptimized={isSvg(logoUrl)}
      />
    );
  }
  return (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-signal text-[15px] font-extrabold tracking-tight text-white shadow-[inset_0_-2px_0_rgb(0_0_0/0.12)] lg:h-11 lg:w-11"
      >
        {brandInitials(name)}
      </span>
      <span className="flex min-w-0 flex-col leading-none">
        <span className={`truncate text-[17px] font-extrabold tracking-[-0.02em] lg:text-[19px] ${inverted ? "text-white" : "text-ink"}`}>
          {name}
        </span>
        {subline ? (
          <span className={`mt-1 truncate text-[11px] font-medium ${inverted ? "text-white/70" : "text-signal"}`}>{subline}</span>
        ) : null}
      </span>
    </span>
  );
}

const navLink = "inline-flex h-12 items-center gap-1 whitespace-nowrap px-3 text-[14px] font-medium text-white/90 hover:text-white";
const dropdown =
  "invisible absolute left-0 top-full z-50 rounded-[var(--radius-card)] border border-line bg-surface p-1.5 text-ink opacity-0 shadow-[var(--shadow-soft)] transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100";

export async function StoreHeader() {
  const [categories, brands, settings] = await Promise.all([getCategories(), getBrands(), getSiteSettings()]);
  const tree = buildCategoryTree(categories);
  const menuCategories = tree.map((c) => ({
    name: c.name,
    slug: c.slug,
    children: c.children.map((ch) => ({ name: ch.name, slug: ch.slug })),
  }));
  const topBrands = (brands.some((b) => b.is_featured) ? brands.filter((b) => b.is_featured) : brands).slice(0, 10);
  const tagline = settings.tagline_bn || settings.tagline;

  return (
    <>
      {/* slim utility bar (scrolls away) */}
      <div className="bg-board text-[12.5px] text-white/85">
        <div className="container-page flex h-9 items-center justify-between gap-4">
          {tagline ? <p className={`${settings.tagline_bn ? "bn " : ""}min-w-0 truncate font-medium text-white xl:shrink-0`}>{tagline}</p> : <span />}
          <ul className="hidden items-center gap-5 xl:flex" aria-label="Why shop with us">
            {TOP_BAR_HIGHLIGHTS.map((h) => (
              <li key={h} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <ShieldCheck className="h-3.5 w-3.5 text-[#6ee7b7]" aria-hidden />
                {h}
              </li>
            ))}
          </ul>
          <div className="flex shrink-0 items-center gap-4">
            <span className="hidden items-center gap-1.5 whitespace-nowrap md:inline-flex">
              <MapPin className="h-3.5 w-3.5" aria-hidden />
              {STORE_AREA}
            </span>
            {settings.opening_hours ? (
              <span className="hidden items-center gap-1.5 whitespace-nowrap lg:inline-flex xl:hidden 2xl:inline-flex">
                <Clock className="h-3.5 w-3.5" aria-hidden />
                {settings.opening_hours}
              </span>
            ) : null}
            {settings.phone ? (
              <a href={`tel:${settings.phone}`} className="inline-flex items-center gap-1.5 whitespace-nowrap font-semibold text-white hover:underline">
                <Phone className="h-3.5 w-3.5" aria-hidden />
                {settings.phone}
              </a>
            ) : null}
          </div>
        </div>
      </div>

      <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/90">
        <div className="container-page flex h-16 items-center gap-2 lg:h-[78px] lg:gap-8">
          <MobileMenu
            categories={menuCategories}
            brands={brands.map((b) => ({ name: b.name, slug: b.slug }))}
            storeName={settings.store_name}
            phone={settings.phone}
          />
          <Link href="/" className="mr-auto min-w-0 shrink-0 lg:mr-0" aria-label={`${settings.store_name} home`}>
            <Logo name={settings.store_name} logoUrl={settings.logo_url} subline={STORE_SERVICES} />
          </Link>
          <SearchBox className="hidden max-w-2xl flex-1 md:block" size="lg" />
          <nav aria-label="Shortcuts" className="flex items-center gap-0.5 md:ml-auto lg:gap-1.5">
            <CompareLink />
            <AccountLink />
            <CartLink />
          </nav>
        </div>
        <div className="container-page pb-3 md:hidden">
          <SearchBox />
        </div>
      </header>

      {/* green navigation bar */}
      <nav aria-label="Main" className="bg-gradient-to-r from-signal to-[#0c8667] text-white">
        <div className="container-page flex items-center">
          <ul className="no-scrollbar -mx-4 flex flex-1 items-center overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0">
            <li className="group relative hidden lg:block">
              <Link
                href="/categories"
                className="mr-2 inline-flex h-12 items-center gap-2 bg-black/10 px-4 text-[14px] font-semibold text-white hover:bg-black/20"
              >
                <LayoutGrid className="h-4 w-4" aria-hidden />
                All Categories
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              </Link>
              {menuCategories.length ? (
                <div className={`${dropdown} w-[min(560px,80vw)]`}>
                  <ul className="grid grid-cols-2 gap-1">
                    {menuCategories.map((c) => (
                      <li key={c.slug} className="rounded-lg p-1.5">
                        <Link href={`/categories/${c.slug}`} className="block rounded-md px-2 py-1.5 font-semibold text-ink hover:bg-paper">
                          {c.name}
                        </Link>
                        {c.children.length ? (
                          <ul className="mt-0.5">
                            {c.children.map((ch) => (
                              <li key={ch.slug}>
                                <Link href={`/categories/${ch.slug}`} className="block rounded-md px-2 py-1 text-sm text-ink-soft hover:bg-paper hover:text-ink">
                                  {ch.name}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  <Link href="/categories" className="mt-1 block border-t border-line px-3.5 pb-1.5 pt-2.5 text-sm font-semibold text-signal hover:underline">
                    All categories
                  </Link>
                </div>
              ) : null}
            </li>

            {menuCategories.map((c) => (
              <li key={c.slug} className="group relative shrink-0">
                <Link href={`/categories/${c.slug}`} className={navLink}>
                  {c.name}
                  {c.children.length ? <ChevronDown className="hidden h-3.5 w-3.5 lg:block" aria-hidden /> : null}
                </Link>
                {c.children.length ? (
                  <ul className={`${dropdown} hidden min-w-52 lg:block`}>
                    {c.children.map((ch) => (
                      <li key={ch.slug}>
                        <Link href={`/categories/${ch.slug}`} className="block rounded-md px-3 py-2 text-ink hover:bg-paper">
                          {ch.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}

            <li className="group relative shrink-0">
              <Link href="/brands" className={navLink}>
                Brands
                <ChevronDown className="hidden h-3.5 w-3.5 lg:block" aria-hidden />
              </Link>
              {topBrands.length ? (
                <ul className={`${dropdown} hidden min-w-72 grid-cols-2 lg:grid`}>
                  {topBrands.map((b) => (
                    <li key={b.slug}>
                      <Link href={`/brands/${b.slug}`} className="block rounded-md px-3 py-2 text-ink hover:bg-paper">
                        {b.name}
                      </Link>
                    </li>
                  ))}
                  <li className="col-span-2 border-t border-line pt-1">
                    <Link href="/brands" className="block rounded-md px-3 py-2 font-semibold text-signal hover:bg-paper">
                      All brands
                    </Link>
                  </li>
                </ul>
              ) : null}
            </li>

            <li className="shrink-0">
              <Link href="/offers" className={`${navLink} font-semibold text-white`}>
                Offers
                <span className="ml-1 rounded-full bg-deal px-1.5 py-px text-[10px] font-bold leading-4 text-white">Hot</span>
              </Link>
            </li>
            <li className="shrink-0 lg:hidden">
              <Link href="/compare" className={navLink}>
                Compare
              </Link>
            </li>
          </ul>
          <Link
            href="/compare"
            className="ml-3 hidden h-9 shrink-0 items-center gap-2 rounded-full border border-white/35 px-4 text-[13px] font-semibold text-white hover:border-white hover:bg-white/10 lg:inline-flex"
          >
            <GitCompareArrows className="h-4 w-4" aria-hidden />
            Compare phones
          </Link>
        </div>
      </nav>
    </>
  );
}
