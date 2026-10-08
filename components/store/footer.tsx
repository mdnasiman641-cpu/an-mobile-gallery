import Link from "next/link";
import { Clock, Facebook, Instagram, Mail, MapPin, MessageCircle, Phone, Youtube } from "lucide-react";
import { buildCategoryTree, getCategories } from "@/services/catalog";
import { getSiteSettings } from "@/services/settings";
import { Logo } from "@/components/store/header";
import { STORE_AREA, STORE_SERVICES } from "@/lib/storefront";
import { currentYear, whatsappLink } from "@/lib/utils";

const heading = "text-[15px] font-semibold text-white";
const linkCls = "text-white/70 hover:text-white hover:underline";

export async function StoreFooter() {
  const [settings, categories] = await Promise.all([getSiteSettings(), getCategories()]);
  const topCategories = buildCategoryTree(categories).slice(0, 6);
  const wa = whatsappLink(settings.whatsapp, `Hello ${settings.store_name}, I have a question.`);
  const year = currentYear();

  const social = [
    { href: settings.facebook_url, label: "Facebook", Icon: Facebook },
    { href: settings.instagram_url, label: "Instagram", Icon: Instagram },
    { href: settings.youtube_url, label: "YouTube", Icon: Youtube },
  ].filter((s) => s.href);

  return (
    <footer className="mt-16 bg-ink text-white/80">
      <div className="container-page grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1.2fr_1.2fr] lg:gap-8">
        <div>
          <Link href="/" aria-label={`${settings.store_name} home`} className="inline-block">
            <Logo name={settings.store_name} logoUrl={settings.logo_url} subline={STORE_SERVICES} inverted />
          </Link>
          {settings.tagline ? <p className="mt-4 max-w-xs text-sm text-white/70">{settings.tagline}</p> : null}
          {settings.tagline_bn ? <p className="bn mt-1 max-w-xs text-sm text-white/60">{settings.tagline_bn}</p> : null}
          {social.length ? (
            <div className="mt-5 flex gap-2">
              {social.map(({ href, label, Icon }) => (
                <a
                  key={label}
                  href={href!}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 hover:border-white hover:bg-white/10"
                >
                  <Icon className="h-[18px] w-[18px]" />
                </a>
              ))}
            </div>
          ) : null}
        </div>

        <div>
          <p className={heading}>Useful links</p>
          <ul className="mt-4 space-y-2.5 text-sm">
            <li>
              <Link href="/" className={linkCls}>
                Home
              </Link>
            </li>
            {topCategories.map((c) => (
              <li key={c.slug}>
                <Link href={`/categories/${c.slug}`} className={linkCls}>
                  {c.name}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/brands" className={linkCls}>
                Brands
              </Link>
            </li>
            <li>
              <Link href="/offers" className={linkCls}>
                Offers
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <p className={heading}>Help</p>
          <ul className="mt-4 space-y-2.5 text-sm">
            <li>
              <Link href="/contact" className={linkCls}>
                Contact us
              </Link>
            </li>
            <li>
              <Link href="/about" className={linkCls}>
                About us
              </Link>
            </li>
            <li>
              <Link href="/pages/warranty-and-returns" className={linkCls}>
                Warranty &amp; returns
              </Link>
            </li>
            <li>
              <Link href="/pages/privacy-policy" className={linkCls}>
                Privacy policy
              </Link>
            </li>
            <li>
              <Link href="/account/orders" className={linkCls}>
                Track your order
              </Link>
            </li>
            <li>
              <Link href="/compare" className={linkCls}>
                Compare phones
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <p className={heading}>Customer support</p>
          <ul className="mt-4 space-y-3 text-sm">
            {settings.phone ? (
              <li className="flex gap-2.5">
                <Phone className="mt-0.5 h-4 w-4 shrink-0 text-[#6ee7b7]" aria-hidden />
                <a href={`tel:${settings.phone}`} className={linkCls}>
                  {settings.phone}
                </a>
              </li>
            ) : null}
            {wa ? (
              <li className="flex gap-2.5">
                <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#6ee7b7]" aria-hidden />
                <a href={wa} target="_blank" rel="noopener noreferrer" className={linkCls}>
                  Chat on WhatsApp
                </a>
              </li>
            ) : null}
            {settings.email ? (
              <li className="flex gap-2.5">
                <Mail className="mt-0.5 h-4 w-4 shrink-0 text-[#6ee7b7]" aria-hidden />
                <a href={`mailto:${settings.email}`} className={`break-all ${linkCls}`}>
                  {settings.email}
                </a>
              </li>
            ) : null}
            {settings.opening_hours ? (
              <li className="flex gap-2.5 text-white/70">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-[#6ee7b7]" aria-hidden />
                {settings.opening_hours}
              </li>
            ) : null}
          </ul>
        </div>

        <div>
          <p className={heading}>Shop location</p>
          <div className="mt-4 flex gap-2.5 text-sm text-white/70">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#6ee7b7]" aria-hidden />
            <span>
              {settings.address || STORE_AREA}
              {settings.address_bn ? <span className="bn mt-0.5 block text-white/55">{settings.address_bn}</span> : null}
            </span>
          </div>
          {settings.map_url ? (
            <a
              href={settings.map_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex h-10 items-center rounded-full bg-white px-5 text-sm font-semibold text-ink hover:bg-gold"
            >
              Get directions
            </a>
          ) : null}
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="container-page flex flex-col gap-2 py-5 text-xs text-white/55 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {settings.store_name}. Prices in Bangladeshi Taka ({settings.currency_symbol}).
          </p>
          <p>Cash on delivery available across Bangladesh</p>
        </div>
      </div>
    </footer>
  );
}
