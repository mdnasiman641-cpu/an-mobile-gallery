import { z } from "zod";
import { cleanText, safeLink } from "@/lib/header-config";

/**
 * Main navigation (the green menu bar and the mobile menu), managed in
 * Admin → Settings → Header & Navigation and stored with the other header
 * settings (public.storefront_header.nav, migration 0020).
 *
 * Two levels: top-level items, and child items inside a top-level item's
 * dropdown. A child can never have children, so circular menus are
 * impossible. "All categories", "Brands" and category items with
 * "show subcategories" are filled from the live catalog, never from a copy.
 * With nothing saved (nav = null) the built-in menu is shown unchanged.
 */

export const NAV_LIMITS = { items: 80, top: 12, children: 24, label: 40, badge: 12 } as const;

export const NAV_TYPES = ["link", "category", "all_categories", "brands", "heading"] as const;
export type NavType = (typeof NAV_TYPES)[number];
export const TOP_TYPES: NavType[] = ["link", "category", "all_categories", "brands"];
export const CHILD_TYPES: NavType[] = ["link", "category", "heading"];
export const NAV_TYPE_LABELS: Record<NavType, string> = {
  link: "Link (page on this site or https:// address)",
  category: "Category",
  all_categories: "All categories (automatic menu)",
  brands: "Brands (automatic menu)",
  heading: "Group heading (no link)",
};

export const NAV_ICONS = ["none", "grid", "smartphone", "tag", "flame", "sparkles", "percent", "star", "map-pin", "compare", "headphones", "gift"] as const;
export type NavIcon = (typeof NAV_ICONS)[number];

export const BADGE_STYLES = ["deal", "signal", "gold", "ink"] as const;
export type BadgeStyle = (typeof BADGE_STYLES)[number];
export const BADGE_STYLE_LABELS: Record<BadgeStyle, string> = { deal: "Red", signal: "Green", gold: "Gold", ink: "Dark" };

export interface NavItem {
  id: string;
  parent_id: string | null;
  type: NavType;
  /** Empty for a category item = the category's own name. */
  label: string;
  url: string | null;
  category_id: string | null;
  /** Category items: list its subcategories in the dropdown. */
  auto_children: boolean;
  icon: NavIcon;
  new_tab: boolean;
  badge: string | null;
  badge_style: BadgeStyle;
  active: boolean;
}

export interface NavStyle {
  /** null = the built-in green gradient. */
  bg_color: string | null;
  text_color: string;
  hover_color: string;
  active_color: string;
  spacing: "compact" | "normal" | "relaxed";
}

export interface NavConfig {
  items: NavItem[];
  style: NavStyle;
}

/**
 * White passes 4.5:1 on both ends of the built-in gradient (5.3:1 and 4.5:1);
 * the current page is marked with white + bold + underline, not a paler colour.
 */
export const DEFAULT_NAV_STYLE: NavStyle = { bg_color: null, text_color: "#ffffff", hover_color: "#ffffff", active_color: "#ffffff", spacing: "normal" };

/** The two ends of the built-in green gradient (contrast is checked against both). */
export const NAV_GRADIENT = ["#0b7a60", "#0c8667"] as const;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const color = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Colour must look like #1A2B3C").transform((v) => v.toLowerCase());
const navId = z.string().regex(/^[a-zA-Z0-9_-]{6,40}$/, "Invalid id");

export const navItemSchema = z.object({
  id: navId,
  parent_id: navId.nullable(),
  type: z.enum(NAV_TYPES),
  label: z
    .string()
    .transform(cleanText)
    .pipe(z.string().max(NAV_LIMITS.label, `Label: at most ${NAV_LIMITS.label} characters`)),
  url: z.string().nullish().transform((v) => (v && v.trim() ? v.trim() : null)),
  category_id: z.string().uuid().nullish().transform((v) => v ?? null),
  auto_children: z.boolean(),
  icon: z.enum(NAV_ICONS),
  new_tab: z.boolean(),
  badge: z
    .string()
    .nullish()
    .transform((v) => (v ? cleanText(v) : ""))
    .pipe(z.string().max(NAV_LIMITS.badge, `Badge: at most ${NAV_LIMITS.badge} characters`))
    .transform((v) => v || null),
  badge_style: z.enum(BADGE_STYLES),
  active: z.boolean(),
});

