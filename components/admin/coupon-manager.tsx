"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { deleteCouponAction, saveCouponAction } from "@/app/admin/(panel)/content-actions";
import { adminTable } from "@/components/admin/page-header";
import { ConfirmButton, toastResult } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";
import { formatDate, formatPrice } from "@/lib/utils";
import { toDhakaInput } from "@/lib/date-input";
import type { Coupon } from "@/types";

type Form = {
  code: string;
  description: string;
  discount_type: "percent" | "fixed";
  discount_value: string;
  min_order_amount: string;
  max_discount_amount: string;
  starts_at: string;
  ends_at: string;
  usage_limit: string;
  is_active: boolean;
};

const blank: Form = {
  code: "",
  description: "",
  discount_type: "fixed",
  discount_value: "",
  min_order_amount: "0",
  max_discount_amount: "",
  starts_at: "",
  ends_at: "",
  usage_limit: "",
  is_active: true,
};

function couponState(c: Coupon): { label: string; tone: "signal" | "neutral" | "warn" | "deal" } {
  const now = Date.now();
  if (!c.is_active) return { label: "Off", tone: "neutral" };
  if (c.ends_at && new Date(c.ends_at).getTime() < now) return { label: "Expired", tone: "deal" };
  if (c.starts_at && new Date(c.starts_at).getTime() > now) return { label: "Scheduled", tone: "warn" };
  if (c.usage_limit && c.used_count >= c.usage_limit) return { label: "Used up", tone: "deal" };
  return { label: "Active", tone: "signal" };
}

