"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Plus } from "lucide-react";
import { deleteArticleAction, saveArticleAction } from "@/app/admin/(panel)/guides/actions";
import { ConfirmButton, ImageField, toastResult } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";
import { RichText } from "@/components/ui/rich-text";
import { ARTICLE_LIMITS, isArticlePublic, type Article } from "@/lib/articles";
import { slugify } from "@/lib/slug";
import { cn } from "@/lib/utils";

interface Option {
  id: string;
  name: string;
}

type Form = {
  title: string;
  slug: string;
  slugTouched: boolean;
  excerpt: string;
  content: string;
  meta_title: string;
  meta_description: string;
  featured_image: string;
  featured_image_alt: string;
  topics: string;
  related_product_ids: string[];
  related_category_ids: string[];
  canonical_url: string;
  /** datetime-local, the admin's own time zone */
  published_at: string;
  status: Article["status"];
};

const blank: Form = {
  title: "",
  slug: "",
  slugTouched: false,
  excerpt: "",
  content: "",
  meta_title: "",
  meta_description: "",
  featured_image: "",
  featured_image_alt: "",
  topics: "",
  related_product_ids: [],
  related_category_ids: [],
  canonical_url: "",
  published_at: "",
  status: "draft",
};

const pad = (n: number) => String(n).padStart(2, "0");
const toLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const toIso = (local: string) => (local ? new Date(local).toISOString() : null);

function fromArticle(a: Article): Form {
  return {
    title: a.title,
    slug: a.slug,
    slugTouched: true,
    excerpt: a.excerpt ?? "",
    content: a.content,
    meta_title: a.meta_title ?? "",
    meta_description: a.meta_description ?? "",
    featured_image: a.featured_image ?? "",
    featured_image_alt: a.featured_image_alt ?? "",
    topics: a.topics.join(", "),
    related_product_ids: a.related_product_ids,
    related_category_ids: a.related_category_ids,
    canonical_url: a.canonical_url ?? "",
    published_at: toLocal(a.published_at),
    status: a.status,
  };
}

function statusOf(a: Pick<Article, "status" | "published_at">, now: number): { label: string; tone: "signal" | "neutral" | "warn" } {
  if (a.status === "draft") return { label: "Draft", tone: "neutral" };
  return isArticlePublic(a, now) ? { label: "Published", tone: "signal" } : { label: "Scheduled", tone: "warn" };
}

