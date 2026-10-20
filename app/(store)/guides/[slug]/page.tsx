import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getArticle } from "@/services/articles";
import { getCategories } from "@/services/catalog";
import { getProductCardsByIds } from "@/services/homepage";
import { getSeoSettings, getSiteSettings } from "@/services/settings";
import { Breadcrumbs } from "@/components/ui/misc";
import { RichText } from "@/components/ui/rich-text";
import { ProductGrid } from "@/components/store/product-card";
import { JsonLd } from "@/components/seo/json-ld";
import { breadcrumbJsonLd } from "@/lib/jsonld";
import { absoluteImageUrl, absoluteUrl, buildMetadata } from "@/lib/seo";
import { withSiteDefaults } from "@/lib/page-metadata";
import { formatDate, isSvg, toPlainText } from "@/lib/utils";

type Props = { params: Promise<{ slug: string }> };

// Cached; refreshed when the guide is saved in Admin → Guides.
export const revalidate = 3600;
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const a = await getArticle(slug);
  if (!a) return { title: "Guide not found", robots: { index: false } };
  const meta = buildMetadata({
    title: a.meta_title || a.title,
    description: a.meta_description || a.excerpt || toPlainText(a.content, 160),
    path: `/guides/${a.slug}`,
    image: a.featured_image,
    imageAlt: a.featured_image_alt ?? undefined,
    type: "article",
  });
  // a different canonical only when the admin set one on purpose
  if (a.canonical_url) meta.alternates = { canonical: a.canonical_url };
  return withSiteDefaults(meta);
}

export default async function GuidePage({ params }: Props) {
  const { slug } = await params;
  const a = await getArticle(slug);
  if (!a) notFound();
  const [products, categories, site, seo] = await Promise.all([
    a.related_product_ids.length ? getProductCardsByIds(a.related_product_ids) : Promise.resolve([]),
    a.related_category_ids.length ? getCategories() : Promise.resolve([]),
    getSiteSettings(),
    getSeoSettings(),
  ]);
  const relatedCategories = a.related_category_ids.map((id) => categories.find((c) => c.id === id)).filter((c) => Boolean(c)) as typeof categories;
  const org = seo.organization_name || site.store_name;
  const image = absoluteImageUrl(a.featured_image);

  return (
    <div className="container-page py-5 lg:py-8">
      <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Guides", href: "/guides" }, { name: a.title }]} />
      <article className="mx-auto mt-3 max-w-3xl">
        {a.topics.length ? <p className="text-sm font-semibold uppercase tracking-wide text-signal">{a.topics.join(" · ")}</p> : null}
        <h1 className="mt-1 text-2xl font-bold leading-tight md:text-[2.25rem]">{a.title}</h1>
        <p className="mt-2 text-sm text-ink-mute">
          {org}
          {a.published_at ? ` · ${formatDate(a.published_at)}` : ""}
          {a.published_at && Date.parse(a.updated_at) - Date.parse(a.published_at) > 86_400_000 ? ` · updated ${formatDate(a.updated_at)}` : ""}
        </p>
        {a.excerpt ? <p className="mt-4 text-lg leading-relaxed text-ink-soft">{a.excerpt}</p> : null}
        {a.featured_image ? (
          <div className="relative mt-5 aspect-[16/9] overflow-hidden rounded-[var(--radius-card)] bg-paper">
            <Image src={a.featured_image} alt={a.featured_image_alt ?? ""} fill priority sizes="(min-width: 768px) 768px, 100vw" className="object-cover" unoptimized={isSvg(a.featured_image)} />
          </div>
        ) : null}
        <RichText content={a.content} className="mt-6 text-ink-soft" />

        {relatedCategories.length ? (
          <nav aria-label="Related categories" className="mt-8">
            <h2 className="text-lg font-bold">Browse related categories</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {relatedCategories.map((c) => (
                <li key={c.id}>
                  <Link href={`/categories/${c.slug}`} className="inline-flex rounded-full border border-line px-4 py-2 text-sm font-semibold hover:border-signal hover:text-signal">
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </article>

      {products.length ? (
        <section className="mt-10" aria-labelledby="guide-products">
          <h2 id="guide-products" className="section-title mb-5">
            Phones mentioned in this guide
          </h2>
          <ProductGrid products={products} listName={`Guide: ${a.title}`} />
        </section>
      ) : null}

      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "Article",
            headline: a.title.slice(0, 110),
            ...(a.meta_description || a.excerpt ? { description: a.meta_description || a.excerpt } : {}),
            ...(image ? { image: [image] } : {}),
            ...(a.published_at ? { datePublished: a.published_at } : {}),
            dateModified: a.updated_at,
            mainEntityOfPage: absoluteUrl(`/guides/${a.slug}`),
            author: { "@type": "Organization", name: org, url: absoluteUrl("/") },
            publisher: { "@id": `${absoluteUrl("/")}#organization` },
          },
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Guides", path: "/guides" },
            { name: a.title, path: `/guides/${a.slug}` },
          ]),
        ]}
      />
    </div>
  );
}
