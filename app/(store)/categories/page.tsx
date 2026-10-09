import type { Metadata } from "next";
import Link from "next/link";
import { buildCategoryTree, getCategories } from "@/services/catalog";
import { Breadcrumbs, EmptyState } from "@/components/ui/misc";
import { JsonLd } from "@/components/seo/json-ld";
import { breadcrumbJsonLd } from "@/lib/jsonld";
import { buildMetadata } from "@/lib/seo";
import { withSiteDefaults } from "@/lib/page-metadata";

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  return withSiteDefaults(buildMetadata({
  title: "Shop by Category",
  description: "Smartphones, iPhones, Android phones, used phones, feature phones and accessories with prices in Bangladesh.",
  path: "/categories",
  }));
}

export default async function CategoriesPage() {
  const tree = buildCategoryTree(await getCategories());
  return (
    <div className="container-page py-5 lg:py-8">
      <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Categories" }]} />
      <h1 className="mt-3 text-2xl font-bold md:text-3xl">Shop by category</h1>
      {tree.length ? (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tree.map((c) => (
            <li key={c.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
              <Link href={`/categories/${c.slug}`} className="text-lg font-bold text-ink hover:underline">
                {c.name}
              </Link>
              {c.description ? <p className="mt-1 text-sm text-ink-soft">{c.description}</p> : null}
              {c.children.length ? (
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {c.children.map((ch) => (
                    <li key={ch.id}>
                      <Link
                        href={`/categories/${ch.slug}`}
                        className="inline-flex h-9 items-center rounded-full border border-line-strong px-3 text-sm font-medium hover:border-ink"
                      >
                        {ch.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState className="mt-6" title="No categories yet" description="Categories added in the admin panel appear here." />
      )}
      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Categories", path: "/categories" }])} />
    </div>
  );
}
