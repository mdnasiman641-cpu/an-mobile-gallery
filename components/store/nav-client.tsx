"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ResolvedNavItem } from "@/lib/navigation";
import { NavBadge, NavIconEl } from "@/components/store/main-nav";
import { cn } from "@/lib/utils";

/**
 * Marks the menu link of the current page (aria-current) so it gets the
 * "active item" colour. Runs only on navigation; changes no layout.
 */
export function ActiveNav() {
  const pathname = usePathname();
  useEffect(() => {
    for (const a of document.querySelectorAll<HTMLAnchorElement>("nav[data-main-nav] a[href]")) {
      const href = a.getAttribute("href") ?? "";
      if (href === pathname) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
  }, [pathname]);
  return null;
}

const row = "flex min-h-11 items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-[15px] font-medium text-ink hover:bg-paper";

/** Mobile menu: the same items, with tap-to-expand dropdowns. */
export function MobileNavList({ items }: { items: ResolvedNavItem[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const uid = useId();
  return (
    <ul>
      {items.map((it) => {
        const kids = it.mega
          ? it.mega.flatMap((c) => [{ key: c.slug, label: c.name, href: `/categories/${c.slug}`, sub: false }, ...c.children.map((s) => ({ key: s.slug, label: s.name, href: `/categories/${s.slug}`, sub: true }))])
          : it.children.map((c) => ({ key: c.key, label: c.label, href: c.href, sub: false, heading: c.kind === "heading", newTab: c.newTab, badge: c.badge }));
        const label = (
          <span className="inline-flex min-w-0 items-center gap-2">
            <NavIconEl icon={it.icon} className="h-4 w-4 shrink-0 text-signal" />
            <span className="min-w-0">{it.label}</span>
            <NavBadge badge={it.badge} />
          </span>
        );
        if (!kids.length) {
          return (
            <li key={it.key}>
              {it.newTab ? (
                <a href={it.href} target="_blank" rel="noopener noreferrer" className={row}>
                  {label}
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-mute" aria-hidden />
                </a>
              ) : (
                <Link href={it.href} prefetch={false} className={row}>
                  {label}
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-mute" aria-hidden />
                </Link>
              )}
            </li>
          );
        }
        const expanded = open === it.key;
        const panel = `${uid}-${it.key}`;
        return (
          <li key={it.key}>
            <button type="button" className={cn(row, "w-full text-left")} aria-expanded={expanded} aria-controls={panel} onClick={() => setOpen(expanded ? null : it.key)}>
              {label}
              <ChevronDown className={cn("h-4 w-4 shrink-0 text-ink-mute transition-transform", expanded && "rotate-180")} aria-hidden />
            </button>
            {expanded ? (
              <ul id={panel} className="mb-1 ml-3 border-l border-line pl-2">
                <li>
                  <Link href={it.href} prefetch={false} className={cn(row, "font-semibold text-signal")}>
                    View all {it.label}
                  </Link>
                </li>
                {kids.map((k) =>
                  "heading" in k && k.heading ? (
                    <li key={k.key} className="px-3 pb-1 pt-3 text-xs font-bold uppercase tracking-wide text-ink-mute">
                      {k.label}
                    </li>
                  ) : (
                    <li key={k.key}>
                      {"newTab" in k && k.newTab ? (
                        <a href={k.href as string} target="_blank" rel="noopener noreferrer" className={cn(row, "text-ink-soft")}>
                          {k.label}
                        </a>
                      ) : (
                        <Link href={k.href as string} prefetch={false} className={cn(row, k.sub ? "pl-6 text-ink-soft" : "text-ink-soft")}>
                          {k.label}
                          {"badge" in k ? <NavBadge badge={k.badge ?? null} /> : null}
                        </Link>
                      )}
                    </li>
                  ),
                )}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
