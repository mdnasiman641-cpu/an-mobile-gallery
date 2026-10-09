import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { getPage } from "@/services/catalog";
import { Breadcrumbs } from "@/components/ui/misc";
import { RichText } from "@/components/ui/rich-text";
import { buildMetadata } from "@/lib/seo";
import { formatDate, toPlainText } from "@/lib/utils";
import { withSiteDefaults } from "@/lib/page-metadata";

type Props = { params: Promise<{ slug: string }> };

export const revalidate = 86400;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPage(slug);
  if (!page) return { title: "Page not found", robots: { index: false } };
  return withSiteDefaults(buildMetadata({
    title: page.meta_title || page.title,
    description: page.meta_description || toPlainText(page.content, 160),
    path: `/pages/${page.slug}`,
  }));
}

export default async function ContentPage({ params }: Props) {
  const { slug } = await params;
  // The About page has its own URL; /pages/about would be a duplicate.
  if (slug === "about") permanentRedirect("/about");
  const page = await getPage(slug);
  if (!page) notFound();
  return (
    <div className="container-page py-5 lg:py-8">
      <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: page.title }]} />
      <article className="mt-3 max-w-3xl">
        <h1 className="text-2xl font-bold md:text-3xl">{page.title}</h1>
        <p className="mt-1 text-sm text-ink-mute">Last updated {formatDate(page.updated_at)}</p>
        <RichText content={page.content} className="mt-5 text-ink-soft" />
      </article>
    </div>
  );
}
