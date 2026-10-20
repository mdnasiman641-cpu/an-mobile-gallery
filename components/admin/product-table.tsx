"use client";

import { useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { bulkProductsAction, bulkSetProductFieldAction, type BulkFieldChange } from "@/app/admin/(panel)/products/actions";
import { adminTable } from "@/components/admin/page-header";
import { ConfirmButton, toastResult } from "@/components/admin/ui";
import { Badge } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { boxLabel, conditionLabel, formatPrice, formatDate, getAvailability, isSvg, statusLabel } from "@/lib/utils";
import type { ProductCondition, ProductStatus } from "@/types";

export interface AdminProductRow {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  price: number;
  sale_price: number | null;
  stock_quantity: number;
  low_stock_threshold: number;
  status: ProductStatus;
  featured: boolean;
  is_demo: boolean;
  updated_at: string;
  brand: { name: string } | null;
  category: { name: string } | null;
  condition: ProductCondition;
  /** undefined until migration 0017 has run */
  box_included?: boolean | null;
  image: string | null;
  variant_count: number;
}

const STATUS_TONE = { active: "signal", draft: "neutral", out_of_stock: "deal", archived: "warn" } as const;

export interface BulkCategoryOption {
  id: string;
  name: string;
  parent_id: string | null;
  is_active: boolean;
}

type BulkField = BulkFieldChange["field"];

export function ProductTable({
  rows,
  canBulkEdit = false,
  categories = [],
}: {
  rows: AdminProductRow[];
  /** Change category / condition / box: admins only (checked again on the server). */
  canBulkEdit?: boolean;
  categories?: BulkCategoryOption[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function run(op: Parameters<typeof bulkProductsAction>[1]) {
    start(async () => {
      const res = await bulkProductsAction(Array.from(selected), op);
      if (toastResult(res)) {
        setSelected(new Set());
        router.refresh();
      }
    });
  }

  /** Full success: clear the selection. Partial: keep it so the admin can retry. Refresh whenever something changed. */
  function afterFieldChange(r: { ok: boolean; anyUpdated: boolean }) {
    if (r.ok) setSelected(new Set());
    if (r.anyUpdated) router.refresh();
  }

  return (
    <>
      {selected.size > 0 ? (
        <div className="sticky top-14 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-ink bg-surface p-2.5 lg:top-2" role="toolbar" aria-label="Bulk actions">
          <span className="px-2 text-sm font-semibold">{selected.size} selected</span>
          <Button size="sm" variant="outline" loading={pending} onClick={() => run("active")}>Publish</Button>
          <Button size="sm" variant="outline" loading={pending} onClick={() => run("draft")}>Move to draft</Button>
          <Button size="sm" variant="outline" loading={pending} onClick={() => run("out_of_stock")}>Mark out of stock</Button>
          <Button size="sm" variant="outline" loading={pending} onClick={() => run("feature")}>Feature</Button>
          <Button size="sm" variant="outline" loading={pending} onClick={() => run("unfeature")}>Unfeature</Button>
          <Button size="sm" variant="outline" loading={pending} onClick={() => run("archived")}>Archive</Button>
          {canBulkEdit ? (
            <>
              <BulkFieldButton field="category" ids={selected} categories={categories} disabled={pending} onDone={afterFieldChange} />
              <BulkFieldButton field="condition" ids={selected} categories={categories} disabled={pending} onDone={afterFieldChange} />
              <BulkFieldButton field="box" ids={selected} categories={categories} disabled={pending} onDone={afterFieldChange} />
            </>
          ) : null}
          <ConfirmButton
            title={`Delete ${selected.size} product${selected.size === 1 ? "" : "s"}?`}
            description="They disappear from the store and their images are removed. Past orders keep their details. This can't be undone."
            confirmLabel="Delete"
            onConfirm={async () => {
              const res = await bulkProductsAction(Array.from(selected), "delete");
              if (res.ok) {
                setSelected(new Set());
                router.refresh();
              }
              return res;
            }}
          >
            Delete
          </ConfirmButton>
          <button type="button" className="ml-auto px-2 text-sm text-ink-soft underline" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      ) : null}

      <div className={adminTable.wrap}>
        <table className={adminTable.table}>
          <thead>
            <tr>
              <th className={`${adminTable.th} w-10`}>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--color-signal)]"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                  aria-label="Select all products on this page"
                />
              </th>
              <th className={adminTable.th}>Product</th>
              <th className={adminTable.th}>Brand</th>
              <th className={adminTable.th}>Category</th>
              <th className={adminTable.th}>Condition</th>
              <th className={`${adminTable.th} text-right`}>Price</th>
              <th className={`${adminTable.th} text-right`}>Stock</th>
              <th className={adminTable.th}>Status</th>
              <th className={adminTable.th}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const availability = getAvailability(p.stock_quantity, p.low_stock_threshold);
              return (
                <tr key={p.id} className={selected.has(p.id) ? "bg-signal-tint/50" : undefined}>
                  <td className={adminTable.td}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--color-signal)]"
                      checked={selected.has(p.id)}
                      onChange={() => toggle(p.id)}
                      aria-label={`Select ${p.name}`}
                    />
                  </td>
                  <td className={adminTable.td}>
                    <div className="flex items-center gap-3">
                      <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-md bg-paper">
                        {p.image ? <Image src={p.image} alt="" fill sizes="44px" className="object-contain p-0.5" unoptimized={isSvg(p.image)} /> : null}
                      </span>
                      <span className="min-w-0">
                        <Link href={`/admin/products/${p.id}`} className="font-semibold hover:underline">
                          {p.name}
                        </Link>
                        <span className="block text-xs text-ink-mute">
                          {p.sku ?? "No SKU"}
                          {p.variant_count ? `, ${p.variant_count} variants` : ""}
                          {p.featured ? ", featured" : ""}
                          {p.is_demo ? ", demo" : ""}
                        </span>
                      </span>
                    </div>
                  </td>
                  <td className={adminTable.td}>{p.brand?.name ?? "—"}</td>
                  <td className={adminTable.td}>{p.category?.name ?? <span className="text-ink-mute">None</span>}</td>
                  <td className={`${adminTable.td} whitespace-nowrap`}>
                    {conditionLabel[p.condition]}
                    <span className="block text-xs text-ink-mute">{boxLabel(p.box_included) ?? "Box: not set"}</span>
                  </td>
                  <td className={`${adminTable.td} price text-right`}>
                    {formatPrice(p.sale_price ?? p.price)}
                    {p.sale_price !== null ? <span className="block text-xs text-ink-mute line-through">{formatPrice(p.price)}</span> : null}
                  </td>
                  <td className={`${adminTable.td} price text-right ${availability === "out_of_stock" ? "text-deal" : availability === "low_stock" ? "text-warn" : ""}`}>
                    {p.stock_quantity}
                  </td>
                  <td className={adminTable.td}>
                    <Badge tone={STATUS_TONE[p.status]}>{statusLabel[p.status]}</Badge>
                  </td>
                  <td className={`${adminTable.td} text-xs text-ink-mute`}>{formatDate(p.updated_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

const FIELD_TEXT: Record<BulkField, { button: string; title: string; label: string }> = {
  category: { button: "Change category", title: "Change category", label: "New category" },
  condition: { button: "Set condition", title: "Set condition", label: "Condition" },
  box: { button: "Set box availability", title: "Set box availability", label: "Box" },
};

/**
 * One bulk edit: pick a value → review → apply. A product has one category,
 * so "Change category" REPLACES it (no other field changes).
 */
function BulkFieldButton({
  field,
  ids,
  categories,
  disabled,
  onDone,
}: {
  field: BulkField;
  ids: Set<string>;
  categories: BulkCategoryOption[];
  disabled?: boolean;
  /** Called after the server answered. */
  onDone: (r: { ok: boolean; anyUpdated: boolean }) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const selectId = useId();
  const [value, setValue] = useState("");
  const [step, setStep] = useState<"choose" | "confirm">("choose");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const text = FIELD_TEXT[field];
  const [frozen, setFrozen] = useState<string[]>([]); // the selection when the dialog opened
  const n = frozen.length;
  const count = `${n} product${n === 1 ? "" : "s"}`;

  const parentName = new Map(categories.map((c) => [c.id, c.name]));
  const options: { value: string; label: string }[] =
    field === "category"
      ? categories.map((c) => ({
          value: c.id,
          label: `${c.parent_id && parentName.get(c.parent_id) ? `${parentName.get(c.parent_id)} › ` : ""}${c.name}${c.is_active ? "" : " (hidden)"}`,
        }))
      : field === "condition"
        ? [
            { value: "new", label: "New" },
            { value: "used", label: "Used / Pre-owned" },
          ]
        : [
            { value: "with", label: "With box" },
            { value: "without", label: "Without box" },
          ];
  const chosen = options.find((o) => o.value === value)?.label ?? "";

  function open() {
    setValue("");
    setStep("choose");
    setError(null);
    setFrozen(Array.from(ids));
    ref.current?.showModal();
  }

  function change(): BulkFieldChange | null {
    if (!value) return null;
    if (field === "category") return { field, categoryId: value };
    if (field === "condition") return value === "new" || value === "used" ? { field, value } : null;
    return value === "with" || value === "without" ? { field, value } : null;
  }

  function apply() {
    const c = change();
    if (!c || pending) return;
    start(async () => {
      const res = await bulkSetProductFieldAction(frozen, c);
      toastResult(res);
      if (res.ok) ref.current?.close();
      else setError(res.message ?? "Something went wrong. Please try again.");
      onDone({ ok: res.ok, anyUpdated: (res.data?.updated ?? 0) > 0 });
    });
  }

  return (
    <>
      <Button size="sm" variant="outline" disabled={disabled || ids.size === 0} onClick={open}>
        {text.button}
      </Button>
      <dialog
        ref={ref}
        className="m-auto w-[min(92vw,440px)] rounded-[var(--radius-card)] border border-line bg-surface p-0 text-ink backdrop:bg-ink/40"
        aria-labelledby={titleId}
        onCancel={(e) => pending && e.preventDefault()}
      >
        <div className="p-5">
          <h2 id={titleId} className="text-lg font-bold">
            {text.title}
          </h2>
          <p className="mt-1 text-sm text-ink-soft">{count} selected</p>

          {step === "choose" ? (
            <div className="mt-4 flex flex-col gap-1.5">
              <label htmlFor={selectId} className="text-sm font-medium">
                {text.label}
              </label>
              <Select id={selectId} value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="">Choose…</option>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
              {field === "category" ? (
                <p className="text-xs text-ink-mute">Each product has one category. The selected products move to this category (their current category is replaced).</p>
              ) : field === "box" ? (
                <p className="text-xs text-ink-mute">Only box availability changes. Warranty stays as it is.</p>
              ) : null}
              {field === "category" && options.length === 0 ? <p className="text-sm text-deal">No categories yet. Add one under Categories first.</p> : null}
            </div>
          ) : (
            <p className="mt-4 rounded-[var(--radius-control)] bg-paper p-3 text-sm" role="status">
              {field === "category" ? "Move" : "Set"} <strong>{count}</strong> to <strong>{chosen}</strong>? Nothing else on these products changes.
            </p>
          )}

          {error ? (
            <p className="mt-3 text-sm text-deal" role="alert">
              {error}
            </p>
          ) : null}

          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={pending} onClick={() => (step === "confirm" && !error ? setStep("choose") : ref.current?.close())}>
              {step === "confirm" && !error ? "Back" : "Cancel"}
            </Button>
            {step === "choose" ? (
              <Button type="button" disabled={!value} onClick={() => setStep("confirm")}>
                Apply to {count}
              </Button>
            ) : (
              <Button type="button" loading={pending} disabled={pending || Boolean(error)} onClick={apply}>
                Confirm
              </Button>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
