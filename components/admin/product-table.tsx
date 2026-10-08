"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { bulkProductsAction } from "@/app/admin/(panel)/products/actions";
import { adminTable } from "@/components/admin/page-header";
import { ConfirmButton, toastResult } from "@/components/admin/ui";
import { Badge } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { formatPrice, formatDate, getAvailability, isSvg, statusLabel } from "@/lib/utils";
import type { ProductStatus } from "@/types";

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
  image: string | null;
  variant_count: number;
}

const STATUS_TONE = { active: "signal", draft: "neutral", out_of_stock: "deal", archived: "warn" } as const;

export function ProductTable({ rows }: { rows: AdminProductRow[] }) {
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
