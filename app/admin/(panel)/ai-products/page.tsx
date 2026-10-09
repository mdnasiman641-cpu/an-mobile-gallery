import type { Metadata } from "next";
import Link from "next/link";
import { hasRole, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminPageHeader, adminTable } from "@/components/admin/page-header";
import { HealthBadge, effectiveStatus, relativeTime, successRate } from "@/components/admin/ai-health";
import { ProcessQueueButton, RegenerateButton, RetryJobButton, SyncStockButton } from "@/components/admin/ai-products";
import { Badge } from "@/components/ui/misc";
import { STOCK_SOURCE } from "@/lib/integrations/stock-sync";
import { formatPrice } from "@/lib/utils";
import type { HealthStatus } from "@/lib/ai/types";

export const metadata: Metadata = { title: "AI Products" };

const STATUS_LABEL = {
  pending: "Pending",
  processing: "Processing",
  ready: "Ready for Review",
  needs_verification: "Needs Verification",
  failed: "Failed",
  published: "Published",
} as const;
type QueueStatus = keyof typeof STATUS_LABEL;
const TONE: Record<QueueStatus, "neutral" | "signal" | "warn" | "deal" | "ink"> = {
  pending: "neutral",
  processing: "neutral",
  ready: "signal",
  needs_verification: "warn",
  failed: "deal",
  published: "ink",
};

interface ContentRow {
  product_id: string;
  review_status: Exclude<QueueStatus, "published">;
  model: string | null;
  generated_at: string | null;
  updated_at: string;
  product: { id: string; name: string; slug: string; status: string; price: number; stock_quantity: number } | null;
}

interface JobRow {
  id: string;
  product_id: string;
  task_type: string;
  status: string;
  trigger: string;
  attempts: number;
  fallback_used: boolean;
  final_provider: string | null;
  final_model: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  product: { name: string } | null;
  ai_job_attempts: { attempt: number; provider: string; model: string; status: string; error_code: string | null; http_status: number | null }[];
}

