"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { deletePageAction, savePageAction } from "@/app/admin/(panel)/content-actions";
import { ConfirmButton, toastResult } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";
import { RichText } from "@/components/ui/rich-text";
import { slugify } from "@/lib/slug";
import type { Page } from "@/types";

type Form = { slug: string; title: string; content: string; meta_title: string; meta_description: string; is_published: boolean };
const blank: Form = { slug: "", title: "", content: "", meta_title: "", meta_description: "", is_published: true };

export function PageManager({ pages, canDelete }: { pages: Page[]; canDelete: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [f, setF] = useState<Form>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));
  const publicPath = (slug: string) => (slug === "about" ? "/about" : `/pages/${slug}`);

  function open(p?: Page) {
    setErrors({});
    setEditing(p ? p.id : "new");
    setF(p ? { slug: p.slug, title: p.title, content: p.content, meta_title: p.meta_title ?? "", meta_description: p.meta_description ?? "", is_published: p.is_published } : blank);
  }

  function save() {
    start(async () => {
      const res = await savePageAction(editing === "new" ? null : editing, { ...f, slug: f.slug || slugify(f.title) });
      if (!res.ok) setErrors(res.fieldErrors ?? {});
      if (toastResult(res)) {
        if (res.data) setEditing(res.data.id);
        router.refresh();
      }
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div>
        <Button className="mb-3 w-full" onClick={() => open()}>
          <Plus className="h-4 w-4" aria-hidden />
          New page
        </Button>
        <ul className="space-y-1.5">
          {pages.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => open(p)}
                className={`w-full rounded-[var(--radius-control)] border px-3 py-2.5 text-left ${editing === p.id ? "border-ink bg-surface" : "border-line bg-surface hover:border-line-strong"}`}
              >
                <span className="block font-semibold">{p.title}</span>
                <span className="text-xs text-ink-mute">{publicPath(p.slug)}</span>
                {!p.is_published ? <Badge className="ml-2">Hidden</Badge> : null}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {editing ? (
        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5" aria-label="Page editor">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Title" htmlFor="p-title" error={errors.title} required>
              <Input id="p-title" value={f.title} onChange={(e) => set("title", e.target.value)} />
            </Field>
            <Field label="URL" htmlFor="p-slug" error={errors.slug} hint={`Shown at ${publicPath(f.slug || slugify(f.title) || "page")}`}>
              <Input id="p-slug" value={f.slug} placeholder={slugify(f.title)} onChange={(e) => set("slug", slugify(e.target.value))} disabled={f.slug === "about" && editing !== "new"} />
            </Field>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Field label="Content" htmlFor="p-content" hint="## Heading, - bullet, **bold**, [link](https://…)">
              <Textarea id="p-content" rows={18} value={f.content} onChange={(e) => set("content", e.target.value)} className="font-mono text-sm" />
            </Field>
            <div>
              <p className="text-sm font-medium">Preview</p>
              <div className="mt-1.5 min-h-40 rounded-[var(--radius-control)] border border-line bg-paper p-4 text-sm">
                <RichText content={f.content} />
              </div>
            </div>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="SEO title" htmlFor="p-mt">
              <Input id="p-mt" value={f.meta_title} placeholder={f.title} onChange={(e) => set("meta_title", e.target.value)} />
            </Field>
            <Field label="SEO description" htmlFor="p-md">
              <Input id="p-md" value={f.meta_description} onChange={(e) => set("meta_description", e.target.value)} maxLength={320} />
            </Field>
          </div>
          <Checkbox className="mt-4" label="Published" checked={f.is_published} onChange={(e) => set("is_published", e.target.checked)} />
          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={save} loading={pending}>
              Save page
            </Button>
            {editing !== "new" && canDelete && f.slug !== "about" ? (
              <ConfirmButton
                title={`Delete “${f.title}”?`}
                confirmLabel="Delete page"
                variant="ghost"
                onConfirm={async () => {
                  const res = await deletePageAction(editing);
                  if (res.ok) {
                    setEditing(null);
                    router.refresh();
                  }
                  return res;
                }}
              >
                Delete
              </ConfirmButton>
            ) : null}
          </div>
        </section>
      ) : (
        <p className="text-ink-soft">Choose a page to edit, or create a new one (for example a delivery information page).</p>
      )}
    </div>
  );
}
