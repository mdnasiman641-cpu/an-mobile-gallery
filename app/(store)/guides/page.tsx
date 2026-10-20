import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { getPublishedArticles } from "@/services/articles";
import { getSiteSettings } from "@/services/settings";
import { Breadcrumbs, EmptyState } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { JsonLd } from "@/components/seo/json-ld";
import { breadcrumbJsonLd } from "@/lib/jsonld";
import { buildMetadata } from "@/lib/seo";
import { withSiteDefaults } from "@/lib/page-metadata";
import { formatDate, isSvg } from "@/lib/utils";

// Refreshed when a guide is saved in Admin → Guides (and hourly as a fallback).
export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const [articles, site] = await Promise.all([getPublishedArticles(1), getSiteSettings()]);
  return withSiteDefaults(
    buildMetadata({
      title: "Mobile Phone Buying Guides",
      description: `Practical guides from ${site.store_name}: choosing a smartphone, checking a used phone before you buy, and understanding phone specifications.`,
      path: "/guides",
      // an empty list is not worth indexing
      noIndex: articles.length === 0,
    }),
  );
}

export default async function GuidesPage() {
  const articles = await getPublishedArticles(60);
  return (
    <div className="container-page py-5 lg:py-8">
      <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Guides" }]} />
      <h1 className="mt-3 text-2xl font-bold md:text-3xl">Buying guides</h1>
      <p className="mt-1 max-w-2xl text-ink-soft">Practical help with choosing, comparing and checking mobile phones.</p>
      {articles.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No guides published yet" description="Browse our phones, or contact us with any question." action={<ButtonLink href="/products">Browse phones</ButtonLink>} />
        </div>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {articles.map((a, i) => (
            <li key={a.slug}>
              <Link href={`/guides/${a.slug}`} className="group flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface hover:border-brand/50 hover:shadow-[var(--shadow-soft)]">
                <span className="relative block aspect-[16/9] bg-paper">
                  {a.featured_image ? (
                    <Image src={a.featured_image} alt={a.featured_image_alt ?? ""} fill sizes="(min-width: 1024px) 400px, (min-width: 640px) 50vw, 100vw" className="object-cover" priority={i < 3} unoptimized={isSvg(a.featured_image)} />
                  ) : null}
                </span>
                <span className="flex flex-1 flex-col p-4">
                  {a.topics.length ? <span className="text-xs font-semibold uppercase tracking-wide text-signal">{a.topics.slice(0, 2).join(" · ")}</span> : null}
                  <span className="mt-1 text-lg font-bold leading-snug text-ink group-hover:underline">{a.title}</span>
                  {a.excerpt ? <span className="mt-1.5 line-clamp-3 text-sm text-ink-soft">{a.excerpt}</span> : null}
                  {a.published_at ? <span className="mt-auto pt-3 text-xs text-ink-mute">{formatDate(a.published_at)}</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Guides", path: "/guides" }])} />
    </div>
  );
}
