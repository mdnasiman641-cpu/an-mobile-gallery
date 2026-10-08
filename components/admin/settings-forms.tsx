"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSeoSettingsAction, saveSiteSettingsAction } from "@/app/admin/(panel)/content-actions";
import { ImageField, toastResult } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import type { SeoSettings, SiteSettings } from "@/types";

type Stringify<T> = { [K in keyof T]: string };

function toStrings<T extends object>(obj: T): Stringify<T> {
  const out = {} as Stringify<T>;
  for (const [k, v] of Object.entries(obj)) (out as Record<string, string>)[k] = v === null || v === undefined ? "" : String(v);
  return out;
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <h2 className="font-bold">{title}</h2>
      {description ? <p className="text-sm text-ink-soft">{description}</p> : null}
      <div className="mt-4 grid gap-4 md:grid-cols-2">{children}</div>
    </section>
  );
}

export function SiteSettingsForm({ initial }: { initial: SiteSettings }) {
  const router = useRouter();
  const [f, setF] = useState(toStrings(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const bind = (k: keyof SiteSettings) => ({
    id: `s-${k}`,
    value: f[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value })),
    "aria-invalid": Boolean(errors[k]) || undefined,
  });

  function save() {
    start(async () => {
      const res = await saveSiteSettingsAction(f);
      setErrors(res.fieldErrors ?? {});
      if (toastResult(res)) router.refresh();
    });
  }

  return (
    <div className="grid gap-5 pb-20">
      <Section title="Store">
        <Field label="Store name" htmlFor="s-store_name" error={errors.store_name} required>
          <Input {...bind("store_name")} />
        </Field>
        <Field label="Store name in Bangla" htmlFor="s-store_name_bn">
          <Input {...bind("store_name_bn")} className="bn" />
        </Field>
        <Field label="Tagline" htmlFor="s-tagline">
          <Input {...bind("tagline")} />
        </Field>
        <Field label="Tagline in Bangla" htmlFor="s-tagline_bn">
          <Input {...bind("tagline_bn")} className="bn" />
        </Field>
        <div className="md:col-span-2 md:max-w-sm">
          <ImageField
            label="Logo"
            value={f.logo_url || null}
            onChange={(url) => setF((p) => ({ ...p, logo_url: url ?? "" }))}
            folder="site"
            aspect="aspect-[4/1]"
            maxEdge={640}
            hint="Transparent PNG or WebP, about 320 × 80 px. Without a logo, the store name is shown."
          />
        </div>
      </Section>

      <Section title="Contact" description="Shown in the header, footer, contact page and structured data.">
        <Field label="Phone" htmlFor="s-phone">
          <Input {...bind("phone")} type="tel" placeholder="01XXXXXXXXX" />
        </Field>
        <Field label="WhatsApp number" htmlFor="s-whatsapp">
          <Input {...bind("whatsapp")} type="tel" placeholder="01XXXXXXXXX" />
        </Field>
        <Field label="Email" htmlFor="s-email" error={errors.email}>
          <Input {...bind("email")} type="email" />
        </Field>
        <Field label="Opening hours" htmlFor="s-opening_hours">
          <Input {...bind("opening_hours")} />
        </Field>
        <Field label="Address" htmlFor="s-address">
          <Textarea {...bind("address")} rows={2} />
        </Field>
        <Field label="Address in Bangla" htmlFor="s-address_bn">
          <Textarea {...bind("address_bn")} rows={2} className="bn" />
        </Field>
        <Field label="Google Maps link" htmlFor="s-map_url" error={errors.map_url} className="md:col-span-2">
          <Input {...bind("map_url")} placeholder="https://maps.app.goo.gl/…" />
        </Field>
      </Section>

      <Section title="Social links">
        <Field label="Facebook page" htmlFor="s-facebook_url" error={errors.facebook_url}>
          <Input {...bind("facebook_url")} placeholder="https://facebook.com/…" />
        </Field>
        <Field label="Instagram" htmlFor="s-instagram_url" error={errors.instagram_url}>
          <Input {...bind("instagram_url")} placeholder="https://instagram.com/…" />
        </Field>
        <Field label="YouTube" htmlFor="s-youtube_url" error={errors.youtube_url}>
          <Input {...bind("youtube_url")} placeholder="https://youtube.com/@…" />
        </Field>
        <Field label="TikTok" htmlFor="s-tiktok_url" error={errors.tiktok_url}>
          <Input {...bind("tiktok_url")} placeholder="https://tiktok.com/@…" />
        </Field>
      </Section>

      <Section title="Delivery, currency and returns">
        <Field label="Delivery charge inside Dhaka (৳)" htmlFor="s-delivery_charge_inside_dhaka" error={errors.delivery_charge_inside_dhaka}>
          <Input {...bind("delivery_charge_inside_dhaka")} inputMode="decimal" />
        </Field>
        <Field label="Delivery charge outside Dhaka (৳)" htmlFor="s-delivery_charge_outside_dhaka" error={errors.delivery_charge_outside_dhaka}>
          <Input {...bind("delivery_charge_outside_dhaka")} inputMode="decimal" />
        </Field>
        <Field label="Free delivery from (৳)" htmlFor="s-free_delivery_threshold" hint="0 = never free">
          <Input {...bind("free_delivery_threshold")} inputMode="decimal" />
        </Field>
        <Field label="Return window (days)" htmlFor="s-return_days" hint="Used in product structured data. 0 = no returns.">
          <Input {...bind("return_days")} inputMode="numeric" />
        </Field>
        <Field label="Currency code" htmlFor="s-currency" error={errors.currency}>
          <Input {...bind("currency")} maxLength={3} />
        </Field>
        <Field label="Currency symbol" htmlFor="s-currency_symbol">
          <Input {...bind("currency_symbol")} maxLength={4} />
        </Field>
        <Field label="Shipping note" htmlFor="s-shipping_note" className="md:col-span-2">
          <Textarea {...bind("shipping_note")} rows={2} />
        </Field>
      </Section>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur lg:left-60">
        <div className="mx-auto flex max-w-[1400px] justify-end md:px-2">
          <Button onClick={save} loading={pending}>
            Save settings
          </Button>
        </div>
      </div>
    </div>
  );
}

