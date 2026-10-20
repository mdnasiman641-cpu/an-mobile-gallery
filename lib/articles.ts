import { z } from "zod";

/**
 * Buying guides / articles (Admin → Guides, public at /guides/<slug>).
 * Shared types and validation for the admin form and the server action.
 */

export interface Article {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  content: string;
  meta_title: string | null;
  meta_description: string | null;
  featured_image: string | null;
  featured_image_alt: string | null;
  topics: string[];
  related_product_ids: string[];
  related_category_ids: string[];
  canonical_url: string | null;
  status: "draft" | "published";
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ArticleSummary = Pick<Article, "slug" | "title" | "excerpt" | "featured_image" | "featured_image_alt" | "topics" | "published_at" | "updated_at">;

export const ARTICLE_LIMITS = { topics: 10, products: 12, categories: 12 } as const;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .nullish()
    .transform((v) => (v ? v : null));

/** Visible to visitors: published and the publication date has arrived. */
export function isArticlePublic(a: Pick<Article, "status" | "published_at">, now = Date.now()): boolean {
  return a.status === "published" && Boolean(a.published_at) && Date.parse(a.published_at as string) <= now;
}

export const articleSchema = z
  .object({
    title: z.string().trim().min(3, "Title is required").max(200),
    slug: z
      .string()
      .trim()
      .max(120)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and dashes, e.g. used-iphone-buying-guide"),
    excerpt: text(320),
    content: z.string().max(100_000, "The article is too long").default(""),
    meta_title: text(120),
    meta_description: text(320),
    featured_image: text(1000).refine((v) => v === null || /^https:\/\//.test(v) || /^\/(?!\/)/.test(v), "Upload an image or use an https:// address"),
    featured_image_alt: text(200),
    topics: z
      .array(z.string().trim().min(1).max(40))
      .max(ARTICLE_LIMITS.topics, `At most ${ARTICLE_LIMITS.topics} topics`)
      .transform((t) => Array.from(new Set(t))),
    related_product_ids: z.array(z.string().uuid()).max(ARTICLE_LIMITS.products, `At most ${ARTICLE_LIMITS.products} products`),
    related_category_ids: z.array(z.string().uuid()).max(ARTICLE_LIMITS.categories, `At most ${ARTICLE_LIMITS.categories} categories`),
    canonical_url: text(500).refine((v) => v === null || /^https:\/\/[^\s]+$/.test(v), "Canonical URL must start with https://"),
    status: z.enum(["draft", "published"]),
    /** ISO time; empty = now when publishing. */
    published_at: z
      .string()
      .nullish()
      .transform((v, ctx) => {
        if (!v) return null;
        const t = Date.parse(v);
        if (Number.isNaN(t)) {
          ctx.addIssue({ code: "custom", message: "Invalid date" });
          return z.NEVER;
        }
        return new Date(t).toISOString();
      }),
  })
  .superRefine((a, ctx) => {
    if (a.status === "published" && a.content.trim().length < 200) {
      ctx.addIssue({ code: "custom", path: ["content"], message: "Write at least 200 characters before publishing (thin pages don't help visitors or search)." });
    }
    if (a.featured_image && !a.featured_image_alt) {
      ctx.addIssue({ code: "custom", path: ["featured_image_alt"], message: "Describe the image (alt text)" });
    }
  });

export type ArticleInput = z.input<typeof articleSchema>;
