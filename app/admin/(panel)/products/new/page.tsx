import type { Metadata } from "next";
import { hasRole, requireStaff } from "@/lib/auth";
import { getAdminTaxonomy } from "@/services/admin";
import { getSiteSettings } from "@/services/settings";
import { AdminPageHeader } from "@/components/admin/page-header";
import { ProductForm } from "@/components/admin/product-form";
import { emptyProductValues } from "@/lib/product-form-values";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage() {
  const session = await requireStaff("editor");
  const [{ brands, categories }, settings] = await Promise.all([getAdminTaxonomy(), getSiteSettings()]);
  return (
    <>
      <AdminPageHeader title="New product" back={{ href: "/admin/products", label: "Products" }} />
      <ProductForm
        initial={emptyProductValues()}
        brands={brands}
        categories={categories}
        storeName={settings.store_name}
        canSeeCost={hasRole(session, "admin")}
      />
    </>
  );
}
