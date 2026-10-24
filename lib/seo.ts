import type { Metadata } from "next";
import { getSiteUrl } from "@/lib/env";
import { effectivePrice, formatPrice, toPlainText } from "@/lib/utils";

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
  // optional real data for the automatic description (search result snippet)
  price?: number | null;
  sale_price?: number | null;
  stock_quantity?: number | null;
  status?: string | null;
  variants?: { price: number; sale_price: number | null; stock: number; status: string }[];
}

/** Lowest current price, the regular price it replaces (if on sale) and whether anything is in stock. */
function priceFacts(p: ProductSeoInput): { price: number | null; was: number | null; inStock: boolean | null } {
  const active = (p.variants ?? []).filter((v) => v.status === "active");
  const rows = active.length
    ? active.map((v) => ({ price: Number(v.price), sale: v.sale_price, stock: v.stock }))
    : p.price !== undefined && p.price !== null
      ? [{ price: Number(p.price), sale: p.sale_price ?? null, stock: p.stock_quantity ?? null }]
      : [];
  const priced = rows.filter((r) => r.price > 0);
  if (!priced.length) return { price: null, was: null, inStock: null };
  const best = priced.reduce((a, b) => (effectivePrice(b.price, b.sale) < effectivePrice(a.price, a.sale) ? b : a));
  const now = effectivePrice(best.price, best.sale);
  const known = rows.filter((r) => r.stock !== null && r.stock !== undefined);
  return {
    price: now,
    was: now < best.price ? best.price : null,
    inStock: p.status === "out_of_stock" ? false : known.length ? known.some((r) => Number(r.stock) > 0) : null,
  };
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
 * The search-result snippet when the admin wrote none. Built only from real product data, most
 * important first (Google shows about 150 characters): price, condition, stock, then the Bangla
 * search word "দাম" with the price, e.g.
 * "Redmi 15C 6GB/128GB price in Bangladesh: ৳15,999. New phone, in stock at AN MOBILE GADGETS.
 *  Specifications, photos and offers. দাম ৳15,999."
 * Without a price it falls back to "Buy … in Bangladesh. Check latest price, …".
 */
export function productSeoDescription(p: ProductSeoInput, opts: { storeName?: string | null; currencySymbol?: string | null } = {}): string {
  if (p.meta_description?.trim()) return clip(p.meta_description.trim(), 300);
  const usedNote = p.condition === "used" ? " Checked used phone." : p.condition === "refurbished" ? " Refurbished phone." : "";
  const facts = priceFacts(p);
  if (facts.price === null) {
    return clip(`Buy ${p.name} in Bangladesh. Check latest price, specifications, availability and offers.${usedNote}`, 300);
  }
  const symbol = opts.currencySymbol || "৳";
  const price = formatPrice(facts.price, symbol);
  const was = facts.was ? ` (was ${formatPrice(facts.was, symbol)})` : "";
  const kind = p.condition === "used" ? "Checked used phone" : p.condition === "refurbished" ? "Refurbished phone" : "New phone";
  const stock = facts.inStock === true ? ", in stock" : facts.inStock === false ? ", currently out of stock" : "";
  const at = opts.storeName?.trim() ? ` at ${opts.storeName.trim()}` : "";
  return clip(`${p.name} price in Bangladesh: ${price}${was}. ${kind}${stock}${at}. Specifications, photos and offers. দাম ${price}.`, 300);
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
