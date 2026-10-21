"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, CircleHelp, ExternalLink, Plus, Sparkles, Trash2 } from "lucide-react";
import { runAiTaskAction, saveAiExtrasAction } from "@/app/admin/(panel)/ai-products/actions";
import { toastResult } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";
import { TASK_FIELDS, type ContentTask, type TrackedField, type Verification } from "@/lib/ai/product-content";
import { cn } from "@/lib/utils";

export interface AssistantProps {
  productId: string;
  reviewStatus: "pending" | "processing" | "ready" | "needs_verification" | "failed" | null;
  generatedAt: string | null;
  model: string | null;
  fields: { key: TrackedField; label: string; source: "ai" | "manual" | "empty" }[];
  specs: { label: string; value: string; status: Verification; source: string | null }[];
  sources: { url: string; title: string | null }[];
  extras: { faq: { q: string; a: string }[]; keywords: string[]; tags: string[]; manual: boolean };
  lastJob: { status: string; error: string | null; attempts: { attempt: number; provider: string; model: string; status: string; code: string | null }[]; fallbackUsed: boolean } | null;
  checklist: { hasImages: boolean; hasPrice: boolean; isPublished: boolean };
  external: { source: string; id: string; syncedAt: string; status: string; error: string | null; quantity: number | null; removed: boolean } | null;
}

const STATUS_TEXT: Record<NonNullable<AssistantProps["reviewStatus"]>, string> = {
  pending: "Pending",
  processing: "Processing",
  ready: "Ready for Review",
  needs_verification: "Needs Verification",
  failed: "Failed",
};

const VERIFY_ICON: Record<Verification, { Icon: typeof CheckCircle2; cls: string; text: string }> = {
  VERIFIED: { Icon: CheckCircle2, cls: "text-signal", text: "verified" },
  LIKELY: { Icon: CheckCircle2, cls: "text-taka", text: "likely, not verified" },
  NEEDS_VERIFICATION: { Icon: AlertTriangle, cls: "text-warn", text: "needs verification" },
  UNKNOWN: { Icon: CircleHelp, cls: "text-ink-mute", text: "not found" },
  CONFLICT: { Icon: AlertTriangle, cls: "text-deal", text: "sources disagree" },
  USER_PROVIDED: { Icon: CheckCircle2, cls: "text-signal", text: "entered by you" },
};

/**
 * The saved product's AI status (fields, specification checks, sources, FAQ / keywords / tags,
 * last job). Shown INSIDE the AI Product Assistant (one AI section on the page); its actions live
 * in the assistant: generating there, "Improve existing content" under More options.
 */