export function SeoSettingsForm({ initial }: { initial: SeoSettings }) {
  const router = useRouter();
  const [f, setF] = useState(toStrings(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const bind = (k: keyof SeoSettings) => ({
    id: `seo-${k}`,
    value: f[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value })),
  });

  function save() {
    start(async () => {
      const res = await saveSeoSettingsAction(f);
      setErrors(res.fieldErrors ?? {});
      if (toastResult(res)) router.refresh();
    });
  }

  return (
    <div className="grid gap-5 pb-20">
      <Section title="Search results" description="Used for the home page and as defaults for pages without their own SEO text.">
        <Field label={`Site title (${f.site_title.length}/60)`} htmlFor="seo-site_title" error={errors.site_title} className="md:col-span-2">
          <Input {...bind("site_title")} />
        </Field>
        <Field label={`Site description (${f.site_description.length}/160)`} htmlFor="seo-site_description" error={errors.site_description} className="md:col-span-2">
          <Textarea {...bind("site_description")} rows={3} />
        </Field>
        <Field label="Default keywords" htmlFor="seo-default_keywords" hint="Comma separated. Google ignores this tag; it is kept for other search engines." className="md:col-span-2">
          <Input {...bind("default_keywords")} />
        </Field>
        <div className="md:col-span-2 md:max-w-md">
          <ImageField
            label="Default share image (Open Graph)"
            value={f.default_og_image || null}
            onChange={(url) => setF((p) => ({ ...p, default_og_image: url ?? "" }))}
            folder="site"
            aspect="aspect-[1200/630]"
            maxEdge={1200}
            hint="1200 × 630 px. Shown when a page without its own image is shared on Facebook or WhatsApp."
          />
        </div>
      </Section>

      <Section title="Verification" description="Paste the code only, or the whole meta tag — the code is extracted automatically.">
        <Field label="Google Search Console verification" htmlFor="seo-google_site_verification" hint="Search Console → Add property → HTML tag">
          <Input {...bind("google_site_verification")} placeholder="abc123…" />
        </Field>
        <Field label="Facebook domain verification" htmlFor="seo-facebook_domain_verification" hint="Meta Business Suite → Brand safety → Domains">
          <Input {...bind("facebook_domain_verification")} />
        </Field>
        <Field label="X (Twitter) handle" htmlFor="seo-twitter_handle">
          <Input {...bind("twitter_handle")} placeholder="@yourstore" />
        </Field>
      </Section>

      <Section title="Organisation" description="Used in structured data that helps Google show your store's knowledge panel.">
        <Field label="Organisation name" htmlFor="seo-organization_name">
          <Input {...bind("organization_name")} />
        </Field>
        <Field label="Legal name" htmlFor="seo-organization_legal_name">
          <Input {...bind("organization_legal_name")} />
        </Field>
        <Field label="Founded (year)" htmlFor="seo-organization_founding_year" error={errors.organization_founding_year}>
          <Input {...bind("organization_founding_year")} inputMode="numeric" />
        </Field>
        <div className="md:max-w-sm">
          <ImageField
            label="Organisation logo"
            value={f.organization_logo || null}
            onChange={(url) => setF((p) => ({ ...p, organization_logo: url ?? "" }))}
            folder="site"
            aspect="aspect-square"
            maxEdge={512}
            hint="Square, at least 112 × 112 px"
          />
        </div>
      </Section>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur lg:left-60">
        <div className="mx-auto flex max-w-[1400px] justify-end md:px-2">
          <Button onClick={save} loading={pending}>
            Save SEO settings
          </Button>
        </div>
      </div>
    </div>
  );
}
