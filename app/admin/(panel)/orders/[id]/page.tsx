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
import { ShipmentPanel } from "@/components/admin/shipment-panel";
import { SHIPMENT_COLUMNS, type ShipmentEventRow, type ShipmentRow } from "@/lib/couriers";

export const metadata: Metadata = { title: "Order" };

const ZONE = { inside_dhaka: "Inside Dhaka", outside_dhaka: "Outside Dhaka", store_pickup: "Store pickup" } as const;

export default async function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  await requireStaff("admin");
  const supabase = await createClient();
  // The staff note is not readable by customers, so it comes from a staff-only function.
  // Shipments are admin-only (RLS). Before migration 0014 these reads just return errors and the panel stays empty.
  const [{ data }, noteRes, shipRes, courierRes] = await Promise.all([
    supabase.from("orders").select(`${ORDER_COLUMNS}, order_items(*)`).eq("id", id).maybeSingle(),
    supabase.rpc("admin_order_note", { p_order_id: id }),
    supabase.from("shipments").select(SHIPMENT_COLUMNS).eq("order_id", id).order("created_at", { ascending: false }),
    supabase
      .from("courier_settings")
      .select("is_enabled, client_id, client_secret_hint, store_id, default_delivery_type, default_item_type, default_weight")
      .eq("provider", "pathao")
      .maybeSingle(),
  ]);
  if (!data) notFound();
  const shipments = (shipRes.data as ShipmentRow[] | null) ?? [];
  const eventsRes = shipments.length
    ? await supabase
        .from("shipment_events")
        .select("id, shipment_id, status, source, provider_status, note, occurred_at")
        .in(
          "shipment_id",
          shipments.map((s) => s.id),
        )
        .order("occurred_at", { ascending: false })
        .limit(100)
    : null;
  const events = (eventsRes?.data as ShipmentEventRow[] | null) ?? [];
  const courier = courierRes.data as {
    is_enabled: boolean;
    client_id: string | null;
    client_secret_hint: string | null;
    store_id: number | null;
    default_delivery_type: 12 | 24 | 48;
    default_item_type: 1 | 2 | 3;
    default_weight: number | string;
  } | null;
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

          {shipRes.error ? (
            <p className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface p-4 text-sm text-ink-soft">
              Shipments and tracking need database migration 0014. Run it in Supabase (see docs/DEPLOY-CLOUDFLARE.md).
            </p>
          ) : (
            <ShipmentPanel
              orderId={o.id}
              orderNumber={o.order_number}
              orderStatus={o.status}
              orderTotal={Number(o.total)}
              paid={o.payment_status === "paid"}
              itemCount={o.order_items.reduce((n, i) => n + i.quantity, 0)}
              itemSummary={o.order_items.map((i) => `${i.quantity}× ${i.product_name}${i.variant_label ? ` (${i.variant_label})` : ""}`).join(", ")}
              shipments={shipments}
              events={events}
              pathao={{
                available: Boolean(courier?.is_enabled && courier.client_id && courier.client_secret_hint && courier.store_id),
                deliveryType: courier?.default_delivery_type ?? 48,
                itemType: courier?.default_item_type ?? 2,
                weight: Number(courier?.default_weight ?? 0.5),
              }}
            />
          )}
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
