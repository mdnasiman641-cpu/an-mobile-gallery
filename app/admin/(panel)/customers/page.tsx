import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { escapeFilter } from "@/services/admin";
import { AdminFilterBar, AdminPageHeader, adminTable } from "@/components/admin/page-header";
import { Badge, EmptyState, Pagination } from "@/components/ui/misc";
import { Input } from "@/components/ui/form";
import { formatDate, formatPrice } from "@/lib/utils";
import { buildListingHref } from "@/lib/listing";

export const metadata: Metadata = { title: "Customers" };
const PER_PAGE = 25;

interface Row {
  id: string;
  user_id: string | null;
  full_name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  created_at: string;
  orders: { id: string; order_number: string; total: number; status: string; created_at: string }[];
}

export default async function AdminCustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireStaff("admin");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();

  let query = supabase
    .from("customers")
    .select("id, user_id, full_name, phone, email, city, created_at, orders(id, order_number, total, status, created_at)", { count: "exact" });
  const q = escapeFilter(sp.q ?? "");
  if (q) query = query.or(`full_name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`);
  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .order("created_at", { referencedTable: "orders", ascending: false })
    .range((page - 1) * PER_PAGE, page * PER_PAGE - 1);
  const rows = (data ?? []) as Row[];

  return (
    <>
      <AdminPageHeader title="Customers" description={`${count ?? 0} customer${count === 1 ? "" : "s"}, including guest buyers`} />
      <AdminFilterBar>
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs font-medium text-ink-soft">
          Search
          <Input name="q" defaultValue={sp.q} placeholder="Name, phone or email" className="h-10" />
        </label>
      </AdminFilterBar>
      {error ? (
        <p className="rounded-lg bg-deal-tint p-3 text-sm text-deal" role="alert">
          Customers couldn&rsquo;t be loaded.
        </p>
      ) : rows.length === 0 ? (
        <EmptyState title="No customers found" description="Customers are added automatically when they register or place an order." />
      ) : (
        <>
          <div className={adminTable.wrap}>
            <table className={adminTable.table}>
              <thead>
                <tr>
                  <th className={adminTable.th}>Customer</th>
                  <th className={adminTable.th}>Contact</th>
                  <th className={`${adminTable.th} text-right`}>Orders</th>
                  <th className={`${adminTable.th} text-right`}>Spent</th>
                  <th className={adminTable.th}>Last order</th>
                  <th className={adminTable.th}>Since</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const valid = c.orders.filter((o) => o.status !== "cancelled");
                  const spent = valid.reduce((n, o) => n + Number(o.total), 0);
                  const last = c.orders[0];
                  return (
                    <tr key={c.id}>
                      <td className={adminTable.td}>
                        <span className="font-semibold">{c.full_name || "—"}</span>
                        <span className="mt-0.5 block">
                          <Badge tone={c.user_id ? "signal" : "neutral"}>{c.user_id ? "Account" : "Guest"}</Badge>
                        </span>
                      </td>
                      <td className={adminTable.td}>
                        {c.phone ? (
                          <a href={`tel:${c.phone}`} className="hover:underline">
                            {c.phone}
                          </a>
                        ) : (
                          "—"
                        )}
                        {c.email ? <span className="block text-xs text-ink-mute">{c.email}</span> : null}
                        {c.city ? <span className="block text-xs text-ink-mute">{c.city}</span> : null}
                      </td>
                      <td className={`${adminTable.td} price text-right`}>{c.orders.length}</td>
                      <td className={`${adminTable.td} price text-right font-semibold`}>{formatPrice(spent)}</td>
                      <td className={adminTable.td}>
                        {last ? (
                          <Link href={`/admin/orders/${last.id}`} className="text-signal hover:underline">
                            {last.order_number}
                          </Link>
                        ) : (
                          <span className="text-ink-mute">None</span>
                        )}
                      </td>
                      <td className={`${adminTable.td} text-xs text-ink-mute`}>{formatDate(c.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={Math.ceil((count ?? 0) / PER_PAGE)} buildHref={(n) => buildListingHref("/admin/customers", sp, { page: n })} />
        </>
      )}
    </>
  );
}
