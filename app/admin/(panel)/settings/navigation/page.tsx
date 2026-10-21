import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminPageHeader } from "@/components/admin/page-header";
import { NavigationManager } from "@/components/admin/navigation-manager";
import { readNav } from "@/lib/navigation";

export const metadata: Metadata = { title: "Header & Navigation" };

export default async function NavigationSettingsPage() {
  await requireStaff("admin");
  const supabase = await createClient();
  const [navRes, cats, brands] = await Promise.all([
    supabase.from("storefront_header").select("nav").eq("id", 1).maybeSingle(),
    supabase.from("categories").select("id, name, slug, parent_id, is_active").order("sort_order").order("name"),
    supabase.from("brands").select("name, slug, is_featured").eq("is_active", true).order("sort_order").order("name"),
  ]);
  // only a missing column / table means the migration is missing; other errors are shown as they are
  const e = navRes.error;
  const migrationMissing = Boolean(e && (e.code === "42703" || e.code === "PGRST204" || e.code === "42P01" || e.code === "PGRST205"));
  const loadError = e && !migrationMissing ? `The saved menu couldn't be loaded (database error ${e.code ?? "unknown"}: ${e.message}).` : null;
  return (
    <>
      <AdminPageHeader
        title="Header & Navigation"
        description="The menu bar under the header (desktop) and the mobile menu. Logo: Settings → Branding. Announcement bar and Locations: Settings."
      />
      <NavigationManager
        saved={migrationMissing ? null : readNav((navRes.data as { nav: unknown } | null)?.nav)}
        categories={((cats.data ?? []) as { id: string; name: string; slug: string; parent_id: string | null; is_active: boolean }[])}
        brands={((brands.data ?? []) as { name: string; slug: string; is_featured: boolean }[])}
        migrationMissing={migrationMissing}
      />
      {loadError ? (
        <p className="mt-4 rounded-lg bg-deal-tint p-3 text-sm text-deal" role="alert">
          {loadError}
        </p>
      ) : null}
    </>
  );
}
