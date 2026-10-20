import type { Metadata } from "next";
import { hasRole, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { escapeFilter, getAdminTaxonomy } from "@/services/admin";
import { AdminFilterBar, AdminPageHeader } from "@/components/admin/page-header";
import { ProductTable, type AdminProductRow } from "@/components/admin/product-table";
import { EmptyState, Pagination } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { buildListingHref } from "@/lib/listing";

export const metadata: Metadata = { title: "Products" };

const PER_PAGE = 25;
type SP = Record<string, string | undefined>;

const LIST_COLUMNS =
  "id, name, slug, sku, price, sale_price, stock_quantity, low_stock_threshold, status, featured, is_demo, updated_at, condition, category:categories(name), brand:brands(name), product_images(url, is_primary), product_variants(count)";

export default async function AdminProductsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await requireStaff("editor");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();
  const { brands, categories } = await getAdminTaxonomy();
  const q = escapeFilter(sp.q ?? "");
  const sort = sp.sort ?? "updated";

  const list = (columns: string) => {
    let query = supabase.from("products").select(columns, { count: "exact" });
    if (q) query = query.or(`name.ilike.%${q}%,sku.ilike.%${q}%,model.ilike.%${q}%`);
    if (sp.status) query = query.eq("status", sp.status);
    if (sp.brand) query = query.eq("brand_id", sp.brand);
    if (sp.category) query = query.eq("category_id", sp.category);
    if (sp.stock === "out") query = query.lte("stock_quantity", 0);
    if (sp.stock === "low") query = query.gt("stock_quantity", 0).lte("stock_quantity", 3);
    if (sp.demo === "1") query = query.eq("is_demo", true);
    if (sp.demo === "0") query = query.eq("is_demo", false);
    query =
      sort === "name"
        ? query.order("name")
        : sort === "stock"
          ? query.order("stock_quantity")
          : sort === "price"
            ? query.order("price")
            : query.order("updated_at", { ascending: false });
    return query.range((page - 1) * PER_PAGE, page * PER_PAGE - 1);
  };

  // box_included exists once migration 0017 has run; until then the list loads without it.
  let res = await list(`${LIST_COLUMNS}, box_included`);
  if (res.error && /box_included/.test(res.error.message)) res = await list(LIST_COLUMNS);
  const { data, count, error } = res;

  const rows: AdminProductRow[] = ((data ?? []) as unknown as (Omit<AdminProductRow, "image" | "variant_count"> & {
    product_images: { url: string; is_primary: boolean }[];
    product_variants: { count: number }[];
  })[]).map((r) => ({
    ...r,
    price: Number(r.price),
    sale_price: r.sale_price === null ? null : Number(r.sale_price),
    image: r.product_images.find((i) => i.is_primary)?.url ?? r.product_images[0]?.url ?? null,
    variant_count: r.product_variants[0]?.count ?? 0,
  }));
  const totalPages = Math.ceil((count ?? 0) / PER_PAGE);

  return (
    <>
      <AdminPageHeader
        title="Products"
        description={`${count ?? 0} product${count === 1 ? "" : "s"}`}
        actions={<ButtonLink href="/admin/products/new">Add product</ButtonLink>}
      />
      <AdminFilterBar>
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs font-medium text-ink-soft">
          Search
          <Input name="q" defaultValue={sp.q} placeholder="Name, SKU or model" className="h-10" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          Status
          <Select name="status" defaultValue={sp.status ?? ""} className="h-10">
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="out_of_stock">Out of stock</option>
            <option value="archived">Archived</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          Brand
          <Select name="brand" defaultValue={sp.brand ?? ""} className="h-10">
            <option value="">All</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          Category
          <Select name="category" defaultValue={sp.category ?? ""} className="h-10">
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          Stock
          <Select name="stock" defaultValue={sp.stock ?? ""} className="h-10">
            <option value="">Any</option>
            <option value="low">Low (1–3)</option>
            <option value="out">Out of stock</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          Data
          <Select name="demo" defaultValue={sp.demo ?? ""} className="h-10">
            <option value="">All</option>
            <option value="0">Real store data</option>
            <option value="1">Demo data</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          Sort
          <Select name="sort" defaultValue={sort} className="h-10">
            <option value="updated">Recently updated</option>
            <option value="name">Name</option>
            <option value="stock">Lowest stock</option>
            <option value="price">Lowest price</option>
          </Select>
        </label>
      </AdminFilterBar>

      {error ? (
        <p className="rounded-lg bg-deal-tint p-3 text-sm text-deal" role="alert">
          Products couldn&rsquo;t be loaded. Refresh the page to try again.
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          title={q || sp.status || sp.brand ? "No products match these filters" : "No products yet"}
          description="Add your first product, or clear the filters."
          action={<ButtonLink href="/admin/products/new">Add product</ButtonLink>}
        />
      ) : (
        <>
          <ProductTable
            rows={rows}
            canBulkEdit={hasRole(session, "admin")}
            categories={categories.map((c) => ({ id: c.id, name: c.name, parent_id: c.parent_id, is_active: c.is_active }))}
          />
          <Pagination page={page} totalPages={totalPages} buildHref={(p) => buildListingHref("/admin/products", sp, { page: p })} />
        </>
      )}
    </>
  );
}
