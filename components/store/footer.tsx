import Link from "next/link";
import { Facebook, Instagram, MapPin, Mail, Phone, Youtube } from "lucide-react";
import { getCategories } from "@/services/catalog";
import { getSiteSettings } from "@/services/settings";
import { currentYear, whatsappLink } from "@/lib/utils";

export async function StoreFooter() {
  const [settings, categories] = await Promise.all([getSiteSettings(), getCategories()]);
  const topCategories = categories.filter((c) => !c.parent_id).slice(0, 6);
  const wa = whatsappLink(settings.whatsapp, `Hello ${settings.store_name}, I have a question.`);
  const year = currentYear();

  const social = [
    { href: settings.facebook_url, label: "Facebook", Icon: Facebook },
    { href: settings.instagram_url, label: "Instagram", Icon: Instagram },
    { href: settings.youtube_url, label: "YouTube", Icon: Youtube },
  ].filter((s) => s.href);

  return (
    <footer className="mt-16 border-t border-line bg-ink text-white/80">
      <div className="container-page grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-lg font-bold text-white">{settings.store_name}</p>
          {settings.store_name_bn ? <p className="bn mt-0.5 text-white/70">{settings.store_name_bn}</p> : null}
          {settings.tagline ? <p className="mt-3 max-w-xs text-sm">{settings.tagline}</p> : null}
          {social.length ? (
            <div className="mt-4 flex gap-2">
              {social.map(({ href, label, Icon }) => (
                <a
                  key={label}
                  href={href!}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 hover:border-white"
                >
                  <Icon className="h-[18px] w-[18px]" />
                </a>
              ))}
            </div>
          ) : null}
        </div>

        <div>
          <p className="font-semibold text-white">Shop</p>
          <ul className="mt-3 space-y-2 text-sm">
            {topCategories.map((c) => (
              <li key={c.slug}>
                <Link href={`/categories/${c.slug}`} className="hover:text-white hover:underline">
                  {c.name}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/brands" className="hover:text-white hover:underline">
                All brands
              </Link>
            </li>
            <li>
              <Link href="/offers" className="hover:text-white hover:underline">
                Offers
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <p className="font-semibold text-white">Help</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link href="/contact" className="hover:text-white hover:underline">
                Contact us
              </Link>
            </li>
            <li>
              <Link href="/about" className="hover:text-white hover:underline">
                About us
              </Link>
            </li>
            <li>
              <Link href="/pages/warranty-and-returns" className="hover:text-white hover:underline">
                Warranty &amp; returns
              </Link>
            </li>
            <li>
              <Link href="/pages/privacy-policy" className="hover:text-white hover:underline">
                Privacy policy
              </Link>
            </li>
            <li>
              <Link href="/account/orders" className="hover:text-white hover:underline">
                Track your order
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <p className="font-semibold text-white">Visit or call</p>
          <ul className="mt-3 space-y-3 text-sm">
            {settings.address ? (
              <li className="flex gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  {settings.address}
                  {settings.address_bn ? <span className="bn mt-0.5 block text-white/60">{settings.address_bn}</span> : null}
                </span>
              </li>
            ) : null}
            {settings.phone ? (
              <li className="flex gap-2">
                <Phone className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <a href={`tel:${settings.phone}`} className="hover:text-white hover:underline">
                  {settings.phone}
                </a>
              </li>
            ) : null}
            {settings.email ? (
              <li className="flex gap-2">
                <Mail className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <a href={`mailto:${settings.email}`} className="break-all hover:text-white hover:underline">
                  {settings.email}
                </a>
              </li>
            ) : null}
            {settings.opening_hours ? <li className="text-white/60">{settings.opening_hours}</li> : null}
            {wa ? (
              <li>
                <a
                  href={wa}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-10 items-center rounded-full bg-white px-4 text-sm font-semibold text-ink hover:bg-white/90"
                >
                  Chat on WhatsApp
                </a>
              </li>
            ) : null}
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="container-page flex flex-col gap-2 py-5 text-xs text-white/60 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {settings.store_name}. Prices in Bangladeshi Taka ({settings.currency_symbol}).
          </p>
          <p>Cash on delivery available across Bangladesh</p>
        </div>
      </div>
    </footer>
  );
}
