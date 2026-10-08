import type { MetadataRoute } from "next";
import { getAllProductsForSitemap, getBrands, getCategories, getPublishedPages } from "@/services/catalog";
import { absoluteUrl } from "@/lib/seo";

// Built from the database and cached for an hour. A product added in the
// admin panel appears here automatically — nothing is maintained by hand.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, brands, categories, pages] = await Promise.all([
    getAllProductsForSitemap(),
    getBrands(),
    getCategories(),
    getPublishedPages(),
  ]);

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), changeFrequency: "daily", priority: 1 },
    { url: absoluteUrl("/products"), changeFrequency: "daily", priority: 0.9 },
    { url: absoluteUrl("/offers"), changeFrequency: "daily", priority: 0.8 },
    { url: absoluteUrl("/brands"), changeFrequency: "weekly", priority: 0.6 },
    { url: absoluteUrl("/categories"), changeFrequency: "weekly", priority: 0.6 },
    { url: absoluteUrl("/contact"), changeFrequency: "monthly", priority: 0.4 },
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
  ];
}