export function CouponManager({ coupons }: { coupons: Coupon[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [f, setF] = useState<Form>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  function open(c?: Coupon) {
    setErrors({});
    setEditing(c ? c.id : "new");
    setF(
      c
        ? {
            code: c.code,
            description: c.description ?? "",
            discount_type: c.discount_type,
            discount_value: String(c.discount_value),
            min_order_amount: String(c.min_order_amount),
            max_discount_amount: c.max_discount_amount === null ? "" : String(c.max_discount_amount),
            starts_at: toDhakaInput(c.starts_at),
            ends_at: toDhakaInput(c.ends_at),
            usage_limit: c.usage_limit === null ? "" : String(c.usage_limit),
            is_active: c.is_active,
          }
        : blank,
    );
  }

  function save() {
    start(async () => {
      const res = await saveCouponAction(editing === "new" ? null : editing, f);
      if (!res.ok) setErrors(res.fieldErrors ?? {});
      if (toastResult(res)) {
        setEditing(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div>
        <div className="mb-3 flex justify-end">
          <Button onClick={() => open()}>
            <Plus className="h-4 w-4" aria-hidden />
            New coupon
          </Button>
        </div>
        <div className={adminTable.wrap}>
          <table className={adminTable.table}>
            <thead>
              <tr>
                <th className={adminTable.th}>Code</th>
                <th className={adminTable.th}>Discount</th>
                <th className={adminTable.th}>Minimum order</th>
                <th className={adminTable.th}>Used</th>
                <th className={adminTable.th}>Valid</th>
                <th className={adminTable.th}>Status</th>
                <th className={adminTable.th}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {coupons.length === 0 ? (
                <tr>
                  <td colSpan={7} className={`${adminTable.td} text-center text-ink-mute`}>
                    No coupons yet.
                  </td>
                </tr>
              ) : (
                coupons.map((c) => {
                  const st = couponState(c);
                  return (
                    <tr key={c.id}>
                      <td className={adminTable.td}>
                        <span className="font-mono font-semibold">{c.code}</span>
                        {c.is_demo ? <span className="ml-1 text-xs text-warn">demo</span> : null}
                        {c.description ? <span className="block text-xs text-ink-mute">{c.description}</span> : null}
                      </td>
                      <td className={`${adminTable.td} price`}>
                        {c.discount_type === "percent" ? `${c.discount_value}%` : formatPrice(c.discount_value)}
                        {c.max_discount_amount ? <span className="block text-xs text-ink-mute">up to {formatPrice(c.max_discount_amount)}</span> : null}
                      </td>
                      <td className={`${adminTable.td} price`}>{Number(c.min_order_amount) ? formatPrice(c.min_order_amount) : "—"}</td>
                      <td className={`${adminTable.td} price`}>
                        {c.used_count}
                        {c.usage_limit ? ` / ${c.usage_limit}` : ""}
                      </td>
                      <td className={`${adminTable.td} text-xs text-ink-soft`}>
                        {c.starts_at ? formatDate(c.starts_at) : "Now"} – {c.ends_at ? formatDate(c.ends_at) : "no end"}
                      </td>
                      <td className={adminTable.td}>
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </td>
                      <td className={`${adminTable.td} text-right`}>
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => open(c)}>
                            Edit
                          </Button>
                          <ConfirmButton
                            title={`Delete coupon ${c.code}?`}
                            description="Orders that already used it keep their discount."
                            confirmLabel="Delete"
                            variant="ghost"
                            onConfirm={async () => {
                              const res = await deleteCouponAction(c.id);
                              if (res.ok) router.refresh();
                              return res;
                            }}
                          >
                            Delete
                          </ConfirmButton>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing ? (
        <section className="h-fit rounded-[var(--radius-card)] border border-line bg-surface p-5 xl:sticky xl:top-6" aria-label="Coupon editor">
          <h2 className="text-lg font-bold">{editing === "new" ? "New coupon" : `Edit ${f.code}`}</h2>
          <div className="mt-4 grid gap-4">
            <Field label="Code" htmlFor="c-code" error={errors.code} required hint="Customers type this at checkout">
              <Input id="c-code" value={f.code} onChange={(e) => set("code", e.target.value.toUpperCase().replace(/\s/g, ""))} className="font-mono uppercase" />
            </Field>
            <Field label="Description (internal)" htmlFor="c-desc">
              <Input id="c-desc" value={f.description} onChange={(e) => set("description", e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type" htmlFor="c-type">
                <Select id="c-type" value={f.discount_type} onChange={(e) => set("discount_type", e.target.value as Form["discount_type"])}>
                  <option value="fixed">Fixed amount (৳)</option>
                  <option value="percent">Percentage (%)</option>
                </Select>
              </Field>
              <Field label={f.discount_type === "percent" ? "Percent off" : "Taka off"} htmlFor="c-val" error={errors.discount_value} required>
                <Input id="c-val" inputMode="decimal" value={f.discount_value} onChange={(e) => set("discount_value", e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Minimum order (৳)" htmlFor="c-min" error={errors.min_order_amount}>
                <Input id="c-min" inputMode="decimal" value={f.min_order_amount} onChange={(e) => set("min_order_amount", e.target.value)} />
              </Field>
              <Field label="Maximum discount (৳)" htmlFor="c-max" hint="Optional cap for % coupons">
                <Input id="c-max" inputMode="decimal" value={f.max_discount_amount} onChange={(e) => set("max_discount_amount", e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Starts (Dhaka time)" htmlFor="c-start">
                <Input id="c-start" type="datetime-local" value={f.starts_at} onChange={(e) => set("starts_at", e.target.value)} />
              </Field>
              <Field label="Ends (Dhaka time)" htmlFor="c-end" error={errors.ends_at}>
                <Input id="c-end" type="datetime-local" value={f.ends_at} onChange={(e) => set("ends_at", e.target.value)} />
              </Field>
            </div>
            <Field label="Usage limit" htmlFor="c-limit" hint="Total uses across all customers. Empty = unlimited">
              <Input id="c-limit" inputMode="numeric" value={f.usage_limit} onChange={(e) => set("usage_limit", e.target.value.replace(/\D/g, ""))} />
            </Field>
            <Checkbox label="Active" checked={f.is_active} onChange={(e) => set("is_active", e.target.checked)} />
          </div>
          <div className="mt-5 flex gap-2">
            <Button onClick={save} loading={pending}>
              {editing === "new" ? "Create coupon" : "Save coupon"}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
