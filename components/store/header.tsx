import Link from "next/link";
import Image from "next/image";
import { ChevronDown, Phone } from "lucide-react";
import { buildCategoryTree, getBrands, getCategories } from "@/services/catalog";
import { getSiteSettings } from "@/services/settings";
import { SearchBox } from "@/components/store/search-box";
import { AccountLink, CartLink, CompareLink, MobileMenu } from "@/components/store/header-actions";
import { isSvg } from "@/lib/utils";

export function Logo({ name, logoUrl, nameBn }: { name: string; logoUrl: string | null; nameBn?: string | null }) {
  if (logoUrl) {
    return (
      <Image
        src={logoUrl}
        alt={name}
        width={160}
        height={40}
        priority
        className="h-9 w-auto object-contain"
        unoptimized={isSvg(logoUrl)}
      />
    );
  }
  const [first, ...rest] = name.split(" ");
  return (
    <span className="flex flex-col leading-none">
      <span className="text-[1.35rem] font-extrabold tracking-tight text-ink">
        {first}
        <span className="text-signal">.</span>
      </span>
      <span className="mt-0.5 text-[11px] font-medium text-ink-soft">
        {rest.join(" ")}
        {nameBn ? <span className="bn ml-1 text-ink-mute">{nameBn}</span> : null}
      </span>
    </span>
  );
}

export async function StoreHeader() {
  const [categories, brands, settings] = await Promise.all([getCategories(), getBrands(), getSiteSettings()]);
  const tree = buildCategoryTree(categories);
  const menuCategories = tree.map((c) => ({
    name: c.name,
    slug: c.slug,
    children: c.children.map((ch) => ({ name: ch.name, slug: ch.slug })),
  }));
  const topBrands = brands.filter((b) => b.is_featured).slice(0, 8);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
      {/* top strip — desktop only */}
      <div className="hidden border-b border-line bg-ink text-white lg:block">
        <div className="container-page flex h-9 items-center justify-between text-[13px]">
          <p className="bn text-white/85">{settings.tagline_bn || settings.tagline}</p>
          <div className="flex items-center gap-5 text-white/85">
            {settings.opening_hours ? <span>{settings.opening_hours}</span> : null}
            {settings.phone ? (
              <a href={`tel:${settings.phone}`} className="inline-flex items-center gap-1.5 font-semibold text-white hover:underline">
                <Phone className="h-3.5 w-3.5" aria-hidden />
                {settings.phone}
              </a>
            ) : null}
          </div>
        </div>
      </div>

      {/* main bar */}
      <div className="container-page flex h-16 items-center gap-2 lg:h-[72px] lg:gap-6">
        <MobileMenu
          categories={menuCategories}
          brands={brands.map((b) => ({ name: b.name, slug: b.slug }))}
          storeName={settings.store_name}
          phone={settings.phone}
        />
        <Link href="/" className="mr-auto shrink-0 lg:mr-0" aria-label={`${settings.store_name} home`}>
          <Logo name={settings.store_name} logoUrl={settings.logo_url} nameBn={settings.store_name_bn} />
        </Link>
        <SearchBox className="hidden max-w-2xl flex-1 md:block" />
        <nav aria-label="Shortcuts" className="flex items-center gap-0.5 md:ml-auto">
          <CompareLink />
          <AccountLink />
          <CartLink />
        </nav>
      </div>

      {/* mobile search row */}
      <div className="container-page pb-3 md:hidden">
        <SearchBox />
      </div>

      {/* category nav — desktop */}
      <nav aria-label="Main" className="hidden border-t border-line lg:block">
        <ul className="container-page flex h-11 items-center gap-1 text-[14px] font-medium">
          {menuCategories.map((c) => (
            <li key={c.slug} className="group relative">
              <Link
                href={`/categories/${c.slug}`}
                className="inline-flex h-11 items-center gap-1 rounded-md px-3 text-ink-soft hover:text-ink"
              >
                {c.name}
                {c.children.length ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : null}
              </Link>
              {c.children.length ? (
                <ul className="invisible absolute left-0 top-full z-50 min-w-52 rounded-[var(--radius-card)] border border-line bg-surface p-1.5 opacity-0 shadow-lg shadow-ink/10 transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
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
          <li className="group relative">
            <Link href="/brands" className="inline-flex h-11 items-center gap-1 rounded-md px-3 text-ink-soft hover:text-ink">
              Brands
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </Link>
            {topBrands.length ? (
              <ul className="invisible absolute left-0 top-full z-50 grid min-w-72 grid-cols-2 rounded-[var(--radius-card)] border border-line bg-surface p-1.5 opacity-0 shadow-lg shadow-ink/10 transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
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
          <li>
            <Link href="/offers" className="inline-flex h-11 items-center rounded-md px-3 font-semibold text-deal hover:underline">
              Offers
            </Link>
          </li>
          <li className="ml-auto">
            <Link href="/compare" className="inline-flex h-11 items-center rounded-md px-3 text-ink-soft hover:text-ink">
              Compare phones
            </Link>
          </li>
        </ul>
      </nav>
    </header>
  );
}
