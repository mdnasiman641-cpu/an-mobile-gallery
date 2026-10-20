import type { MetadataRoute } from "next";
import { getAllProductsForSitemap, getBrands, getCategories, getPublishedPages } from "@/services/catalog";
import { getArticlesForSitemap } from "@/services/articles";
import { getHeaderConfig } from "@/services/header";
import { cachedQueryProducts } from "@/services/listing";
import { LANDINGS, LANDING_SLUGS } from "@/lib/collections";
import { visibleOutlets } from "@/lib/header-config";
import { absoluteUrl } from "@/lib/seo";

// Built from the database and cached for an hour. A product added in the
// admin panel appears here automatically — nothing is maintained by hand.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, brands, categories, pages, articles, header, landings] = await Promise.all([
    getAllProductsForSitemap(),
    getBrands(),
    getCategories(),
    getPublishedPages(),
    getArticlesForSitemap(),
    getHeaderConfig(),
    // collection pages only while they have products
    Promise.all(
      LANDING_SLUGS.map(async (slug) => {
        const d = LANDINGS[slug];
        try {
          const page = await cachedQueryProducts({ ...d.query, perPage: 1 });
          return page.total > 0 ? slug : null;
        } catch {
          return null;
        }
      }),
    ),
  ]);
  const brandSlugs = new Set(brands.map((b) => b.slug));

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), changeFrequency: "daily", priority: 1 },
    { url: absoluteUrl("/products"), changeFrequency: "daily", priority: 0.9 },
    { url: absoluteUrl("/offers"), changeFrequency: "daily", priority: 0.8 },
    { url: absoluteUrl("/brands"), changeFrequency: "weekly", priority: 0.6 },
    { url: absoluteUrl("/categories"), changeFrequency: "weekly", priority: 0.6 },
    { url: absoluteUrl("/contact"), changeFrequency: "monthly", priority: 0.4 },
    { url: absoluteUrl("/track"), changeFrequency: "yearly", priority: 0.2 },
  ];

  return [
    ...staticRoutes,
    ...categories.map((c) => ({
      url: absoluteUrl(`/categories/${c.slug}`),
      lastModified: c.updated_at ? new Date(c.updated_at) : undefined,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
    ...brands.map((b) => ({
      url: absoluteUrl(`/brands/${b.slug}`),
      lastModified: b.updated_at ? new Date(b.updated_at) : undefined,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    ...products.map((p) => ({
      url: absoluteUrl(`/products/${p.slug}`),
      lastModified: new Date(p.updated_at),
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
    ...pages
      .filter((p) => p.slug !== "about")
      .map((p) => ({
        url: absoluteUrl(`/pages/${p.slug}`),
        lastModified: new Date(p.updated_at),
        changeFrequency: "monthly" as const,
        priority: 0.3,
      })),
    { url: absoluteUrl("/about"), changeFrequency: "monthly", priority: 0.4 },
    ...landings
      .filter((s): s is NonNullable<typeof s> => s !== null && (!LANDINGS[s].brand || brandSlugs.has(LANDINGS[s].brand as string)))
      .map((s) => ({ url: absoluteUrl(`/collections/${s}`), changeFrequency: "daily" as const, priority: 0.8 })),
    ...(visibleOutlets(header.outlets).length ? [{ url: absoluteUrl("/shop-locations"), changeFrequency: "monthly" as const, priority: 0.5 }] : []),
    ...(articles.length ? [{ url: absoluteUrl("/guides"), changeFrequency: "weekly" as const, priority: 0.5 }] : []),
    // a guide whose canonical points elsewhere is not listed (only canonical URLs belong here)
    ...articles
      .filter((a) => !a.canonical_url || a.canonical_url === absoluteUrl(`/guides/${a.slug}`))
      .map((a) => ({ url: absoluteUrl(`/guides/${a.slug}`), lastModified: new Date(a.updated_at), changeFrequency: "monthly" as const, priority: 0.6 })),
  ];
}
