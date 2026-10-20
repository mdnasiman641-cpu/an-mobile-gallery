import type { Metadata } from "next";
import { hasRole, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminPageHeader } from "@/components/admin/page-header";
import { GuideManager } from "@/components/admin/guide-manager";
import { getSeoSettings, getSiteSettings } from "@/services/settings";
import { getSiteUrl } from "@/lib/env";
import type { Article } from "@/lib/articles";

export const metadata: Metadata = { title: "Guides" };

export default async function AdminGuidesPage() {
  const session = await requireStaff("editor");
  const supabase = await createClient();
  const [articles, products, categories, site, seo] = await Promise.all([
    supabase.from("articles").select("*").order("updated_at", { ascending: false }).limit(300),
    supabase.from("products").select("id, name").in("status", ["active", "out_of_stock"]).order("name").limit(1000),
    supabase.from("categories").select("id, name").eq("is_active", true).order("sort_order").order("name"),
    getSiteSettings(),
    getSeoSettings(),
  ]);
  return (
    <>
      <AdminPageHeader title="Guides" description="Buying guides and articles at /guides. Drafts stay private; published guides are added to the sitemap." />
      <GuideManager
        articles={(articles.data ?? []) as Article[]}
        products={(products.data ?? []) as { id: string; name: string }[]}
        categories={(categories.data ?? []) as { id: string; name: string }[]}
        canDelete={hasRole(session, "admin")}
        siteUrl={getSiteUrl()}
        storeName={site.store_name}
        defaultImage={seo.default_og_image}
        migrationMissing={Boolean(articles.error)}
      />
    </>
  );
}
