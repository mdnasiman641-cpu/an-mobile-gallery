"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { deleteTaxonomyAction, saveTaxonomyAction } from "@/app/admin/(panel)/taxonomy-actions";
import { adminTable } from "@/components/admin/page-header";
import { ConfirmButton, ImageField, toastResult } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";
import { isSvg } from "@/lib/utils";
import { slugify } from "@/lib/slug";

export interface TaxonomyRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  meta_title: string | null;
  meta_description: string | null;
  is_featured: boolean;
  is_active: boolean;
  sort_order: number;
  image: string | null;
  parent_id?: string | null;
  product_count: number;
}

type FormState = Omit<TaxonomyRow, "id" | "product_count" | "sort_order"> & { sort_order: string };

const blank: FormState = {
  name: "",
  slug: "",
  description: "",
  meta_title: "",
  meta_description: "",
  is_featured: false,
  is_active: true,
  sort_order: "0",
  image: null,
  parent_id: null,
};

export function TaxonomyManager({ kind, rows }: { kind: "brand" | "category"; rows: TaxonomyRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<FormState>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const label = kind === "brand" ? "brand" : "category";
  const parents = rows.filter((r) => !r.parent_id);

  function open(row?: TaxonomyRow) {
    setErrors({});
    if (row) {
      setEditing(row.id);
      setForm({
        name: row.name,
        slug: row.slug,
        description: row.description ?? "",
        meta_title: row.meta_title ?? "",
        meta_description: row.meta_description ?? "",
        is_featured: row.is_featured,
        is_active: row.is_active,
        sort_order: String(row.sort_order),
        image: row.image,
        parent_id: row.parent_id ?? null,
      });
    } else {
      setEditing("new");
      setForm(blank);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function save() {
    start(async () => {
      const res = await saveTaxonomyAction(kind, editing === "new" ? null : editing, {
        ...form,
        parent_id: form.parent_id || null,
      });
      if (!res.ok) setErrors(res.fieldErrors ?? {});
      if (toastResult(res)) {
        setEditing(null);
        router.refresh();
      }
    });
  }

  const set = <K extends keyof FormState>(k: K, val: FormState[K]) => setForm((p) => ({ ...p, [k]: val }));
  const nameOf = (id: string | null | undefined) => rows.find((r) => r.id === id)?.name;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div>
        <div className="mb-3 flex justify-end">
          <Button onClick={() => open()}>
            <Plus className="h-4 w-4" aria-hidden />
            Add {label}
          </Button>
        </div>
        <div className={adminTable.wrap}>
          <table className={adminTable.table}>
            <thead>
              <tr>
                <th className={adminTable.th}>Name</th>
                {kind === "category" ? <th className={adminTable.th}>Parent</th> : null}
                <th className={`${adminTable.th} text-right`}>Products</th>
                <th className={adminTable.th}>Visibility</th>
                <th className={`${adminTable.th} text-right`}>Order</th>
                <th className={adminTable.th}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className={`${adminTable.td} text-center text-ink-mute`}>
                    No {label === "brand" ? "brands" : "categories"} yet.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td className={adminTable.td}>
                      <div className="flex items-center gap-3">
                        <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md bg-paper">
                          {r.image ? <Image src={r.image} alt="" fill sizes="36px" className="object-contain" unoptimized={isSvg(r.image)} /> : null}
                        </span>
                        <span>
                          <span className="font-semibold">{r.name}</span>
                          <span className="block text-xs text-ink-mute">/{kind === "brand" ? "brands" : "categories"}/{r.slug}</span>
                        </span>
                      </div>
                    </td>
                    {kind === "category" ? <td className={adminTable.td}>{nameOf(r.parent_id) ?? "—"}</td> : null}
                    <td className={`${adminTable.td} price text-right`}>{r.product_count}</td>
                    <td className={adminTable.td}>
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={r.is_active ? "signal" : "neutral"}>{r.is_active ? "Visible" : "Hidden"}</Badge>
                        {r.is_featured ? <Badge tone="taka">{kind === "brand" ? "Popular" : "Featured"}</Badge> : null}
                      </div>
                    </td>
                    <td className={`${adminTable.td} price text-right`}>{r.sort_order}</td>
                    <td className={`${adminTable.td} text-right`}>
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => open(r)}>
                          <Pencil className="h-4 w-4" aria-hidden />
                          Edit
                        </Button>
                        <ConfirmButton
                          title={`Delete ${r.name}?`}
                          description={r.product_count ? `${r.product_count} products use it, so it can't be deleted until they are moved.` : "This can't be undone."}
                          confirmLabel="Delete"
                          variant="ghost"
                          onConfirm={async () => {
                            const res = await deleteTaxonomyAction(kind, r.id);
                            if (res.ok) router.refresh();
                            return res;
                          }}
                        >
                          Delete
                        </ConfirmButton>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing ? (
        <section className="h-fit rounded-[var(--radius-card)] border border-line bg-surface p-5 xl:sticky xl:top-6" aria-label={`${editing === "new" ? "Add" : "Edit"} ${label}`}>
          <h2 className="text-lg font-bold">{editing === "new" ? `Add ${label}` : `Edit ${form.name}`}</h2>
          <div className="mt-4 grid gap-4">
            <Field label="Name" htmlFor="tx-name" error={errors.name} required>
              <Input id="tx-name" value={form.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label="URL slug" htmlFor="tx-slug" hint={editing === "new" ? "Leave empty to create from the name" : "Changing it keeps the old URL working"}>
              <Input id="tx-slug" value={form.slug} placeholder={slugify(form.name)} onChange={(e) => set("slug", slugify(e.target.value))} />
            </Field>
            {kind === "category" ? (
              <Field label="Parent category" htmlFor="tx-parent" error={errors.parent_id}>
                <Select id="tx-parent" value={form.parent_id ?? ""} onChange={(e) => set("parent_id", e.target.value || null)}>
                  <option value="">None (top level)</option>
                  {parents
                    .filter((p) => p.id !== editing)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </Select>
              </Field>
            ) : null}
            <ImageField
              label={kind === "brand" ? "Logo" : "Image"}
              value={form.image}
              onChange={(url) => set("image", url)}
              folder={kind === "brand" ? "brands" : "categories"}
              aspect="aspect-[3/1]"
              maxEdge={600}
            />
            <Field label="Description" htmlFor="tx-desc" hint="Shown at the top of the page; also used for SEO">
              <Textarea id="tx-desc" rows={3} value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} />
            </Field>
            <Field label="SEO title" htmlFor="tx-mt" hint="Leave empty for an automatic title">
              <Input id="tx-mt" value={form.meta_title ?? ""} maxLength={120} onChange={(e) => set("meta_title", e.target.value)} />
            </Field>
            <Field label="SEO description" htmlFor="tx-md" hint="Leave empty for an automatic description">
              <Textarea id="tx-md" rows={2} value={form.meta_description ?? ""} maxLength={320} onChange={(e) => set("meta_description", e.target.value)} />
            </Field>
            <Field label="Sort order" htmlFor="tx-sort" hint="Lower numbers appear first">
              <Input id="tx-sort" inputMode="numeric" value={form.sort_order} onChange={(e) => set("sort_order", e.target.value.replace(/[^\d-]/g, ""))} />
            </Field>
            <Checkbox label="Visible in the store" checked={form.is_active} onChange={(e) => set("is_active", e.target.checked)} />
            <Checkbox
              label={kind === "brand" ? "Popular brand (home page and menu)" : "Featured category (home page)"}
              checked={form.is_featured}
              onChange={(e) => set("is_featured", e.target.checked)}
            />
          </div>
          <div className="mt-5 flex gap-2">
            <Button onClick={save} loading={pending}>
              {editing === "new" ? `Add ${label}` : "Save changes"}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
