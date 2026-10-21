"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, PlugZap, FlaskConical } from "lucide-react";
import { checkLovableConnectionAction, syncLovableStockAction } from "@/app/admin/(panel)/inventory/lovable-actions";
import { toastResult } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { formatDate } from "@/lib/utils";

export interface LovableSyncView {
  configured: boolean;
  configProblem: string | null;
  migrationMissing: boolean;
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
  const s = view.summary;
  const c = view.contract;
  const disabled = pending || !view.configured || view.migrationMissing;

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
          <Button type="button" size="sm" variant="outline" disabled={disabled || !c.checked_at} loading={pending} onClick={() => run(() => syncLovableStockAction("test"))}>
            <FlaskConical className="h-4 w-4" aria-hidden /> Test first 5
          </Button>
          <Button type="button" size="sm" disabled={disabled || !c.checked_at} loading={pending} onClick={() => run(() => syncLovableStockAction("auto"))}>
            <RefreshCw className="h-4 w-4" aria-hidden /> {view.resumePage ? `Continue sync (page ${view.resumePage})` : "Sync Lovable Stock Now"}
          </Button>
        </span>
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        Imports from khadijatelecom1.lovable.app. New products arrive as drafts (price 0, not public). Stock is updated for existing products. Prices, photos, descriptions and
        publishing stay under your control; nothing is ever deleted here.
      </p>

      {view.migrationMissing ? (
        <p className="mt-3 rounded-lg bg-warn-tint p-3 text-sm text-warn" role="status">
          Run database migration 0022 (supabase/migrations/20261021000022_inventory_sync_state.sql) in the Supabase SQL editor first.
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
          <li><Badge tone="signal">{s.imported ?? 0} new imported</Badge></li>
          <li><Badge tone="signal">{s.updated ?? 0} updated</Badge></li>
          <li><Badge>{s.unchanged ?? 0} unchanged</Badge></li>
          <li><Badge tone="warn">{s.skipped ?? 0} skipped</Badge></li>
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