export const navStyleSchema = z.object({
  bg_color: color.nullable(),
  text_color: color,
  hover_color: color,
  active_color: color,
  spacing: z.enum(["compact", "normal", "relaxed"]),
});

export const navConfigSchema = z.object({
  items: z.array(navItemSchema).max(NAV_LIMITS.items, `At most ${NAV_LIMITS.items} menu items`),
  style: navStyleSchema,
});

/**
 * Checks the menu as a whole. Returns errors keyed like "items.3.url".
 * `categoryIds` are the categories that exist; links must be safe.
 */
export function checkNav(config: NavConfig, categoryIds: Set<string>): Record<string, string> {
  const errors: Record<string, string> = {};
  const byId = new Map<string, NavItem>();
  config.items.forEach((it, i) => {
    if (byId.has(it.id)) errors[`items.${i}.id`] = "Duplicate item";
    byId.set(it.id, it);
  });
  let top = 0;
  const childCount = new Map<string, number>();
  config.items.forEach((it, i) => {
    const at = (k: string, m: string) => {
      if (!errors[`items.${i}.${k}`]) errors[`items.${i}.${k}`] = m;
    };
    if (it.parent_id === null) {
      top++;
      if (!TOP_TYPES.includes(it.type)) at("type", "A group heading can only be inside a dropdown");
    } else {
      const parent = byId.get(it.parent_id);
      if (!parent || parent.id === it.id) at("parent_id", "Choose an existing top-level item");
      else if (parent.parent_id !== null) at("parent_id", "Dropdown items can't have their own dropdown");
      else if (parent.type === "all_categories" || parent.type === "brands") at("parent_id", "This menu is filled automatically");
      if (!CHILD_TYPES.includes(it.type)) at("type", "Automatic menus can only be top-level items");
      childCount.set(it.parent_id, (childCount.get(it.parent_id) ?? 0) + 1);
    }
    if (it.type === "link") {
      if (!it.url) at("url", "Enter a destination, e.g. /offers or https://…");
      else if (!safeLink(it.url)) at("url", "Use a path on this site (/offers) or a full https:// address");
      if (!it.label) at("label", "Enter a label");
    }
    if (it.type === "heading" && !it.label) at("label", "Enter the heading text");
    if (it.type === "category") {
      if (!it.category_id) at("category_id", "Choose a category");
      else if (!categoryIds.has(it.category_id)) at("category_id", "This category no longer exists");
    }
    if ((it.type === "all_categories" || it.type === "brands") && !it.label) at("label", "Enter a label");
  });
  if (top > NAV_LIMITS.top) errors.items = `At most ${NAV_LIMITS.top} top-level items`;
  for (const [pid, n] of childCount) {
    if (n > NAV_LIMITS.children) {
      const i = config.items.findIndex((x) => x.id === pid);
      errors[`items.${i}.children`] = `At most ${NAV_LIMITS.children} dropdown items`;
    }
  }
  return errors;
}

/** Stored value → config (invalid items dropped, so a bad row never breaks the header); null = built-in menu. */
export function readNav(raw: unknown): NavConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { items?: unknown; style?: unknown };
  if (!Array.isArray(r.items)) return null;
  const items = r.items.flatMap((x) => {
    const p = navItemSchema.safeParse(x);
    return p.success ? [p.data] : [];
  });
  const ids = new Set(items.map((i) => i.id));
  const tops = new Set(items.filter((i) => i.parent_id === null).map((i) => i.id));
  const style = navStyleSchema.safeParse({ ...DEFAULT_NAV_STYLE, ...(r.style && typeof r.style === "object" ? r.style : {}) });
  return {
    // children whose parent is gone are dropped; nothing deeper than two levels
    items: items.filter((i) => i.parent_id === null || (ids.has(i.parent_id) && tops.has(i.parent_id))),
    style: style.success ? style.data : DEFAULT_NAV_STYLE,
  };
}

// ---------------------------------------------------------------------------
// Resolving the menu with live data
// ---------------------------------------------------------------------------

export interface NavCategory {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
}
export interface NavBrand {
  name: string;
  slug: string;
  is_featured?: boolean;
}

export interface ResolvedChild {
  key: string;
  kind: "link" | "heading";
  label: string;
  href: string | null;
  newTab: boolean;
  badge: { text: string; style: BadgeStyle } | null;
  icon: NavIcon;
}
export interface ResolvedNavItem extends Omit<ResolvedChild, "kind"> {
  href: string;
  /** Dropdown content: links (with optional headings), or the category mega menu. */
  children: ResolvedChild[];
  mega: { name: string; slug: string; children: { name: string; slug: string }[] }[] | null;
}

