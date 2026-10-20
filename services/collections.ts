import "server-only";
import { COLLECTIONS, type CollectionDef } from "@/lib/collections";
import { cachedQueryProducts } from "@/services/listing";
import { effectivePrice } from "@/lib/utils";
import type { ProductQuery } from "@/services/catalog";
import type { Brand, Category } from "@/types";

export interface CollectionSummary extends CollectionDef {
  href: string;
  /** In-stock products in this collection. */
  count: number;
  /** Lowest current price among them. */
  fromPrice: number | null;
  image: string | null;
  imageAlt: string;
}

/**
 * Real numbers for the homepage collection cards. One small cached query per
 * collection (4 rows, cache tag "catalog"), only for collections the catalog
 * can serve; collections without in-stock products are left out.
 */
export async function getCollectionSummaries(categories: Pick<Category, "slug" | "name" | "parent_id">[], brands: Pick<Brand, "slug">[]): Promise<CollectionSummary[]> {
  const brand = (slug: string) => brands.some((b) => b.slug === slug);
  const category = (re: RegExp) => categories.find((c) => re.test(c.slug));
  const iphoneCategory = category(/^iphones?$/);
  const androidCategory = category(/^android(-phones?)?$/);

  const targets: { def: CollectionDef; query: ProductQuery; href: string }[] = [];
  for (const def of COLLECTIONS) {
    switch (def.key) {
      case "iphone":
        if (brand("apple")) targets.push({ def, query: { brands: ["apple"] }, href: iphoneCategory ? `/categories/${iphoneCategory.slug}` : "/brands/apple" });
        else if (iphoneCategory) targets.push({ def, query: { category: iphoneCategory.slug }, href: `/categories/${iphoneCategory.slug}` });
        break;
      case "used":
        targets.push({ def, query: { flag: "used" }, href: "/collections/used-phones" });
        break;
      case "new":
        targets.push({ def, query: { conditions: ["new"] }, href: "/collections/new-phones" });
        break;
      case "samsung":
        if (brand("samsung")) targets.push({ def, query: { brands: ["samsung"] }, href: "/brands/samsung" });
        break;
      case "android":
        if (androidCategory) targets.push({ def, query: { category: androidCategory.slug }, href: `/categories/${androidCategory.slug}` });
        break;
      case "deals":
        targets.push({ def, query: { flag: "offer" }, href: "/offers" });
        break;
    }
  }

  const results = await Promise.all(
    targets.map(async (t) => {
      try {
        const page = await cachedQueryProducts({ ...t.query, inStock: true, sort: "price_asc", perPage: 4 });
        if (!page.total) return null;
        const withImage = page.items.find((p) => p.image_url);
        const cheapest = page.items[0];
        const summary: CollectionSummary = {
          ...t.def,
          href: t.href,
          count: page.total,
          fromPrice: cheapest ? effectivePrice(cheapest.price, cheapest.sale_price) : null,
          image: withImage?.image_url ?? null,
          imageAlt: withImage ? withImage.image_alt || withImage.name : "",
        };
        return summary;
      } catch {
        return null; // one failing collection never breaks the homepage
      }
    }),
  );
  return results.filter((r): r is CollectionSummary => r !== null);
}