export function GuideManager({
  articles,
  products,
  categories,
  canDelete,
  siteUrl,
  storeName,
  defaultImage,
  migrationMissing,
}: {
  articles: Article[];
  products: Option[];
  categories: Option[];
  canDelete: boolean;
  siteUrl: string;
  storeName: string;
  defaultImage: string | null;
  migrationMissing: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [f, setF] = useState<Form>(blank);
  const [initial, setInitial] = useState<string>(JSON.stringify(blank));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [productFilter, setProductFilter] = useState("");
  const [pending, start] = useTransition();
  const [now] = useState(() => Date.now());
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));
  const current = editing && editing !== "new" ? articles.find((a) => a.id === editing) : undefined;
  const dirty = JSON.stringify(f) !== initial;
  const slug = f.slug || slugify(f.title);
  const path = `/guides/${slug || "your-guide"}`;

  function open(a?: Article) {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    const next = a ? fromArticle(a) : blank;
    setErrors({});
    setEditing(a ? a.id : "new");
    setF(next);
    setInitial(JSON.stringify(next));
  }

  function save(status: Article["status"]) {
    start(async () => {
      const payload = {
        title: f.title,
        slug,
        excerpt: f.excerpt,
        content: f.content,
        meta_title: f.meta_title,
        meta_description: f.meta_description,
        featured_image: f.featured_image,
        featured_image_alt: f.featured_image_alt,
        topics: f.topics.split(",").map((t) => t.trim()).filter(Boolean),
        related_product_ids: f.related_product_ids,
        related_category_ids: f.related_category_ids,
        canonical_url: f.canonical_url,
        status,
        published_at: toIso(f.published_at),
      };
      const res = await saveArticleAction(editing === "new" ? null : editing, payload);
      setErrors(res.fieldErrors ?? {});
      if (toastResult(res) && res.data) {
        const next = fromArticle(res.data);
        setEditing(res.data.id);
        setF(next);
        setInitial(JSON.stringify(next));
        router.refresh();
      }
    });
  }

  const shownProducts = useMemo(() => {
    const q = productFilter.trim().toLowerCase();
    const list = q ? products.filter((p) => p.name.toLowerCase().includes(q)) : products;
    return list.slice(0, 50);
  }, [products, productFilter]);
  const toggle = (k: "related_product_ids" | "related_category_ids", id: string, max: number) =>
    setF((p) => {
      const has = p[k].includes(id);
      if (!has && p[k].length >= max) return p;
      return { ...p, [k]: has ? p[k].filter((x) => x !== id) : [...p[k], id] };
    });

  if (migrationMissing) {
    return (
      <p className="rounded-lg bg-warn-tint p-4 text-sm text-warn" role="status">
        Guides need database migration 0019 (supabase/migrations/20261021000019_guides_and_collections.sql). Run it in the Supabase SQL editor, then reload this page.
      </p>
    );
  }

  const shareTitle = f.meta_title || f.title || "Guide title";
  const shareText = f.meta_description || f.excerpt || "The description shown when the guide is shared or found in search.";
  const shareImage = f.featured_image || defaultImage;

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
      <div className="min-w-0">
        <Button className="mb-3 w-full" onClick={() => open()}>
          <Plus className="h-4 w-4" aria-hidden />
          New guide
        </Button>
        {articles.length === 0 ? <p className="text-sm text-ink-mute">No guides yet.</p> : null}
        <ul className="space-y-1.5">
          {articles.map((a) => {
            const st = statusOf(a, now);
            return (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => open(a)}
                  className={cn("w-full rounded-[var(--radius-control)] border bg-surface px-3 py-2.5 text-left", editing === a.id ? "border-ink" : "border-line hover:border-line-strong")}
                >
                  <span className="block font-semibold [overflow-wrap:anywhere]">{a.title}</span>
                  <span className="mt-1 flex items-center gap-2 text-xs text-ink-mute">
                    <Badge tone={st.tone}>{st.label}</Badge>/guides/{a.slug}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {editing ? (
        <section className="min-w-0 rounded-[var(--radius-card)] border border-line bg-surface p-5" aria-label="Guide editor">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold">{editing === "new" ? "New guide" : "Edit guide"}</h2>
            {current ? <Badge tone={statusOf(current, now).tone}>{statusOf(current, now).label}</Badge> : null}
            {current && isArticlePublic(current, now) ? (
              <a href={`/guides/${current.slug}`} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-sm font-semibold text-signal hover:underline">
                View on website <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            ) : null}
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Title" htmlFor="g-title" error={errors.title} required>
              <Input id="g-title" value={f.title} maxLength={200} onChange={(e) => setF((p) => ({ ...p, title: e.target.value, slug: p.slugTouched ? p.slug : slugify(e.target.value) }))} />
            </Field>
            <Field
              label="URL"
              htmlFor="g-slug"
              error={errors.slug}
              hint={current?.status === "published" ? `${path} — changing the URL of a published guide breaks existing links to it` : path}
            >
              <Input id="g-slug" value={f.slug} onChange={(e) => setF((p) => ({ ...p, slug: slugify(e.target.value), slugTouched: true }))} placeholder={slugify(f.title)} />
            </Field>
            <Field label="Summary (optional)" htmlFor="g-excerpt" error={errors.excerpt} hint="One or two sentences shown on the guides list" className="md:col-span-2">
              <Textarea id="g-excerpt" rows={2} maxLength={320} value={f.excerpt} onChange={(e) => set("excerpt", e.target.value)} />
            </Field>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <Field label="Content" htmlFor="g-content" error={errors.content} hint="## Heading, ### Sub-heading, - bullet, 1. step, **bold**, [link](/products) — at least 200 characters to publish">
              <Textarea id="g-content" rows={22} value={f.content} onChange={(e) => set("content", e.target.value)} className="font-mono text-sm" />
            </Field>
            <div className="min-w-0">
              <p className="text-sm font-medium">Preview</p>
              <div className="mt-1.5 max-h-[560px] min-h-40 overflow-auto rounded-[var(--radius-control)] border border-line bg-paper p-4 text-sm">
                <p className="text-xl font-bold">{f.title || "Guide title"}</p>
                {f.excerpt ? <p className="mt-2 text-ink-soft">{f.excerpt}</p> : null}
                <RichText content={f.content} className="mt-3" />
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <ImageField label="Featured image (optional)" value={f.featured_image || null} onChange={(url) => set("featured_image", url ?? "")} folder="site" aspect="aspect-[16/9]" maxEdge={1600} hint="1200 × 675 px works well. Also used when the guide is shared." />
              {errors.featured_image ? <p className="mt-1 text-sm text-deal">{errors.featured_image}</p> : null}
            </div>
            <div className="grid content-start gap-4">
              <Field label="Image description (alt text)" htmlFor="g-alt" error={errors.featured_image_alt} hint="What the image shows, for screen readers and search">
                <Input id="g-alt" value={f.featured_image_alt} maxLength={200} onChange={(e) => set("featured_image_alt", e.target.value)} />
              </Field>
              <Field label="Topics (optional)" htmlFor="g-topics" error={errors.topics} hint="Comma separated, e.g. Used phones, iPhone">
                <Input id="g-topics" value={f.topics} onChange={(e) => set("topics", e.target.value)} />
              </Field>
              <Field label="Publication date" htmlFor="g-date" error={errors.published_at} hint="Empty = when you publish. A future date schedules the guide.">
                <Input id="g-date" type="datetime-local" value={f.published_at} onChange={(e) => set("published_at", e.target.value)} />
              </Field>
            </div>
          </div>

          <fieldset className="mt-5">
            <legend className="text-sm font-medium">
              Related products ({f.related_product_ids.length}/{ARTICLE_LIMITS.products})
            </legend>
            {f.related_product_ids.length ? (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {f.related_product_ids.map((id) => (
                  <li key={id}>
                    <button type="button" onClick={() => toggle("related_product_ids", id, ARTICLE_LIMITS.products)} className="rounded-full bg-signal-tint px-3 py-1 text-xs font-semibold text-signal-dark" aria-label={`Remove ${products.find((p) => p.id === id)?.name ?? "product"}`}>
                      {products.find((p) => p.id === id)?.name ?? "Unknown product"} ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <Input className="mt-2" placeholder="Search products to add…" aria-label="Search products to add" value={productFilter} onChange={(e) => setProductFilter(e.target.value)} />
            <ul className="mt-2 max-h-48 overflow-auto rounded-[var(--radius-control)] border border-line">
              {shownProducts.map((p) => (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-paper">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--color-signal)]" checked={f.related_product_ids.includes(p.id)} onChange={() => toggle("related_product_ids", p.id, ARTICLE_LIMITS.products)} />
                    {p.name}
                  </label>
                </li>
              ))}
            </ul>
            {errors.related_product_ids ? <p className="mt-1 text-sm text-deal">{errors.related_product_ids}</p> : null}
          </fieldset>

          <fieldset className="mt-5">
            <legend className="text-sm font-medium">
              Related categories ({f.related_category_ids.length}/{ARTICLE_LIMITS.categories})
            </legend>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
              {categories.map((c) => (
                <li key={c.id}>
                  <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--color-signal)]" checked={f.related_category_ids.includes(c.id)} onChange={() => toggle("related_category_ids", c.id, ARTICLE_LIMITS.categories)} />
                    {c.name}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Field label={`SEO title (${(f.meta_title || f.title).length}/60)`} htmlFor="g-mt" error={errors.meta_title} hint="Empty = the title">
              <Input id="g-mt" value={f.meta_title} maxLength={120} placeholder={f.title} onChange={(e) => set("meta_title", e.target.value)} />
            </Field>
            <Field label={`SEO description (${f.meta_description.length}/160)`} htmlFor="g-md" error={errors.meta_description} hint="Empty = the summary">
              <Textarea id="g-md" rows={2} value={f.meta_description} maxLength={320} onChange={(e) => set("meta_description", e.target.value)} />
            </Field>
          </div>

          <div className="mt-4">
            <p className="text-sm font-medium">Search & sharing preview</p>
            <div className="mt-1.5 grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-line bg-white p-3" aria-label="Google result preview">
                <p className="truncate text-xs text-ink-mute">{siteUrl.replace(/^https?:\/\//, "")}{path}</p>
                <p className="mt-0.5 line-clamp-1 text-[17px] text-[#1a0dab]">
                  {shareTitle} | {storeName}
                </p>
                <p className="mt-0.5 line-clamp-2 text-sm text-ink-soft">{shareText}</p>
              </div>
              <div className="overflow-hidden rounded-lg border border-line bg-white" aria-label="Social share preview">
                <div className="relative aspect-[1.91/1] bg-paper">
                  {shareImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={shareImage} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full items-center justify-center text-xs text-ink-mute">No image</span>
                  )}
                </div>
                <div className="p-3">
                  <p className="text-[11px] uppercase text-ink-mute">{siteUrl.replace(/^https?:\/\//, "")}</p>
                  <p className="line-clamp-1 font-semibold">{shareTitle}</p>
                  <p className="line-clamp-2 text-xs text-ink-soft">{shareText}</p>
                </div>
              </div>
            </div>
          </div>

          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium">Advanced: canonical URL</summary>
            <Field label="Canonical URL (optional)" htmlFor="g-canonical" error={errors.canonical_url} hint="Only if this guide is a copy of a page elsewhere. Empty = this guide's own address." className="mt-2">
              <Input id="g-canonical" value={f.canonical_url} maxLength={500} onChange={(e) => set("canonical_url", e.target.value)} placeholder={`${siteUrl}${path}`} />
            </Field>
          </details>

          <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <Button variant="outline" onClick={() => save("draft")} loading={pending}>
              {current?.status === "published" ? "Unpublish (save as draft)" : "Save draft"}
            </Button>
            <Button onClick={() => save("published")} loading={pending}>
              {current?.status === "published" ? "Update published guide" : "Publish"}
            </Button>
            {dirty ? (
              <Button variant="ghost" onClick={() => setF(JSON.parse(initial) as Form)} disabled={pending}>
                Cancel changes
              </Button>
            ) : null}
            {current && canDelete ? (
              <ConfirmButton
                title={`Delete “${current.title}”?`}
                description="It disappears from the website and the sitemap. This can't be undone."
                confirmLabel="Delete guide"
                variant="ghost"
                className="ml-auto"
                onConfirm={async () => {
                  const res = await deleteArticleAction(current.id);
                  if (res.ok) {
                    setEditing(null);
                    setF(blank);
                    setInitial(JSON.stringify(blank));
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
        <div className="rounded-[var(--radius-card)] border border-dashed border-line p-6 text-ink-soft">
          <p className="font-semibold text-ink">Write useful buying guides</p>
          <p className="mt-1 text-sm">
            For example: how to check a used phone before buying, new vs used phones, or smartphone specifications explained. Write from your own experience, keep facts current, and link the
            phones and categories you mention. Drafts are never shown on the website.
          </p>
        </div>
      )}
    </div>
  );
}
