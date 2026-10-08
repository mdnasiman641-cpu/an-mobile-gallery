import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { getPublicClient } from "@/lib/supabase/public";
import { CACHE_TAGS } from "@/lib/cache";
import type {
  Banner,
  Brand,
  Category,
  CategoryNode,
  FilterOptions,
  Page,
  ProductCard,
  ProductDetail,
  Review,
} from "@/types";

/**
 * Public catalog reads. Every function here uses the cookie-less client, so
 * pages that call them can be statically cached (ISR).
 *
 * Error policy: when Supabase is not configured we return empty data (lets a
 * first build succeed). When it IS configured and a query fails we throw, so
 * Next.js keeps serving the last good cached page instead of caching an
 * empty one, and error.tsx shows a friendly message on a cold render.
 */

function fail(context: string, message: string): never {
  throw new Error(`[catalog] ${context}: ${message}`);
}

// Explicit column list: never send search_vector to the browser.
const PRODUCT_COLUMNS =
  "id, brand_id, category_id, name, model, slug, sku, barcode, mpn, short_description, description, price, sale_price, stock_quantity, low_stock_threshold, condition, status, featured, is_new, is_offer, is_best_seller, warranty, meta_title, meta_description, canonical_url, ram_options, storage_options, color_options, rating_avg, rating_count, view_count, sales_count, published_at, is_demo, created_at, updated_at";

const BRAND_COLUMNS =
  "id, name, slug, logo_url, description, meta_title, meta_description, is_featured, is_active, sort_order, updated_at";
const CATEGORY_COLUMNS =
  "id, parent_id, name, slug, description, image_url, meta_title, meta_description, is_featured, is_active, sort_order, updated_at";

// ---------------------------------------------------------------------------
// Product listing (single RPC: product + brand + primary image, no N+1)
// ---------------------------------------------------------------------------

export type SortOption = "relevance" | "price_asc" | "price_desc" | "newest" | "popular";
export type ProductFlag = "featured" | "new" | "offer" | "best_seller" | "used";

export interface ProductQuery {
  query?: string | null;
  brands?: string[];
  category?: string | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  ram?: string[];
  storage?: string[];
  conditions?: string[];
  inStock?: boolean | null;
  flag?: ProductFlag | null;
  sort?: SortOption;
  page?: number;
  perPage?: number;
}

export interface ProductPage {
  items: ProductCard[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

function normalizeCard(row: Record<string, unknown>): ProductCard {
  const r = row as unknown as ProductCard;
  return {
    ...r,
    price: Number(r.price),
    sale_price: r.sale_price === null ? null : Number(r.sale_price),
    rating_avg: Number(r.rating_avg),
    total_count: Number(row.total_count ?? 0),
  };
}

export async function queryProducts(q: ProductQuery): Promise<ProductPage> {
  const perPage = Math.min(Math.max(q.perPage ?? 24, 1), 60);
  const page = Math.max(q.page ?? 1, 1);
  const supabase = getPublicClient();
  if (!supabase) return { items: [], total: 0, page, perPage, totalPages: 0 };

  const { data, error } = await supabase.rpc("search_products", {
    p_query: q.query?.trim() || null,
    p_brands: q.brands?.length ? q.brands : null,
    p_category: q.category || null,
    p_min_price: q.minPrice ?? null,
    p_max_price: q.maxPrice ?? null,
    p_ram: q.ram?.length ? q.ram : null,
    p_storage: q.storage?.length ? q.storage : null,
    p_conditions: q.conditions?.length ? q.conditions : null,
    p_in_stock: q.inStock ?? null,
    p_flag: q.flag ?? null,
    p_sort: q.sort ?? "relevance",
    p_limit: perPage,
    p_offset: (page - 1) * perPage,
  });
  if (error) fail("search_products", error.message);

  const items = ((data as Record<string, unknown>[]) ?? []).map(normalizeCard);
  const total = items[0]?.total_count ?? 0;
  return { items, total, page, perPage, totalPages: Math.ceil(total / perPage) };
}

export const getFilterOptions = cache(async (category?: string | null): Promise<FilterOptions> => {
  const empty: FilterOptions = { ram: [], storage: [], brands: [], conditions: [], price_min: null, price_max: null };
  const supabase = getPublicClient();
  if (!supabase) return empty;
  const { data, error } = await supabase.rpc("get_filter_options", { p_category: category || null });
  if (error) fail("get_filter_options", error.message);
  return { ...empty, ...((data as FilterOptions) ?? {}) };
});

// ---------------------------------------------------------------------------
// Product detail (one request with nested relations)
// ---------------------------------------------------------------------------

export const getProductBySlug = cache(async (slug: string): Promise<ProductDetail | null> => {
  const supabase = getPublicClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("products")
    .select(
      `${PRODUCT_COLUMNS},
       brand:brands(id, name, slug, logo_url),
       category:categories(id, name, slug, parent_id),
       images:product_images(id, product_id, url, storage_path, alt_text, is_primary, sort_order, width, height),
       variants:product_variants(id, product_id, sku, storage, ram, color, color_hex, price, sale_price, stock, image_url, status, sort_order),
       specifications:product_specifications(id, product_id, group_name, name, value, sort_order),
       features:product_features(id, product_id, feature, sort_order)`,
    )
    .eq("slug", slug)
    .in("status", ["active", "out_of_stock"])
    .maybeSingle();

  if (error) fail("product", error.message);
  if (!data) return null;

  const p = data as unknown as ProductDetail;
  const bySort = <T extends { sort_order: number }>(a: T, b: T) => a.sort_order - b.sort_order;
  return {
    ...p,
    price: Number(p.price),
    sale_price: p.sale_price === null ? null : Number(p.sale_price),
    rating_avg: Number(p.rating_avg),
    images: [...(p.images ?? [])].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order),
    variants: [...(p.variants ?? [])]
      .filter((v) => v.status === "active")
      .map((v) => ({ ...v, price: Number(v.price), sale_price: v.sale_price === null ? null : Number(v.sale_price) }))
      .sort(bySort),
    specifications: [...(p.specifications ?? [])].sort(bySort),
    features: [...(p.features ?? [])].sort(bySort),
  };
});

export async function getSlugRedirect(entity: "product" | "brand" | "category", slug: string): Promise<string | null> {
  const supabase = getPublicClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("slug_redirects")
    .select("new_slug")
    .eq("entity", entity)
    .eq("old_slug", slug)
    .maybeSingle();
  if (error) fail("slug_redirects", error.message);
  return (data as { new_slug: string } | null)?.new_slug ?? null;
}

export async function getApprovedReviews(productId: string, limit = 20): Promise<Review[]> {
  const supabase = getPublicClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("reviews")
    .select("id, product_id, user_id, customer_name, rating, title, body, status, is_verified_purchase, created_at")
    .eq("product_id", productId)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) fail("reviews", error.message);
  return (data as Review[]) ?? [];
}

