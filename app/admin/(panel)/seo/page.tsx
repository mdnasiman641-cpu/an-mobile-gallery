import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminPageHeader } from "@/components/admin/page-header";
import { SeoSettingsForm } from "@/components/admin/settings-forms";
import { DEFAULT_SEO_SETTINGS, getSiteSettings } from "@/services/settings";
import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { seoHealth, type HealthProduct, type HealthTaxonomy } from "@/lib/seo-health";
import { absoluteUrl } from "@/lib/seo";
import type { SeoSettings } from "@/types";

export const metadata: Metadata = { title: "SEO" };

export default async function AdminSeoPage() {
  await requireStaff("admin");
  const supabase = await createClient();
  const [{ data }, site, productsRes, categoriesRes, brandsRes] = await Promise.all([
    supabase.from("seo_settings").select("*").eq("id", 1).maybeSingle(),
    getSiteSettings(),
    supabase
      .from("products")
      .select("id, name, status, stock_quantity, short_description, description, brand_id, category_id, product_images(count)")
      .eq("is_demo", false)
      .neq("status", "archived")
      .limit(2000),
    supabase.from("categories").select("id, name, description").eq("is_active", true),
    supabase.from("brands").select("id, name, description").eq("is_active", true),
  ]);
  const { id: _id, updated_at: _u, ...seo } = (data ?? {}) as SeoSettings & { id?: number; updated_at?: string };
  const current = { ...DEFAULT_SEO_SETTINGS, ...seo };
  const products: HealthProduct[] = ((productsRes.data ?? []) as unknown as (Omit<HealthProduct, "images"> & { product_images: { count: number }[] | null })[]).map(
    ({ product_images, ...p }) => ({ ...p, images: product_images?.[0]?.count ?? 0 }),
  );
  const health = seoHealth({
    seo: current,
    site,
    products,
    categories: (categoriesRes.data ?? []) as HealthTaxonomy[],
    brands: (brandsRes.data ?? []) as HealthTaxonomy[],
  });
  const todo = health.filter((h) => !h.ok).length;

  const links = [
    { label: "Sitemap", href: absoluteUrl("/sitemap.xml") },
    { label: "robots.txt", href: absoluteUrl("/robots.txt") },
    { label: "Google Merchant feed", href: absoluteUrl("/feeds/google-merchant.xml") },
  ];

  return (
    <>
      <AdminPageHeader title="SEO" description="Product titles, descriptions, canonical URLs and structured data are generated automatically from product data." />
      <section className="mb-5 rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <h2 className="font-bold">Submit these to Google</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {links.map((l) => (
            <li key={l.label}>
              <span className="text-ink-soft">{l.label}: </span>
              <a href={l.href} target="_blank" rel="noreferrer" className="break-all font-mono text-signal underline">
                {l.href}
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-ink-mute">
          These use NEXT_PUBLIC_SITE_URL. If it shows localhost here in production, set that variable to your domain and redeploy.
        </p>
      </section>
      <section className="mb-5 rounded-[var(--radius-card)] border border-line bg-surface p-5" aria-labelledby="seo-health">
        <h2 id="seo-health" className="font-bold">
          SEO health {todo ? <span className="text-sm font-semibold text-warn">· {todo} to improve</span> : <span className="text-sm font-semibold text-signal">· all good</span>}
        </h2>
        <p className="mt-1 text-sm text-ink-soft">Checked from your real store data each time this page opens. Fix the items with a warning, most important first.</p>
        <ul className="mt-3 divide-y divide-line">
          {health.map((h) => (
            <li key={h.key} className="flex gap-3 py-2.5">
              {h.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-signal" aria-label="OK" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-label="To improve" />}
              <div className="min-w-0 text-sm">
                <p className="font-semibold">
                  {h.title}
                  {h.fixHref && !h.ok ? (
                    <Link href={h.fixHref} className="ml-2 text-xs font-normal text-signal underline">
                      Open
                    </Link>
                  ) : null}
                </p>
                <p className="text-ink-soft">{h.detail}</p>
                {!h.ok && h.examples.length ? (
                  <p className="mt-1 text-xs [overflow-wrap:anywhere]">
                    {h.examples.map((e, i) => (
                      <span key={`${e.href}-${i}`}>
                        {i ? " · " : ""}
                        <Link href={e.href} className="text-signal underline">
                          {e.name}
                        </Link>
                      </span>
                    ))}
                    {h.more ? <span className="text-ink-mute"> · and {h.more} more</span> : null}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>
      <SeoSettingsForm initial={current} />
    </>
  );
}