export function AiAssistant(props: AssistantProps) {
  const generated = Boolean(props.generatedAt);
  const counts = { ai: props.fields.filter((f) => f.source === "ai").length, manual: props.fields.filter((f) => f.source === "manual").length, empty: props.fields.filter((f) => f.source === "empty").length };
  return (
    <details className="mt-4 rounded-lg border border-line bg-surface p-3">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
        <span id="ai-assistant" className="font-semibold">
          Saved content status
        </span>
        {props.reviewStatus ? (
          <Badge tone={props.reviewStatus === "ready" ? "signal" : props.reviewStatus === "failed" ? "deal" : props.reviewStatus === "needs_verification" ? "warn" : "neutral"}>{STATUS_TEXT[props.reviewStatus]}</Badge>
        ) : null}
        <span className="text-ink-soft">
          {counts.ai} AI · {counts.manual} edited by you · {counts.empty} empty
          {generated ? ` · generated ${new Date(props.generatedAt!).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}${props.model ? ` with ${props.model}` : ""}` : ""}
        </span>
      </summary>
      <div className="mt-3 grid gap-4 lg:grid-cols-3">
        <div>
          <h3 className="text-sm font-semibold">Fields</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {props.fields.map((f) => (
              <li key={f.key} className="flex items-center justify-between gap-2">
                <span>{f.label}</span>
                {f.source === "ai" ? <Badge tone="signal">AI Generated</Badge> : f.source === "manual" ? <Badge tone="ink">Manually Edited</Badge> : <Badge>Empty</Badge>}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-semibold">AI verification</h3>
          {props.specs.length === 0 ? (
            <p className="mt-2 text-sm text-ink-mute">Run the AI to check specifications.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {props.specs.map((s) => {
                const v = VERIFY_ICON[s.status];
                return (
                  <li key={s.label} className="flex items-start gap-2">
                    <v.Icon className={cn("mt-0.5 h-4 w-4 shrink-0", v.cls)} aria-hidden />
                    <span className="min-w-0">
                      <span className="font-medium">{s.label}</span> <span className="text-ink-soft">{s.value}</span>
                      <span className={cn("block text-xs", v.cls)}>
                        {v.text}
                        {s.source && /^https?:/.test(s.source) ? (
                          <>
                            {" · "}
                            <a href={s.source} target="_blank" rel="noopener noreferrer nofollow" className="underline">
                              source
                            </a>
                          </>
                        ) : s.source === "stock" ? " · from stock" : null}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {props.sources.length ? (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer font-medium">Sources ({props.sources.length})</summary>
              <ul className="mt-1 space-y-0.5">
                {props.sources.slice(0, 12).map((s) => (
                  <li key={s.url}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 underline">
                      {s.title || new URL(s.url).hostname} <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>

        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Before you publish</h3>
            <ul className="mt-2 space-y-1 text-sm">
              <Check ok={props.checklist.hasImages} text="Product photos added (by you)" />
              <Check ok={props.checklist.hasPrice} text="Selling price entered (by you)" />
              <Check ok={props.reviewStatus === "ready"} text="AI content reviewed, specs verified" warnOnly />
              <Check ok={props.checklist.isPublished} text="Status set to Active and saved" warnOnly />
            </ul>
          </div>
          {props.external ? (
            <div className="rounded-lg border border-line bg-surface p-3 text-xs text-ink-soft">
              <p className="font-semibold text-ink">
                From stock ({props.external.source}) #{props.external.id}
              </p>
              <p>
                Stock qty {props.external.quantity ?? "—"} · synced {new Date(props.external.syncedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} · {props.external.status}
              </p>
              {props.external.removed ? <p className="text-deal">Removed from the stock system. The website product was kept.</p> : null}
              {props.external.error ? <p className="text-warn">{props.external.error}</p> : null}
            </div>
          ) : null}
          {props.lastJob ? (
            <div className="text-xs text-ink-soft">
              <p className="font-semibold text-ink">
                Last job: {props.lastJob.status}
                {props.lastJob.fallbackUsed ? " (fallback used)" : ""}
              </p>
              <ol>
                {props.lastJob.attempts.map((a) => (
                  <li key={a.attempt}>
                    Attempt {a.attempt}: {a.provider} · {a.model} — {a.status === "success" ? "SUCCESS" : (a.code ?? a.status)}
                  </li>
                ))}
              </ol>
              {props.lastJob.error ? <p className="text-deal">{props.lastJob.error}</p> : null}
            </div>
          ) : null}
        </div>
      </div>

      <ExtrasEditor productId={props.productId} initial={props.extras} />
    </details>
  );
}

/** "Improve existing content" (rewrites the SAVED text in place; asks before replacing your edits). */
export function ImproveContentButton(props: Pick<AssistantProps, "productId" | "fields" | "extras" | "generatedAt"> & { disabled?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const task: ContentTask = "improve";
  const manual = props.fields.filter((f) => TASK_FIELDS[task].includes(f.key) && f.source === "manual").map((f) => f.label);
  const nothing = !props.generatedAt && props.fields.every((f) => f.source === "empty");
  function run(replace: boolean) {
    dialogRef.current?.close();
    start(async () => {
      toastResult(await runAiTaskAction(props.productId, task, replace));
      router.refresh();
    });
  }
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        loading={pending}
        disabled={props.disabled || pending || nothing}
        title="Rewrites the saved text in place. Save your changes first; the page reloads with the result."
        onClick={() => {
          if (manual.length) {
            setConfirm(manual);
            dialogRef.current?.showModal();
          } else run(false);
        }}
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden /> Improve existing content
      </Button>
      <dialog ref={dialogRef} className="m-auto w-[min(92vw,460px)] rounded-[var(--radius-card)] border border-line bg-surface p-0 text-ink backdrop:bg-ink/40" aria-labelledby="ai-confirm-title">
        <div className="p-5">
          <h2 id="ai-confirm-title" className="text-lg font-bold">
            Improve and replace my edits?
          </h2>
          <p className="mt-1.5 text-sm text-ink-soft">You edited these by hand: {confirm?.join(", ")}.</p>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => dialogRef.current?.close()}>
              Cancel
            </Button>
            <Button type="button" variant="outline" onClick={() => run(false)}>
              Keep my edits
            </Button>
            <Button type="button" variant="danger" onClick={() => run(true)}>
              Replace my edits
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}

function Check({ ok, text, warnOnly = false }: { ok: boolean; text: string; warnOnly?: boolean }) {
  return (
    <li className="flex items-center gap-2">
      {ok ? <CheckCircle2 className="h-4 w-4 text-signal" aria-hidden /> : <AlertTriangle className={cn("h-4 w-4", warnOnly ? "text-ink-mute" : "text-warn")} aria-hidden />}
      <span className={ok ? "" : "text-ink-soft"}>{text}</span>
    </li>
  );
}

function ExtrasEditor({ productId, initial }: { productId: string; initial: AssistantProps["extras"] }) {
  const router = useRouter();
  const [faq, setFaq] = useState(initial.faq);
  const [keywords, setKeywords] = useState(initial.keywords.join(", "));
  const [tags, setTags] = useState(initial.tags.join(", "));
  const [pending, start] = useTransition();
  const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

  return (
    <details className="mt-4 rounded-lg border border-line bg-surface p-3">
      <summary className="cursor-pointer text-sm font-semibold">
        FAQ, SEO keywords and tags {initial.manual ? <Badge tone="ink">Manually Edited</Badge> : initial.faq.length ? <Badge tone="signal">AI Generated</Badge> : null}
      </summary>
      <div className="mt-3 space-y-3">
        {faq.map((item, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
            <Input aria-label={`Question ${i + 1}`} value={item.q} maxLength={200} onChange={(e) => setFaq(faq.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))} />
            <Textarea aria-label={`Answer ${i + 1}`} rows={2} value={item.a} maxLength={600} onChange={(e) => setFaq(faq.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))} />
            <Button variant="ghost" size="icon" aria-label={`Remove question ${i + 1}`} onClick={() => setFaq(faq.filter((_, j) => j !== i))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {faq.length < 12 ? (
          <Button variant="outline" size="sm" onClick={() => setFaq([...faq, { q: "", a: "" }])}>
            <Plus className="h-4 w-4" aria-hidden /> Add question
          </Button>
        ) : null}
        <label className="block text-sm font-medium">
          SEO keywords (comma separated)
          <Input className="mt-1" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
        </label>
        <label className="block text-sm font-medium">
          Tags (comma separated)
          <Input className="mt-1" value={tags} onChange={(e) => setTags(e.target.value)} />
        </label>
        <Button
          size="sm"
          loading={pending}
          onClick={() =>
            start(async () => {
              if (toastResult(await saveAiExtrasAction(productId, { faq: faq.filter((x) => x.q.trim() && x.a.trim()), keywords: split(keywords), tags: split(tags) }))) router.refresh();
            })
          }
        >
          Save FAQ, keywords and tags
        </Button>
        <p className="text-xs text-ink-mute">Stored with the product for review. They are not shown on the public product page yet.</p>
      </div>
    </details>
  );
}
