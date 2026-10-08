import "server-only";
import { unstable_cache } from "next/cache";
import { getPublicClient } from "@/lib/supabase/public";
import { CACHE_TAGS } from "@/lib/cache";
import { DEFAULT_SECTIONS, mergeSections, SECTION_KEYS, type HomepageSection, type SectionKey } from "@/lib/homepage";
import type { ProductCard } from "@/types";

interface SectionRow {
  key: SectionKey;
  position: number;
  is_enabled: boolean;
  title: string | null;
  subtitle: string | null;
  description: string | null;
  image_url: string | null;
  button_text: string | null;
  button_url: string | null;
  mode: "auto" | "manual";
  item_limit: number | null;
  config: HomepageSection["config"] | null;
}

export function sectionFromRow(r: SectionRow, itemIds: string[]): HomepageSection {
  return {
    key: r.key,
    position: r.position,
    isEnabled: r.is_enabled,
    title: r.title,
    subtitle: r.subtitle,
    description: r.description,
    imageUrl: r.image_url,
    buttonText: r.button_text,
    buttonUrl: r.button_url,
    mode: r.mode,
    itemLimit: r.item_limit,
    config: r.config ?? {},
    itemIds,
  };
}

/**
 * Homepage layout (cached; tag "homepage"). Any problem — table not created
 * yet, network error — falls back to the built-in layout, so the public
 * homepage keeps working exactly as before.
 */
export const getHomepageSections = unstable_cache(
  async (): Promise<HomepageSection[]> => {
    const supabase = getPublicClient();
    if (!supabase) return DEFAULT_SECTIONS;
    const [sectionsRes, itemsRes] = await Promise.all([
      supabase.from("homepage_sections").select("key, position, is_enabled, title, subtitle, description, image_url, button_text, button_url, mode, item_limit, config"),
      supabase.from("homepage_section_items").select("section_key, item_id, position").order("position"),
    ]);
    if (sectionsRes.error || itemsRes.error || !sectionsRes.data?.length) return DEFAULT_SECTIONS;
    const items = new Map<string, string[]>();
    for (const it of itemsRes.data as { section_key: string; item_id: string }[]) {
      items.set(it.section_key, [...(items.get(it.section_key) ?? []), it.item_id]);
    }
    const rows = (sectionsRes.data as SectionRow[]).filter((r) => (SECTION_KEYS as readonly string[]).includes(r.key));
    return mergeSections(rows.map((r) => sectionFromRow(r, items.get(r.key) ?? [])));
  },
  ["homepage-sections"],
  { tags: [CACHE_TAGS.homepage], revalidate: 3600 },
);

/** Product cards in the given order (published products only). */
export async function getProductCardsByIds(ids: string[]): Promise<ProductCard[]> {
  if (ids.length === 0) return [];
  const supabase = getPublicClient();
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("product_cards_by_ids", { p_ids: ids.slice(0, 60) });
  if (error) return []; // e.g. migration not run yet: the section just hides
  return ((data as Record<string, unknown>[]) ?? []).map((row) => {
    const r = row as unknown as ProductCard;
    return { ...r, price: Number(r.price), sale_price: r.sale_price === null ? null : Number(r.sale_price), rating_avg: Number(r.rating_avg) };
  });
}
