import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { getBrands } from "@/services/catalog";
import { Breadcrumbs, EmptyState } from "@/components/ui/misc";
import { JsonLd } from "@/components/seo/json-ld";
import { breadcrumbJsonLd } from "@/lib/jsonld";
import { buildMetadata } from "@/lib/seo";
import { isSvg } from "@/lib/utils";
import { withSiteDefaults } from "@/lib/page-metadata";

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  return withSiteDefaults(buildMetadata({
  title: "Mobile Phone Brands in Bangladesh",
  description: "Shop phones by brand: Apple, Samsung, Xiaomi, OnePlus, Realme, Oppo, Vivo and more, with current prices in Bangladesh.",
  path: "/brands",
  }));
}

export default async function BrandsPage() {
  const brands = await getBrands();
  return (
    <div className="container-page py-5 lg:py-8">
      <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Brands" }]} />
      <h1 className="mt-3 text-2xl font-bold md:text-3xl">Shop by brand</h1>
      {brands.length ? (
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {brands.map((b) => (
            <li key={b.id}>
              <Link
                href={`/brands/${b.slug}`}
                className="flex h-full flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-4 hover:border-ink"
              >
                <span className="flex h-12 items-center">
                  {b.logo_url ? (
                    <span className="relative h-10 w-28">
                      <Image src={b.logo_url} alt={b.name} fill sizes="112px" className="object-contain object-left" unoptimized={isSvg(b.logo_url)} />
                    </span>
                  ) : (
                    <span className="text-xl font-bold tracking-tight">{b.name}</span>
                  )}
                </span>
                {b.description ? <span className="line-clamp-2 text-sm text-ink-soft">{b.description}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState className="mt-6" title="No brands yet" description="Brands added in the admin panel appear here." />
      )}
      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Brands", path: "/brands" }])} />
    </div>
  );
}
