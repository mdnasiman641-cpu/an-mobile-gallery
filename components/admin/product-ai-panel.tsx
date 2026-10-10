"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Eraser, RefreshCw, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";
import { relativeTime } from "@/components/admin/ai-health";
import {
  COMPLETION_SECTIONS,
  SECTION_LABELS,
  type CompletionCheck,
  type CompletionRun,
  type CompletionSection,
  type FieldState,
} from "@/lib/ai/product-completion";
import type { Verification } from "@/lib/ai/product-content";

export interface ReviewItem {
  label: string;
  value: string | null;
  status: Verification;
}

export interface AiPanelProps {
  name: string;
  price: string;
  ram: string;
  storage: string;
  onName: (v: string) => void;
  onPrice: (v: string) => void;
  onRam: (v: string) => void;
  onStorage: (v: string) => void;
  errors: Record<string, string>;
  hasVariants: boolean;
  /** Why AI can't run here (migration missing / no models), or null. */
  setupMessage: string | null;
  canManageAi: boolean;
  busy: boolean;
  disabled: boolean;
  onComplete: (sections: CompletionSection[]) => void;
  run: CompletionRun | null;
  justCompleted: boolean;
  error: { message: string; details: string[]; draftSaved: boolean } | null;
  confirm: { conflicts: string[] } | null;
  onConfirm: (replace: boolean) => void;
  lastApply: { applied: string[]; kept: string[] } | null;
  unapplied: string[];
  onApplyCached: () => void;
  review: ReviewItem[];
  onUseValue: (item: ReviewItem) => void;
  skuSuggestion: string | null;
  onUseSku: () => void;
  newBrand: string | null;
  newCategory: string | null;
  aiFieldCount: number;
  onClearSection: (s: CompletionSection) => void;
  onRemoveAll: () => void;
  /** Field-level result of the last run (or null before any run). */
  check: CompletionCheck | null;
  /** Sections being generated right now. */
  busySections: CompletionSection[];
  /** Sections with empty fields in the form now. */
  missing: CompletionSection[];
  onGenerateMissing: () => void;
}

const STATE_BADGE: Record<FieldState, { tone: "signal" | "warn" | "deal" | "neutral"; text: string }> = {
  pending: { tone: "neutral", text: "Pending" },
  generating: { tone: "neutral", text: "Generating…" },
  success: { tone: "signal", text: "Success" },
  partial: { tone: "warn", text: "Partial" },
  failed: { tone: "deal", text: "Failed" },
  skipped: { tone: "neutral", text: "Not requested" },
};

/** One generation action per section ("Research product" = identity + specifications from the web). */
const ACTIONS: { label: string; sections: CompletionSection[]; research?: boolean }[] = [
  { label: "Research product", sections: ["basic", "specs"], research: true },
  { label: "Generate specifications", sections: ["specs"] },
  { label: "Generate description", sections: ["description"] },
  { label: "Generate SEO", sections: ["seo"] },
  { label: "Generate FAQ", sections: ["faq"] },
];

