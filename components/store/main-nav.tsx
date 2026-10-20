import Link from "next/link";
import { ChevronDown, Flame, GitCompareArrows, Gift, Headphones, LayoutGrid, MapPin, Percent, Smartphone, Sparkles, Star, Tag, type LucideIcon } from "lucide-react";
import type { BadgeStyle, NavIcon, NavStyle, ResolvedChild, ResolvedNavItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/**
 * The admin-managed main menu bar (desktop dropdowns open on hover and on
 * keyboard focus, no JavaScript). Labels are plain text (never HTML).
 * Shared by the storefront header and the admin preview.
 */

export const NAV_ICON: Record<Exclude<NavIcon, "none">, LucideIcon> = {
  grid: LayoutGrid,
  smartphone: Smartphone,
  tag: Tag,
  flame: Flame,
  sparkles: Sparkles,
  percent: Percent,
  star: Star,
  "map-pin": MapPin,
  compare: GitCompareArrows,
  headphones: Headphones,
  gift: Gift,
};

export const BADGE_CLASS: Record<BadgeStyle, string> = {
  deal: "bg-deal text-white",
  signal: "bg-white text-signal",
  gold: "bg-gold text-ink",
  ink: "bg-ink text-white",
};

const SPACING = { compact: "px-2", normal: "px-3", relaxed: "px-4" } as const;

export function NavIconEl({ icon, className }: { icon: NavIcon; className?: string }) {
  if (icon === "none") return null;
  const I = NAV_ICON[icon];
  return <I className={className} aria-hidden />;
}

export function NavBadge({ badge, className }: { badge: ResolvedChild["badge"]; className?: string }) {
  if (!badge) return null;
  return <span className={cn("ml-1 rounded-full px-1.5 py-px text-[10px] font-bold uppercase leading-4", BADGE_CLASS[badge.style], className)}>{badge.text}</span>;
}

function ItemLink({ href, newTab, className, children, ...rest }: { href: string; newTab: boolean; className?: string; children: React.ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  if (newTab)
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className} {...rest}>
        {children}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    );
  return (
    <Link href={href} prefetch={false} className={className} {...rest}>
      {children}
    </Link>
  );
}

const dropdown =
  "invisible absolute top-full z-50 max-w-[min(92vw,640px)] rounded-[var(--radius-card)] border border-line bg-surface p-1.5 text-ink opacity-0 shadow-[var(--shadow-soft)] transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100";

function DropdownLinks({ items }: { items: ResolvedChild[] }) {
  return (
    <ul className="min-w-52">
      {items.map((c) =>
        c.kind === "heading" ? (
          <li key={c.key} className="px-3 pb-1 pt-2.5 text-xs font-bold uppercase tracking-wide text-ink-mute first:pt-1.5">
            {c.label}
          </li>
        ) : (
          <li key={c.key}>
            <ItemLink href={c.href as string} newTab={c.newTab} className="flex items-center gap-2 rounded-md px-3 py-2 text-ink hover:bg-paper focus-visible:bg-paper">
              <NavIconEl icon={c.icon} className="h-4 w-4 text-signal" />
              {c.label}
              <NavBadge badge={c.badge} />
            </ItemLink>
          </li>
        ),
      )}
    </ul>
  );
}

export function MainNavBar({ items, style, after }: { items: ResolvedNavItem[]; style: NavStyle; after?: React.ReactNode }) {
  const pad = SPACING[style.spacing];
  const vars = {
    "--nav-text": style.text_color,
    "--nav-hover": style.hover_color,
    "--nav-active": style.active_color,
    ...(style.bg_color ? { backgroundColor: style.bg_color, backgroundImage: "none" } : {}),
  } as React.CSSProperties;
  const half = Math.ceil(items.length / 2);

  return (
    <nav aria-label="Main" data-main-nav className="bg-gradient-to-r from-signal to-[#0c8667] text-[var(--nav-text)]" style={vars}>
      <div className="container-page flex items-center">
        <ul className="no-scrollbar -mx-4 flex min-w-0 flex-1 items-center overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0">
          {items.map((it, i) => {
            const Icon = it.icon !== "none" ? NAV_ICON[it.icon] : null;
            const hasDrop = it.mega ? it.mega.length > 0 : it.children.length > 0;
            // dropdowns of items on the right open towards the left (they stay on screen)
            const side = i >= half ? "right-0" : "left-0";
            return (
              <li key={it.key} className="group relative shrink-0">
                <ItemLink
                  href={it.href}
                  newTab={it.newTab}
                  className={cn(
                    "inline-flex h-12 items-center gap-1.5 whitespace-nowrap text-[14px] font-medium text-[var(--nav-text)] hover:text-[var(--nav-hover)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white aria-[current=page]:font-semibold aria-[current=page]:text-[var(--nav-active)]",
                    pad,
                    it.mega && "bg-black/10 font-semibold hover:bg-black/20",
                  )}
                >
                  {Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
                  {it.label}
                  <NavBadge badge={it.badge} />
                  {hasDrop ? <ChevronDown className="hidden h-3.5 w-3.5 lg:block" aria-hidden /> : null}
                </ItemLink>
                {it.mega && it.mega.length ? (
                  <div className={cn(dropdown, side, "hidden w-[min(560px,80vw)] lg:block")}>
                    <ul className="grid grid-cols-2 gap-1">
                      {it.mega.map((c) => (
                        <li key={c.slug} className="rounded-lg p-1.5">
                          <Link href={`/categories/${c.slug}`} prefetch={false} className="block rounded-md px-2 py-1.5 font-semibold text-ink hover:bg-paper">
                            {c.name}
                          </Link>
                          {c.children.length ? (
                            <ul className="mt-0.5">
                              {c.children.map((ch) => (
                                <li key={ch.slug}>
                                  <Link href={`/categories/${ch.slug}`} prefetch={false} className="block rounded-md px-2 py-1 text-sm text-ink-soft hover:bg-paper hover:text-ink">
                                    {ch.name}
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    <Link href="/categories" prefetch={false} className="mt-1 block border-t border-line px-3.5 pb-1.5 pt-2.5 text-sm font-semibold text-signal hover:underline">
                      All categories
                    </Link>
                  </div>
                ) : it.children.length ? (
                  <div className={cn(dropdown, side, "hidden lg:block")}>
                    <DropdownLinks items={it.children} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        {after}
      </div>
    </nav>
  );
}
