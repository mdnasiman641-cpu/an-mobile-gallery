"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateOrderAction } from "@/app/admin/(panel)/orders/actions";
import { toastResult } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/form";
import { orderStatusLabel, paymentStatusLabel } from "@/lib/utils";
import type { OrderStatus, PaymentStatus } from "@/types";

export function OrderStatusForm({
  id,
  status,
  paymentStatus,
  adminNote,
}: {
  id: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  adminNote: string | null;
}) {
  const router = useRouter();
  const [s, setS] = useState<OrderStatus>(status);
  const [p, setP] = useState<PaymentStatus>(paymentStatus);
  const [note, setNote] = useState(adminNote ?? "");
  const [pending, start] = useTransition();
  const locked = status === "cancelled";

  function save() {
    if (s === "cancelled" && status !== "cancelled" && !window.confirm("Cancel this order? Its items go back into stock. A cancelled order can't be reopened.")) return;
    start(async () => {
      const res = await updateOrderAction({ id, status: s, payment_status: p, admin_note: note });
      if (toastResult(res)) router.refresh();
    });
  }

  return (
    <div className="grid gap-4">
      <Field label="Order status" htmlFor="o-status" hint={locked ? "Cancelled orders can't be reopened." : undefined}>
        <Select id="o-status" value={s} onChange={(e) => setS(e.target.value as OrderStatus)} disabled={locked}>
          {(Object.keys(orderStatusLabel) as OrderStatus[]).map((k) => (
            <option key={k} value={k}>
              {orderStatusLabel[k]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Payment status" htmlFor="o-pay">
        <Select id="o-pay" value={p} onChange={(e) => setP(e.target.value as PaymentStatus)}>
          {(Object.keys(paymentStatusLabel) as PaymentStatus[]).map((k) => (
            <option key={k} value={k}>
              {paymentStatusLabel[k]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Internal note" htmlFor="o-note" hint="Only staff can see this">
        <Textarea id="o-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </Field>
      <Button onClick={save} loading={pending}>
        Save order
      </Button>
    </div>
  );
}
