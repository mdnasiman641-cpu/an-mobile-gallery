"use client";

import Link from "next/link";
import Image from "next/image";
import { Minus, Plus, Trash2 } from "lucide-react";
import { useStore } from "@/components/providers";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { formatPrice, isSvg } from "@/lib/utils";

export function CartView({ insideDhaka, freeThreshold }: { insideDhaka: number; freeThreshold: number }) {
  const { items, ready, subtotal, updateQuantity, removeItem } = useStore();

  if (!ready) {
    return (
      <div className="mt-6 space-y-3" aria-busy="true" aria-label="Loading cart">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        className="mt-6"
        title="Your cart is empty"
        description="Find a phone you like and tap “Add to cart”."
        action={<ButtonLink href="/products">Browse phones</ButtonLink>}
      />
    );
  }

  const freeDelivery = freeThreshold > 0 && subtotal >= freeThreshold;

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.key} className="flex gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-3 sm:gap-4 sm:p-4">
            <Link href={`/products/${item.slug}`} className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-paper sm:h-24 sm:w-24">
              {item.image ? (
                <Image src={item.image} alt={item.name} fill sizes="96px" className="object-contain p-2" unoptimized={isSvg(item.image)} />
              ) : null}
            </Link>
            <div className="flex min-w-0 flex-1 flex-col">
              <Link href={`/products/${item.slug}`} className="line-clamp-2 font-semibold text-ink hover:underline">
                {item.name}
              </Link>
              {item.variantLabel ? <p className="text-sm text-ink-soft">{item.variantLabel}</p> : null}
              <p className="price mt-1 font-semibold">{formatPrice(item.price)}</p>
              <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                <div className="flex items-center rounded-[var(--radius-control)] border border-line-strong" role="group" aria-label={`Quantity of ${item.name}`}>
                  <button
                    type="button"
                    className="flex h-9 w-9 items-center justify-center disabled:opacity-40"
                    onClick={() => updateQuantity(item.key, item.quantity - 1)}
                    disabled={item.quantity <= 1}
                    aria-label="Decrease quantity"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="price w-8 text-center text-sm font-semibold">{item.quantity}</span>
                  <button
                    type="button"
                    className="flex h-9 w-9 items-center justify-center disabled:opacity-40"
                    onClick={() => updateQuantity(item.key, item.quantity + 1)}
                    disabled={item.quantity >= Math.min(item.maxQuantity, 10)}
                    aria-label="Increase quantity"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => removeItem(item.key)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm text-ink-soft hover:bg-deal-tint hover:text-deal"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                  Remove
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <aside className="h-fit rounded-[var(--radius-card)] border border-line bg-surface p-5 lg:sticky lg:top-40" aria-label="Order summary">
        <h2 className="text-lg font-bold">Order summary</h2>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-soft">Subtotal</dt>
            <dd className="price font-semibold">{formatPrice(subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-soft">Delivery</dt>
            <dd className="price">{freeDelivery ? "Free" : `from ${formatPrice(insideDhaka)}`}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-ink-mute">Coupon codes and the exact delivery charge are applied at checkout.</p>
        <ButtonLink href="/checkout" size="lg" className="mt-4 w-full">
          Checkout
        </ButtonLink>
        <Link href="/products" className="mt-3 block text-center text-sm font-semibold text-signal hover:underline">
          Continue shopping
        </Link>
      </aside>
    </div>
  );
}