export function ProductAiPanel(p: AiPanelProps) {
  const completion = p.run?.completion ?? null;
  const ran = Boolean(p.run);
  const [selected, setSelected] = useState<CompletionSection[]>([]);
  const blocked = p.disabled || p.busy || Boolean(p.setupMessage);
  const toggle = (s: CompletionSection) => setSelected((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  // While a run is going, its fields show "Generating…"; the rest keep their last state.
  const fields = (p.check?.fields ?? []).map((f) =>
    p.busy && p.busySections.includes(f.section) ? { ...f, state: "generating" as FieldState, note: null } : f,
  );
  const failedRequired = p.check && !p.busy ? p.check.retrySections : [];
  return (
    <section aria-labelledby="ai-quick-title" className="mb-4 rounded-[var(--radius-card)] border border-signal/30 bg-surface p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="ai-quick-title" className="flex items-center gap-2 text-base font-bold">
            <Sparkles className="h-5 w-5 text-signal" aria-hidden /> Quick start
          </h2>
          <p className="text-sm text-ink-soft">Enter these four, then let AI fill in the rest for you to review. AI never changes them and never publishes.</p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Product name" htmlFor="quick-name" required error={p.errors.name} hint="e.g. Redmi 15">
          <Input id="quick-name" value={p.name} onChange={(e) => p.onName(e.target.value)} aria-invalid={Boolean(p.errors.name)} />
        </Field>
        <Field label="Selling price (৳)" htmlFor="quick-price" required error={p.errors.price} hint={p.hasVariants ? "Variants have their own prices" : "e.g. 18999"}>
          <Input id="quick-price" inputMode="decimal" value={p.price} onChange={(e) => p.onPrice(e.target.value)} aria-invalid={Boolean(p.errors.price)} />
        </Field>
        <Field label="RAM" htmlFor="quick-ram" required error={p.errors.quick_ram} hint="e.g. 6GB">
          <Input id="quick-ram" value={p.ram} onChange={(e) => p.onRam(e.target.value)} aria-invalid={Boolean(p.errors.quick_ram)} />
        </Field>
        <Field label="ROM / Storage" htmlFor="quick-storage" required error={p.errors.quick_storage} hint="e.g. 128GB">
          <Input id="quick-storage" value={p.storage} onChange={(e) => p.onStorage(e.target.value)} aria-invalid={Boolean(p.errors.quick_storage)} />
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => p.onComplete([...COMPLETION_SECTIONS])} loading={p.busy} disabled={p.disabled || Boolean(p.setupMessage)}>
          {p.busy ? null : <Sparkles className="h-4 w-4" aria-hidden />}
          {ran ? "Complete again with AI" : "Complete with AI"}
        </Button>
        {p.aiFieldCount > 0 && !p.busy ? (
          <Button type="button" variant="ghost" size="sm" onClick={p.onRemoveAll}>
            <Eraser className="h-4 w-4" aria-hidden /> Remove AI content
          </Button>
        ) : null}
        <p className="text-xs text-ink-mute" aria-live="polite">
          {p.busy ? "AI is researching and completing product information…" : ran && p.run ? `Last AI run ${relativeTime(p.run.createdAt)} · ${p.run.usedModel}` : null}
        </p>
      </div>

      <div className="mt-4 space-y-3 rounded-lg bg-paper p-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Generate one part">
          {ACTIONS.map((a) => (
            <Button key={a.label} type="button" size="sm" variant="outline" disabled={blocked} onClick={() => p.onComplete(a.sections)}>
              {a.research ? <Search className="h-3.5 w-3.5" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />} {a.label}
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-auto min-h-9 whitespace-normal py-1.5 text-left"
            disabled={blocked || p.missing.length === 0}
            onClick={p.onGenerateMissing}
          >
            Generate all missing fields{p.missing.length ? ` (${p.missing.map((m) => SECTION_LABELS[m]).join(", ")})` : " — none missing"}
          </Button>
        </div>
        <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <legend className="sr-only">Regenerate selected parts</legend>
          <span className="text-xs font-semibold text-ink-mute">Regenerate selected:</span>
          {COMPLETION_SECTIONS.map((s) => (
            <label key={s} className="inline-flex min-h-8 items-center gap-1.5 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-[var(--color-signal)]" checked={selected.includes(s)} onChange={() => toggle(s)} />
              {SECTION_LABELS[s]}
            </label>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={blocked || selected.length === 0}
            onClick={() => p.onComplete(COMPLETION_SECTIONS.filter((s) => selected.includes(s)))}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Regenerate selected
          </Button>
        </fieldset>
        <p className="text-xs text-ink-mute">
          “Generate all missing fields” only fills empty fields and adds missing specifications; it never replaces what is already there. The other buttons replace AI text in their
          part (your own edits are kept unless you confirm).
        </p>
      </div>

      {p.setupMessage ? (
        <p className="mt-3 rounded-lg bg-warn-tint p-3 text-sm">
          {p.setupMessage}{" "}
          {p.canManageAi ? (
            <Link className="font-semibold underline" href="/admin/settings/ai">
              Open AI settings
            </Link>
          ) : null}
        </p>
      ) : null}

      {p.busy ? (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-signal-tint" role="progressbar" aria-label="AI is working">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-signal" />
        </div>
      ) : null}

      {p.error ? (
        <div className="mt-3 rounded-lg border border-deal/30 bg-deal-tint p-3 text-sm" role="alert">
          <p className="flex items-center gap-2 font-semibold text-deal">
            <AlertTriangle className="h-4 w-4" aria-hidden /> {p.error.message.split(/(?<=\.)\s/)[0]}
          </p>
          {p.error.message.split(/(?<=\.)\s/).length > 1 ? <p className="mt-1">{p.error.message.split(/(?<=\.)\s/).slice(1).join(" ")}</p> : null}
          {p.error.details.length ? (
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-ink-soft">
              {p.error.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          ) : null}
          {p.error.draftSaved ? <p className="mt-1.5 text-xs text-ink-soft">Your draft is saved. Nothing you entered was lost.</p> : null}
        </div>
      ) : null}

      {p.confirm ? (
        <div className="mt-3 rounded-lg border border-warn/40 bg-warn-tint p-3 text-sm" role="alert">
          <p className="font-semibold">You edited some of these fields yourself:</p>
          <p className="mt-0.5 text-ink-soft">{p.confirm.conflicts.join(" · ")}</p>
          <p className="mt-1">Replace your edits with the new AI text?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => p.onConfirm(false)}>
              Keep my edits (fill the rest)
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => p.onConfirm(true)}>
              Replace my edits
            </Button>
          </div>
        </div>
      ) : null}

      {p.unapplied.length && !p.busy && !p.confirm ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-paper p-3 text-sm">
          <p>
            The last AI result has values that aren&rsquo;t in the form yet: <span className="text-ink-soft">{p.unapplied.join(", ")}</span>.
          </p>
          <Button type="button" size="sm" variant="outline" onClick={p.onApplyCached}>
            Apply AI result
          </Button>
        </div>
      ) : null}

      {ran && p.run && completion ? (
        <div className="mt-4 space-y-3">
          {p.justCompleted && p.check ? (
            p.check.status === "success" ? (
              <p className="flex items-center gap-2 rounded-lg bg-signal-tint p-3 text-sm font-semibold text-signal-dark" role="status">
                <CheckCircle2 className="h-4 w-4" aria-hidden /> AI completed the product information. Please review before saving.
              </p>
            ) : (
              <p className="flex items-center gap-2 rounded-lg bg-warn-tint p-3 text-sm font-semibold" role="status">
                <AlertTriangle className="h-4 w-4 text-warn" aria-hidden /> Partly completed: some fields are missing or need checking (see below). What was filled is in the form for review.
              </p>
            )
          ) : null}
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div>
              <dt className="inline text-ink-mute">AI completed using: </dt>
              <dd className="inline font-semibold">{p.run.usedModel}</dd>
            </div>
            {p.run.fallbackUsed ? (
              <div>
                <dt className="inline text-ink-mute">Fallback used: </dt>
                <dd className="inline font-semibold">{p.run.chain.length > 1 ? p.run.chain.join(" → ") : `skipped ${p.run.skipped.length} unavailable model(s)`}</dd>
              </div>
            ) : null}
            <div>
              <dt className="inline text-ink-mute">Web research: </dt>
              <dd className="inline">
                {completion.researched
                  ? `yes, ${completion.sources.length} source${completion.sources.length === 1 ? "" : "s"} (listed below)`
                  : (p.run.researchNote ?? "not performed for this run — values are marked “likely”, not verified")}
              </dd>
            </div>
          </dl>
          {fields.length ? (
            <div className="rounded-lg border border-line">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
                <p className="text-sm font-semibold">Field status</p>
                {failedRequired.length ? (
                  <Button type="button" size="sm" variant="outline" disabled={blocked} onClick={() => p.onComplete(failedRequired)}>
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Retry failed fields
                  </Button>
                ) : null}
              </div>
              <ul className="divide-y divide-line text-sm" aria-label="Field status">
                {fields.map((f) => (
                  <li key={f.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-3 py-1.5">
                    <span className="min-w-0">
                      <span className="font-medium">{f.label}</span>
                      {f.note && f.state !== "skipped" ? <span className="text-ink-soft"> · {f.note}</span> : null}
                    </span>
                    <Badge tone={STATE_BADGE[f.state].tone}>{STATE_BADGE[f.state].text}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {p.run.skipped.length ? (
            <details className="text-xs text-ink-soft">
              <summary className="cursor-pointer">Skipped models ({p.run.skipped.length})</summary>
              <ul className="mt-1 list-disc pl-5">
                {p.run.skipped.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </details>
          ) : null}

          {p.lastApply && (p.lastApply.applied.length || p.lastApply.kept.length) ? (
            <p className="text-sm text-ink-soft">
              {p.lastApply.applied.length ? <>Filled: {p.lastApply.applied.join(", ")}. </> : null}
              {p.lastApply.kept.length ? <>Kept your edits: {p.lastApply.kept.join(", ")}.</> : null}
            </p>
          ) : null}

          {p.newBrand || p.newCategory || p.skuSuggestion ? (
            <ul className="space-y-1.5 text-sm">
              {p.newBrand ? (
                <li>
                  AI suggests the brand <strong>{p.newBrand}</strong>, which isn&rsquo;t in your list. Add it under{" "}
                  <Link className="underline" href="/admin/brands">
                    Brands
                  </Link>{" "}
                  first, then select it. Nothing was created automatically.
                </li>
              ) : null}
              {p.newCategory ? (
                <li>
                  AI suggests the category <strong>{p.newCategory}</strong>, which isn&rsquo;t in your list. Add it under{" "}
                  <Link className="underline" href="/admin/categories">
                    Categories
                  </Link>{" "}
                  if you want it.
                </li>
              ) : null}
              {p.skuSuggestion ? (
                <li className="flex flex-wrap items-center gap-2">
                  Suggested SKU (your internal code): <code className="rounded bg-paper px-1.5">{p.skuSuggestion}</code>
                  <Button type="button" size="sm" variant="ghost" onClick={p.onUseSku}>
                    Use
                  </Button>
                </li>
              ) : null}
            </ul>
          ) : null}

          {p.review.length ? (
            <details className="rounded-lg border border-line p-3 text-sm" open={p.justCompleted}>
              <summary className="cursor-pointer font-semibold">
                Needs verification ({p.review.filter((i) => i.value).length}){" "}
                <span className="font-normal text-ink-mute">· not found ({p.review.filter((i) => !i.value).length}) — left empty in the form</span>
              </summary>
              <ul className="mt-2 divide-y divide-line">
                {p.review
                  .filter((i) => i.value)
                  .map((item) => (
                    <li key={item.label} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                      <span>
                        <span className="font-medium">{item.label}</span>
                        <span className="text-ink-soft">: {item.value}</span> <Badge tone="warn">Needs verification</Badge>
                      </span>
                      <Button type="button" size="sm" variant="ghost" onClick={() => p.onUseValue(item)}>
                        I checked it — use
                      </Button>
                    </li>
                  ))}
              </ul>
              {p.review.some((i) => !i.value) ? (
                <p className="mt-2 text-xs text-ink-soft">
                  <span className="font-semibold">Not found (fill in by hand if you know them):</span>{" "}
                  {p.review
                    .filter((i) => !i.value)
                    .map((i) => i.label)
                    .join(", ")}
                </p>
              ) : null}
            </details>
          ) : null}

          {completion.faq.length || completion.seo.keywords.length ? (
            <details className="rounded-lg border border-line p-3 text-sm">
              <summary className="cursor-pointer font-semibold">FAQ and SEO keywords</summary>
              <p className="mt-1 text-xs text-ink-mute">Saved with the product&rsquo;s AI content (edit them in the AI Assistant on the product page). Not shown publicly.</p>
              {completion.seo.keywords.length ? <p className="mt-2">Keywords: {completion.seo.keywords.join(", ")}</p> : null}
              <dl className="mt-2 space-y-2">
                {completion.faq.map((f, i) => (
                  <div key={i}>
                    <dt className="font-medium">{f.q}</dt>
                    <dd className="text-ink-soft">{f.a}</dd>
                  </div>
                ))}
              </dl>
            </details>
          ) : null}

          {completion.sources.length ? (
            <details className="text-xs text-ink-soft">
              <summary className="cursor-pointer">Sources ({completion.sources.length})</summary>
              <ul className="mt-1 list-disc pl-5">
                {completion.sources.map((s) => (
                  <li key={s.url}>
                    <a className="underline" href={s.url} target="_blank" rel="noopener noreferrer nofollow">
                      {s.title || s.url}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            <span className="self-center text-xs font-semibold text-ink-mute">Clear AI text:</span>
            {COMPLETION_SECTIONS.filter((s) => s !== "faq").map((s) => (
              <Button key={s} type="button" size="sm" variant="ghost" disabled={p.busy} onClick={() => p.onClearSection(s)}>
                <Eraser className="h-3.5 w-3.5" aria-hidden /> {SECTION_LABELS[s]}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** Small tag next to a field label. */
export function AiTag({ origin }: { origin: "ai" | "manual" | "empty" }) {
  if (origin === "ai") return <Badge tone="signal">AI</Badge>;
  return null;
}
