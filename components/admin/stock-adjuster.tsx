"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adjustStockAction } from "@/app/admin/(panel)/inventory/actions";
import { toastResult } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";

export function StockAdjuster({
  productId,
  variantId,
  label,
  current,
}: {
  productId: string;
  variantId: string | null;
  label: string;
  current: number;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [mode, setMode] = useState<"add" | "remove" | "set">("add");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState<"restock" | "return" | "adjustment" | "damage">("restock");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  const n = Number(qty) || 0;
  const change = mode === "add" ? n : mode === "remove" ? -n : n - current;
  const result = current + change;

  function submit() {
    start(async () => {
      const res = await adjustStockAction({ product_id: productId, variant_id: variantId, change, reason: mode === "set" ? "adjustment" : reason, note });
      if (toastResult(res)) {
        ref.current?.close();
        setQty("");
        setNote("");
        router.refresh();
      }
    });
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => ref.current?.showModal()}>
        Adjust
      </Button>
      <dialog ref={ref} aria-labelledby={`${id}-t`} className="m-auto w-[min(92vw,420px)] rounded-[var(--radius-card)] border border-line bg-surface p-0 text-ink backdrop:bg-ink/40">
        <form
          className="grid gap-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div>
            <h2 id={`${id}-t`} className="text-lg font-bold">
              Adjust stock
            </h2>
            <p className="text-sm text-ink-soft">
              {label}. Now in stock: <strong>{current}</strong>
            </p>
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-[var(--radius-control)] bg-paper p-1" role="radiogroup" aria-label="Adjustment type">
            {(["add", "remove", "set"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => {
                  setMode(m);
                  if (m === "add") setReason("restock");
                  if (m === "remove") setReason("damage");
                }}
                className={`h-9 rounded-lg text-sm font-semibold ${mode === m ? "bg-surface shadow-sm" : "text-ink-soft"}`}
              >
                {m === "add" ? "Add" : m === "remove" ? "Remove" : "Set to"}
              </button>
            ))}
          </div>
          <Field label="Quantity" htmlFor={`${id}-q`}>
            <Input id={`${id}-q`} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} autoFocus />
          </Field>
          {mode !== "set" ? (
            <Field label="Reason" htmlFor={`${id}-r`}>
              <Select id={`${id}-r`} value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
                <option value="restock">New stock arrived</option>
                <option value="return">Customer return</option>
                <option value="damage">Damaged / lost</option>
                <option value="adjustment">Stock count correction</option>
              </Select>
            </Field>
          ) : null}
          <Field label="Note (optional)" htmlFor={`${id}-n`}>
            <Input id={`${id}-n`} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Supplier, invoice no., etc." />
          </Field>
          <p className="text-sm text-ink-soft">
            New stock: <strong className={result < 0 ? "text-deal" : "text-ink"}>{result}</strong>
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => ref.current?.close()}>
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={change === 0 || result < 0}>
              Save stock
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