export default async function AiProductsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const session = await requireStaff("editor");
  const isAdmin = hasRole(session, "admin");
  const { status: filter } = await searchParams;
  const supabase = await createClient();

  const [contentRes, jobsRes, pendingRes, runRes, healthRes, modelsRes] = await Promise.all([
    supabase
      .from("ai_product_content")
      .select("product_id, review_status, model, generated_at, updated_at, product:products(id, name, slug, status, price, stock_quantity)")
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("ai_jobs")
      .select("id, product_id, task_type, status, trigger, attempts, fallback_used, final_provider, final_model, error_code, error_message, created_at, completed_at, product:products(name), ai_job_attempts(attempt, provider, model, status, error_code, http_status)")
      .order("created_at", { ascending: false })
      .limit(15),
    supabase.from("ai_jobs").select("id", { count: "exact", head: true }).in("status", ["pending", "processing"]),
    supabase.from("sync_runs").select("trigger, started_at, finished_at, imported, updated, skipped, failed").eq("source", STOCK_SOURCE).order("started_at", { ascending: false }).limit(1).maybeSingle(),
    isAdmin ? supabase.from("ai_model_health").select("model_id, status, cooldown_until, total_requests, successful_requests") : Promise.resolve({ data: [] }),
    isAdmin ? supabase.from("ai_models").select("id, display_name, model_name, priority, is_enabled").order("priority") : Promise.resolve({ data: [] }),
  ]);

  if (contentRes.error) {
    return (
      <>
        <AdminPageHeader title="AI Products" />
        <p className="rounded-[var(--radius-card)] border border-warn/30 bg-warn-tint p-4 text-sm">
          This page needs the latest database migration (<code>20261009000010_homepage_ai_sync.sql</code>).
        </p>
      </>
    );
  }

  const rows = ((contentRes.data as unknown as ContentRow[]) ?? [])
    .filter((r) => r.product)
    .map((r) => ({ ...r, queue: (r.product!.status === "active" || r.product!.status === "out_of_stock" ? "published" : r.review_status) as QueueStatus }));
  const counts = rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.queue]: (acc[r.queue] ?? 0) + 1 }), {});
  const shown = filter && filter in STATUS_LABEL ? rows.filter((r) => r.queue === filter) : rows;
  const jobs = (jobsRes.data as unknown as JobRow[]) ?? [];
  const latestJob = new Map<string, JobRow>();
  for (const j of jobs) if (!latestJob.has(j.product_id)) latestJob.set(j.product_id, j);
  const run = runRes.data as { trigger: string; started_at: string; finished_at: string | null; imported: number; updated: number; skipped: number; failed: number } | null;
  const health = new Map(((healthRes.data as { model_id: string; status: HealthStatus; cooldown_until: string | null; total_requests: number; successful_requests: number }[]) ?? []).map((h) => [h.model_id, h]));
  const models = (modelsRes.data as { id: string; display_name: string; model_name: string; priority: number; is_enabled: boolean }[]) ?? [];

  return (
    <>
      <AdminPageHeader
        title="AI Products"
        description="Products imported from stock and AI drafts waiting for your review. AI never sets prices or publishes."
        actions={<ProcessQueueButton count={pendingRes.count ?? 0} />}
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-4" aria-labelledby="sync-title">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="sync-title" className="font-semibold">
                Stock sync ({STOCK_SOURCE})
              </h2>
              <p className="text-sm text-ink-soft">New stock items become drafts here automatically through the webhook.</p>
            </div>
            {isAdmin ? <SyncStockButton disabled={!process.env.STOCK_EXPORT_URL} /> : null}
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
            <div className="col-span-2 sm:col-span-1">
              <dt className="text-xs text-ink-mute">Last sync</dt>
              <dd className="font-medium">{run ? `${relativeTime(run.started_at)} (${run.trigger})` : "Never"}</dd>
            </div>
            {(["imported", "updated", "skipped", "failed"] as const).map((k) => (
              <div key={k}>
                <dt className="text-xs capitalize text-ink-mute">{k}</dt>
                <dd className="font-medium tabular-nums">{run ? run[k] : 0}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-ink-mute">
            Webhook: {process.env.STOCK_WEBHOOK_SECRET ? "configured" : "not configured (set STOCK_WEBHOOK_SECRET)"} · Manual sync:{" "}
            {process.env.STOCK_EXPORT_URL ? "configured" : "not configured (set STOCK_EXPORT_URL)"}
          </p>
        </section>

        {isAdmin ? (
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-4" aria-labelledby="health-title">
            <div className="flex items-center justify-between">
              <h2 id="health-title" className="font-semibold">
                AI model health
              </h2>
              <Link href="/admin/settings/ai" className="text-sm font-semibold text-signal hover:underline">
                AI settings
              </Link>
            </div>
            {models.length === 0 ? (
              <p className="mt-2 text-sm text-ink-soft">No AI models configured yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line text-sm">
                {models.map((m) => {
                  const h = health.get(m.id);
                  return (
                    <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                      <span className="min-w-0 flex-1 truncate font-medium">{m.display_name}</span>
                      <span className="text-xs text-ink-mute">P{m.priority}</span>
                      <HealthBadge status={effectiveStatus({ isEnabled: m.is_enabled, status: h?.status ?? "HEALTHY" })} cooldownUntil={h?.cooldown_until} />
                      <span className="w-16 text-right text-xs text-ink-mute">{successRate({ successfulRequests: h?.successful_requests ?? 0, totalRequests: h?.total_requests ?? 0 })}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}
      </div>

      <nav aria-label="Filter by status" className="mb-3 flex flex-wrap gap-1.5">
        <Link href="/admin/ai-products" className={`rounded-full px-3 py-1.5 text-sm font-medium ${!filter ? "bg-ink text-white" : "bg-surface text-ink-soft ring-1 ring-line"}`}>
          All ({rows.length})
        </Link>
        {(Object.keys(STATUS_LABEL) as QueueStatus[]).map((k) => (
          <Link
            key={k}
            href={`/admin/ai-products?status=${k}`}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${filter === k ? "bg-ink text-white" : "bg-surface text-ink-soft ring-1 ring-line"}`}
          >
            {STATUS_LABEL[k]} ({counts[k] ?? 0})
          </Link>
        ))}
      </nav>

      <div className={adminTable.wrap}>
        <table className={adminTable.table}>
          <thead>
            <tr>
              <th className={adminTable.th}>Product</th>
              <th className={adminTable.th}>AI status</th>
              <th className={adminTable.th}>Price</th>
              <th className={adminTable.th}>Stock</th>
              <th className={adminTable.th}>Last AI run</th>
              <th className={adminTable.th}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td className={adminTable.td} colSpan={6}>
                  <span className="text-ink-mute">Nothing here yet.</span>
                </td>
              </tr>
            ) : (
              shown.map((r) => {
                const p = r.product!;
                const job = latestJob.get(p.id);
                return (
                  <tr key={r.product_id}>
                    <td className={adminTable.td}>
                      <Link href={`/admin/products/${p.id}`} className="font-medium hover:underline">
                        {p.name}
                      </Link>
                    </td>
                    <td className={adminTable.td}>
                      <Badge tone={TONE[r.queue]}>{STATUS_LABEL[r.queue]}</Badge>
                      {job?.status === "failed" && job.error_message ? <p className="mt-1 max-w-xs text-xs text-deal">{job.error_message.slice(0, 160)}</p> : null}
                    </td>
                    <td className={adminTable.td}>{Number(p.price) > 0 ? formatPrice(Number(p.price)) : <span className="text-warn">Not set</span>}</td>
                    <td className={adminTable.td}>{p.stock_quantity}</td>
                    <td className={adminTable.td}>
                      <span className="text-xs text-ink-soft">{r.generated_at ? `${relativeTime(r.generated_at)} · ${r.model ?? ""}` : "—"}</span>
                    </td>
                    <td className={adminTable.td}>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Link href={`/admin/products/${p.id}`} className="inline-flex h-9 items-center rounded-[var(--radius-control)] bg-signal px-3 text-sm font-semibold text-white hover:bg-signal-dark">
                          Review
                        </Link>
                        {job?.status === "failed" ? <RetryJobButton jobId={job.id} /> : null}
                        {r.queue !== "processing" && r.queue !== "pending" ? <RegenerateButton productId={p.id} /> : null}
                        {r.queue === "published" ? (
                          <Link href={`/products/${p.slug}`} target="_blank" className="inline-flex h-9 items-center px-2 text-sm font-semibold text-signal hover:underline">
                            View product
                          </Link>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <section className="mt-8" aria-labelledby="joblog-title">
        <h2 id="joblog-title" className="mb-3 text-lg font-bold">
          AI job log
        </h2>
        {jobs.length === 0 ? (
          <p className="text-sm text-ink-mute">No AI jobs yet.</p>
        ) : (
          <ul className="space-y-2">
            {jobs.map((j) => (
              <li key={j.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{j.product?.name ?? "Deleted product"}</span>
                  <Badge>{j.task_type === "complete" ? "complete with AI" : j.task_type}</Badge>
                  <Badge tone={j.status === "succeeded" ? "signal" : j.status === "failed" ? "deal" : "neutral"}>{j.status}</Badge>
                  {j.fallback_used ? <Badge tone="warn">fallback used</Badge> : null}
                  <span className="text-xs text-ink-mute">
                    {relativeTime(j.created_at)} · {j.trigger}
                  </span>
                </div>
                {j.ai_job_attempts.length ? (
                  <ol className="mt-2 space-y-0.5 text-xs text-ink-soft">
                    {[...j.ai_job_attempts]
                      .sort((a, b) => a.attempt - b.attempt)
                      .map((a) => (
                        <li key={a.attempt}>
                          Attempt {a.attempt}: {a.provider} · {a.model} —{" "}
                          <span className={a.status === "success" ? "font-semibold text-signal" : a.status === "failed" ? "text-deal" : "text-ink-mute"}>
                            {a.status === "success" ? "SUCCESS" : `${a.error_code ?? a.status.toUpperCase()}${a.http_status ? ` (${a.http_status})` : ""}`}
                          </span>
                        </li>
                      ))}
                  </ol>
                ) : null}
                {j.final_model ? (
                  <p className="mt-1 text-xs text-ink-mute">
                    Final provider: {j.final_provider} · {j.final_model}
                  </p>
                ) : null}
                {j.status === "failed" && j.error_message ? <p className="mt-1 text-xs text-deal">{j.error_message}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
