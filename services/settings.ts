import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { getPublicClient } from "@/lib/supabase/public";
import { CACHE_TAGS } from "@/lib/cache";
import type { SeoSettings, SiteSettings } from "@/types";

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  store_name: "AN MOBILE GALLERY",
  store_name_bn: "এএন মোবাইল গ্যালারি",
  tagline: "Original phones, honest prices",
  tagline_bn: "আসল ফোন, সঠিক দাম",
  logo_url: null,
  phone: null,
  whatsapp: null,
  email: null,
  address: null,
  address_bn: null,
  map_url: null,
  facebook_url: null,
  instagram_url: null,
  youtube_url: null,
  tiktok_url: null,
  opening_hours: "Sat–Thu, 10:00 AM – 9:00 PM",
  delivery_charge_inside_dhaka: 60,
  delivery_charge_outside_dhaka: 120,
  free_delivery_threshold: 0,
  currency: "BDT",
  currency_symbol: "৳",
  return_days: 7,
  return_policy: null,
  shipping_note: null,
};

export const DEFAULT_SEO_SETTINGS: SeoSettings = {
  site_title: "AN MOBILE GALLERY",
  site_description:
    "Buy original smartphones, used phones and gadgets in Bangladesh at the best price. Fast delivery and warranty support.",
  default_keywords: null,
  default_og_image: null,
  google_site_verification: null,
  facebook_domain_verification: null,
  twitter_handle: null,
  organization_name: "AN MOBILE GALLERY",
  organization_legal_name: null,
  organization_logo: null,
  organization_founding_year: null,
};

const SITE_COLUMNS =
  "store_name, store_name_bn, tagline, tagline_bn, logo_url, phone, whatsapp, email, address, address_bn, map_url, facebook_url, instagram_url, youtube_url, tiktok_url, opening_hours, delivery_charge_inside_dhaka, delivery_charge_outside_dhaka, free_delivery_threshold, currency, currency_symbol, return_days, return_policy, shipping_note";

const SEO_COLUMNS =
  "site_title, site_description, default_keywords, default_og_image, google_site_verification, facebook_domain_verification, twitter_handle, organization_name, organization_legal_name, organization_logo, organization_founding_year";

// Settings are read on every page, so they are cached across requests
// (tag "settings") and only re-read after an admin saves them.
const loadSiteSettings = unstable_cache(
  async (): Promise<SiteSettings> => {
    const supabase = getPublicClient();
    if (!supabase) return DEFAULT_SITE_SETTINGS;
    const { data, error } = await supabase.from("site_settings").select(SITE_COLUMNS).eq("id", 1).maybeSingle();
    if (error) throw new Error(`site_settings: ${error.message}`);
    if (!data) return DEFAULT_SITE_SETTINGS;
    const row = data as unknown as SiteSettings;
    return {
      ...DEFAULT_SITE_SETTINGS,
      ...row,
      delivery_charge_inside_dhaka: Number(row.delivery_charge_inside_dhaka),
      delivery_charge_outside_dhaka: Number(row.delivery_charge_outside_dhaka),
      free_delivery_threshold: Number(row.free_delivery_threshold),
    };
  },
  ["site-settings"],
  { tags: [CACHE_TAGS.settings], revalidate: 86400 },
);

const loadSeoSettings = unstable_cache(
  async (): Promise<SeoSettings> => {
    const supabase = getPublicClient();
    if (!supabase) return DEFAULT_SEO_SETTINGS;
    const { data, error } = await supabase.from("seo_settings").select(SEO_COLUMNS).eq("id", 1).maybeSingle();
    if (error) throw new Error(`seo_settings: ${error.message}`);
    return data ? { ...DEFAULT_SEO_SETTINGS, ...(data as unknown as SeoSettings) } : DEFAULT_SEO_SETTINGS;
  },
  ["seo-settings"],
  { tags: [CACHE_TAGS.settings], revalidate: 86400 },
);

/** Never throws: falls back to defaults (not cached) if the database is unreachable. */
export const getSiteSettings = cache(async (): Promise<SiteSettings> => {
  try {
    return await loadSiteSettings();
  } catch (e) {
    console.error("[settings] using defaults:", e);
    return DEFAULT_SITE_SETTINGS;
  }
});

export const getSeoSettings = cache(async (): Promise<SeoSettings> => {
  try {
    return await loadSeoSettings();
  } catch (e) {
    console.error("[seo] using defaults:", e);
    return DEFAULT_SEO_SETTINGS;
  }
});
