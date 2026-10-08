import { getPublicClient } from "@/lib/supabase/public";
import { getSiteSettings } from "@/services/settings";
import { absoluteImageUrl, absoluteUrl } from "@/lib/seo";
import { toPlainText, variantLabel } from "@/lib/utils";

/**
 * Google Merchant Center product feed (RSS 2.0 + g: namespace).
 * Add  https://your-domain/feeds/google-merchant.xml  as a scheduled feed in
 * Merchant Center. Cached for an hour; built only from real database data.
 * Products with variants are listed one item per variant (item_group_id).
 */
export const revalidate = 3600;

const CONDITION: Record<string, string> = { new: "new", used: "used", refurbished: "refurbished" };

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function money(n: number, currency: string) {
  return `${Number(n).toFixed(2)} ${currency}`;
}

interface FeedRow {
  id: string;
  slug: string;
  name: string;
  short_description: string | null;
  description: string | null;
  price: number;
  sale_price: number | null;
  stock_quantity: number;
  status: string;
  condition: string;
  sku: string | null;
  barcode: string | null;
  mpn: string | null;
  brand: { name: string } | null;
  category: { name: string } | null;
  images: { url: string; is_primary: boolean; sort_order: number }[];
  variants: {
    id: string;
    sku: string | null;
    storage: string | null;
    ram: string | null;
    color: string | null;
    price: number;
    sale_price: number | null;
    stock: number;
    image_url: string | null;
    status: string;
  }[];
}

export async function GET() {
  const supabase = getPublicClient();
  const settings = await getSiteSettings();
  const currency = settings.currency || "BDT";
  const rows: FeedRow[] = [];

  if (supabase) {
    for (let from = 0; from < 20000; from += 500) {
      const { data, error } = await supabase
        .from("products")
        .select(
          "id, slug, name, short_description, description, price, sale_price, stock_quantity, status, condition, sku, barcode, mpn, brand:brands(name), category:categories(name), images:product_images(url, is_primary, sort_order), variants:product_variants(id, sku, storage, ram, color, price, sale_price, stock, image_url, status)",
        )
        .in("status", ["active", "out_of_stock"])
        .eq("is_demo", false)
        .order("created_at")
        .range(from, from + 499);
      if (error) {
        console.error("[merchant feed]", error.message);
        return new Response("Feed temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
      }
      rows.push(...((data as unknown as FeedRow[]) ?? []));
      if (!data || data.length < 500) break;
    }
  }

  const items: string[] = [];
  for (const p of rows) {
    const images = [...p.images].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order);
    const mainImage = absoluteImageUrl(images[0]?.url);
    if (!mainImage) continue; // Merchant Center requires an image
    const extraImages = images.slice(1, 10).map((i) => `<g:additional_image_link>${esc(absoluteImageUrl(i.url))}</g:additional_image_link>`);
    const description = toPlainText(p.description || p.short_description || p.name, 4900);
    const common = [
      `<g:condition>${CONDITION[p.condition] ?? "new"}</g:condition>`,
      p.brand ? `<g:brand>${esc(p.brand.name)}</g:brand>` : "",
      p.mpn ? `<g:mpn>${esc(p.mpn)}</g:mpn>` : "",
      p.category ? `<g:product_type>${esc(p.category.name)}</g:product_type>` : "",
      `<g:identifier_exists>${p.barcode || p.mpn ? "yes" : "no"}</g:identifier_exists>`,
      `<g:shipping><g:country>BD</g:country><g:price>${money(settings.delivery_charge_inside_dhaka, currency)}</g:price></g:shipping>`,
    ].join("");

    const variants = p.variants.filter((v) => v.status === "active");
    const entries = variants.length
      ? variants.map((v) => ({
          id: v.sku || v.id,
          title: `${p.name} ${variantLabel(v)}`.trim(),
          link: absoluteUrl(`/products/${p.slug}?variant=${v.id}`),
          image: absoluteImageUrl(v.image_url) || mainImage,
          price: v.price,
          sale: v.sale_price,
          inStock: p.status === "active" && v.stock > 0,
          gtin: null as string | null,
          group: p.sku || p.id,
          color: v.color,
        }))
      : [
          {
            id: p.sku || p.id,
            title: p.name,
            link: absoluteUrl(`/products/${p.slug}`),
            image: mainImage,
            price: p.price,
            sale: p.sale_price,
            inStock: p.status === "active" && p.stock_quantity > 0,
            gtin: p.barcode,
            group: null as string | null,
            color: null as string | null,
          },
        ];

    for (const e of entries) {
      items.push(
        [
          "<item>",
          `<g:id>${esc(e.id)}</g:id>`,
          `<g:title>${esc(e.title.slice(0, 150))}</g:title>`,
          `<g:description>${esc(description)}</g:description>`,
          `<g:link>${esc(e.link)}</g:link>`,
          `<g:image_link>${esc(e.image)}</g:image_link>`,
          ...extraImages,
          `<g:availability>${e.inStock ? "in_stock" : "out_of_stock"}</g:availability>`,
          `<g:price>${money(e.price, currency)}</g:price>`,
          e.sale !== null && Number(e.sale) < Number(e.price) ? `<g:sale_price>${money(e.sale, currency)}</g:sale_price>` : "",
          e.gtin && /^\d{8,14}$/.test(e.gtin) ? `<g:gtin>${esc(e.gtin)}</g:gtin>` : "",
          e.group ? `<g:item_group_id>${esc(e.group)}</g:item_group_id>` : "",
          e.color ? `<g:color>${esc(e.color)}</g:color>` : "",
          common,
          "</item>",
        ].join(""),
      );
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>${esc(settings.store_name)}</title>
<link>${esc(absoluteUrl("/"))}</link>
<description>${esc(`${settings.store_name} product feed`)}</description>
${items.join("\n")}
</channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
