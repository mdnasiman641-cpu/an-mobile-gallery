import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff, hasRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminPageHeader, adminTable } from "@/components/admin/page-header";
import { SalesChart } from "@/components/admin/sales-chart";
import { Badge } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { formatDate, formatPrice, orderStatusLabel, orderStatusTone, statusLabel } from "@/lib/utils";
import type { Order, ProductStatus } from "@/types";

export const metadata: Metadata = { title: "Dashboard" };

interface Stats {
  total_products: number;
  active_products: number;
  out_of_stock: number;
  low_stock: number;
  draft_products: number;
  total_orders?: number;
  pending_orders?: number;
  completed_orders?: number;
  cancelled_orders?: number;
  total_customers?: number;
  total_sales?: number;
  delivered_sales?: number;
  pending_reviews?: number;
  sales_by_day?: { day: string; total: number; orders: number }[];
}

function Stat({ label, value, href, tone }: { label: string; value: string | number; href?: string; tone?: "warn" | "deal" }) {
  const body = (
    <>
      <p className="text-xs font-medium text-ink-soft">{label}</p>
      <p className={`price mt-1 text-2xl font-bold ${tone === "warn" ? "text-warn" : tone === "deal" ? "text-deal" : "text-ink"}`}>{value}</p>
    </>
  );
  return href ? (
    <Link href={href} className="rounded-[var(--radius-card)] border border-line bg-surface p-4 hover:border-ink">
      {body}
    </Link>
  ) : (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">{body}</div>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await requireStaff("editor");
  const { error: pageError } = await searchParams;
  const supabase = await createClient();
  const isAdmin = hasRole(session, "admin");

  const [statsRes, recentProductsRes, recentOrdersRes] = await Promise.all([
    supabase.rpc("dashboard_stats"),
    supabase.from("products").select("id, name, status, price, sale_price, stock_quantity, created_at").order("created_at", { ascending: false }).limit(6),
    isAdmin
      ? supabase.from("orders").select("id, order_number, customer_name, total, status, created_at").order("created_at", { ascending: false }).limit(8)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const stats = (statsRes.data ?? {}) as Stats;
  const recentProducts = (recentProductsRes.data ?? []) as { id: string; name: string; status: ProductStatus; price: number; sale_price: number | null; stock_quantity: number; created_at: string }[];
  const recentOrders = (recentOrdersRes.data ?? []) as Pick<Order, "id" | "order_number" | "customer_name" | "total" | "status" | "created_at">[];

  return (
    <>
      <AdminPageHeader
        title="Dashboard"
        description="Store at a glance"
        actions={<ButtonLink href="/admin/products/new">Add product</ButtonLink>}
      />
      {pageError === "forbidden" ? (
        <p className="mb-4 rounded-lg bg-warn-tint p-3 text-sm text-warn" role="alert">
          Your role doesn&rsquo;t have access to that page.
        </p>
      ) : null}
      {statsRes.error ? (
        <p className="mb-4 rounded-lg bg-deal-tint p-3 text-sm text-deal" role="alert">
          Dashboard numbers couldn&rsquo;t be loaded. Check the database connection and refresh.
        </p>
      ) : null}

      <section aria-label="Catalog" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total products" value={stats.total_products ?? 0} href="/admin/products" />
        <Stat label="Active products" value={stats.active_products ?? 0} href="/admin/products?status=active" />
        <Stat label="Out of stock" value={stats.out_of_stock ?? 0} href="/admin/inventory?filter=out" tone={stats.out_of_stock ? "deal" : undefined} />
        <Stat label="Low stock" value={stats.low_stock ?? 0} href="/admin/inventory?filter=low" tone={stats.low_stock ? "warn" : undefined} />
      </section>

      {isAdmin ? (
        <section aria-label="Sales" className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Total orders" value={stats.total_orders ?? 0} href="/admin/orders" />
          <Stat label="Pending orders" value={stats.pending_orders ?? 0} href="/admin/orders?status=pending" tone={stats.pending_orders ? "warn" : undefined} />
          <Stat label="Completed orders" value={stats.completed_orders ?? 0} href="/admin/orders?status=delivered" />
          <Stat label="Total customers" value={stats.total_customers ?? 0} href="/admin/customers" />
          <Stat label="Total sales (excl. cancelled)" value={formatPrice(stats.total_sales ?? 0)} />
          <Stat label="Delivered sales" value={formatPrice(stats.delivered_sales ?? 0)} />
          <Stat label="Reviews waiting" value={stats.pending_reviews ?? 0} href="/admin/reviews?status=pending" />
          <Stat label="Draft products" value={stats.draft_products ?? 0} href="/admin/products?status=draft" />
        </section>
      ) : null}

      {isAdmin && stats.sales_by_day?.length ? (
        <section className="mt-6 rounded-[var(--radius-card)] border border-line bg-surface p-5" aria-labelledby="sales-h">
          <h2 id="sales-h" className="font-bold">
            Sales, last 14 days
          </h2>
          <p className="text-xs text-ink-mute">Order value per day, excluding cancelled orders</p>
          <div className="mt-3">
            <SalesChart data={stats.sales_by_day} />
          </div>
        </section>
      ) : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        {isAdmin ? (
          <section aria-labelledby="recent-orders-h">
            <div className="mb-2 flex items-center justify-between">
              <h2 id="recent-orders-h" className="font-bold">
                Recent orders
              </h2>
              <Link href="/admin/orders" className="text-sm font-semibold text-signal hover:underline">
                All orders
              </Link>
            </div>
            <div className={adminTable.wrap}>
              <table className={adminTable.table}>
                <thead>
                  <tr>
                    <th className={adminTable.th}>Order</th>
                    <th className={adminTable.th}>Customer</th>
                    <th className={adminTable.th}>Status</th>
                    <th className={`${adminTable.th} text-right`}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.length === 0 ? (
                    <tr>
                      <td colSpan={4} className={`${adminTable.td} text-center text-ink-mute`}>
                        No orders yet
                      </td>
                    </tr>
                  ) : (
                    recentOrders.map((o) => (
                      <tr key={o.id}>
                        <td className={adminTable.td}>
                          <Link href={`/admin/orders/${o.id}`} className="font-semibold hover:underline">
                            {o.order_number}
                          </Link>
                          <span className="block text-xs text-ink-mute">{formatDate(o.created_at, true)}</span>
                        </td>
                        <td className={adminTable.td}>{o.customer_name}</td>
                        <td className={adminTable.td}>
                          <Badge tone={orderStatusTone[o.status]}>{orderStatusLabel[o.status]}</Badge>
                        </td>
                        <td className={`${adminTable.td} price text-right font-semibold`}>{formatPrice(o.total)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <section aria-labelledby="recent-products-h">
          <div className="mb-2 flex items-center justify-between">
            <h2 id="recent-products-h" className="font-bold">
              Recently added products
            </h2>
            <Link href="/admin/products" className="text-sm font-semibold text-signal hover:underline">
              All products
            </Link>
          </div>
          <div className={adminTable.wrap}>
            <table className={adminTable.table}>
              <thead>
                <tr>
                  <th className={adminTable.th}>Product</th>
                  <th className={adminTable.th}>Status</th>
                  <th className={`${adminTable.th} text-right`}>Stock</th>
                  <th className={`${adminTable.th} text-right`}>Price</th>
                </tr>
              </thead>
              <tbody>
                {recentProducts.length === 0 ? (
                  <tr>
                    <td colSpan={4} className={`${adminTable.td} text-center text-ink-mute`}>
                      No products yet. <Link href="/admin/products/new" className="text-signal underline">Add the first one</Link>
                    </td>
                  </tr>
                ) : (
                  recentProducts.map((p) => (
                    <tr key={p.id}>
                      <td className={adminTable.td}>
                        <Link href={`/admin/products/${p.id}`} className="font-semibold hover:underline">
                          {p.name}
                        </Link>
                      </td>
                      <td className={adminTable.td}>{statusLabel[p.status]}</td>
                      <td className={`${adminTable.td} price text-right`}>{p.stock_quantity}</td>
                      <td className={`${adminTable.td} price text-right`}>{formatPrice(p.sale_price ?? p.price)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
