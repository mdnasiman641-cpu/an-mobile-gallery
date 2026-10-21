"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Pencil, Plus, RotateCcw } from "lucide-react";
import { saveNavigationAction } from "@/app/admin/(panel)/settings/navigation/actions";
import { ConfirmButton, toastResult } from "@/components/admin/ui";
import { MainNavBar } from "@/components/store/main-nav";
import { MobileNavList } from "@/components/store/nav-client";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";
import { contrastRatio, newItemId, safeLink } from "@/lib/header-config";
import {
  BADGE_STYLES,
  BADGE_STYLE_LABELS,
  CHILD_TYPES,
  DEFAULT_NAV_STYLE,
  NAV_GRADIENT,
  NAV_ICONS,
  NAV_LIMITS,
  NAV_TYPE_LABELS,
  TOP_TYPES,
  currentMenuItems,
  resolveNav,
  type NavConfig,
  type NavItem,
  type NavStyle,
  type NavType,
} from "@/lib/navigation";
import { cn } from "@/lib/utils";

interface Cat {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  is_active: boolean;
}

/** Existing pages to pick from (free text is allowed too). */
const SUGGESTED_LINKS = ["/categories", "/brands", "/offers", "/compare", "/shop-locations", "/products", "/products?sort=newest", "/collections/used-phones", "/collections/new-phones", "/collections/used-iphones", "/guides", "/contact", "/about", "/track"];

const blankItem = (parent_id: string | null, type: NavType = "link"): NavItem => ({
  id: newItemId(),
  parent_id,
  type,
  label: "",
  url: type === "link" ? "" : null,
  category_id: null,
  auto_children: false,
  icon: "none",
  new_tab: false,
  badge: null,
  badge_style: "deal",
  active: true,
});

