"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/components/providers";
import { checkCouponAction, placeOrderAction, refreshCartAction, type OrderConfirmation } from "@/app/(store)/checkout/actions";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { cn, formatPrice, isSvg } from "@/lib/utils";
import type { DeliveryZone } from "@/types";

interface Props {
  deliveryInside: number;
  deliveryOutside: number;
  freeThreshold: number;
  storeName: string;
  phone: string | null;
  prefill: { name: string; phone: string; email: string; address: string; city: string; area: string };
}

const ZONES: { value: DeliveryZone; label: string; labelBn: string }[] = [
  { value: "inside_dhaka", label: "Inside Dhaka", labelBn: "ঢাকার ভিতরে" },
  { value: "outside_dhaka", label: "Outside Dhaka", labelBn: "ঢাকার বাইরে" },
  { value: "store_pickup", label: "Pick up from shop", labelBn: "দোকান থেকে নেব" },
];

export function CheckoutForm({ deliveryInside, deliveryOutside, freeThreshold, storeName, phone, prefill }: Props) {
  const { items, ready, subtotal, clear, syncItems } = useStore();
  const [priceNotice, setPriceNotice] = useState(false);
  const checkedPrices = useRef(false);

  // Once per visit: replace browser-saved prices/stock with current values.
  useEffect(() => {
    if (!ready || checkedPrices.current || items.length === 0) return;
    checkedPrices.current = true;
    refreshCartAction(items.map((i) => ({ key: i.key, productId: i.productId, variantId: i.variantId }))).then((lines) => {
      if (lines.length && syncItems(lines)) setPriceNotice(true);
    });
  }, [ready, items, syncItems]);
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [zone, setZone] = useState<DeliveryZone>("inside_dhaka");
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<{ code: string; discount: number } | null>(null);
  const [couponMsg, setCouponMsg] = useState<string | null>(null);
  const [checkingCoupon, setCheckingCoupon] = useState(false);
  const [confirmation, setConfirmation] = useState<OrderConfirmation | null>(null);

  if (confirmation) {
    return (
      <div className="mx-auto mt-6 max-w-xl rounded-[var(--radius-card)] border border-line bg-surface p-6 text-center sm:p-8" role="status">
        <CheckCircle2 className="mx-auto h-12 w-12 text-signal" aria-hidden />
        <h2 className="mt-3 text-2xl font-bold">Order placed</h2>
        <p className="bn mt-1 text-ink-soft">আপনার অর্ডার গ্রহণ করা হয়েছে</p>
        <p className="mt-4 text-ink-soft">
          Your order number is <strong className="text-ink">{confirmation.order_number}</strong>. We&rsquo;ll call you to confirm before delivery.
        </p>
        <dl className="mx-auto mt-5 max-w-xs space-y-1.5 text-left text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-soft">Subtotal</dt>
            <dd className="price">{formatPrice(confirmation.subtotal)}</dd>
          </div>
          {confirmation.discount > 0 ? (
            <div className="flex justify-between">
              <dt className="text-ink-soft">Discount</dt>
              <dd className="price text-deal">−{formatPrice(confirmation.discount)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between">
            <dt className="text-ink-soft">Delivery</dt>
            <dd className="price">{confirmation.delivery_charge ? formatPrice(confirmation.delivery_charge) : "Free"}</dd>
          </div>
          <div className="flex justify-between border-t border-line pt-2 text-base font-bold">
            <dt>Pay on delivery</dt>
            <dd className="price">{formatPrice(confirmation.total)}</dd>
          </div>
        </dl>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <ButtonLink href="/products" variant="outline">
            Continue shopping
          </ButtonLink>
          <ButtonLink href="/account/orders">View my orders</ButtonLink>
        </div>
        {phone ? (
          <p className="mt-4 text-sm text-ink-mute">
            Questions? Call {storeName} at <a href={`tel:${phone}`} className="font-semibold text-ink underline">{phone}</a>
          </p>
        ) : null}
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]" aria-busy="true">
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        className="mt-6"
        title="Your cart is empty"
        description="Add a product to your cart before checking out."
        action={<ButtonLink href="/products">Browse phones</ButtonLink>}
      />
    );
  }

  const discount = coupon ? Math.min(coupon.discount, subtotal) : 0;
  const baseDelivery = zone === "store_pickup" ? 0 : zone === "outside_dhaka" ? deliveryOutside : deliveryInside;
  const delivery = freeThreshold > 0 && subtotal - discount >= freeThreshold ? 0 : baseDelivery;
  const total = subtotal - discount + delivery;

  async function applyCoupon() {
    setCheckingCoupon(true);
    const res = await checkCouponAction(couponInput, subtotal);
    setCheckingCoupon(false);
    setCouponMsg(res.message ?? null);
    setCoupon(res.ok && res.data ? res.data : null);
  }

  function submit(form: FormData) {
    setFormError(null);
    const payload = {
      customer_name: String(form.get("customer_name") ?? ""),
      phone: String(form.get("phone") ?? ""),
      email: String(form.get("email") ?? ""),
      address: String(form.get("address") ?? ""),
      city: String(form.get("city") ?? ""),
      area: String(form.get("area") ?? ""),
      delivery_zone: zone,
      note: String(form.get("note") ?? ""),
      coupon_code: coupon?.code ?? "",
      items: items.map((i) => ({ product_id: i.productId, variant_id: i.variantId, quantity: i.quantity, slug: i.slug })),
    };
    startTransition(async () => {
      const res = await placeOrderAction(payload);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        setFormError(res.message ?? "Please check your details.");
        toast.error(res.message ?? "Order not placed.");
        return;
      }
      setErrors({});
      clear();
      setConfirmation(res.data!);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  return (
    <form action={submit} className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]" noValidate>
      <div className="space-y-6">
        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5" aria-labelledby="contact-h">
          <h2 id="contact-h" className="text-lg font-bold">
            Your details
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="customer_name" error={errors.customer_name} required>
              <Input id="customer_name" name="customer_name" autoComplete="name" defaultValue={prefill.name} aria-invalid={Boolean(errors.customer_name)} required />
            </Field>
            <Field label="Mobile number" htmlFor="phone" error={errors.phone} hint="We call this number to confirm your order" required>
              <Input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="01XXXXXXXXX"
                defaultValue={prefill.phone}
                aria-invalid={Boolean(errors.phone)}
                required
              />
            </Field>
            <Field label="Email (optional)" htmlFor="email" error={errors.email} className="sm:col-span-2">
              <Input id="email" name="email" type="email" autoComplete="email" defaultValue={prefill.email} aria-invalid={Boolean(errors.email)} />
            </Field>
          </div>
        </section>

        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5" aria-labelledby="delivery-h">
          <h2 id="delivery-h" className="text-lg font-bold">
            Delivery
          </h2>
          <fieldset className="mt-4">
            <legend className="sr-only">Delivery area</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {ZONES.map((z) => {
                const fee = z.value === "store_pickup" ? 0 : z.value === "outside_dhaka" ? deliveryOutside : deliveryInside;
                return (
                  <label
                    key={z.value}
                    className={cn(
                      "flex cursor-pointer flex-col rounded-[var(--radius-control)] border p-3",
                      zone === z.value ? "border-ink ring-1 ring-ink" : "border-line-strong hover:border-ink",
                    )}
                  >
                    <input type="radio" name="zone" value={z.value} checked={zone === z.value} onChange={() => setZone(z.value)} className="sr-only" />
                    <span className="text-sm font-semibold">{z.label}</span>
                    <span className="bn text-xs text-ink-mute">{z.labelBn}</span>
                    <span className="price mt-1 text-sm">{fee ? formatPrice(fee) : "Free"}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          {zone !== "store_pickup" ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Full address" htmlFor="address" error={errors.address} className="sm:col-span-2" required>
                <Textarea
                  id="address"
                  name="address"
                  rows={3}
                  autoComplete="street-address"
                  placeholder="House, road, area"
                  defaultValue={prefill.address}
                  aria-invalid={Boolean(errors.address)}
                  required
                />
              </Field>
              <Field label="District / City" htmlFor="city" error={errors.city}>
                <Input id="city" name="city" autoComplete="address-level2" defaultValue={prefill.city} />
              </Field>
              <Field label="Thana / Area" htmlFor="area" error={errors.area}>
                <Input id="area" name="area" autoComplete="address-level3" defaultValue={prefill.area} />
              </Field>
            </div>
          ) : (
            <input type="hidden" name="address" value="Store pickup" />
          )}
          <Field label="Note for the shop (optional)" htmlFor="note" className="mt-4">
            <Textarea id="note" name="note" rows={2} placeholder="e.g. call before coming, preferred delivery time" />
          </Field>
        </section>

        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5" aria-labelledby="payment-h">
          <h2 id="payment-h" className="text-lg font-bold">
            Payment
          </h2>
          <p className="mt-3 flex items-center gap-3 rounded-[var(--radius-control)] border border-ink p-3 text-sm ring-1 ring-ink">
            <span className="h-4 w-4 rounded-full border-[5px] border-ink" aria-hidden />
            <span>
              <span className="font-semibold">Cash on delivery</span>
              <span className="block text-ink-soft">Pay when you receive the product.</span>
            </span>
          </p>
        </section>
      </div>

      <aside className="h-fit rounded-[var(--radius-card)] border border-line bg-surface p-5 lg:sticky lg:top-40" aria-label="Order summary">
        <h2 className="text-lg font-bold">Your order</h2>
        {priceNotice ? (
          <p className="mt-3 rounded-lg bg-warn-tint p-3 text-sm text-warn" role="status">
            Some prices or stock changed since you added these items. Your order has been updated to the current prices.
          </p>
        ) : null}
        <ul className="mt-4 space-y-3">
          {items.map((i) => (
            <li key={i.key} className="flex gap-3">
              <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-paper">
                {i.image ? <Image src={i.image} alt="" fill sizes="56px" className="object-contain p-1" unoptimized={isSvg(i.image)} /> : null}
              </span>
              <span className="min-w-0 flex-1 text-sm">
                <span className="line-clamp-2 font-medium">{i.name}</span>
                {i.variantLabel ? <span className="block text-ink-mute">{i.variantLabel}</span> : null}
                <span className="text-ink-mute">Qty {i.quantity}</span>
              </span>
              <span className="price shrink-0 text-sm font-semibold">{formatPrice(i.price * i.quantity)}</span>
            </li>
          ))}
        </ul>

        <div className="mt-5 border-t border-line pt-4">
          <label htmlFor="coupon" className="text-sm font-medium">
            Coupon code
          </label>
          <div className="mt-1.5 flex gap-2">
            <Input
              id="coupon"
              value={couponInput}
              onChange={(e) => {
                setCouponInput(e.target.value.toUpperCase());
                setCoupon(null);
                setCouponMsg(null);
              }}
              className="h-10 uppercase"
              autoComplete="off"
            />
            <Button type="button" variant="outline" size="sm" className="h-10" onClick={applyCoupon} loading={checkingCoupon} disabled={!couponInput.trim()}>
              Apply
            </Button>
          </div>
          {couponMsg ? <p className={cn("mt-1.5 text-sm", coupon ? "text-signal-dark" : "text-deal")}>{couponMsg}</p> : null}
        </div>

        <dl className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-soft">Subtotal</dt>
            <dd className="price">{formatPrice(subtotal)}</dd>
          </div>
          {discount > 0 ? (
            <div className="flex justify-between">
              <dt className="text-ink-soft">Discount ({coupon?.code})</dt>
              <dd className="price text-deal">−{formatPrice(discount)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between">
            <dt className="text-ink-soft">Delivery</dt>
            <dd className="price">{delivery ? formatPrice(delivery) : "Free"}</dd>
          </div>
          <div className="flex justify-between border-t border-line pt-3 text-base font-bold">
            <dt>Total</dt>
            <dd className="price">{formatPrice(total)}</dd>
          </div>
        </dl>

        {formError ? (
          <p className="mt-4 rounded-lg bg-deal-tint p-3 text-sm text-deal" role="alert">
            {formError}
          </p>
        ) : null}

        <Button type="submit" size="lg" className="mt-4 w-full" loading={pending}>
          Place order
        </Button>
        <p className="mt-3 text-center text-xs text-ink-mute">
          By placing the order you agree to our{" "}
          <Link href="/pages/warranty-and-returns" className="underline">
            warranty &amp; return policy
          </Link>
          .
        </p>
      </aside>
    </form>
  );
}
