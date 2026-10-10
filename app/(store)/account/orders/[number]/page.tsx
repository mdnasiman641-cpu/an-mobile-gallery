import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/misc";
import { formatDate, formatPrice, isSvg, orderStatusLabel, orderStatusTone, paymentStatusLabel } from "@/lib/utils";
import type { Order, OrderItem } from "@/types";
import { ORDER_COLUMNS } from "@/lib/order-columns";
import { TrackingView } from "@/components/store/tracking-view";
import { customerStatus, type TrackingResult } from "@/lib/couriers";

const STEPS = ["pending", "confirmed", "processing", "shipped", "delivered"] as const;

export default async function AccountOrderDetailPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const user = await requireUser(`/account/orders/${number}`);
  const supabase = await createClient();
  const [{ data }, trackRes] = await Promise.all([
    supabase.from("orders").select(`${ORDER_COLUMNS}, order_items(*)`).eq("order_number", number).eq("user_id", user.id).maybeSingle(),
    // courier details (owner only, checked in the database); null before migration 0014
    /^[A-Z]{2,6}-\d{6}-\d{1,10}$/.test(number) ? supabase.rpc("track_order", { p_order_number: number }) : Promise.resolve({ data: null }),
  ]);
  if (!data) notFound();
  const tracking = (trackRes.data as TrackingResult | null) ?? null;
  // admin_note is not selected (staff-only)
  const order = data as unknown as Omit<Order, "admin_note"> & { order_items: OrderItem[] };
  const stepIndex = STEPS.indexOf(order.status as (typeof STEPS)[number]);

  return (
    <section aria-labelledby="order-h">
      <Link href="/account/orders" className="text-sm font-semibold text-signal hover:underline">
        All orders
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h2 id="order-h" className="text-lg font-bold">
          Order {order.order_number}
        </h2>
        {tracking ? (
          <Badge tone={customerStatus(tracking.status, tracking.shipment?.active ? tracking.shipment.status : null).tone}>
            {customerStatus(tracking.status, tracking.shipment?.active ? tracking.shipment.status : null).label}
          </Badge>
        ) : (
          <Badge tone={orderStatusTone[order.status]}>{orderStatusLabel[order.status]}</Badge>
        )}
      </div>
      <p className="text-sm text-ink-mute">Placed {formatDate(order.created_at, true)}</p>

      {tracking ? (
        <div className="mt-5">
          <TrackingView result={tracking} showItems={false} summary={false} />
        </div>
      ) : order.status !== "cancelled" ? (
        <ol className="mt-5 grid grid-cols-5 gap-1" aria-label="Order progress">
          {STEPS.map((s, i) => (
            <li key={s} className="text-center text-[11px] sm:text-xs">
              <span className={`block h-1.5 rounded-full ${i <= stepIndex ? "bg-signal" : "bg-line"}`} aria-hidden />
              <span className={`mt-1.5 block ${i <= stepIndex ? "font-semibold text-ink" : "text-ink-mute"}`}>
                {orderStatusLabel[s]}
                {i === stepIndex ? <span className="sr-only"> (current)</span> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      <ul className="mt-6 divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
        {order.order_items.map((i) => (
          <li key={i.id} className="flex gap-3 p-4">
            <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-paper">
              {i.image_url ? <Image src={i.image_url} alt="" fill sizes="64px" className="object-contain p-1" unoptimized={isSvg(i.image_url)} /> : null}
            </span>
            <span className="min-w-0 flex-1 text-sm">
              {i.product_slug ? (
                <Link href={`/products/${i.product_slug}`} className="font-semibold hover:underline">
                  {i.product_name}
                </Link>
              ) : (
                <span className="font-semibold">{i.product_name}</span>
              )}
              {i.variant_label ? <span className="block text-ink-mute">{i.variant_label}</span> : null}
              <span className="block text-ink-mute">
                {i.quantity} × {formatPrice(i.unit_price)}
              </span>
            </span>
            <span className="price text-sm font-semibold">{formatPrice(i.line_total)}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4 text-sm">
          <p className="font-semibold">Delivery</p>
          <p className="mt-1 text-ink-soft">{order.customer_name}</p>
          <p className="text-ink-soft">{order.phone}</p>
          <p className="text-ink-soft">{[order.address, order.area, order.city].filter(Boolean).join(", ")}</p>
        </div>
        <dl className="space-y-1.5 rounded-[var(--radius-card)] border border-line bg-surface p-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-soft">Subtotal</dt>
            <dd className="price">{formatPrice(order.subtotal)}</dd>
          </div>
          {Number(order.discount) > 0 ? (
            <div className="flex justify-between">
              <dt className="text-ink-soft">Discount {order.coupon_code ? `(${order.coupon_code})` : ""}</dt>
              <dd className="price text-deal">−{formatPrice(order.discount)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between">
            <dt className="text-ink-soft">Delivery</dt>
            <dd className="price">{Number(order.delivery_charge) ? formatPrice(order.delivery_charge) : "Free"}</dd>
          </div>
          <div className="flex justify-between border-t border-line pt-2 font-bold">
            <dt>Total</dt>
            <dd className="price">{formatPrice(order.total)}</dd>
          </div>
          <div className="flex justify-between text-ink-mute">
            <dt>Payment</dt>
            <dd>Cash on delivery, {paymentStatusLabel[order.payment_status].toLowerCase()}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
