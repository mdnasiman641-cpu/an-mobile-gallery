"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, PlugZap, FlaskConical, Eye } from "lucide-react";
import { checkLovableConnectionAction, decideLovableGroupAction, previewLovableStockAction, syncLovableStockAction } from "@/app/admin/(panel)/inventory/lovable-actions";
import type { GroupAction, PreviewResult } from "@/lib/integrations/lovable-inventory";
import { toastResult } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { formatDate } from "@/lib/utils";

export interface LovableSyncView {
  configured: boolean;
  configProblem: string | null;
  /** What to run first, or null. */
  migrationMissing: string | null;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  resumePage: number | null;
  incrementalSupported: boolean | null;
  checkpoint: string | null;
  running: boolean;
  summary: {
    mode?: string;
    at?: string;
    pages?: number;
    received?: number;
    imported?: number;
    held?: number;
    updated?: number;
    unchanged?: number;
    skipped?: number;
    failed?: number;
    finished?: boolean;
    errors?: { id: string | null; error: string }[];
  };
  contract: {
    checked_at?: string;
    listKey?: string;
    fields?: string[];
    sample?: Record<string, string>;
    mapping?: Record<string, string | null>;
    meta?: Record<string, unknown>;
    firstItemUsable?: boolean;
    firstItemError?: string | null;
  };
}

const FIELD_LABELS: Record<string, string> = {
  id: "Product ID",
  name: "Name",
  brand: "Brand",
  model: "Model",
  model_number: "Model number",
  sku: "SKU",
  ram: "RAM",
  storage: "ROM / storage",
  condition: "Condition",
  color: "Colour",
  category: "Category",
  quantity: "Stock quantity",
  sale_price: "Selling price (reference only)",
  image_url: "Image URL (reference only)",
  updated_at: "Updated time",
};

