import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { escapeFilter } from "@/services/admin";
import { AdminFilterBar, AdminPageHeader, adminTable } from "@/components/admin/page-header";
import { Badge, EmptyState, Pagination } from "@/components/ui/misc";
import { Input, Select } from "@/components/ui/form";
import { formatDate, formatPrice, orderStatusLabel, orderStatusTone, paymentStatusLabel } from "@/lib/utils";
import { buildListingHref } from "@/lib/listing";
import type { Order } from "@/types";

export const metadata: Metadata = { title: "Orders" };
const PER_PAGE = 25;
const STATUSES = ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled"] as const;

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireStaff("admin");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();

  let query = supabase
    .from("orders")
    .select("id, order_number, customer_name, phone, total, status, payment_status, delivery_zone, created_at, order_items(count)", { count: "exact" });
  const q = escapeFilter(sp.q ?? "");
  if (q) query = query.or(`order_number.ilike.%${q}%,customer_name.ilike.%${q}%,phone.ilike.%${q}%`);
  if (sp.status && (STATUSES as readonly string[]).includes(sp.status)) query = query.eq("status", sp.status);
  if (sp.payment) query = query.eq("payment_status", sp.payment);
  if (sp.from) query = query.gte("created_at", `${sp.from}T00:00:00+06:00`);
  if (sp.to) query = query.lte("created_at", `${sp.to}T23:59:59+06:00`);

  const { data, count, error } = await query.order("created_at", { ascending: false }).range((page - 1) * PER_PAGE, page * PER_PAGE - 1);
  const orders = (data ?? []) as (Pick<Order, "id" | "order_number" | "customer_name" | "phone" | "total" | "status" | "payment_status" | "delivery_zone" | "created_at"> & {
    order_items: { count: number }[];
  })[];

  return (
    <>
      <AdminPageHeader title="Orders" description={`${count ?? 0} order${count === 1 ? "" : "s"}`} />
      <nav aria-label="Order status" className="no-scrollbar mb-3 flex gap-1 overflow-x-auto">
        {[{ value: "", label: "All" }, ...STATUSES.map((s) => ({ value: s, label: orderStatusLabel[s] }))].map((s) => (
          <Link
            key={s.value}
            href={s.value ? `/admin/orders?status=${s.value}` : "/admin/orders"}
            aria-current={(sp.status ?? "") === s.value ? "page" : undefined}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold ${(sp.status ?? "") === s.value ? "bg-ink text-white" : "bg-surface text-ink-soft ring-1 ring-line hover:text-ink"}`}
          >
            {s.label}
          </Link>
        ))}
      </nav>
      <AdminFilterBar>
        {sp.status ? <input type="hidden" name="status" value={sp.status} /> : null}
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs font-medium text-ink-soft">
          Search
          <Input name="q" defaultValue={sp.q} placeholder="Order number, name or phone" className="h-10" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          Payment
          <Select name="payment" defaultValue={sp.payment ?? ""} className="h-10">
            <option value="">Any</option>
            <option value="unpaid">Unpaid</option>
            <option value="paid">Paid</option>
            <option value="partially_paid">Partially paid</option>
            <option value="refunded">Refunded</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          From
          <Input type="date" name="from" defaultValue={sp.from} className="h-10" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          To
          <Input type="date" name="to" defaultValue={sp.to} className="h-10" />
        </label>
      </AdminFilterBar>

      {error ? (
        <p className="rounded-lg bg-deal-tint p-3 text-sm text-deal" role="alert">
          Orders couldn&rsquo;t be loaded. Refresh to try again.
        </p>
      ) : orders.length === 0 ? (
        <EmptyState title="No orders found" description="New orders from the website appear here." />
      ) : (
        <>
          <div className={adminTable.wrap}>
            <table className={adminTable.table}>
              <thead>
                <tr>
                  <th className={adminTable.th}>Order</th>
                  <th className={adminTable.th}>Customer</th>
                  <th className={adminTable.th}>Items</th>
                  <th className={adminTable.th}>Status</th>
                  <th className={adminTable.th}>Payment</th>
                  <th className={`${adminTable.th} text-right`}>Total</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td className={adminTable.td}>
                      <Link href={`/admin/orders/${o.id}`} className="font-semibold hover:underline">
                        {o.order_number}
                      </Link>
                      <span className="block text-xs text-ink-mute">{formatDate(o.created_at, true)}</span>
                    </td>
                    <td className={adminTable.td}>
                      {o.customer_name}
                      <a href={`tel:${o.phone}`} className="block text-xs text-ink-mute hover:underline">
                        {o.phone}
                      </a>
                    </td>
                    <td className={`${adminTable.td} price`}>{o.order_items[0]?.count ?? 0}</td>
                    <td className={adminTable.td}>
                      <Badge tone={orderStatusTone[o.status]}>{orderStatusLabel[o.status]}</Badge>
                    </td>
                    <td className={`${adminTable.td} text-xs`}>{paymentStatusLabel[o.payment_status]}</td>
                    <td className={`${adminTable.td} price text-right font-semibold`}>{formatPrice(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={Math.ceil((count ?? 0) / PER_PAGE)} buildHref={(n) => buildListingHref("/admin/orders", sp, { page: n })} />
        </>
      )}
    </>
  );
}
