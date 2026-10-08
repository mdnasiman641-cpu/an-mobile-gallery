import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminPageHeader } from "@/components/admin/page-header";
import { HomepageManager, type PickerOption } from "@/components/admin/homepage-manager";
import { DEFAULT_SECTIONS, mergeSections, type HomepageSection, type SectionKey } from "@/lib/homepage";
import { sectionFromRow } from "@/services/homepage";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";

export const metadata: Metadata = { title: "Homepage Management" };

export default async function HomepageManagementPage() {
  await requireStaff("editor");
  const supabase = await createClient();
  const [sectionsRes, itemsRes, productsRes, categoriesRes, brandsRes, bannersRes] = await Promise.all([
    supabase.from("homepage_sections").select("key, position, is_enabled, title, subtitle, description, image_url, button_text, button_url, mode, item_limit, config"),
    supabase.from("homepage_section_items").select("section_key, item_id, position").order("position"),
    supabase.from("products").select("id, name, status, condition").in("status", ["active", "out_of_stock"]).order("name").limit(1000),
    supabase.from("categories").select("id, name, is_active").order("sort_order"),
    supabase.from("brands").select("id, name, is_active").order("sort_order"),
    supabase.from("banners").select("id, title, placement, is_active").order("sort_order"),
  ]);

  const migrationMissing = Boolean(sectionsRes.error);
  let sections: HomepageSection[] = DEFAULT_SECTIONS;
  if (!migrationMissing) {
    const items = new Map<string, string[]>();
    for (const it of (itemsRes.data as { section_key: string; item_id: string }[]) ?? []) items.set(it.section_key, [...(items.get(it.section_key) ?? []), it.item_id]);
    sections = mergeSections(
      ((sectionsRes.data as Parameters<typeof sectionFromRow>[0][]) ?? []).map((r) => sectionFromRow(r, items.get(r.key) ?? [])),
    );
  }

  const options: Record<"product" | "category" | "brand" | "banner", PickerOption[]> = {
    product: ((productsRes.data as { id: string; name: string; status: string; condition: string }[]) ?? []).map((p) => ({
      id: p.id,
      label: p.name,
      note: [p.condition !== "new" ? p.condition : null, p.status === "out_of_stock" ? "out of stock" : null].filter(Boolean).join(", ") || null,
    })),
    category: ((categoriesRes.data as { id: string; name: string; is_active: boolean }[]) ?? []).map((c) => ({ id: c.id, label: c.name, note: c.is_active ? null : "hidden" })),
    brand: ((brandsRes.data as { id: string; name: string; is_active: boolean }[]) ?? []).map((b) => ({ id: b.id, label: b.name, note: b.is_active ? null : "hidden" })),
    banner: ((bannersRes.data as { id: string; title: string; placement: string; is_active: boolean }[]) ?? []).map((b) => ({
      id: b.id,
      label: b.title,
      note: [b.placement, b.is_active ? null : "inactive"].filter(Boolean).join(", "),
    })),
  };

  return (
    <>
      <AdminPageHeader
        title="Homepage Management"
        description="Choose which sections appear, their order, their text, and which products, categories, brands or banners they show."
        actions={
          <Link href="/" target="_blank" rel="noopener noreferrer" className={buttonClasses("outline", "sm")}>
            View homepage
          </Link>
        }
      />
      {migrationMissing ? (
        <p className="mb-4 rounded-[var(--radius-card)] border border-warn/30 bg-warn-tint p-4 text-sm text-ink">
          Homepage settings can&rsquo;t be saved yet: run the latest database migration (<code>20261009000010_homepage_ai_sync.sql</code>) in Supabase. The homepage
          keeps showing its built-in layout until then.
        </p>
      ) : null}
      <HomepageManager initial={sections} options={options} readOnly={migrationMissing} keysWithItems={["hero", "deals", "categories", "offers", "featured", "new_arrivals", "used", "refurbished", "accessories", "best_sellers", "brands", "promotions"] satisfies SectionKey[]} />
    </>
  );
}
