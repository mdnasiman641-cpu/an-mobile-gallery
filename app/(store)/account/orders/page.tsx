import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, EmptyState } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { formatDate, formatPrice, orderStatusLabel, orderStatusTone as statusTone } from "@/lib/utils";
import type { Order } from "@/types";

export default async function AccountOrdersPage() {
  const user = await requireUser("/account/orders");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select("id, order_number, status, total, created_at, order_items(count)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const orders = (data ?? []) as (Pick<Order, "id" | "order_number" | "status" | "total" | "created_at"> & {
    order_items: { count: number }[];
  })[];

  return (
    <section aria-labelledby="orders-h">
      <h2 id="orders-h" className="mb-4 text-lg font-bold">
        Orders
      </h2>
      {error ? (
        <p className="text-deal">Your orders couldn&rsquo;t be loaded. Please refresh the page.</p>
      ) : orders.length === 0 ? (
        <EmptyState
          title="No orders yet"
          description="Orders placed while signed in, or with the mobile number on your profile, appear here."
          action={<ButtonLink href="/products">Start shopping</ButtonLink>}
        />
      ) : (
        <ul className="space-y-2">
          {orders.map((o) => (
            <li key={o.id}>
              <Link
                href={`/account/orders/${o.order_number}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 hover:border-ink"
              >
                <span>
                  <span className="block font-semibold">{o.order_number}</span>
                  <span className="text-sm text-ink-mute">
                    {formatDate(o.created_at)}, {o.order_items[0]?.count ?? 0} item(s)
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <Badge tone={statusTone[o.status]}>{orderStatusLabel[o.status]}</Badge>
                  <span className="price font-bold">{formatPrice(o.total)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
