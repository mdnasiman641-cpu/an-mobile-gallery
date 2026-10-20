import "server-only";
import { cache } from "react";
import { getPublicClient } from "@/lib/supabase/public";
import type { Article, ArticleSummary } from "@/lib/articles";

// Public reads go through the anonymous client: row-level security only
// returns published articles whose publication date has passed.

const SUMMARY_COLUMNS = "slug, title, excerpt, featured_image, featured_image_alt, topics, published_at, updated_at";
const ARTICLE_COLUMNS =
  "id, slug, title, excerpt, content, meta_title, meta_description, featured_image, featured_image_alt, topics, related_product_ids, related_category_ids, canonical_url, status, published_at, created_at, updated_at";

/** Table missing = migration 0019 not run yet: no guides, no errors. */
function missingTable(error: { code?: string; message?: string }): boolean {
  return error.code === "42P01" || error.code === "PGRST205" || /relation .*articles.* does not exist|could not find the table .*articles/i.test(error.message ?? "");
}

/** Newest published guides (bounded). */
export async function getPublishedArticles(limit = 60): Promise<ArticleSummary[]> {
  const supabase = getPublicClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("articles")
    .select(SUMMARY_COLUMNS)
    .eq("status", "published")
    .lte("published_at", new Date().toISOString())
    .order("published_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (error) {
    if (missingTable(error)) return [];
    throw new Error(`[articles] list: ${error.message}`);
  }
  return (data as ArticleSummary[]) ?? [];
}

/** One published guide (generateMetadata and the page share this call). */
export const getArticle = cache(async (slug: string): Promise<Article | null> => {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return null;
  const supabase = getPublicClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("articles")
    .select(ARTICLE_COLUMNS)
    .eq("slug", slug)
    .eq("status", "published")
    .lte("published_at", new Date().toISOString())
    .maybeSingle();
  if (error) {
    if (missingTable(error)) return null;
    throw new Error(`[articles] ${slug}: ${error.message}`);
  }
  return (data as Article | null) ?? null;
});

/** For the sitemap: published guides only. */
export async function getArticlesForSitemap(): Promise<{ slug: string; updated_at: string; canonical_url: string | null }[]> {
  const supabase = getPublicClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("articles")
    .select("slug, updated_at, canonical_url")
    .eq("status", "published")
    .lte("published_at", new Date().toISOString())
    .limit(1000);
  if (error) return [];
  return (data as { slug: string; updated_at: string; canonical_url: string | null }[]) ?? [];
}
