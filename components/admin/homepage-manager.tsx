"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, GripVertical, Plus, Search, Trash2, X } from "lucide-react";
import {
  resetHomepageSectionAction,
  saveHomepageOrderAction,
  saveHomepageSectionAction,
  toggleHomepageSectionAction,
} from "@/app/admin/(panel)/homepage/actions";
import { ConfirmButton, ImageField, toastResult } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";
import { DEFAULT_TEXT_ITEMS, SECTION_DEFS, sectionLimit, type HomepageSection, type SectionKey, type TextItem } from "@/lib/homepage";
import { cn } from "@/lib/utils";

export interface PickerOption {
  id: string;
  label: string;
  note: string | null;
}

type Options = Record<"product" | "category" | "brand" | "banner", PickerOption[]>;

interface FormState {
  title: string;
  subtitle: string;
  description: string;
  image_url: string | null;
  button_text: string;
  button_url: string;
  mode: "auto" | "manual";
  item_limit: string;
  items: TextItem[];
  item_ids: string[];
}

function toForm(s: HomepageSection): FormState {
  return {
    title: s.title ?? "",
    subtitle: s.subtitle ?? "",
    description: s.description ?? "",
    image_url: s.imageUrl,
    button_text: s.buttonText ?? "",
    button_url: s.buttonUrl ?? "",
    mode: s.mode,
    item_limit: s.itemLimit ? String(s.itemLimit) : "",
    items: s.config.items?.length ? s.config.items : (DEFAULT_TEXT_ITEMS[s.key] ?? []),
    item_ids: s.itemIds,
  };
}

