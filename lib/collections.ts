import type { ProductQuery } from "@/services/catalog";

/**
 * Product collections used by the homepage "Shop by collection" section and
 * by the few campaign landing pages (/collections/[slug]).
 *
 * Every collection is a filter over the real catalog: it is shown only when
 * matching products exist (counts and prices come from the database). Where
 * the site already has a page for a collection (a category or brand page,
 * /offers) the card links there instead of creating a duplicate page.
 */

export type CollectionKey = "iphone" | "used" | "new" | "samsung" | "android" | "deals";

export interface CollectionDef {
  key: CollectionKey;
  label: string;
  /** Short line under the label on the homepage card. */
  blurb: string;
}

export const COLLECTIONS: CollectionDef[] = [
  { key: "iphone", label: "iPhone", blurb: "New and used Apple iPhones" },
  { key: "used", label: "Used phones", blurb: "Pre-owned, condition stated on every listing" },
  { key: "new", label: "New phones", blurb: "Brand-new smartphones" },
  { key: "samsung", label: "Samsung", blurb: "Galaxy phones" },
  { key: "android", label: "Android phones", blurb: "Phones from every Android brand" },
  { key: "deals", label: "Best deals", blurb: "Products with a reduced price right now" },
];

/** Campaign landing pages that have no equivalent page elsewhere on the site. */
export type LandingSlug = "used-phones" | "new-phones" | "used-iphones";

export interface LandingDef {
  slug: LandingSlug;
  /** Visible heading (H1). */
  heading: string;
  headingBn?: string;
  title: string;
  description: string;
  intro: string;
  /** Short, practical guidance (general advice, not claims about the shop). */
  tipsTitle: string;
  tips: string[];
  /** Needs this brand to exist in the catalog (e.g. "apple"). */
  brand?: string;
  query: Omit<ProductQuery, "page" | "perPage">;
  /** The same products in the main listing (filters + all pages). */
  listingParams: Record<string, string>;
}

export const LANDINGS: Record<LandingSlug, LandingDef> = {
  "used-phones": {
    slug: "used-phones",
    heading: "Used mobile phones",
    headingBn: "ব্যবহৃত মোবাইল ফোন",
    title: "Used Mobile Phones Price in Bangladesh",
    description:
      "Browse used and pre-owned smartphones with prices in Taka, the condition stated on every listing and current availability. Order online or contact the shop.",
    intro:
      "Every phone below is a used or pre-owned phone that is in stock or recently sold out. Each listing states its condition, price in Taka and storage options; open a phone to see its photos and full details, or message us on WhatsApp before you buy.",
    tipsTitle: "Checking a used phone",
    tips: [
      "Compare the photos and the condition on the listing with the phone you receive.",
      "Check that the IMEI in Settings matches the IMEI on the box or SIM tray, if the box is included.",
      "On an iPhone, look at Settings → Battery → Battery Health; on Android, check the battery and charging.",
      "Test calls, both cameras, speakers, microphone, Wi-Fi and the fingerprint or face unlock.",
      "Ask which accessories are included before ordering.",
    ],
    query: { flag: "used", sort: "newest" },
    listingParams: { flag: "used" },
  },
  "new-phones": {
    slug: "new-phones",
    heading: "New mobile phones",
    headingBn: "নতুন মোবাইল ফোন",
    title: "New Mobile Phones Price in Bangladesh",
    description: "Browse brand-new smartphones with current prices in Taka and stock availability. Order online or contact the shop.",
    intro:
      "All phones on this page are listed in New condition. Prices are in Taka and availability comes straight from our stock; open a phone for photos, specifications and storage options.",
    tipsTitle: "Choosing a new phone",
    tips: [
      "Decide on your budget first, then compare RAM and storage within it.",
      "Choose storage for the next few years: photos and apps grow over time.",
      "Compare the camera, battery and display specifications on each product page.",
      "Use Compare to view up to four phones side by side.",
    ],
    query: { conditions: ["new"], sort: "newest" },
    listingParams: { condition: "new" },
  },
  "used-iphones": {
    slug: "used-iphones",
    heading: "Used iPhones",
    headingBn: "ব্যবহৃত আইফোন",
    title: "Used iPhone Price in Bangladesh",
    description: "Browse used and pre-owned Apple iPhones with prices in Taka, the condition stated on every listing and current availability.",
    intro:
      "Pre-owned Apple iPhones currently listed in the shop. Each listing shows the model, storage, condition and price in Taka; open a phone for its photos and details.",
    tipsTitle: "Checking a used iPhone",
    tips: [
      "Open Settings → Battery → Battery Health & Charging to see the maximum capacity.",
      "Make sure Find My iPhone is switched off and the phone is not linked to another Apple ID.",
      "Check Settings → General → About → Parts and Service History for replaced parts (on supported models).",
      "Test Face ID or Touch ID, both cameras, speakers and charging.",
    ],
    brand: "apple",
    query: { brands: ["apple"], conditions: ["used", "refurbished"], sort: "newest" },
    listingParams: { brand: "apple", condition: "used,refurbished" },
  },
};

export const LANDING_SLUGS = Object.keys(LANDINGS) as LandingSlug[];

export function isLandingSlug(v: string): v is LandingSlug {
  return (LANDING_SLUGS as string[]).includes(v);
}

export function listingHref(params: Record<string, string>): string {
  return `/products?${new URLSearchParams(params).toString()}`;
}