/** Related = same category; "frequently viewed" = most viewed in the same brand. */
export async function getProductRecommendations(product: ProductDetail) {
  const [related, viewed] = await Promise.all([
    product.category
      ? queryProducts({ category: product.category.slug, sort: "popular", perPage: 9 })
      : Promise.resolve(null),
    product.brand ? queryProducts({ brands: [product.brand.slug], sort: "popular", perPage: 9 }) : Promise.resolve(null),
  ]);
  const relatedItems = (related?.items ?? []).filter((p) => p.id !== product.id).slice(0, 8);
  const relatedIds = new Set(relatedItems.map((p) => p.id));
  const viewedItems = (viewed?.items ?? []).filter((p) => p.id !== product.id && !relatedIds.has(p.id)).slice(0, 8);
  return { related: relatedItems, frequentlyViewed: viewedItems };
}

// ---------------------------------------------------------------------------
// Brands & categories (cached across requests; used in menus on every page)
// ---------------------------------------------------------------------------

export const getBrands = cache(
  unstable_cache(
    async (): Promise<Brand[]> => {
      const supabase = getPublicClient();
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("brands")
        .select(BRAND_COLUMNS)
        .eq("is_active", true)
        .order("sort_order")
        .order("name");
      if (error) fail("brands", error.message);
      return (data as Brand[]) ?? [];
    },
    ["brands"],
    { tags: [CACHE_TAGS.navigation], revalidate: 86400 },
  ),
);

export const getCategories = cache(
  unstable_cache(
    async (): Promise<Category[]> => {
      const supabase = getPublicClient();
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("categories")
        .select(CATEGORY_COLUMNS)
        .eq("is_active", true)
        .order("sort_order")
        .order("name");
      if (error) fail("categories", error.message);
      return (data as Category[]) ?? [];
    },
    ["categories"],
    { tags: [CACHE_TAGS.navigation], revalidate: 86400 },
  ),
);

