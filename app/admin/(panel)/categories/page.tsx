import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminPageHeader } from "@/components/admin/page-header";
import { TaxonomyManager, type TaxonomyRow } from "@/components/admin/taxonomy-manager";

export const metadata: Metadata = { title: "Categories" };

export default async function AdminCategoriesPage() {
  await requireStaff("editor");
  const supabase = await createClient();
  const { data } = await supabase
    .from("categories")
    .select("id, parent_id, name, slug, description, meta_title, meta_description, is_featured, is_active, sort_order, image_url, products(count)")
    .order("sort_order")
    .order("name");

  const flat: TaxonomyRow[] = ((data ?? []) as unknown as (Omit<TaxonomyRow, "image" | "product_count"> & {
    image_url: string | null;
    products: { count: number }[];
  })[]).map(({ image_url, products, ...r }) => ({ ...r, image: image_url, product_count: products[0]?.count ?? 0 }));

  // parents followed by their children
  const rows = flat
    .filter((c) => !c.parent_id)
    .flatMap((p) => [p, ...flat.filter((c) => c.parent_id === p.id)])
    .concat(flat.filter((c) => c.parent_id && !flat.some((p) => p.id === c.parent_id)));

  return (
    <>
      <AdminPageHeader title="Categories" description="Supports parent and child categories, e.g. Smartphones → iPhone." />
      <TaxonomyManager kind="category" rows={rows} />
    </>
  );
}
