"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { deleteBannerAction, saveBannerAction } from "@/app/admin/(panel)/content-actions";
import { ConfirmButton, ImageField, toastResult } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { Badge, EmptyState } from "@/components/ui/misc";
import { toDhakaInput } from "@/lib/date-input";
import { bannerSchema, firstFieldErrors } from "@/lib/validation";
import { isSvg } from "@/lib/utils";
import type { Banner } from "@/types";

type Form = {
  title: string;
  subtitle: string;
  image_url: string | null;
  mobile_image_url: string | null;
  button_text: string;
  button_url: string;
  placement: "hero" | "promo";
  is_active: boolean;
  sort_order: string;
  starts_at: string;
  ends_at: string;
};

const blank: Form = {
  title: "",
  subtitle: "",
  image_url: null,
  mobile_image_url: null,
  button_text: "",
  button_url: "",
  placement: "hero",
  is_active: true,
  sort_order: "0",
  starts_at: "",
  ends_at: "",
};

// Fields that show their own error message in the form.
const VISIBLE_FIELDS = new Set(["image_url", "title", "subtitle", "button_text", "button_url", "placement", "sort_order", "starts_at", "ends_at"]);

export function BannerManager({ banners }: { banners: (Banner & { is_demo?: boolean })[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [f, setF] = useState<Form>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  function open(b?: Banner) {
    setErrors({});
    setEditing(b ? b.id : "new");
    setF(
      b
        ? {
            title: b.title,
            subtitle: b.subtitle ?? "",
            image_url: b.image_url,
            mobile_image_url: b.mobile_image_url,
            button_text: b.button_text ?? "",
            button_url: b.button_url ?? "",
            placement: b.placement,
            is_active: b.is_active,
            sort_order: String(b.sort_order),
            starts_at: toDhakaInput(b.starts_at),
            ends_at: toDhakaInput(b.ends_at),
          }
        : blank,
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function save() {
    const payload = { ...f, image_url: f.image_url ?? "" };
    // Same schema the server action uses, so both sides apply identical rules.
    const check = bannerSchema.safeParse(payload);
    if (!check.success) {
      setErrors(firstFieldErrors(check.error));
      toast.error("Please fix the highlighted fields.");
      return;
    }
    start(async () => {
      const res = await saveBannerAction(editing === "new" ? null : editing, payload);
      if (!res.ok) setErrors(res.fieldErrors ?? {});
      if (toastResult(res)) {
        setEditing(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div>
        <div className="mb-3 flex justify-end">
          <Button onClick={() => open()}>
            <Plus className="h-4 w-4" aria-hidden />
            New banner
          </Button>
        </div>
        {banners.length === 0 ? (
          <EmptyState title="No banners yet" description="Without banners, the home page shows a simple headline instead." />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {banners.map((b) => (
              <li key={b.id} className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
                <div className="relative aspect-[21/9] bg-ink">
                  <Image src={b.image_url} alt="" fill sizes="400px" className="object-cover" unoptimized={isSvg(b.image_url)} />
                </div>
                <div className="p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={b.is_active ? "signal" : "neutral"}>{b.is_active ? "Active" : "Hidden"}</Badge>
                    <Badge>{b.placement === "hero" ? "Hero slider" : "Promo tile"}</Badge>
                    {b.is_demo ? <Badge tone="warn">Demo</Badge> : null}
                    <span className="text-xs text-ink-mute">Order {b.sort_order}</span>
                  </div>
                  <p className="mt-1.5 font-semibold">{b.title}</p>
                  {b.subtitle ? <p className="text-sm text-ink-soft">{b.subtitle}</p> : null}
                  <div className="mt-2 flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => open(b)}>
                      Edit
                    </Button>
                    <ConfirmButton
                      title="Delete this banner?"
                      confirmLabel="Delete"
                      variant="ghost"
                      onConfirm={async () => {
                        const res = await deleteBannerAction(b.id);
                        if (res.ok) router.refresh();
                        return res;
                      }}
                    >
                      Delete
                    </ConfirmButton>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing ? (
        <section className="h-fit rounded-[var(--radius-card)] border border-line bg-surface p-5 xl:sticky xl:top-6" aria-label="Banner editor">
          <h2 className="text-lg font-bold">{editing === "new" ? "New banner" : "Edit banner"}</h2>
          <div className="mt-4 grid gap-4">
            <ImageField
              label="Banner image"
              value={f.image_url}
              onChange={(url) => set("image_url", url)}
              folder="banners"
              aspect="aspect-[21/9]"
              hint="Wide image, ideally 1600 × 700 px. Text is placed on top, so keep the left side calm."
            />
            {errors.image_url ? <p className="-mt-2 text-sm text-deal">{errors.image_url}</p> : null}
            <Field label="Title" htmlFor="b-title" error={errors.title} required>
              <Input id="b-title" value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={120} />
            </Field>
            <Field label="Subtitle" htmlFor="b-sub" error={errors.subtitle}>
              <Input id="b-sub" value={f.subtitle} onChange={(e) => set("subtitle", e.target.value)} maxLength={240} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Button text" htmlFor="b-btn" error={errors.button_text}>
                <Input id="b-btn" value={f.button_text} onChange={(e) => set("button_text", e.target.value)} maxLength={40} />
              </Field>
              <Field label="Button link" htmlFor="b-url" error={errors.button_url} hint="e.g. /brands/samsung">
                <Input id="b-url" value={f.button_url} onChange={(e) => set("button_url", e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Placement" htmlFor="b-place" error={errors.placement}>
                <Select id="b-place" value={f.placement} onChange={(e) => set("placement", e.target.value as Form["placement"])}>
                  <option value="hero">Hero slider (top)</option>
                  <option value="promo">Promo tile (middle)</option>
                </Select>
              </Field>
              <Field label="Sort order" htmlFor="b-sort" error={errors.sort_order}>
                <Input id="b-sort" inputMode="numeric" value={f.sort_order} onChange={(e) => set("sort_order", e.target.value.replace(/\D/g, ""))} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Show from (optional)" htmlFor="b-start" error={errors.starts_at}>
                <Input id="b-start" type="datetime-local" value={f.starts_at} onChange={(e) => set("starts_at", e.target.value)} />
              </Field>
              <Field label="Show until (optional)" htmlFor="b-end" error={errors.ends_at}>
                <Input id="b-end" type="datetime-local" value={f.ends_at} onChange={(e) => set("ends_at", e.target.value)} />
              </Field>
            </div>
            <p className="-mt-2 text-xs text-ink-mute">Scheduled banners appear within an hour of their start time (pages are cached).</p>
            <Checkbox label="Active" checked={f.is_active} onChange={(e) => set("is_active", e.target.checked)} />
          </div>
          {Object.entries(errors).filter(([k]) => !VISIBLE_FIELDS.has(k)).length ? (
            <ul className="mt-4 rounded-lg bg-deal-tint p-3 text-sm text-deal" role="alert">
              {Object.entries(errors)
                .filter(([k]) => !VISIBLE_FIELDS.has(k))
                .map(([k, msg]) => (
                  <li key={k}>
                    {k.replace(/_/g, " ")}: {msg}
                  </li>
                ))}
            </ul>
          ) : null}
          <div className="mt-5 flex gap-2">
            <Button onClick={save} loading={pending}>
              {editing === "new" ? "Add banner" : "Save banner"}
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
