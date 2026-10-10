"use client";

import { useRef, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { trackOrderAction } from "@/app/(store)/track/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { TrackingView } from "@/components/store/tracking-view";
import type { TrackingResult } from "@/lib/couriers";

export function TrackOrderForm({ phone: shopPhone }: { phone: string | null }) {
  const params = useSearchParams();
  const initialOrder = (params.get("order") ?? "").toUpperCase().slice(0, 30);
  const [order, setOrder] = useState(/^[A-Z0-9-]+$/.test(initialOrder) ? initialOrder : "");
  const [phone, setPhone] = useState("");
  const [result, setResult] = useState<TrackingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const resultRef = useRef<HTMLDivElement>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    start(async () => {
      const res = await trackOrderAction({ order_number: order, phone });
      if (res.ok && res.data) {
        setResult(res.data);
        requestAnimationFrame(() => resultRef.current?.focus());
      } else {
        setResult(null);
        setError(res.message ?? "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div className="mt-6 grid max-w-2xl gap-6">
      <form onSubmit={submit} className="grid gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:grid-cols-2" noValidate>
        <Field label="Order number" htmlFor="trk-order" hint="e.g. AMG-261010-1001">
          <Input
            id="trk-order"
            value={order}
            onChange={(e) => setOrder(e.target.value.toUpperCase())}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={30}
            required
          />
        </Field>
        <Field label="Mobile number" htmlFor="trk-phone" hint="The number used for the order">
          <Input id="trk-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} placeholder="01XXXXXXXXX" required />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" loading={pending} disabled={!order.trim() || !phone.trim()} className="w-full sm:w-auto">
            {pending ? null : <Search className="h-4 w-4" aria-hidden />}
            {pending ? "Checking…" : "Track order"}
          </Button>
        </div>
      </form>

      <div aria-live="polite">
        {error ? (
          <div className="rounded-[var(--radius-card)] border border-deal/30 bg-deal-tint p-4 text-sm" role="alert">
            <p className="font-semibold text-deal">{error}</p>
            {shopPhone ? (
              <p className="mt-1 text-ink-soft">
                Need help? Call{" "}
                <a href={`tel:${shopPhone}`} className="font-semibold text-ink underline">
                  {shopPhone}
                </a>
                .
              </p>
            ) : null}
          </div>
        ) : null}
        {result ? (
          <div ref={resultRef} tabIndex={-1} className="rounded-[var(--radius-card)] border border-line bg-surface p-5 outline-none">
            <TrackingView result={result} />
          </div>
        ) : null}
        {pending && !result ? <div className="skeleton h-40 rounded-[var(--radius-card)]" aria-hidden /> : null}
      </div>
    </div>
  );
}