export function HomepageManager({
  initial,
  options,
  readOnly,
  keysWithItems,
}: {
  initial: HomepageSection[];
  options: Options;
  readOnly: boolean;
  keysWithItems: SectionKey[];
}) {
  const router = useRouter();
  const [list, setList] = useState(initial);
  const [editing, setEditing] = useState<SectionKey | null>(null);
  const [dragKey, setDragKey] = useState<SectionKey | null>(null);
  const [pending, start] = useTransition();

  function saveOrder(next: HomepageSection[]) {
    setList(next);
    start(async () => {
      const ok = toastResult(await saveHomepageOrderAction(next.map((s) => s.key)));
      if (!ok) setList(list);
      else router.refresh();
    });
  }

  function move(index: number, delta: -1 | 1) {
    const to = index + delta;
    if (to < 0 || to >= list.length) return;
    const next = [...list];
    [next[index], next[to]] = [next[to], next[index]];
    saveOrder(next);
  }

  function drop(target: SectionKey) {
    if (!dragKey || dragKey === target) return;
    const next = list.filter((s) => s.key !== dragKey);
    next.splice(next.findIndex((s) => s.key === target), 0, list.find((s) => s.key === dragKey)!);
    setDragKey(null);
    saveOrder(next);
  }

  function toggle(s: HomepageSection) {
    const nextEnabled = !s.isEnabled;
    setList((l) => l.map((x) => (x.key === s.key ? { ...x, isEnabled: nextEnabled } : x)));
    start(async () => {
      if (!toastResult(await toggleHomepageSectionAction(s.key, nextEnabled))) setList((l) => l.map((x) => (x.key === s.key ? { ...x, isEnabled: !nextEnabled } : x)));
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-soft">
        Drag sections, or use the arrows, to change their order. Sections with nothing to show (for example no discounted products) hide themselves on the
        homepage. Hero + Today&rsquo;s Best Deals, and Exchange + EMI, appear side by side when they are next to each other.
      </p>
      <ol className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface" aria-label="Homepage sections">
        {list.map((s, i) => {
          const def = SECTION_DEFS[s.key];
          const open = editing === s.key;
          return (
            <li
              key={s.key}
              draggable={!readOnly && !open}
              onDragStart={() => setDragKey(s.key)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => drop(s.key)}
              className={cn(dragKey === s.key && "opacity-50")}
            >
              <div className="flex flex-wrap items-center gap-3 px-3 py-3 sm:px-4">
                <GripVertical className={cn("h-5 w-5 shrink-0 text-ink-mute", !readOnly && "cursor-grab")} aria-hidden />
                <span className="w-6 text-sm tabular-nums text-ink-mute">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className={cn("font-semibold", !s.isEnabled && "text-ink-mute line-through")}>{def.label}</p>
                  <p className="truncate text-xs text-ink-mute">
                    {s.title ? `“${s.title}” · ` : ""}
                    {def.itemType ? (s.mode === "manual" ? `Manual: ${s.itemIds.length} selected` : "Automatic") : "Text section"}
                  </p>
                </div>
                {!s.isEnabled ? <Badge>Hidden</Badge> : null}
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" aria-label={`Move ${def.label} up`} disabled={readOnly || pending || i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`Move ${def.label} down`} disabled={readOnly || pending || i === list.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <label className="ml-1 inline-flex cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--color-signal)]" checked={s.isEnabled} disabled={readOnly || pending} onChange={() => toggle(s)} />
                    Show
                  </label>
                  <Button variant="outline" size="sm" className="ml-2" disabled={readOnly} onClick={() => setEditing(open ? null : s.key)} aria-expanded={open}>
                    {open ? "Close" : "Edit"}
                  </Button>
                </div>
              </div>
              {open ? (
                <SectionEditor
                  section={s}
                  options={def.itemType ? options[def.itemType] : []}
                  canPick={keysWithItems.includes(s.key)}
                  onDone={() => {
                    setEditing(null);
                    router.refresh();
                  }}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function SectionEditor({ section, options, canPick, onDone }: { section: HomepageSection; options: PickerOption[]; canPick: boolean; onDone: () => void }) {
  const def = SECTION_DEFS[section.key];
  const [f, setF] = useState<FormState>(() => toForm(section));
  const [query, setQuery] = useState("");
  const [pending, start] = useTransition();
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));
  const id = (name: string) => `hp-${section.key}-${name}`;
  const limit = sectionLimit({ ...section, itemLimit: f.item_limit ? Number(f.item_limit) : null });
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options.filter((o) => !f.item_ids.includes(o.id) && (!q || o.label.toLowerCase().includes(q))).slice(0, 20);
  }, [options, query, f.item_ids]);

  function save() {
    start(async () => {
      const ok = toastResult(
        await saveHomepageSectionAction(section.key, {
          ...f,
          item_limit: f.item_limit || null,
          items: def.hasTextItems ? f.items.filter((i) => i.title.trim()) : undefined,
        }),
      );
      if (ok) onDone();
    });
  }

  const moveItem = (i: number, d: -1 | 1) => {
    const next = [...f.item_ids];
    const to = i + d;
    if (to < 0 || to >= next.length) return;
    [next[i], next[to]] = [next[to], next[i]];
    set("item_ids", next);
  };

  return (
    <div className="space-y-5 border-t border-line bg-paper px-4 py-5 sm:px-6">
      <p className="text-sm text-ink-soft">
        <span className="font-semibold text-ink">Automatic:</span> {def.autoHint}
      </p>

      {def.fields.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {def.fields.includes("title") ? (
            <Field label="Title" htmlFor={id("title")} hint={`Empty = “${def.defaultTitle.replace("{store}", "store name")}”`}>
              <Input id={id("title")} value={f.title} maxLength={120} onChange={(e) => set("title", e.target.value)} />
            </Field>
          ) : null}
          {def.fields.includes("subtitle") ? (
            <Field label="Subtitle" htmlFor={id("subtitle")} hint={def.defaultSubtitle ? `Empty = “${def.defaultSubtitle}”` : undefined}>
              <Input id={id("subtitle")} value={f.subtitle} maxLength={240} onChange={(e) => set("subtitle", e.target.value)} />
            </Field>
          ) : null}
          {def.fields.includes("description") ? (
            <Field label="Description" htmlFor={id("description")} className="md:col-span-2">
              <Textarea id={id("description")} rows={3} value={f.description} maxLength={1000} onChange={(e) => set("description", e.target.value)} />
            </Field>
          ) : null}
          {def.fields.includes("button") ? (
            <>
              <Field label="Button text" htmlFor={id("btext")} hint={def.defaultButtonText ? `Empty = “${def.defaultButtonText}”` : undefined}>
                <Input id={id("btext")} value={f.button_text} maxLength={60} onChange={(e) => set("button_text", e.target.value)} />
              </Field>
              <Field label="Button link" htmlFor={id("burl")} hint="A path like /offers, or a full https:// link. Empty = automatic.">
                <Input id={id("burl")} value={f.button_url} maxLength={500} onChange={(e) => set("button_url", e.target.value)} />
              </Field>
            </>
          ) : null}
          {def.fields.includes("image") ? (
            <div className="md:col-span-2 md:max-w-sm">
              <ImageField label="Hero image (optional)" value={f.image_url} onChange={(v) => set("image_url", v)} folder="banners" aspect="aspect-square" hint="Replaces the product photo in the hero." />
            </div>
          ) : null}
        </div>
      ) : null}

      {def.hasTextItems ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{section.key === "emi" ? "Points" : "Items"}</legend>
          {f.items.map((item, i) => (
            <div key={i} className="flex flex-wrap gap-2">
              <Input aria-label={`Item ${i + 1} title`} className="min-w-40 flex-1" value={item.title} maxLength={80} onChange={(e) => set("items", f.items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
              {section.key !== "emi" ? (
                <Input aria-label={`Item ${i + 1} text`} className="min-w-52 flex-[2]" value={item.text} maxLength={160} onChange={(e) => set("items", f.items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
              ) : null}
              <Button variant="ghost" size="icon" aria-label={`Remove item ${i + 1}`} onClick={() => set("items", f.items.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {f.items.length < 5 ? (
            <Button variant="outline" size="sm" onClick={() => set("items", [...f.items, { title: "", text: "" }])}>
              <Plus className="h-4 w-4" aria-hidden /> Add item
            </Button>
          ) : null}
        </fieldset>
      ) : null}

      {def.itemType && canPick ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-4">
            <fieldset className="flex gap-4">
              <legend className="mb-1.5 text-sm font-medium">Content</legend>
              {(["auto", "manual"] as const).map((m) => (
                <label key={m} className="inline-flex items-center gap-2 text-sm">
                  <input type="radio" name={id("mode")} className="accent-[var(--color-signal)]" checked={f.mode === m} onChange={() => set("mode", m)} />
                  {m === "auto" ? "Automatic" : "Manual selection"}
                </label>
              ))}
            </fieldset>
            {(def.maxLimit ?? 24) > 1 ? (
              <Field label="How many" htmlFor={id("limit")} className="w-32">
                <Input id={id("limit")} type="number" min={1} max={def.maxLimit ?? 24} placeholder={String(def.defaultLimit ?? 10)} value={f.item_limit} onChange={(e) => set("item_limit", e.target.value)} />
              </Field>
            ) : null}
          </div>

          {f.mode === "manual" ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <p className="text-sm font-medium">
                  Selected ({f.item_ids.length}/{limit})
                </p>
                {f.item_ids.length === 0 ? <p className="mt-2 text-sm text-ink-mute">Nothing selected yet. The section stays hidden until you pick something.</p> : null}
                <ol className="mt-2 space-y-1.5">
                  {f.item_ids.map((itemId, i) => {
                    const o = byId.get(itemId);
                    return (
                      <li key={itemId} className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm">
                        <span className="w-5 text-ink-mute">{i + 1}</span>
                        <span className="min-w-0 flex-1 truncate">{o ? o.label : "No longer available (will be skipped)"}</span>
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Move up" onClick={() => moveItem(i, -1)} disabled={i === 0}>
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Move down" onClick={() => moveItem(i, 1)} disabled={i === f.item_ids.length - 1}>
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Remove ${o?.label ?? "item"}`} onClick={() => set("item_ids", f.item_ids.filter((x) => x !== itemId))}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </li>
                    );
                  })}
                </ol>
              </div>
              <div>
                <label htmlFor={id("search")} className="text-sm font-medium">
                  Add {def.itemType === "product" ? "published products" : `${def.itemType}s`}
                </label>
                <div className="relative mt-1.5">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute" aria-hidden />
                  <Input id={id("search")} className="pl-9" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
                </div>
                <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
                  {results.map((o) => (
                    <li key={o.id}>
                      <button
                        type="button"
                        disabled={f.item_ids.length >= limit}
                        onClick={() => set("item_ids", [...f.item_ids, o.id])}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm hover:bg-surface disabled:opacity-50"
                      >
                        <Plus className="h-3.5 w-3.5 text-signal" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{o.label}</span>
                        {o.note ? <span className="text-xs text-ink-mute">{o.note}</span> : null}
                      </button>
                    </li>
                  ))}
                  {results.length === 0 ? <li className="px-3 py-1.5 text-sm text-ink-mute">No matches.</li> : null}
                </ul>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <Button onClick={save} loading={pending}>
          Save section
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <span className="flex-1" />
        <ConfirmButton
          title={`Reset ${def.label}?`}
          description="Clears your text and manual selection for this section and goes back to the built-in text and automatic content."
          confirmLabel="Reset"
          onConfirm={async () => {
            const res = await resetHomepageSectionAction(section.key);
            if (res.ok) onDone();
            return res;
          }}
        >
          Reset to default
        </ConfirmButton>
      </div>
    </div>
  );
}