export function NavigationManager({
  saved,
  categories,
  brands,
  migrationMissing,
}: {
  /** null = the built-in menu is live */
  saved: NavConfig | null;
  categories: Cat[];
  brands: { name: string; slug: string; is_featured: boolean }[];
  migrationMissing: boolean;
}) {
  const router = useRouter();
  const [live, setLive] = useState<NavConfig | null>(saved);
  const [draft, setDraft] = useState<NavConfig>(saved ?? { items: [], style: DEFAULT_NAV_STYLE });
  const [editing, setEditing] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");

  const activeCats = useMemo(() => categories.filter((c) => c.is_active), [categories]);
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "Deleted category";
  const items = draft.items;
  const tops = items.filter((i) => i.parent_id === null);
  const childrenOf = (id: string) => items.filter((i) => i.parent_id === id);
  const dirty = JSON.stringify(draft) !== JSON.stringify(live ?? { items: [], style: DEFAULT_NAV_STYLE });
  const resolved = useMemo(() => resolveNav(draft, activeCats, brands), [draft, activeCats, brands]);
  const errorFor = (id: string, field: string) => {
    const i = items.findIndex((x) => x.id === id);
    return errors[`items.${i}.${field}`];
  };
  const itemHasError = (id: string) => {
    const i = items.findIndex((x) => x.id === id);
    return Object.keys(errors).some((k) => k.startsWith(`items.${i}.`));
  };

  const setItems = (next: NavItem[]) => setDraft((d) => ({ ...d, items: next }));
  const update = (id: string, patch: Partial<NavItem>) => setItems(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const setStyle = (patch: Partial<NavStyle>) => setDraft((d) => ({ ...d, style: { ...d.style, ...patch } }));

  function add(parent_id: string | null) {
    const it = blankItem(parent_id);
    setItems([...items, it]);
    setEditing(it.id);
  }
  /** Swap with the previous / next item that has the same parent. */
  function move(id: string, by: -1 | 1) {
    const it = items.find((i) => i.id === id);
    if (!it) return;
    const siblings = items.filter((i) => i.parent_id === it.parent_id);
    const k = siblings.findIndex((i) => i.id === id);
    const other = siblings[k + by];
    if (!other) return;
    const a = items.indexOf(it);
    const b = items.indexOf(other);
    const next = [...items];
    [next[a], next[b]] = [next[b], next[a]];
    setItems(next);
  }
  function remove(id: string) {
    setItems(items.filter((i) => i.id !== id && i.parent_id !== id)); // a top item's dropdown goes with it
    if (editing === id) setEditing(null);
  }

  function publish(config: NavConfig | null) {
    start(async () => {
      const res = await saveNavigationAction(config);
      setErrors(res.fieldErrors ?? {});
      if (toastResult(res)) {
        setLive(res.data ?? null);
        if (!res.data) setDraft({ items: [], style: DEFAULT_NAV_STYLE });
        router.refresh();
      }
    });
  }

  if (migrationMissing) {
    return (
      <p className="rounded-lg bg-warn-tint p-4 text-sm text-warn" role="status">
        The menu needs database migration 0020 (supabase/migrations/20261021000020_navigation.sql, after 0018). Run it in the Supabase SQL editor, then reload this page. Until then the website keeps its built-in menu.
      </p>
    );
  }

  // lowest contrast of each menu colour against the background (both gradient ends for the built-in one)
  const backgrounds = draft.style.bg_color ? [draft.style.bg_color] : [...NAV_GRADIENT];
  const hex = (v: string) => /^#[0-9a-f]{6}$/i.test(v);
  const lowContrast = (
    [
      ["Text", draft.style.text_color],
      ["Hover", draft.style.hover_color],
      ["Current page", draft.style.active_color],
    ] as const
  )
    .filter(([, c]) => hex(c) && backgrounds.every(hex))
    .map(([name, c]) => ({ name, ratio: Math.min(...backgrounds.map((b) => contrastRatio(b, c))) }))
    .filter((x) => x.ratio < 4.5);

  const row = (it: NavItem, isChild: boolean) => {
    const kids = isChild ? [] : childrenOf(it.id);
    const siblings = items.filter((i) => i.parent_id === it.parent_id);
    const k = siblings.findIndex((i) => i.id === it.id);
    const label = it.label || (it.type === "category" ? catName(it.category_id) : "(no label)");
    const dest = it.type === "link" ? it.url : it.type === "category" ? `/categories/${categories.find((c) => c.id === it.category_id)?.slug ?? "?"}` : it.type === "all_categories" ? "Automatic: all categories" : it.type === "brands" ? "Automatic: brands" : "Heading";
    const canHaveChildren = !isChild && (it.type === "link" || it.type === "category");
    return (
      <li key={it.id} aria-label={`Menu item ${label}`} className={cn("rounded-lg border bg-surface", itemHasError(it.id) ? "border-deal" : "border-line", !it.active && "border-dashed bg-paper")}>
        <div className="flex flex-wrap items-center gap-2 p-2.5">
          <span className="min-w-0 basis-full sm:basis-auto sm:flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-semibold [overflow-wrap:anywhere]">{label}</span>
              {it.badge ? <Badge tone="deal">{it.badge}</Badge> : null}
              {!it.active ? <Badge>Hidden</Badge> : null}
              {!isChild && kids.length ? <Badge tone="signal">{kids.length} in dropdown</Badge> : null}
            </span>
            <span className="block truncate text-xs text-ink-mute">{dest}</span>
          </span>
          <Checkbox label="Active" checked={it.active} onChange={(e) => update(it.id, { active: e.target.checked })} />
          <span className="flex items-center gap-0.5">
            <Button type="button" size="sm" variant="ghost" aria-label={`Move ${label} up`} disabled={k === 0} onClick={() => move(it.id, -1)}>
              <ArrowUp className="h-4 w-4" aria-hidden />
            </Button>
            <Button type="button" size="sm" variant="ghost" aria-label={`Move ${label} down`} disabled={k === siblings.length - 1} onClick={() => move(it.id, 1)}>
              <ArrowDown className="h-4 w-4" aria-hidden />
            </Button>
            <Button type="button" size="sm" variant="ghost" aria-label={`Edit ${label}`} aria-expanded={editing === it.id} onClick={() => setEditing(editing === it.id ? null : it.id)}>
              <Pencil className="h-4 w-4" aria-hidden />
            </Button>
            <ConfirmButton
              variant="ghost"
              title={`Delete “${label}”?`}
              description={
                kids.length
                  ? `Its ${kids.length} dropdown item${kids.length === 1 ? " is" : "s are"} deleted too. To keep ${kids.length === 1 ? "it" : "them"}, open ${kids.length === 1 ? "it" : "each one"} and choose another parent first. Nothing changes on the website until you publish; categories and products are never deleted.`
                  : "It disappears from the menu when you publish. Categories and products are never deleted."
              }
              confirmLabel="Delete"
              onConfirm={async () => remove(it.id)}
            >
              <span className="sr-only">Delete {label}</span>
              <span aria-hidden>✕</span>
            </ConfirmButton>
          </span>
        </div>
        {editing === it.id ? <ItemEditor it={it} isChild={isChild} tops={tops} categories={activeCats} update={update} errorFor={errorFor} /> : null}
        {!isChild && (kids.length || canHaveChildren) ? (
          <div className="border-t border-line px-2.5 pb-2.5 pt-2">
            {kids.length ? <ul className="ml-3 grid gap-1.5 border-l-2 border-line pl-3">{kids.map((c) => row(c, true))}</ul> : null}
            {canHaveChildren ? (
              <Button type="button" size="sm" variant="ghost" className="mt-1" disabled={kids.length >= NAV_LIMITS.children} onClick={() => add(it.id)}>
                <Plus className="h-4 w-4" aria-hidden /> Add dropdown item
              </Button>
            ) : null}
            {errorFor(it.id, "children") ? <p className="text-sm text-deal">{errorFor(it.id, "children")}</p> : null}
          </div>
        ) : null}
      </li>
    );
  };

  return (
    <div className="grid gap-5 pb-24">
      <section className="min-w-0 rounded-[var(--radius-card)] border border-line bg-surface p-5" aria-labelledby="nav-preview">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="nav-preview" className="font-bold">
            Preview
          </h2>
          <span className="text-sm text-ink-mute">{live ? "Live: your menu." : "Live: the built-in menu (nothing published yet)."} {dirty ? "The preview shows unpublished changes." : ""}</span>
          <div className="ml-auto flex gap-1" role="group" aria-label="Preview size">
            <Button type="button" size="sm" variant={previewMode === "desktop" ? "primary" : "outline"} onClick={() => setPreviewMode("desktop")} aria-pressed={previewMode === "desktop"}>
              Desktop
            </Button>
            <Button type="button" size="sm" variant={previewMode === "mobile" ? "primary" : "outline"} onClick={() => setPreviewMode("mobile")} aria-pressed={previewMode === "mobile"}>
              Mobile
            </Button>
          </div>
        </div>
        <div className="mt-3 min-h-16 rounded-lg border border-line bg-paper pb-4" data-nav-preview={previewMode}>
          {items.length === 0 ? (
            <p className="p-4 text-sm text-ink-mute">No items yet. Start from the current menu, or add your first item.</p>
          ) : previewMode === "desktop" ? (
            <div className="overflow-visible [contain:inline-size]">
              <MainNavBar items={resolved} style={draft.style} />
              <p className="px-3 pt-2 text-xs text-ink-mute">Hover or tab to an item to open its dropdown.</p>
            </div>
          ) : (
            <div className="mx-auto mt-3 w-[min(100%,320px)] rounded-xl border border-line bg-surface p-2 shadow-sm">
              <MobileNavList items={resolved} />
            </div>
          )}
        </div>
      </section>

      <section className="min-w-0 rounded-[var(--radius-card)] border border-line bg-surface p-5" aria-labelledby="nav-items">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="nav-items" className="font-bold">
            Menu items
          </h2>
          <span className="text-sm text-ink-mute">
            {tops.length}/{NAV_LIMITS.top} top-level · {items.length}/{NAV_LIMITS.items} total
          </span>
          <span className="ml-auto flex flex-wrap gap-2">
            {items.length === 0 ? (
              <Button type="button" size="sm" variant="outline" onClick={() => setItems(currentMenuItems(activeCats, newItemId))}>
                Start from the current menu
              </Button>
            ) : null}
            <Button type="button" size="sm" onClick={() => add(null)} disabled={tops.length >= NAV_LIMITS.top || items.length >= NAV_LIMITS.items}>
              <Plus className="h-4 w-4" aria-hidden /> Add menu item
            </Button>
          </span>
        </div>
        {errors.items ? (
          <p className="mt-2 text-sm text-deal" role="alert">
            {errors.items}
          </p>
        ) : null}
        <p className="mt-1 text-sm text-ink-soft">
          Items show in this order. Category items and the automatic “All categories” and “Brands” menus always use your live categories and brands.
        </p>
        <ol className="mt-4 grid gap-2">{tops.map((t) => row(t, false))}</ol>
      </section>

      <section className="min-w-0 rounded-[var(--radius-card)] border border-line bg-surface p-5" aria-labelledby="nav-style">
        <h2 id="nav-style" className="font-bold">
          Menu bar appearance
        </h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Checkbox label="Built-in green gradient" checked={draft.style.bg_color === null} onChange={(e) => setStyle({ bg_color: e.target.checked ? null : "#0b7a60" })} />
            {draft.style.bg_color !== null ? <ColorInput label="Background colour" value={draft.style.bg_color} onChange={(v) => setStyle({ bg_color: v })} error={errors["style.bg_color"]} /> : null}
          </div>
          <ColorInput label="Text colour" value={draft.style.text_color} onChange={(v) => setStyle({ text_color: v })} error={errors["style.text_color"]} />
          <ColorInput label="Hover colour" value={draft.style.hover_color} onChange={(v) => setStyle({ hover_color: v })} error={errors["style.hover_color"]} />
          <ColorInput label="Current page colour" value={draft.style.active_color} onChange={(v) => setStyle({ active_color: v })} error={errors["style.active_color"]} />
          <Field label="Spacing between items" htmlFor="nav-spacing">
            <Select id="nav-spacing" value={draft.style.spacing} onChange={(e) => setStyle({ spacing: e.target.value as NavStyle["spacing"] })}>
              <option value="compact">Compact</option>
              <option value="normal">Normal</option>
              <option value="relaxed">Relaxed</option>
            </Select>
          </Field>
        </div>
        {lowContrast.length ? (
          <p className="mt-3 rounded-lg bg-warn-tint p-2.5 text-sm text-warn" role="status">
            Hard to read: {lowContrast.map((x) => `${x.name} colour ${x.ratio.toFixed(1)}:1`).join(", ")}. Use at least 4.5:1 against the background — on the built-in green, white
            (#ffffff) works; on a custom background, choose a dark background (e.g. #073b30 or #1e293b) with white or light text.
          </p>
        ) : null}
      </section>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur lg:left-60">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-end gap-2 md:px-2">
          {dirty ? <span className="mr-auto text-sm text-ink-mute">Unpublished changes — the website still shows the {live ? "previous" : "built-in"} menu.</span> : null}
          {live ? (
            <ConfirmButton
              variant="ghost"
              tone="primary"
              title="Go back to the built-in menu?"
              description="The website shows the original menu again. Your items are removed from the live site (categories and products are not touched)."
              confirmLabel="Restore built-in menu"
              disabled={pending}
              onConfirm={async () => publish(null)}
            >
              <RotateCcw className="h-4 w-4" aria-hidden /> Built-in menu
            </ConfirmButton>
          ) : null}
          <Button variant="ghost" disabled={!dirty || pending} onClick={() => { setDraft(live ?? { items: [], style: DEFAULT_NAV_STYLE }); setErrors({}); }}>
            Cancel unsaved changes
          </Button>
          <ConfirmButton
            variant="primary"
            tone="primary"
            title="Publish this menu?"
            description="The website's menu bar and mobile menu change to this menu (pages update within a few moments)."
            confirmLabel="Publish"
            disabled={!dirty || pending || items.length === 0}
            onConfirm={async () => publish(draft)}
          >
            Publish changes
          </ConfirmButton>
        </div>
      </div>
    </div>
  );
}

function ColorInput({ label, value, onChange, error }: { label: string; value: string; onChange: (v: string) => void; error?: string }) {
  const id = `nav-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <Field label={label} htmlFor={id} error={error}>
      <span className="flex items-center gap-2">
        <input type="color" aria-label={`${label} picker`} value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"} onChange={(e) => onChange(e.target.value)} className="h-10 w-12 shrink-0 cursor-pointer rounded-[var(--radius-control)] border border-line bg-surface p-1" />
        <Input id={id} value={value} maxLength={7} className="font-mono" onChange={(e) => onChange(e.target.value.trim())} />
      </span>
    </Field>
  );
}

function ItemEditor({
  it,
  isChild,
  tops,
  categories,
  update,
  errorFor,
}: {
  it: NavItem;
  isChild: boolean;
  tops: NavItem[];
  categories: Cat[];
  update: (id: string, patch: Partial<NavItem>) => void;
  errorFor: (id: string, field: string) => string | undefined;
}) {
  const p = `nav-${it.id}`;
  const types = isChild ? CHILD_TYPES : TOP_TYPES;
  const parents = tops.filter((t) => t.id !== it.id && (t.type === "link" || t.type === "category"));
  const external = it.type === "link" && Boolean(it.url && /^https:\/\//.test(it.url));
  return (
    <div className="grid gap-3 border-t border-line p-3 md:grid-cols-2">
      <Field label="Item type" htmlFor={`${p}-type`} error={errorFor(it.id, "type")}>
        <Select
          id={`${p}-type`}
          value={it.type}
          onChange={(e) => {
            const type = e.target.value as NavType;
            update(it.id, { type, url: type === "link" ? (it.url ?? "") : null, category_id: type === "category" ? it.category_id : null, auto_children: type === "category" ? it.auto_children : false, label: type === "category" ? "" : it.label });
          }}
        >
          {types.map((t) => (
            <option key={t} value={t}>
              {NAV_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={it.type === "category" ? "Label (optional)" : "Label"} htmlFor={`${p}-label`} error={errorFor(it.id, "label")} hint={it.type === "category" ? "Empty = the category's name" : undefined}>
        <Input id={`${p}-label`} value={it.label} maxLength={NAV_LIMITS.label} onChange={(e) => update(it.id, { label: e.target.value })} />
      </Field>
      {it.type === "link" ? (
        <Field label="Destination" htmlFor={`${p}-url`} error={errorFor(it.id, "url") ?? (it.url && !safeLink(it.url) ? "Use a path on this site (/offers) or a full https:// address" : undefined)} hint="A page on this site (/offers) or a full https:// address" className="md:col-span-2">
          <Input id={`${p}-url`} list={`${p}-routes`} value={it.url ?? ""} maxLength={500} onChange={(e) => update(it.id, { url: e.target.value })} placeholder="/offers" />
          <datalist id={`${p}-routes`}>
            {SUGGESTED_LINKS.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </Field>
      ) : null}
      {it.type === "category" ? (
        <>
          <Field label="Category" htmlFor={`${p}-cat`} error={errorFor(it.id, "category_id")}>
            <Select id={`${p}-cat`} value={it.category_id ?? ""} onChange={(e) => update(it.id, { category_id: e.target.value || null })}>
              <option value="">Choose…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.parent_id ? `${categories.find((x) => x.id === c.parent_id)?.name ?? ""} › ` : ""}
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          {!isChild ? <Checkbox label="Show its subcategories in the dropdown" checked={it.auto_children} onChange={(e) => update(it.id, { auto_children: e.target.checked })} /> : null}
        </>
      ) : null}
      {isChild ? (
        <Field label="Shown in the dropdown of" htmlFor={`${p}-parent`} error={errorFor(it.id, "parent_id")}>
          <Select id={`${p}-parent`} value={it.parent_id ?? ""} onChange={(e) => update(it.id, { parent_id: e.target.value })}>
            {parents.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label || (t.type === "category" ? categories.find((c) => c.id === t.category_id)?.name : "") || "(no label)"}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {it.type !== "heading" ? (
        <>
          <Field label="Icon (optional)" htmlFor={`${p}-icon`}>
            <Select id={`${p}-icon`} value={it.icon} onChange={(e) => update(it.id, { icon: e.target.value as NavItem["icon"] })}>
              {NAV_ICONS.map((i) => (
                <option key={i} value={i}>
                  {i === "none" ? "No icon" : i}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <Field label="Badge (optional)" htmlFor={`${p}-badge`} error={errorFor(it.id, "badge")} hint="e.g. NEW or HOT">
              <Input id={`${p}-badge`} value={it.badge ?? ""} maxLength={NAV_LIMITS.badge} onChange={(e) => update(it.id, { badge: e.target.value || null })} />
            </Field>
            <Field label="Badge colour" htmlFor={`${p}-bstyle`}>
              <Select id={`${p}-bstyle`} value={it.badge_style} onChange={(e) => update(it.id, { badge_style: e.target.value as NavItem["badge_style"] })}>
                {BADGE_STYLES.map((b) => (
                  <option key={b} value={b}>
                    {BADGE_STYLE_LABELS[b]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </>
      ) : null}
      {it.type === "link" ? (
        <Checkbox label="Open in a new tab" description={external ? "For links to other websites" : "Only for https:// addresses (pages on this site open normally)"} checked={it.new_tab} disabled={!external} onChange={(e) => update(it.id, { new_tab: e.target.checked })} />
      ) : null}
    </div>
  );
}
