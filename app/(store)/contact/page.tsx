import type { Metadata } from "next";
import { Clock, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import { getSiteSettings } from "@/services/settings";
import { Breadcrumbs } from "@/components/ui/misc";
import { JsonLd } from "@/components/seo/json-ld";
import { breadcrumbJsonLd } from "@/lib/jsonld";
import { buildMetadata } from "@/lib/seo";
import { whatsappLink } from "@/lib/utils";
import { withSiteDefaults } from "@/lib/page-metadata";

export const revalidate = 86400;

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSiteSettings();
  return withSiteDefaults(buildMetadata({
    title: `Contact ${s.store_name}`,
    description: `Call, WhatsApp or visit ${s.store_name}. ${s.opening_hours ?? ""}`.trim(),
    path: "/contact",
  }));
}

export default async function ContactPage() {
  const s = await getSiteSettings();
  const wa = whatsappLink(s.whatsapp, `Hello ${s.store_name}`);
  const card = "flex gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-5";

  return (
    <div className="container-page py-5 lg:py-8">
      <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Contact" }]} />
      <h1 className="mt-3 text-2xl font-bold md:text-3xl">
        Contact us <span className="bn ml-1 text-xl font-medium text-ink-soft">যোগাযোগ</span>
      </h1>
      <p className="mt-1 text-ink-soft">The fastest way to reach us is a phone call or WhatsApp.</p>

      <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {s.phone ? (
          <li className={card}>
            <Phone className="mt-0.5 h-5 w-5 shrink-0 text-signal" aria-hidden />
            <div>
              <p className="font-semibold">Call</p>
              <a href={`tel:${s.phone}`} className="text-lg font-bold text-ink hover:underline">
                {s.phone}
              </a>
            </div>
          </li>
        ) : null}
        {wa ? (
          <li className={card}>
            <MessageCircle className="mt-0.5 h-5 w-5 shrink-0 text-signal" aria-hidden />
            <div>
              <p className="font-semibold">WhatsApp</p>
              <a href={wa} target="_blank" rel="noopener noreferrer" className="text-signal underline">
                Start a chat
              </a>
            </div>
          </li>
        ) : null}
        {s.email ? (
          <li className={card}>
            <Mail className="mt-0.5 h-5 w-5 shrink-0 text-signal" aria-hidden />
            <div>
              <p className="font-semibold">Email</p>
              <a href={`mailto:${s.email}`} className="break-all hover:underline">
                {s.email}
              </a>
            </div>
          </li>
        ) : null}
        {s.address ? (
          <li className={card}>
            <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-signal" aria-hidden />
            <div>
              <p className="font-semibold">Shop address</p>
              <p className="text-ink-soft">{s.address}</p>
              {s.address_bn ? <p className="bn text-ink-mute">{s.address_bn}</p> : null}
              {s.map_url ? (
                <a href={s.map_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-sm font-semibold text-signal underline">
                  Open in Google Maps
                </a>
              ) : null}
            </div>
          </li>
        ) : null}
        {s.opening_hours ? (
          <li className={card}>
            <Clock className="mt-0.5 h-5 w-5 shrink-0 text-signal" aria-hidden />
            <div>
              <p className="font-semibold">Opening hours</p>
              <p className="text-ink-soft">{s.opening_hours}</p>
            </div>
          </li>
        ) : null}
      </ul>
      {!s.phone && !s.address && !s.email ? (
        <p className="mt-6 text-ink-soft">Contact details will appear here once they are added in Admin → Settings.</p>
      ) : null}
      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Contact", path: "/contact" }])} />
    </div>
  );
}
