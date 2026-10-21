import type { Metadata } from "next";
import Link from "next/link";
import { hasRole, requireStaff } from "@/lib/auth";
import { LovableSyncPanel, type LovableSyncView } from "@/components/admin/lovable-sync-panel";
import { lovableConfig, LOVABLE_SOURCE } from "@/lib/integrations/lovable-inventory";
import { createClient } from "@/lib/supabase/server";
import { escapeFilter } from "@/services/admin";
import { AdminFilterBar, AdminPageHeader, adminTable } from "@/components/admin/page-header";
import { StockAdjuster } from "@/components/admin/stock-adjuster";
import { Badge, Pagination } from "@/components/ui/misc";
import { Input, Select } from "@/components/ui/form";
import { availabilityLabel, formatDate, getAvailability, variantLabel } from "@/lib/utils";
import { buildListingHref } from "@/lib/listing";

export const metadata: Metadata = { title: "Inventory" };

const PER_PAGE = 30;
const INVENTORY_SELECT = "id, name, sku, stock_quantity, low_stock_threshold, status, product_variants(id, sku, storage, ram, color, stock, status)";
const REASON: Record<string, string> = {
  initial: "Opening stock",
  restock: "Restock",
  sale: "Sold",
  return: "Return",
  adjustment: "Correction",
  order_cancelled: "Order cancelled",
  damage: "Damaged / lost",
};

interface Row {
  id: string;
  name: string;
  sku: string | null;
  stock_quantity: number;
  low_stock_threshold: number;
  status: string;
  product_variants: { id: string; sku: string | null; storage: string | null; ram: string | null; color: string | null; stock: number; status: string }[];
}