export function buildCategoryTree(categories: Category[]): CategoryNode[] {
  const nodes = new Map<string, CategoryNode>();
  categories.forEach((c) => nodes.set(c.id, { ...c, children: [] }));
  const roots: CategoryNode[] = [];
  nodes.forEach((node) => {
    const parent = node.parent_id ? nodes.get(node.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  return roots;
}

export const getBrandBySlug = cache(async (slug: string) => {
  const brands = await getBrands();
  return brands.find((b) => b.slug === slug) ?? null;
});

export const getCategoryBySlug = cache(async (slug: string) => {
  const categories = await getCategories();
  const category = categories.find((c) => c.slug === slug) ?? null;
  if (!category) return null;
  const parent = category.parent_id ? (categories.find((c) => c.id === category.parent_id) ?? null) : null;
  const children = categories.filter((c) => c.parent_id === category.id);
  return { category, parent, children };
});

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

export async function getBanners(placement: "hero" | "promo"): Promise<Banner[]> {
  const supabase = getPublicClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("banners")
    .select(
      "id, title, subtitle, image_url, mobile_image_url, button_text, button_url, placement, is_active, sort_order, starts_at, ends_at",
    )
    .eq("placement", placement)
    .eq("is_active", true)
    .order("sort_order")
    .limit(placement === "hero" ? 6 : 4);
  if (error) fail("banners", error.message);
  return (data as Banner[]) ?? [];
}

export async function getPage(slug: string): Promise<Page | null> {
  const supabase = getPublicClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("pages")
    .select("id, slug, title, content, meta_title, meta_description, is_published, updated_at")
    .eq("slug", slug)
    .eq("is_published", true)
    .maybeSingle();
  if (error) fail("pages", error.message);
  return (data as Page) ?? null;
}

export async function getPublishedPages(): Promise<Pick<Page, "slug" | "title" | "updated_at">[]> {
  const supabase = getPublicClient();
  if (!supabase) return [];
  const { data, error } = await supabase.from("pages").select("slug, title, updated_at").eq("is_published", true);
  if (error) fail("pages", error.message);
  return (data as Pick<Page, "slug" | "title" | "updated_at">[]) ?? [];
}

// ---------------------------------------------------------------------------
// Home page sections (run in parallel; page is cached for REVALIDATE.home)
// ---------------------------------------------------------------------------

export async function getHomeSections() {
  const [featured, latest, bestSellers, offers, used, newArrivals] = await Promise.all([
    queryProducts({ flag: "featured", sort: "popular", perPage: 10 }),
    queryProducts({ sort: "newest", perPage: 10 }),
    queryProducts({ flag: "best_seller", sort: "popular", perPage: 10 }),
    queryProducts({ flag: "offer", sort: "popular", perPage: 10 }),
    queryProducts({ flag: "used", sort: "newest", perPage: 10 }),
    queryProducts({ flag: "new", sort: "newest", perPage: 10 }),
  ]);
  return {
    featured: featured.items,
    latest: latest.items,
    bestSellers: bestSellers.items,
    offers: offers.items,
    used: used.items,
    newArrivals: newArrivals.items,
  };
}

/** Latest approved reviews for the home page (real reviews only). */
export async function getRecentReviews(limit = 6) {
  const supabase = getPublicClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("reviews")
    .select("id, customer_name, rating, title, body, is_verified_purchase, created_at, product:products(name, slug)")
    .eq("status", "approved")
    .gte("rating", 4)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) fail("recent reviews", error.message);
  return (
    (data as unknown as (Pick<Review, "id" | "customer_name" | "rating" | "title" | "body" | "is_verified_purchase" | "created_at"> & {
      product: { name: string; slug: string } | null;
    })[]) ?? []
  );
}

// ---------------------------------------------------------------------------
// Compare (up to 4 products, one request)
// ---------------------------------------------------------------------------

export const getProductsForCompare = unstable_cache(
  async (ids: string[]): Promise<ProductDetail[]> => {
    const supabase = getPublicClient();
    const clean = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 4);
    if (!supabase || clean.length === 0) return [];
    const { data, error } = await supabase
      .from("products")
      .select(
        `${PRODUCT_COLUMNS},
         brand:brands(id, name, slug, logo_url),
         category:categories(id, name, slug, parent_id),
         images:product_images(id, product_id, url, storage_path, alt_text, is_primary, sort_order, width, height),
         variants:product_variants(id, product_id, sku, storage, ram, color, color_hex, price, sale_price, stock, image_url, status, sort_order),
         specifications:product_specifications(id, product_id, group_name, name, value, sort_order),
         features:product_features(id, product_id, feature, sort_order)`,
      )
      .in("id", clean)
      .in("status", ["active", "out_of_stock"]);
    if (error) fail("compare", error.message);
    const rows = (data as unknown as ProductDetail[]) ?? [];
    return clean
      .map((id) => rows.find((r) => r.id === id))
      .filter((r): r is ProductDetail => Boolean(r))
      .map((p) => ({
        ...p,
        price: Number(p.price),
        sale_price: p.sale_price === null ? null : Number(p.sale_price),
        images: [...p.images].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order),
        specifications: [...p.specifications].sort((a, b) => a.sort_order - b.sort_order),
      }));
  },
  ["compare-products"],
  { tags: [CACHE_TAGS.catalog], revalidate: 3600 },
);

// ---------------------------------------------------------------------------
// Sitemap / feeds (paged to handle thousands of products)
// ---------------------------------------------------------------------------

export async function getAllProductsForSitemap(): Promise<{ slug: string; updated_at: string }[]> {
  const supabase = getPublicClient();
  if (!supabase) return [];
  const out: { slug: string; updated_at: string }[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 50000; from += pageSize) {
    const { data, error } = await supabase
      .from("products")
      .select("slug, updated_at")
      .in("status", ["active", "out_of_stock"])
      .eq("is_demo", false) // sample data is never submitted to search engines
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) fail("sitemap products", error.message);
    const rows = (data as { slug: string; updated_at: string }[]) ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

/** Slugs to pre-render at build time (most popular first). */
export async function getPopularProductSlugs(limit = 40): Promise<string[]> {
  try {
    const { items } = await queryProducts({ sort: "popular", perPage: Math.min(limit, 60) });
    return items.map((p) => p.slug);
  } catch {
    return [];
  }
}
