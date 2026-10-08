import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminPageHeader } from "@/components/admin/page-header";
import { SeoSettingsForm } from "@/components/admin/settings-forms";
import { DEFAULT_SEO_SETTINGS } from "@/services/settings";
import { absoluteUrl } from "@/lib/seo";
import type { SeoSettings } from "@/types";

export const metadata: Metadata = { title: "SEO" };

export default async function AdminSeoPage() {
  await requireStaff("admin");
  const supabase = await createClient();
  const { data } = await supabase.from("seo_settings").select("*").eq("id", 1).maybeSingle();
  const { id: _id, updated_at: _u, ...seo } = (data ?? {}) as SeoSettings & { id?: number; updated_at?: string };

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
      <SeoSettingsForm initial={{ ...DEFAULT_SEO_SETTINGS, ...seo }} />
    </>
  );
}