/** Lovable sync status for admins (staff can read the state table; the API key is never read here). */
async function lovableSyncView(supabase: Awaited<ReturnType<typeof createClient>>): Promise<LovableSyncView> {
  const cfg = lovableConfig();
  const { data, error } = await supabase.from("stock_sync_state").select("*").eq("source", LOVABLE_SOURCE).maybeSingle();
  const row = (data ?? {}) as Record<string, unknown>;
  // migration 0023 (batch grouping) is needed too (a HEAD request does not report a missing table, so read one row)
  const groups = error ? null : await supabase.from("stock_source_groups").select("group_key").limit(1);
  const running = typeof row.running_since === "string" && Boolean(row.running_token) && Date.now() - Date.parse(row.running_since) < 5 * 60_000;
  return {
    configured: cfg.ok,
    configProblem: cfg.ok ? null : cfg.message,
    migrationMissing: error
      ? "Run database migration 0022 (supabase/migrations/20261021000022_inventory_sync_state.sql) in the Supabase SQL editor first."
      : groups?.error
        ? "Run database migration 0023 (supabase/migrations/20261021000023_stock_source_groups.sql) in the Supabase SQL editor first."
        : null,
    lastSuccessAt: (row.last_success_at as string | null) ?? null,
    lastAttemptAt: (row.last_attempt_at as string | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
    resumePage: (row.resume_page as number | null) ?? null,
    incrementalSupported: (row.incremental_supported as boolean | null) ?? null,
    checkpoint: (row.checkpoint as string | null) ?? null,
    running,
    summary: (row.last_summary as LovableSyncView["summary"]) ?? {},
    contract: (row.contract as LovableSyncView["contract"]) ?? {},
  };
}

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireStaff("editor");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();

  // In stock first (A–Z), then out of stock (0 before any negative, A–Z). Done in the database:
  // the in-stock and out-of-stock parts are paged separately, so only one page is ever fetched.
  const q = escapeFilter(sp.q ?? "");
  const filter = sp.filter === "in" || sp.filter === "out" || sp.filter === "low" ? sp.filter : "";
  type Part = "in" | "out" | "low";
  // PostgREST filter text for one part (same filters for the count and the page)
  const searchOr = q ? `name.ilike.%${q}%,sku.ilike.%${q}%` : null;
  const stockRange = (part: Part): [number | null, number | null] => (part === "in" ? [0, null] : part === "out" ? [null, 0] : [0, 5]);
  const countOf = async (part: Part) => {
    const [gt, lte] = stockRange(part);
    let qy = supabase.from("products").select("id", { count: "exact", head: true }).neq("status", "archived");
    if (searchOr) qy = qy.or(searchOr);
    if (gt !== null) qy = qy.gt("stock_quantity", gt);
    if (lte !== null) qy = qy.lte("stock_quantity", lte);
    return (await qy).count ?? 0;
  };
  const fetchPart = async (part: Part, from: number, to: number) => {
    const [gt, lte] = stockRange(part);
    let qy = supabase.from("products").select(INVENTORY_SELECT).neq("status", "archived");
    if (searchOr) qy = qy.or(searchOr);
    if (gt !== null) qy = qy.gt("stock_quantity", gt);
    if (lte !== null) qy = qy.lte("stock_quantity", lte);
    const ordered = part === "out" ? qy.order("stock_quantity", { ascending: false }).order("name") : qy.order("name");
    return ((await ordered.range(from, to)).data ?? []) as unknown as Row[];
  };
  const from = (page - 1) * PER_PAGE;
  const to = page * PER_PAGE - 1;
  let rows: Row[];
  let count: number;
  if (filter) {
    // one part only: count and page together
    [count, rows] = await Promise.all([countOf(filter), fetchPart(filter, from, to)]);
  } else {
    const [inCount, outCount] = await Promise.all([countOf("in"), countOf("out")]);
    count = inCount + outCount;
    const [inRows, outRows] = await Promise.all([
      from < inCount ? fetchPart("in", from, Math.min(to, inCount - 1)) : Promise.resolve([] as Row[]),
      to >= inCount && outCount > 0 ? fetchPart("out", Math.max(0, from - inCount), to - inCount) : Promise.resolve([] as Row[]),
    ]);
    rows = [...inRows, ...outRows];
  }

  const { data: history } = await supabase
    .from("inventory")
    .select("id, change, stock_after, reason, note, created_at, product:products(id, name), variant:product_variants(storage, ram, color), order:orders(id, order_number)")
    .order("created_at", { ascending: false })
    .limit(40);
  const moves = (history ?? []) as unknown as {
    id: string;
    change: number;
    stock_after: number;
    reason: string;
    note: string | null;
    created_at: string;
    product: { id: string; name: string } | null;
    variant: { storage: string | null; ram: string | null; color: string | null } | null;
    order: { id: string; order_number: string } | null;
  }[];

  return (
    <>
      <AdminPageHeader title="Inventory" description="Stock levels and every stock movement. Sales and cancellations are recorded automatically." />
      {hasRole(session, "admin") ? <LovableSyncPanel view={await lovableSyncView(supabase)} /> : null}
      <AdminFilterBar>
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs font-medium text-ink-soft">
          Search
          <Input name="q" defaultValue={sp.q} placeholder="Name or SKU" className="h-10" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          Show
          <Select name="filter" defaultValue={filter} className="h-10">
            <option value="">All products</option>
            <option value="in">In stock</option>
            <option value="out">Out of stock</option>
            {filter === "low" ? <option value="low">Low stock (1–5)</option> : null}
          </Select>
        </label>
      </AdminFilterBar>

      <div className={adminTable.wrap}>
        <table className={adminTable.table}>
          <thead>
            <tr>
              <th className={adminTable.th}>Product / variant</th>
              <th className={adminTable.th}>SKU</th>
              <th className={`${adminTable.th} text-right`}>Stock</th>
              <th className={adminTable.th}>Status</th>
              <th className={adminTable.th}>
                <span className="sr-only">Adjust</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className={`${adminTable.td} text-center text-ink-mute`}>
                  Nothing matches.
                </td>
              </tr>
            ) : (
              rows.flatMap((p) => {
                const variants = p.product_variants.filter((v) => v.status === "active");
                const lines = variants.length
                  ? variants.map((v) => ({ key: v.id, variantId: v.id, label: variantLabel(v), sku: v.sku, stock: v.stock, sub: true }))
                  : [{ key: p.id, variantId: null as string | null, label: "", sku: p.sku, stock: p.stock_quantity, sub: false }];
                return [
                  variants.length ? (
                    <tr key={`${p.id}-head`} className="bg-paper/60">
                      <td className={adminTable.td} colSpan={2}>
                        <Link href={`/admin/products/${p.id}`} className="font-semibold hover:underline">
                          {p.name}
                        </Link>
                      </td>
                      <td className={`${adminTable.td} price text-right font-semibold`}>{p.stock_quantity}</td>
                      <td className={adminTable.td} colSpan={2}>
                        <span className="text-xs text-ink-mute">Total of {variants.length} variants</span>
                      </td>
                    </tr>
                  ) : null,
                  ...lines.map((l) => {
                    const a = getAvailability(l.stock, p.low_stock_threshold);
                    return (
                      <tr key={l.key}>
                        <td className={`${adminTable.td} ${l.sub ? "pl-8" : ""}`}>
                          {l.sub ? (
                            l.label
                          ) : (
                            <Link href={`/admin/products/${p.id}`} className="font-semibold hover:underline">
                              {p.name}
                            </Link>
                          )}
                        </td>
                        <td className={`${adminTable.td} text-ink-soft`}>{l.sku ?? "—"}</td>
                        <td className={`${adminTable.td} price text-right font-semibold`}>{l.stock}</td>
                        <td className={adminTable.td}>
                          <Badge tone={a === "in_stock" ? "signal" : a === "low_stock" ? "warn" : "deal"}>{availabilityLabel[a]}</Badge>
                        </td>
                        <td className={`${adminTable.td} text-right`}>
                          <StockAdjuster productId={p.id} variantId={l.variantId} label={l.sub ? `${p.name}, ${l.label}` : p.name} current={l.stock} />
                        </td>
                      </tr>
                    );
                  }),
                ];
              })
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={Math.ceil((count ?? 0) / PER_PAGE)} buildHref={(n) => buildListingHref("/admin/inventory", sp, { page: n })} />

      <section className="mt-10" aria-labelledby="history-h">
        <h2 id="history-h" className="mb-3 text-lg font-bold">
          Recent stock movements
        </h2>
        <div className={adminTable.wrap}>
          <table className={adminTable.table}>
            <thead>
              <tr>
                <th className={adminTable.th}>When</th>
                <th className={adminTable.th}>Product</th>
                <th className={adminTable.th}>Reason</th>
                <th className={`${adminTable.th} text-right`}>Change</th>
                <th className={`${adminTable.th} text-right`}>Stock after</th>
              </tr>
            </thead>
            <tbody>
              {moves.length === 0 ? (
                <tr>
                  <td colSpan={5} className={`${adminTable.td} text-center text-ink-mute`}>
                    No stock movements yet.
                  </td>
                </tr>
              ) : (
                moves.map((m) => (
                  <tr key={m.id}>
                    <td className={`${adminTable.td} text-xs text-ink-mute`}>{formatDate(m.created_at, true)}</td>
                    <td className={adminTable.td}>
                      {m.product?.name ?? "Deleted product"}
                      {m.variant ? <span className="block text-xs text-ink-mute">{variantLabel(m.variant)}</span> : null}
                    </td>
                    <td className={adminTable.td}>
                      {REASON[m.reason] ?? m.reason}
                      {m.order ? (
                        <Link href={`/admin/orders/${m.order.id}`} className="ml-1 text-xs text-signal underline">
                          {m.order.order_number}
                        </Link>
                      ) : null}
                      {m.note ? <span className="block text-xs text-ink-mute">{m.note}</span> : null}
                    </td>
                    <td className={`${adminTable.td} price text-right font-semibold ${m.change > 0 ? "text-signal-dark" : "text-deal"}`}>
                      {m.change > 0 ? `+${m.change}` : m.change}
                    </td>
                    <td className={`${adminTable.td} price text-right`}>{m.stock_after}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