export function LovableSyncPanel({ view }: { view: LovableSyncView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      const res = await fn();
      toastResult({ ok: res.ok, message: res.message });
      setResult({ ok: res.ok, message: res.message ?? "" });
      router.refresh();
    });
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const loadPreview = async () => {
    const res = await previewLovableStockAction();
    setResult({ ok: res.ok, message: res.message ?? "" });
    setPreview(res.ok && res.data ? res.data : null);
    return res;
  };
  const runPreview = () =>
    start(async () => {
      const res = await loadPreview();
      toastResult({ ok: res.ok, message: res.message });
    });
  const decide = (key: string, decision: "link" | "create" | "clear", productId?: string) =>
    start(async () => {
      const res = await decideLovableGroupAction(key, decision, productId);
      toastResult({ ok: res.ok, message: res.message });
      if (res.ok) await loadPreview();
      else setResult({ ok: false, message: res.message ?? "" });
    });
  // imports stay disabled until a preview has read every record and could use all of them
  const previewValid = Boolean(preview && preview.complete && preview.failed.length === 0);
  const s = view.summary;
  const c = view.contract;
  const disabled = pending || !view.configured || Boolean(view.migrationMissing);

  return (
    <section className="mb-6 rounded-[var(--radius-card)] border border-line bg-surface p-5" aria-labelledby="lovable-sync">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="lovable-sync" className="font-bold">
          Lovable stock sync
        </h2>
        {view.configured ? <Badge tone="signal">Configured</Badge> : <Badge tone="warn">Not configured</Badge>}
        {view.running ? <Badge tone="warn">Sync running</Badge> : null}
        <span className="ml-auto flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={disabled} loading={pending} onClick={() => run(() => checkLovableConnectionAction())}>
            <PlugZap className="h-4 w-4" aria-hidden /> Check connection
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={disabled} loading={pending} onClick={runPreview}>
            <Eye className="h-4 w-4" aria-hidden /> Preview all (no changes)
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || !c.checked_at || !previewValid}
            loading={pending}
            title={!previewValid ? "Run a preview first (it must read every record)" : "Creates at most 5 drafts for real; changes nothing else"}
            onClick={() => run(() => syncLovableStockAction("test"))}
          >
            <FlaskConical className="h-4 w-4" aria-hidden /> Import first 5
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={disabled || !c.checked_at || !previewValid}
            title={!previewValid ? "Run a preview first (it must read every record)" : undefined}
            loading={pending}
            onClick={() => run(() => syncLovableStockAction("auto"))}
          >
            <RefreshCw className="h-4 w-4" aria-hidden /> {view.resumePage ? `Continue sync (page ${view.resumePage})` : "Sync Lovable Stock Now"}
          </Button>
        </span>
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        Imports from khadijatelecom1.lovable.app. Purchase batches of the same phone (model, RAM, ROM, condition) become one product whose stock is the sum of the batches.
        New products arrive as drafts (price 0, not public); sold-out phones are not imported. Existing products change stock only after you link them. Prices, photos,
        descriptions and publishing stay under your control; nothing is ever deleted here.
      </p>

      {view.migrationMissing ? (
        <p className="mt-3 rounded-lg bg-warn-tint p-3 text-sm text-warn" role="status">
          {view.migrationMissing}
        </p>
      ) : null}
      {view.configProblem ? (
        <p className="mt-3 rounded-lg bg-warn-tint p-3 text-sm text-warn" role="status">
          {view.configProblem} Add it in Cloudflare → Workers &amp; Pages → an-mobile-gallery → Settings → Variables and Secrets, then redeploy.
        </p>
      ) : null}
      {view.configured && !view.migrationMissing && !c.checked_at ? (
        <p className="mt-3 text-sm text-ink-soft">Press “Check connection” first: it reads one record and shows how its fields map before anything is imported.</p>
      ) : null}
      {result ? (
        <p className={`mt-3 rounded-lg p-3 text-sm ${result.ok ? "bg-signal-tint text-signal-dark" : "bg-deal-tint text-deal"}`} role={result.ok ? "status" : "alert"}>
          {result.message}
        </p>
      ) : null}

      {preview ? <PreviewView preview={preview} pending={pending} onDecide={decide} /> : null}

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-ink-mute">Last successful sync</dt>
          <dd className="font-semibold">{view.lastSuccessAt ? formatDate(view.lastSuccessAt, true) : "Never"}</dd>
        </div>
        <div>
          <dt className="text-ink-mute">Last run</dt>
          <dd className="font-semibold">
            {s.at ? `${formatDate(s.at, true)} · ${s.mode === "test" ? "test" : s.mode === "incremental" ? "changes only" : "full"}${s.finished === false ? " (more to do)" : ""}` : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-ink-mute">Incremental (updated_since)</dt>
          <dd className="font-semibold">{view.incrementalSupported === true ? "Verified — used after a full sync" : view.incrementalSupported === false ? "Not supported — full sync each time" : "Not checked yet"}</dd>
        </div>
        <div>
          <dt className="text-ink-mute">Checkpoint</dt>
          <dd className="font-semibold">{view.checkpoint ? formatDate(view.checkpoint, true) : "—"}</dd>
        </div>
      </dl>

      {s.at ? (
        <ul className="mt-4 flex flex-wrap gap-2 text-sm" aria-label="Last run result">
          <li><Badge tone="signal">{s.imported ?? 0} new drafts</Badge></li>
          <li><Badge tone="signal">{s.updated ?? 0} updated</Badge></li>
          <li><Badge>{s.unchanged ?? 0} unchanged</Badge></li>
          <li><Badge tone="warn">{s.skipped ?? 0} skipped (0 stock)</Badge></li>
          <li><Badge tone="warn">{s.held ?? 0} need a decision</Badge></li>
          <li><Badge tone="deal">{s.failed ?? 0} failed</Badge></li>
          <li className="text-ink-mute">{s.received ?? 0} records read on {s.pages ?? 0} page(s)</li>
        </ul>
      ) : null}
      {view.lastError ? (
        <p className="mt-3 text-sm text-deal" role="alert">
          Last error: {view.lastError}
        </p>
      ) : null}
      {s.errors?.length ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold">Records that need attention ({s.errors.length})</summary>
          <ul className="mt-2 max-h-56 overflow-auto rounded-lg border border-line text-sm">
            {s.errors.map((e, i) => (
              <li key={i} className="border-b border-line px-3 py-1.5 last:border-0">
                <span className="font-mono text-xs text-ink-mute">{e.id ?? "no id"}</span> — {e.error}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {c.checked_at ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-semibold">
            Source format (checked {formatDate(c.checked_at, true)}){c.firstItemUsable === false ? " — first record can't be imported" : ""}
          </summary>
          <p className="mt-2 text-sm text-ink-soft">
            List in <code>{c.listKey}</code>; pagination: {c.meta ? Object.entries(c.meta).filter(([, v]) => v !== null).map(([k, v]) => `${k} ${String(v)}`).join(", ") || "none reported" : "—"}.
            {c.firstItemError ? <span className="text-deal"> {c.firstItemError}.</span> : null}
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-mute">
                  <th className="py-1 pr-3 font-medium">Website field</th>
                  <th className="py-1 pr-3 font-medium">Source field</th>
                  <th className="py-1 font-medium">First record</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(FIELD_LABELS).map(([k, label]) => {
                  const src = c.mapping?.[k] ?? null;
                  return (
                    <tr key={k} className="border-t border-line">
                      <td className="py-1 pr-3">{label}</td>
                      <td className="py-1 pr-3 font-mono text-xs">{src ?? <span className="text-ink-mute">not found</span>}</td>
                      <td className="py-1 text-ink-soft [overflow-wrap:anywhere]">{src ? c.sample?.[src] : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {c.fields?.length ? <p className="mt-2 text-xs text-ink-mute">All source fields: {c.fields.join(", ")}</p> : null}
        </details>
      ) : null}
    </section>
  );
}

const ACTION_LABEL: Record<GroupAction, string> = {
  create: "New draft",
  skip_zero: "Skipped (0 stock)",
  update: "Stock change",
  unchanged: "Unchanged",
  held: "Needs your decision",
  has_variants: "Has options",
};
const ACTION_ORDER: GroupAction[] = ["held", "create", "update", "unchanged", "has_variants", "skip_zero"];

function PreviewView({ preview, pending, onDecide }: { preview: PreviewResult; pending: boolean; onDecide: (key: string, d: "link" | "create" | "clear", productId?: string) => void }) {
  const sorted = [...preview.groups].sort((a, b) => ACTION_ORDER.indexOf(a.action) - ACTION_ORDER.indexOf(b.action) || a.name.localeCompare(b.name));
  const held = sorted.filter((g) => g.action === "held");
  const mem = (g: PreviewResult["groups"][number]) => [g.ram, g.storage].filter(Boolean).join(" / ") || "—";
  return (
    <div className="mt-4 rounded-lg border border-line p-3 text-sm">
      <p className="font-semibold">Preview · nothing saved</p>
      <ul className="mt-2 flex flex-wrap gap-2" aria-label="Preview totals">
        <li><Badge>{preview.records} source records</Badge></li>
        <li><Badge>{preview.groups.length} products (groups)</Badge></li>
        <li><Badge>{preview.totalStock} phones in stock</Badge></li>
        <li><Badge tone="signal">{preview.counts.create} new drafts</Badge></li>
        <li><Badge tone="warn">{preview.counts.skip_zero} skipped (0 stock)</Badge></li>
        <li><Badge tone="warn">{preview.counts.held} need a decision</Badge></li>
        <li><Badge tone="signal">{preview.counts.update} stock changes</Badge></li>
      </ul>
      {!preview.complete ? (
        <p className="mt-2 text-deal" role="alert">
          Not every record could be read ({preview.records} read on {preview.pages} page(s)). Imports stay disabled.
        </p>
      ) : null}
      {preview.failed.length ? (
        <p className="mt-2 text-deal" role="alert">
          {preview.failed.length} record(s) can&apos;t be used: {preview.failed.slice(0, 5).map((f) => `${f.id ?? "no id"} (${f.error})`).join("; ")}. Imports stay disabled.
        </p>
      ) : null}

      {held.length ? (
        <div className="mt-3">
          <p className="font-semibold">Possible existing products — choose for each (nothing is linked automatically)</p>
          <ul className="mt-1 divide-y divide-line rounded-lg border border-line">
            {held.map((g) => (
              <li key={g.key} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  <span className="font-semibold">{g.name}</span> · {g.condition} · {g.total} in stock ({g.batches} batch{g.batches === 1 ? "" : "es"})
                </span>
                {g.candidates.map((p) => (
                  <Button key={p.id} type="button" size="sm" variant="outline" className="h-auto max-w-full whitespace-normal py-1 text-left" disabled={pending} onClick={() => onDecide(g.key, "link", p.id)}>
                    Link to “{p.name}” ({p.status}, stock {p.stock})
                  </Button>
                ))}
                <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => onDecide(g.key, "create")}>
                  Create new draft
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <details className="mt-3">
        <summary className="cursor-pointer font-semibold">All {preview.groups.length} groups with stock totals</summary>
        <div className="mt-2 max-h-96 overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-ink-mute">
                <th className="py-1 pr-3 font-medium">Product (group)</th>
                <th className="py-1 pr-3 font-medium">Condition</th>
                <th className="py-1 pr-3 font-medium">RAM / ROM</th>
                <th className="py-1 pr-3 font-medium">Batches</th>
                <th className="py-1 pr-3 font-medium">Total stock</th>
                <th className="py-1 pr-3 font-medium">Sync would</th>
                <th className="py-1 font-medium">Group key</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((g) => (
                <tr key={g.key} className="border-t border-line align-top">
                  <td className="py-1 pr-3 font-semibold [overflow-wrap:anywhere]">{g.name}</td>
                  <td className="py-1 pr-3">{g.condition ?? "—"}</td>
                  <td className="py-1 pr-3">{mem(g)}</td>
                  <td className="py-1 pr-3">{g.batches}</td>
                  <td className="py-1 pr-3">{g.total}</td>
                  <td className="py-1 pr-3">
                    {ACTION_LABEL[g.action]}
                    {g.product ? (
                      <span className="block text-ink-mute">
                        “{g.product.name}”: {g.product.stock} → {g.total}
                        {g.decision === "linked" ? (
                          <button type="button" className="ml-1 underline" disabled={pending} onClick={() => onDecide(g.key, "clear")}>
                            unlink
                          </button>
                        ) : null}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1 font-mono text-[11px] text-ink-mute [overflow-wrap:anywhere]">{g.key}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
