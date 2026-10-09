import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminPageHeader, adminTable } from "@/components/admin/page-header";
import { OrderStatusForm } from "@/components/admin/order-status-form";
import { Badge } from "@/components/ui/misc";
import { formatDate, formatPrice, isSvg, orderStatusLabel, orderStatusTone, whatsappLink } from "@/lib/utils";
import type { Order, OrderItem } from "@/types";
import { ORDER_COLUMNS } from "@/lib/order-columns";

export const metadata: Metadata = { title: "Order" };

const ZONE = { inside_dhaka: "Inside Dhaka", outside_dhaka: "Outside Dhaka", store_pickup: "Store pickup" } as const;

export default async function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  await requireStaff("admin");
  const supabase = await createClient();
  // The staff note is not readable by customers, so it comes from a staff-only function.
  const [{ data }, noteRes] = await Promise.all([
    supabase.from("orders").select(`${ORDER_COLUMNS}, order_items(*)`).eq("id", id).maybeSingle(),
    supabase.rpc("admin_order_note", { p_order_id: id }),
  ]);
  if (!data) notFound();
  const o = { ...(data as unknown as Order), admin_note: (noteRes.data as string | null) ?? null } as Order & { order_items: OrderItem[] };
  const wa = whatsappLink(o.phone, `Hello ${o.customer_name}, this is about your order ${o.order_number}.`);

  return (
    <>
      <AdminPageHeader
        title={`Order ${o.order_number}`}
        description={`Placed ${formatDate(o.created_at, true)}`}
        back={{ href: "/admin/orders", label: "Orders" }}
        actions={<Badge tone={orderStatusTone[o.status]}>{orderStatusLabel[o.status]}</Badge>}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <div className={adminTable.wrap}>
            <table className={adminTable.table}>
              <thead>
                <tr>
                  <th className={adminTable.th}>Item</th>
                  <th className={`${adminTable.th} text-right`}>Unit price</th>
                  <th className={`${adminTable.th} text-right`}>Qty</th>
                  <th className={`${adminTable.th} text-right`}>Total</th>
                </tr>
              </thead>
              <tbody>
                {o.order_items.map((i) => (
                  <tr key={i.id}>
                    <td className={adminTable.td}>
                      <div className="flex items-center gap-3">
                        <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-paper">
                          {i.image_url ? <Image src={i.image_url} alt="" fill sizes="48px" className="object-contain p-1" unoptimized={isSvg(i.image_url)} /> : null}
                        </span>
                        <span>
                          {i.product_id ? (
                            <Link href={`/admin/products/${i.product_id}`} className="font-semibold hover:underline">
                              {i.product_name}
                            </Link>
                          ) : (
                            <span className="font-semibold">{i.product_name}</span>
                          )}
                          <span className="block text-xs text-ink-mute">
                            {[i.variant_label, i.sku].filter(Boolean).join(", ")}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className={`${adminTable.td} price text-right`}>{formatPrice(i.unit_price)}</td>
                    <td className={`${adminTable.td} price text-right`}>{i.quantity}</td>
                    <td className={`${adminTable.td} price text-right font-semibold`}>{formatPrice(i.line_total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="text-sm">
                <tr>
                  <td colSpan={3} className="px-3 py-2 text-right text-ink-soft">Subtotal</td>
                  <td className="price px-3 py-2 text-right">{formatPrice(o.subtotal)}</td>
                </tr>
                {Number(o.discount) > 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-2 text-right text-ink-soft">Discount {o.coupon_code ? `(${o.coupon_code})` : ""}</td>
                    <td className="price px-3 py-2 text-right text-deal">−{formatPrice(o.discount)}</td>
                  </tr>
                ) : null}
                <tr>
                  <td colSpan={3} className="px-3 py-2 text-right text-ink-soft">Delivery ({ZONE[o.delivery_zone]})</td>
                  <td className="price px-3 py-2 text-right">{formatPrice(o.delivery_charge)}</td>
                </tr>
                <tr className="text-base font-bold">
                  <td colSpan={3} className="px-3 py-3 text-right">Total to collect</td>
                  <td className="price px-3 py-3 text-right">{formatPrice(o.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5" aria-labelledby="cust-h">
              <h2 id="cust-h" className="font-bold">Customer</h2>
              <p className="mt-2">{o.customer_name}</p>
              <p>
                <a href={`tel:${o.phone}`} className="font-semibold text-signal hover:underline">
                  {o.phone}
                </a>
                {wa ? (
                  <a href={wa} target="_blank" rel="noopener noreferrer" className="ml-3 text-sm text-signal underline">
                    WhatsApp
                  </a>
                ) : null}
              </p>
              {o.email ? <p className="text-sm text-ink-soft">{o.email}</p> : null}
              {o.customer_id ? (
                <Link href={`/admin/customers?q=${encodeURIComponent(o.phone)}`} className="mt-2 inline-block text-sm text-signal underline">
                  Customer history
                </Link>
              ) : null}
            </section>
            <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5" aria-labelledby="addr-h">
              <h2 id="addr-h" className="font-bold">Delivery</h2>
              <p className="mt-2 whitespace-pre-line">{o.address}</p>
              <p className="text-sm text-ink-soft">{[o.area, o.city].filter(Boolean).join(", ")}</p>
              <p className="mt-1 text-sm text-ink-soft">{ZONE[o.delivery_zone]}, Cash on delivery</p>
              {o.note ? (
                <p className="mt-3 rounded-lg bg-taka-tint p-2.5 text-sm">
                  <span className="font-semibold">Customer note:</span> {o.note}
                </p>
              ) : null}
            </section>
          </div>
        </div>

        <aside className="h-fit rounded-[var(--radius-card)] border border-line bg-surface p-5" aria-label="Update order">
          <h2 className="mb-4 font-bold">Update order</h2>
          <OrderStatusForm id={o.id} status={o.status} paymentStatus={o.payment_status} adminNote={o.admin_note} />
          <p className="mt-4 text-xs text-ink-mute">Last updated {formatDate(o.updated_at, true)}</p>
        </aside>
      </div>
    </>
  );
}
