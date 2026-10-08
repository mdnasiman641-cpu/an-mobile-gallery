/**
 * Homepage sections: definitions and built-in defaults. The defaults are the
 * current homepage, used when nothing is saved yet (or before the database
 * migration has run), so the public page never depends on this table existing.
 */
import { EMI_PROMO, EXCHANGE_PROMO, STORE_AREA } from "@/lib/storefront";

export const SECTION_KEYS = [
  "hero",
  "deals",
  "trust",
  "categories",
  "exchange",
  "emi",
  "offers",
  "featured",
  "new_arrivals",
  "used",
  "refurbished",
  "accessories",
  "best_sellers",
  "brands",
  "promotions",
  "reviews",
  "why",
  "footer_promo",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export type ItemType = "product" | "category" | "brand" | "banner";
export type SectionField = "title" | "subtitle" | "description" | "image" | "button";

export interface SectionDef {
  key: SectionKey;
  label: string;
  /** Which kind of item a manual selection picks. */
  itemType: ItemType | null;
  fields: SectionField[];
  /** Admin can edit a list of short items (title + text). */
  hasTextItems?: boolean;
  defaultTitle: string;
  defaultSubtitle?: string;
  defaultDescription?: string;
  defaultButtonText?: string;
  defaultLimit?: number;
  maxLimit?: number;
  autoHint: string;
}

export const SECTION_DEFS: Record<SectionKey, SectionDef> = {
  hero: { key: "hero", label: "Hero", itemType: "product", fields: ["image"], defaultTitle: "Hero", autoHint: "Top featured product with a photo (else the newest). Manual: pick the product.", defaultLimit: 1, maxLimit: 1 },
  deals: { key: "deals", label: "Today's Best Deals", itemType: "product", fields: ["title", "subtitle"], defaultTitle: "Today’s best deals", defaultSubtitle: "আজকের সেরা অফার", autoHint: "Discounted products; falls back to featured prices.", defaultLimit: 4, maxLimit: 6 },
  trust: { key: "trust", label: "Trust Features", itemType: null, fields: [], hasTextItems: true, defaultTitle: "Our services", autoHint: "Five short service cards under the hero." },
  categories: { key: "categories", label: "Shop by Category", itemType: "category", fields: ["title", "button"], defaultTitle: "Shop by category", defaultButtonText: "All categories", autoHint: "Featured categories first, then the rest.", defaultLimit: 6, maxLimit: 12 },
  exchange: { key: "exchange", label: "Exchange Promotion", itemType: null, fields: ["title", "subtitle", "description", "button"], defaultTitle: EXCHANGE_PROMO.titleBn, defaultSubtitle: EXCHANGE_PROMO.subtitle, defaultDescription: EXCHANGE_PROMO.text, defaultButtonText: EXCHANGE_PROMO.cta, autoHint: "Button opens your Exchange page if published, else WhatsApp." },
  emi: { key: "emi", label: "EMI Promotion", itemType: null, fields: ["title", "subtitle", "button"], hasTextItems: true, defaultTitle: EMI_PROMO.title, defaultSubtitle: EMI_PROMO.months, defaultButtonText: EMI_PROMO.cta, autoHint: "Button opens your EMI page if published, else WhatsApp." },
  offers: { key: "offers", label: "Special Offers", itemType: "product", fields: ["title", "subtitle", "button"], defaultTitle: "Special offers", defaultSubtitle: "Discounted right now", defaultButtonText: "View all", autoHint: "Products on sale.", defaultLimit: 10 },
  featured: { key: "featured", label: "Featured Phones", itemType: "product", fields: ["title", "subtitle", "button"], defaultTitle: "Featured phones", defaultSubtitle: "Hand-picked by our team", defaultButtonText: "View all", autoHint: "Products marked Featured.", defaultLimit: 10 },
  new_arrivals: { key: "new_arrivals", label: "New Arrivals", itemType: "product", fields: ["title", "subtitle", "button"], defaultTitle: "New arrivals", defaultSubtitle: "Recently added to the shop", defaultButtonText: "View all", autoHint: "Products marked New, else the most recently added.", defaultLimit: 10 },
  used: { key: "used", label: "Used Phones", itemType: "product", fields: ["title", "subtitle", "button"], defaultTitle: "Used & refurbished phones", defaultSubtitle: "Checked and tested, with the condition stated on every listing", defaultButtonText: "View all", autoHint: "Used phones (and refurbished, unless the Refurbished section is on).", defaultLimit: 10 },
  refurbished: { key: "refurbished", label: "Refurbished Phones", itemType: "product", fields: ["title", "subtitle", "button"], defaultTitle: "Refurbished phones", defaultSubtitle: "Professionally restored and checked", defaultButtonText: "View all", autoHint: "Products in Refurbished condition.", defaultLimit: 10 },
  accessories: { key: "accessories", label: "Accessories", itemType: "product", fields: ["title", "subtitle", "button"], defaultTitle: "Accessories", defaultButtonText: "View all", autoHint: "Newest products in the Accessories category.", defaultLimit: 10 },
  best_sellers: { key: "best_sellers", label: "Best Sellers", itemType: "product", fields: ["title", "subtitle", "button"], defaultTitle: "Best sellers", defaultSubtitle: "What customers buy most", defaultButtonText: "View all", autoHint: "Products marked Best seller, by sales.", defaultLimit: 10 },
  brands: { key: "brands", label: "Popular Brands", itemType: "brand", fields: ["title", "button"], defaultTitle: "Popular brands", defaultButtonText: "All brands", autoHint: "Featured brands (else all).", defaultLimit: 12, maxLimit: 24 },
  promotions: { key: "promotions", label: "Promotional Banners", itemType: "banner", fields: [], defaultTitle: "Promotions", autoHint: "Active banners from Admin → Banners.", defaultLimit: 3, maxLimit: 3 },
  reviews: { key: "reviews", label: "Customer Reviews", itemType: null, fields: ["title"], defaultTitle: "What customers say", autoHint: "Latest approved 4★–5★ reviews (real reviews only).", defaultLimit: 6, maxLimit: 9 },
  why: { key: "why", label: "Why AN MOBILE GALLERY", itemType: null, fields: ["title"], hasTextItems: true, defaultTitle: "Why {store}", autoHint: "Five reasons to buy from the shop." },
  footer_promo: { key: "footer_promo", label: "Footer Promotional Content", itemType: null, fields: ["title", "subtitle", "button"], defaultTitle: "Can’t find the phone you want?", defaultSubtitle: "আপনার পছন্দের ফোনটি খুঁজে না পেলে আমাদের জানান", defaultButtonText: "Contact the shop", autoHint: "Dark band above the footer with WhatsApp and contact buttons." },
};

export interface TextItem {
  title: string;
  text: string;
}

export const DEFAULT_TEXT_ITEMS: Partial<Record<SectionKey, TextItem[]>> = {
  trust: [
    { title: "Original products", text: "Checked before sale" },
    { title: "EMI installment", text: EMI_PROMO.months },
    { title: "Buy | Sell | Exchange", text: "Old phone to new" },
    { title: "Fast delivery", text: "Across Bangladesh" },
    { title: "Trusted shop", text: STORE_AREA },
  ],
  emi: EMI_PROMO.points.map((p) => ({ title: p, text: "" })),
  why: [
    { title: "100% genuine products", text: "Every phone is checked before it leaves the shop." },
    { title: "Secure shopping", text: "Pay cash on delivery. Prices are confirmed again at checkout." },
    { title: "Easy EMI plans", text: `Pay over ${EMI_PROMO.months}.` },
    { title: "Customer support", text: "Call or WhatsApp us for help before and after you buy." },
    { title: "Buy | Sell | Exchange", text: "Sell your old phone or trade it in for a new one." },
  ],
};

export interface HomepageSection {
  key: SectionKey;
  position: number;
  isEnabled: boolean;
  title: string | null;
  subtitle: string | null;
  description: string | null;
  imageUrl: string | null;
  buttonText: string | null;
  buttonUrl: string | null;
  mode: "auto" | "manual";
  itemLimit: number | null;
  config: { items?: TextItem[] } & Record<string, unknown>;
  itemIds: string[];
}

const DEFAULT_ORDER: SectionKey[] = [
  "hero", "deals", "trust", "categories", "exchange", "emi", "offers", "brands", "featured",
  "promotions", "new_arrivals", "used", "refurbished", "accessories", "best_sellers", "reviews", "why", "footer_promo",
];
const OFF_BY_DEFAULT = new Set<SectionKey>(["refurbished"]);

export function defaultSection(key: SectionKey): HomepageSection {
  return {
    key,
    position: DEFAULT_ORDER.indexOf(key) + 1,
    isEnabled: !OFF_BY_DEFAULT.has(key),
    title: null,
    subtitle: null,
    description: null,
    imageUrl: null,
    buttonText: null,
    buttonUrl: null,
    mode: "auto",
    itemLimit: SECTION_DEFS[key].defaultLimit ?? null,
    config: {},
    itemIds: [],
  };
}

export const DEFAULT_SECTIONS: HomepageSection[] = DEFAULT_ORDER.map(defaultSection);

/** Saved rows merged over the defaults; always all keys, sorted by position. */
export function mergeSections(saved: HomepageSection[]): HomepageSection[] {
  const byKey = new Map(saved.map((s) => [s.key, s]));
  return SECTION_KEYS.map((k) => byKey.get(k) ?? defaultSection(k)).sort((a, b) => a.position - b.position || SECTION_KEYS.indexOf(a.key) - SECTION_KEYS.indexOf(b.key));
}

/** Text shown on the page: saved value, else the built-in default. */
export function sectionText(s: HomepageSection, storeName: string) {
  const d = SECTION_DEFS[s.key];
  const fill = (v: string | undefined | null) => (v ? v.replace("{store}", storeName) : v ?? null);
  return {
    title: fill(s.title || d.defaultTitle) as string,
    subtitle: fill(s.subtitle || d.defaultSubtitle || null),
    description: fill(s.description || d.defaultDescription || null),
    buttonText: s.buttonText || d.defaultButtonText || null,
    buttonUrl: s.buttonUrl || null,
    items: s.config.items?.length ? s.config.items : (DEFAULT_TEXT_ITEMS[s.key] ?? []),
  };
}

export function sectionLimit(s: HomepageSection): number {
  const d = SECTION_DEFS[s.key];
  return Math.min(s.itemLimit ?? d.defaultLimit ?? 10, d.maxLimit ?? 24);
}
