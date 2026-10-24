/**
 * Admin → SEO → "SEO health": what still holds the site back in Google, computed from the
 * real store data (no guesses). Pure function: the page reads the data, this decides.
 */

export interface HealthProduct {
  id: string;
  name: string;
  status: string;
  stock_quantity: number;
  short_description: string | null;
  description: string | null;
  brand_id: string | null;
  category_id: string | null;
  images: number;
}

export interface HealthTaxonomy {
  id: string;
  name: string;
  description: string | null;
}

export interface HealthInput {
  seo: { google_site_verification: string | null; site_description: string | null; organization_logo: string | null; default_og_image: string | null };
  site: { logo_url: string | null; phone: string | null; address: string | null; facebook_url: string | null; instagram_url: string | null; youtube_url: string | null; tiktok_url: string | null };
  products: HealthProduct[];
  categories: HealthTaxonomy[];
  brands: HealthTaxonomy[];
}

export interface HealthItem {
  key: string;
  ok: boolean;
  title: string;
  detail: string;
  /** Products / pages to fix (at most 8 shown). */
  examples: { name: string; href: string }[];
  more: number;
  fixHref?: string;
}

const PUBLIC = new Set(["active", "out_of_stock"]);
/** Below this many characters of text a product page is "thin" for Google. */
export const THIN_TEXT_CHARS = 200;

const plain = (html: string | null) => (html ?? "").replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
const list = (rows: { id: string; name: string }[], href: (id: string) => string) => ({
  examples: rows.slice(0, 8).map((r) => ({ name: r.name, href: href(r.id) })),
  more: Math.max(0, rows.length - 8),
});
const editProduct = (id: string) => `/admin/products/${id}`;

export function seoHealth(input: HealthInput): HealthItem[] {
  const pub = input.products.filter((p) => PUBLIC.has(p.status));
  const items: HealthItem[] = [];
  const add = (item: Omit<HealthItem, "examples" | "more"> & Partial<Pick<HealthItem, "examples" | "more">>) => items.push({ examples: [], more: 0, ...item });

  add({
    key: "verify",
    ok: Boolean(input.seo.google_site_verification?.trim()),
    title: "Google Search Console",
    detail: input.seo.google_site_verification?.trim()
      ? "Verification code is set. In Search Console, submit the sitemap above and check “Pages” for indexing problems."
      : "Not verified here. Add the site in Google Search Console, paste the HTML-tag code below (or verify by DNS), then submit the sitemap. Without this Google may index the site slowly.",
  });

  const desc = input.seo.site_description?.trim() ?? "";
  add({
    key: "home-description",
    ok: desc.length >= 70 && desc.length <= 160,
    title: "Homepage description",
    detail: `${desc.length} characters. Google shows about 150; 70–160 works best.`,
  });

  add({
    key: "logo",
    ok: Boolean(input.seo.organization_logo || input.site.logo_url),
    title: "Store logo for Google",
    detail: input.seo.organization_logo || input.site.logo_url ? "Set (used in the store's structured data)." : "No logo: add one in Settings → Branding or below.",
  });

  add({
    key: "share-image",
    ok: Boolean(input.seo.default_og_image),
    title: "Default sharing image",
    detail: input.seo.default_og_image ? "Set (used when a page has no photo of its own)." : "Not set: links shared on Facebook / WhatsApp from pages without a photo show no picture.",
  });

  const social = [input.site.facebook_url, input.site.instagram_url, input.site.youtube_url, input.site.tiktok_url].filter(Boolean).length;
  add({
    key: "social",
    ok: social > 0,
    title: "Social profiles",
    detail: social ? `${social} linked (tells Google the Facebook page and the website are the same shop).` : "None linked: add the shop's Facebook page in Settings.",
    fixHref: "/admin/settings",
  });

  const localOk = Boolean(input.site.phone && !input.site.phone.includes("X") && input.site.address && !input.site.address.startsWith("Update"));
  add({
    key: "local",
    ok: localOk,
    title: "Shop address and phone",
    detail: localOk ? "Set (local results such as “mobile shop Kapasia”)." : "Missing: add the real shop address and phone in Settings.",
    fixHref: "/admin/settings",
  });

  add({
    key: "products",
    ok: pub.length > 0,
    title: "Products visible to Google",
    detail: `${pub.length} public product page(s) (Active or Out of stock).`,
  });

  const draftsWithStock = input.products.filter((p) => p.status === "draft" && p.stock_quantity > 0);
  add({
    key: "drafts",
    ok: draftsWithStock.length === 0,
    title: "Drafts that are in stock",
    detail: draftsWithStock.length
      ? `${draftsWithStock.length} draft(s) have stock but are not on the website, so Google can't find them. Add price and photos, then publish.`
      : "None.",
    ...list(draftsWithStock, editProduct),
    fixHref: "/admin/products?status=draft",
  });

  const noPhoto = pub.filter((p) => p.images === 0);
  add({
    key: "photos",
    ok: noPhoto.length === 0,
    title: "Products without photos",
    detail: noPhoto.length ? `${noPhoto.length} public product(s) have no photo (no Google image results, weaker listings).` : "Every public product has a photo.",
    ...list(noPhoto, editProduct),
  });

  const thin = pub.filter((p) => plain(p.short_description).length + plain(p.description).length < THIN_TEXT_CHARS);
  add({
    key: "thin",
    ok: thin.length === 0,
    title: "Products with little text",
    detail: thin.length
      ? `${thin.length} public product(s) have under ${THIN_TEXT_CHARS} characters of description. Use “Generate all” in the product editor, review, save.`
      : "Every public product has a description.",
    ...list(thin, editProduct),
  });

  const noTaxonomy = pub.filter((p) => !p.brand_id || !p.category_id);
  add({
    key: "taxonomy",
    ok: noTaxonomy.length === 0,
    title: "Products without brand or category",
    detail: noTaxonomy.length ? `${noTaxonomy.length} public product(s) are missing a brand or category (they don't appear on brand / category pages).` : "All set.",
    ...list(noTaxonomy, editProduct),
  });

  const byName = new Map<string, HealthProduct[]>();
  for (const p of pub) {
    const k = p.name.toLowerCase().replace(/\s+/g, " ").trim();
    byName.set(k, [...(byName.get(k) ?? []), p]);
  }
  const dupes = [...byName.values()].filter((g) => g.length > 1).flat();
  add({
    key: "duplicates",
    ok: dupes.length === 0,
    title: "Products with the same name",
    detail: dupes.length
      ? `${dupes.length} public products share a name with another one; Google may treat them as duplicates. Make the names differ (memory, colour, condition) or merge them.`
      : "No duplicate names.",
    ...list(dupes, editProduct),
  });

  const thinCats = input.categories.filter((c) => plain(c.description).length < 80);
  add({
    key: "categories",
    ok: thinCats.length === 0,
    title: "Categories without a description",
    detail: thinCats.length ? `${thinCats.length} category page(s) have no intro text (a short paragraph helps them rank).` : "All have a description.",
    ...list(thinCats, () => "/admin/categories"),
  });

  const thinBrands = input.brands.filter((b) => plain(b.description).length < 80);
  add({
    key: "brands",
    ok: thinBrands.length === 0,
    title: "Brands without a description",
    detail: thinBrands.length ? `${thinBrands.length} brand page(s) have no intro text.` : "All have a description.",
    ...list(thinBrands, () => "/admin/brands"),
  });

  return items;
}
