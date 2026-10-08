import type { Metadata } from "next";
import { getPage } from "@/services/catalog";
import { getSiteSettings } from "@/services/settings";
import { Breadcrumbs } from "@/components/ui/misc";
import { RichText } from "@/components/ui/rich-text";
import { JsonLd } from "@/components/seo/json-ld";
import { breadcrumbJsonLd } from "@/lib/jsonld";
import { buildMetadata } from "@/lib/seo";

export const revalidate = 86400;

export async function generateMetadata(): Promise<Metadata> {
  const [page, settings] = await Promise.all([getPage("about"), getSiteSettings()]);
  return buildMetadata({
    title: page?.meta_title || page?.title || `About ${settings.store_name}`,
    description: page?.meta_description || `About ${settings.store_name}: original phones, checked used phones and gadgets in Bangladesh.`,
    path: "/about",
  });
}

export default async function AboutPage() {
  const [page, settings] = await Promise.all([getPage("about"), getSiteSettings()]);
  return (
    <div className="container-page py-5 lg:py-8">
      <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "About" }]} />
      <article className="mt-3 max-w-3xl">
        <h1 className="text-2xl font-bold md:text-3xl">{page?.title || `About ${settings.store_name}`}</h1>
        {settings.store_name_bn ? <p className="bn mt-1 text-lg text-ink-soft">{settings.store_name_bn}</p> : null}
        <RichText
          content={page?.content || `${settings.store_name} sells original smartphones, used phones and gadgets in Bangladesh.`}
          className="mt-5 text-ink-soft"
        />
      </article>
      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "About", path: "/about" }])} />
    </div>
  );
}