const childLink = (key: string, label: string, href: string): ResolvedChild => ({ key, kind: "link", label, href, newTab: false, badge: null, icon: "none" });

/** Active items with live categories / brands filled in. */
export function resolveNav(config: NavConfig, categories: NavCategory[], brands: NavBrand[]): ResolvedNavItem[] {
  const byCat = new Map(categories.map((c) => [c.id, c]));
  const topCats = categories.filter((c) => !c.parent_id);
  const subOf = (id: string) => categories.filter((c) => c.parent_id === id);
  const active = config.items.filter((i) => i.active);
  const out: ResolvedNavItem[] = [];

  for (const it of active.filter((i) => i.parent_id === null)) {
    const badge = it.badge ? { text: it.badge, style: it.badge_style } : null;
    const base = { key: it.id, newTab: it.type === "link" && it.new_tab && /^https:/.test(it.url ?? ""), badge, icon: it.icon };
    const manual: ResolvedChild[] = [];
    for (const ch of active.filter((c) => c.parent_id === it.id)) {
      const cb = { key: ch.id, newTab: ch.type === "link" && ch.new_tab && /^https:/.test(ch.url ?? ""), badge: ch.badge ? { text: ch.badge, style: ch.badge_style } : null, icon: ch.icon };
      if (ch.type === "heading") manual.push({ ...cb, kind: "heading", label: ch.label, href: null });
      else if (ch.type === "link" && ch.url && safeLink(ch.url)) manual.push({ ...cb, kind: "link", label: ch.label, href: safeLink(ch.url) });
      else if (ch.type === "category" && ch.category_id && byCat.has(ch.category_id)) {
        const c = byCat.get(ch.category_id)!;
        manual.push({ ...cb, kind: "link", label: ch.label || c.name, href: `/categories/${c.slug}` });
      }
    }
    if (it.type === "all_categories") {
      out.push({ ...base, label: it.label, href: "/categories", children: [], mega: topCats.map((c) => ({ name: c.name, slug: c.slug, children: subOf(c.id).map((s) => ({ name: s.name, slug: s.slug })) })) });
    } else if (it.type === "brands") {
      const list = (brands.some((b) => b.is_featured) ? brands.filter((b) => b.is_featured) : brands).slice(0, 12);
      out.push({ ...base, label: it.label, href: "/brands", children: list.map((b) => childLink(`${it.id}-${b.slug}`, b.name, `/brands/${b.slug}`)), mega: null });
    } else if (it.type === "category") {
      const c = it.category_id ? byCat.get(it.category_id) : undefined;
      if (!c) continue; // category deleted: the item is hidden, never a broken link
      const auto = it.auto_children ? subOf(c.id).map((s) => childLink(`${it.id}-${s.slug}`, s.name, `/categories/${s.slug}`)) : [];
      out.push({ ...base, label: it.label || c.name, href: `/categories/${c.slug}`, children: [...auto, ...manual], mega: null });
    } else if (it.type === "link") {
      const href = it.url ? safeLink(it.url) : null;
      if (!href) continue;
      out.push({ ...base, label: it.label, href, children: manual, mega: null });
    }
  }
  return out;
}

/** The built-in menu as editable items (Admin → "Start from the current menu"). */
export function currentMenuItems(categories: NavCategory[], newId: () => string): NavItem[] {
  const item = (o: Partial<NavItem> & Pick<NavItem, "type">): NavItem => ({
    id: newId(),
    parent_id: null,
    label: "",
    url: null,
    category_id: null,
    auto_children: false,
    icon: "none",
    new_tab: false,
    badge: null,
    badge_style: "deal",
    active: true,
    ...o,
  });
  return [
    item({ type: "all_categories", label: "All Categories", icon: "grid" }),
    ...categories.filter((c) => !c.parent_id).map((c) => item({ type: "category", category_id: c.id, auto_children: true })),
    item({ type: "brands", label: "Brands" }),
    item({ type: "link", label: "Offers", url: "/offers", badge: "Hot", badge_style: "deal" }),
    item({ type: "link", label: "Compare Phones", url: "/compare", icon: "compare" }),
    item({ type: "link", label: "Shop Locations", url: "/shop-locations", icon: "map-pin" }),
  ];
}
