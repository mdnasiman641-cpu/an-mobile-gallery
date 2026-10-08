import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminPageHeader } from "@/components/admin/page-header";
import { TaxonomyManager, type TaxonomyRow } from "@/components/admin/taxonomy-manager";

export const metadata: Metadata = { title: "Brands" };

export default async function AdminBrandsPage() {
  await requireStaff("editor");
  const supabase = await createClient();
  const { data } = await supabase
    .from("brands")
    .select("id, name, slug, description, meta_title, meta_description, is_featured, is_active, sort_order, logo_url, products(count)")
    .order("sort_order")
    .order("name");

  const rows: TaxonomyRow[] = ((data ?? []) as unknown as (Omit<TaxonomyRow, "image" | "product_count"> & {
    logo_url: string | null;
    products: { count: number }[];
  })[]).map(({ logo_url, products, ...r }) => ({ ...r, image: logo_url, product_count: products[0]?.count ?? 0 }));

  return (
    <>
      <AdminPageHeader title="Brands" description="Brands appear in menus, filters and their own SEO pages." />
      <TaxonomyManager kind="brand" rows={rows} />
    </>
  );
}
