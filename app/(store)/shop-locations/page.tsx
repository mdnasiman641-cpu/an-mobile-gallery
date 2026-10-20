import type { Metadata } from "next";
import Link from "next/link";
import { Clock, MapPin, MessageCircle, Navigation, Phone } from "lucide-react";
import { getHeaderConfig } from "@/services/header";
import { getSiteSettings } from "@/services/settings";
import { Breadcrumbs } from "@/components/ui/misc";
import { JsonLd } from "@/components/seo/json-ld";
import { breadcrumbJsonLd } from "@/lib/jsonld";
import { visibleOutlets, type HeaderOutlet } from "@/lib/header-config";
import { absoluteUrl, buildMetadata } from "@/lib/seo";
import { withSiteDefaults } from "@/lib/page-metadata";
import { whatsappLink } from "@/lib/utils";

// Outlets come from Admin → Settings → Locations / Outlets (cache tag "header":
// refreshed when they are saved).
export const revalidate = 86400;

export async function generateMetadata(): Promise<Metadata> {
  const [header, site] = await Promise.all([getHeaderConfig(), getSiteSettings()]);
  const outlets = visibleOutlets(header.outlets);
  return withSiteDefaults(
    buildMetadata({
      title: `Our Shop Locations | ${site.store_name}`,
      absoluteTitle: true,
      description: outlets.length
        ? `Visit ${site.store_name}: addresses, phone numbers, opening hours and directions for our ${outlets.length === 1 ? "shop" : `${outlets.length} shops`}.`
        : `Shop locations of ${site.store_name}.`,
      path: "/shop-locations",
      noIndex: outlets.length === 0,
    }),
  );
}

const tel = (p: string) => `tel:${p.replace(/[\s-]/g, "")}`;

export default async function ShopLocationsPage() {
  const [header, site] = await Promise.all([getHeaderConfig(), getSiteSettings()]);
  const outlets = visibleOutlets(header.outlets);
  return (
    <div className="container-page py-5 lg:py-8">
      <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Shop locations" }]} />
      <h1 className="mt-3 text-2xl font-bold md:text-3xl">Our shop locations</h1>
      <p className="mt-1 max-w-2xl text-ink-soft">
        {outlets.length ? `Visit ${site.store_name} in person, call ahead, or get directions.` : null}
      </p>

      {outlets.length === 0 ? (
        <div className="mt-6 rounded-[var(--radius-card)] border border-line bg-surface p-6">
          <p className="font-semibold">Location information is currently unavailable.</p>
          <p className="mt-1 text-sm text-ink-soft">
            Please <Link href="/contact" className="font-semibold text-signal underline">contact us</Link> and we&rsquo;ll help you.
          </p>
        </div>
      ) : (
        <ul className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {outlets.map((o) => (
            <OutletCard key={o.id} o={o} />
          ))}
        </ul>
      )}

      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Shop locations", path: "/shop-locations" },
          ]),
          // only outlets the admin entered with a real address
          ...outlets
            .filter((o) => o.address)
            .map((o) => ({
              "@context": "https://schema.org",
              "@type": "Store",
              name: o.name,
              address: { "@type": "PostalAddress", streetAddress: o.address, addressCountry: "BD" },
              ...(o.phone ? { telephone: o.phone } : {}),
              ...(o.map_url ? { hasMap: o.map_url } : {}),
              url: absoluteUrl("/shop-locations"),
              parentOrganization: { "@id": `${absoluteUrl("/")}#organization` },
            })),
        ]}
      />
    </div>
  );
}

function OutletCard({ o }: { o: HeaderOutlet }) {
  const wa = whatsappLink(o.whatsapp);
  return (
    <li className="flex flex-col rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <h2 className="text-lg font-bold [overflow-wrap:anywhere]">{o.name}</h2>
      <dl className="mt-3 space-y-2.5 text-sm text-ink-soft">
        {o.address ? (
          <div className="flex gap-2.5">
            <dt>
              <MapPin className="mt-0.5 h-4 w-4 text-signal" aria-hidden />
              <span className="sr-only">Address</span>
            </dt>
            <dd className="[overflow-wrap:anywhere]">{o.address}</dd>
          </div>
        ) : null}
        {o.hours ? (
          <div className="flex gap-2.5">
            <dt>
              <Clock className="mt-0.5 h-4 w-4 text-signal" aria-hidden />
              <span className="sr-only">Opening hours</span>
            </dt>
            <dd>{o.hours}</dd>
          </div>
        ) : null}
        {o.phone ? (
          <div className="flex gap-2.5">
            <dt>
              <Phone className="mt-0.5 h-4 w-4 text-signal" aria-hidden />
              <span className="sr-only">Phone</span>
            </dt>
            <dd>
              <a href={tel(o.phone)} className="font-semibold text-ink hover:text-signal hover:underline">
                {o.phone}
              </a>
            </dd>
          </div>
        ) : null}
      </dl>
      {o.map_url || wa ? (
        <div className="mt-auto flex flex-wrap gap-2 pt-5">
          {o.map_url ? (
            <a href={o.map_url} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-2 rounded-full bg-signal px-5 text-sm font-semibold text-white hover:bg-board">
              <Navigation className="h-4 w-4" aria-hidden />
              Get directions
              <span className="sr-only"> to {o.name} (opens Google Maps in a new tab)</span>
            </a>
          ) : null}
          {wa ? (
            <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-2 rounded-full border border-line px-5 text-sm font-semibold hover:border-signal hover:text-signal">
              <MessageCircle className="h-4 w-4" aria-hidden />
              WhatsApp
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
