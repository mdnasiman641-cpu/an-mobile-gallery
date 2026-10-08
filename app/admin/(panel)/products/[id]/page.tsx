import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasRole, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getAdminTaxonomy } from "@/services/admin";
import { getSiteSettings } from "@/services/settings";
import { AdminPageHeader } from "@/components/admin/page-header";
import { ProductForm } from "@/components/admin/product-form";
import type { ProductFormValues } from "@/lib/product-form-values";
import { Badge } from "@/components/ui/misc";
import { statusLabel } from "@/lib/utils";
import type { Product, ProductFeature, ProductImage, ProductSpecification, ProductVariant } from "@/types";

export const metadata: Metadata = { title: "Edit product" };

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const session = await requireStaff("editor");
  const canSeeCost = hasRole(session, "admin");
  const supabase = await createClient();

  const [{ data }, taxonomy, settings, costRes] = await Promise.all([
    supabase
      .from("products")
      .select(
        "*, product_variants(*), product_images(*), product_specifications(*), product_features(*)",
      )
      .eq("id", id)
      .maybeSingle(),
    getAdminTaxonomy(),
    getSiteSettings(),
    canSeeCost ? supabase.from("product_costs").select("cost_price").eq("product_id", id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!data) notFound();

  const p = data as Product & {
    product_variants: ProductVariant[];
    product_images: ProductImage[];
    product_specifications: ProductSpecification[];
    product_features: ProductFeature[];
  };
  const bySort = <T extends { sort_order: number }>(a: T, b: T) => a.sort_order - b.sort_order;

  const initial: ProductFormValues = {
    id: p.id,
    name: p.name,
    slug: p.slug,
    model: s(p.model),
    brand_id: s(p.brand_id),
    category_id: s(p.category_id),
    sku: s(p.sku),
    barcode: s(p.barcode),
    mpn: s(p.mpn),
    short_description: s(p.short_description),
    description: s(p.description),
    price: s(p.price),
    sale_price: s(p.sale_price),
    cost_price: s((costRes.data as { cost_price: number | null } | null)?.cost_price),
    stock_quantity: s(p.stock_quantity),
    low_stock_threshold: s(p.low_stock_threshold),
    condition: p.condition,
    status: p.status,
    featured: p.featured,
    is_new: p.is_new,
    is_offer: p.is_offer,
    is_best_seller: p.is_best_seller,
    warranty: s(p.warranty),
    meta_title: s(p.meta_title),
    meta_description: s(p.meta_description),
    canonical_url: s(p.canonical_url),
    variants: [...p.product_variants].sort(bySort).map((v) => ({
      key: v.id,
      id: v.id,
      sku: s(v.sku),
      storage: s(v.storage),
      ram: s(v.ram),
      color: s(v.color),
      color_hex: s(v.color_hex),
      price: s(v.price),
      sale_price: s(v.sale_price),
      stock: s(v.stock),
      image_url: s(v.image_url),
      status: v.status,
    })),
    specs: [...p.product_specifications].sort(bySort).map((x) => ({ group_name: x.group_name, name: x.name, value: x.value })),
    features: [...p.product_features].sort(bySort).map((f) => f.feature),
    images: [...p.product_images]
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order)
      .map((i) => ({ key: i.id, id: i.id, url: i.url, storage_path: i.storage_path, alt_text: s(i.alt_text), width: i.width, height: i.height })),
  };

  return (
    <>
      <AdminPageHeader
        title={p.name}
        description={`/products/${p.slug}`}
        back={{ href: "/admin/products", label: "Products" }}
        actions={
          <>
            {p.is_demo ? <Badge tone="warn">Demo data</Badge> : null}
            <Badge tone={p.status === "active" ? "signal" : "neutral"}>{statusLabel[p.status]}</Badge>
          </>
        }
      />
      <ProductForm
        key={p.updated_at}
        initial={initial}
        brands={taxonomy.brands}
        categories={taxonomy.categories}
        storeName={settings.store_name}
        canSeeCost={canSeeCost}
      />
    </>
  );
}
