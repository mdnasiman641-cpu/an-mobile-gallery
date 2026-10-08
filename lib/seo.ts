import type { Metadata } from "next";
import { getSiteUrl } from "@/lib/env";
import { toPlainText } from "@/lib/utils";

export function absoluteUrl(path = "/"): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${getSiteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Absolute URL for an image (Supabase URLs are already absolute; demo files are local). */
export function absoluteImageUrl(src: string | null | undefined): string | undefined {
  if (!src) return undefined;
  return absoluteUrl(src);
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

interface ProductSeoInput {
  name: string;
  meta_title?: string | null;
  meta_description?: string | null;
  short_description?: string | null;
  condition?: string;
}

/**
 * Title pattern from the brief:
 * "Apple iPhone 15 Pro Max 256GB Price in Bangladesh | STORE NAME"
 * The layout's title template appends " | STORE NAME", so this returns
 * only the first part. An admin-entered meta_title always wins.
 */
export function productSeoTitle(p: ProductSeoInput): string {
  if (p.meta_title?.trim()) return p.meta_title.trim();
  return `${p.name} Price in Bangladesh`;
}

/**
 * "Buy Apple iPhone 15 Pro Max 256GB in Bangladesh. Check latest price,
 *  specifications, availability and offers."
 */
export function productSeoDescription(p: ProductSeoInput): string {
  if (p.meta_description?.trim()) return clip(p.meta_description.trim(), 300);
  const usedNote = p.condition === "used" ? " Checked used phone." : p.condition === "refurbished" ? " Refurbished phone." : "";
  return clip(
    `Buy ${p.name} in Bangladesh. Check latest price, specifications, availability and offers.${usedNote}`,
    300,
  );
}

export function taxonomySeoTitle(kind: "brand" | "category", t: { name: string; meta_title?: string | null }): string {
  if (t.meta_title?.trim()) return t.meta_title.trim();
  return kind === "brand" ? `${t.name} Mobile Phone Price in Bangladesh` : `${t.name} Price in Bangladesh`;
}

export function taxonomySeoDescription(
  kind: "brand" | "category",
  t: { name: string; meta_description?: string | null; description?: string | null },
): string {
  if (t.meta_description?.trim()) return clip(t.meta_description.trim(), 300);
  const base =
    kind === "brand"
      ? `Shop original ${t.name} phones in Bangladesh. Compare latest ${t.name} prices, specifications and stock.`
      : `Shop ${t.name} in Bangladesh. Compare latest prices, specifications and availability.`;
  const extra = toPlainText(t.description, 140);
  return clip(extra ? `${base} ${extra}` : base, 300);
}

interface PageMetaInput {
  title: string;
  description: string;
  path: string;
  image?: string | null;
  imageAlt?: string;
  type?: "website" | "article";
  noIndex?: boolean;
  /** Use the title as-is without the "| Store" suffix. */
  absoluteTitle?: boolean;
}

/** Consistent Metadata for every public page: canonical, OG, Twitter. */
export function buildMetadata(input: PageMetaInput): Metadata {
  const url = absoluteUrl(input.path);
  const image = absoluteImageUrl(input.image);
  return {
    title: input.absoluteTitle ? { absolute: input.title } : input.title,
    description: input.description,
    alternates: { canonical: url },
    robots: input.noIndex ? { index: false, follow: true } : undefined,
    openGraph: {
      type: input.type ?? "website",
      url,
      title: input.title,
      description: input.description,
      locale: "en_BD",
      images: image ? [{ url: image, alt: input.imageAlt ?? input.title }] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: input.title,
      description: input.description,
      images: image ? [image] : undefined,
    },
  };
}
