"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgePercent,
  Bot,
  Boxes,
  ExternalLink,
  FileText,
  FolderTree,
  Image as ImageIcon,
  LayoutDashboard,
  LayoutTemplate,
  Menu,
  MessageSquareText,
  Package,
  Search,
  Settings,
  ShoppingCart,
  Sparkles,
  Tags,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { signOutAction } from "@/app/(store)/account/actions";
import { cn } from "@/lib/utils";
import type { StaffRole } from "@/types";

const NAV: { href: string; label: string; Icon: typeof Package; min: StaffRole }[] = [
  { href: "/admin/dashboard", label: "Dashboard", Icon: LayoutDashboard, min: "editor" },
  { href: "/admin/products", label: "Products", Icon: Package, min: "editor" },
  { href: "/admin/ai-products", label: "AI Products", Icon: Sparkles, min: "editor" },
  { href: "/admin/homepage", label: "Homepage", Icon: LayoutTemplate, min: "editor" },
  { href: "/admin/categories", label: "Categories", Icon: FolderTree, min: "editor" },
  { href: "/admin/brands", label: "Brands", Icon: Tags, min: "editor" },
  { href: "/admin/inventory", label: "Inventory", Icon: Boxes, min: "editor" },
  { href: "/admin/orders", label: "Orders", Icon: ShoppingCart, min: "admin" },
  { href: "/admin/customers", label: "Customers", Icon: Users, min: "admin" },
  { href: "/admin/reviews", label: "Reviews", Icon: MessageSquareText, min: "editor" },
  { href: "/admin/coupons", label: "Coupons", Icon: BadgePercent, min: "admin" },
  { href: "/admin/banners", label: "Banners", Icon: ImageIcon, min: "editor" },
  { href: "/admin/pages", label: "Pages", Icon: FileText, min: "editor" },
  { href: "/admin/seo", label: "SEO", Icon: Search, min: "admin" },
  { href: "/admin/settings", label: "Settings", Icon: Settings, min: "admin" },
  { href: "/admin/settings/ai", label: "AI settings", Icon: Bot, min: "admin" },
  { href: "/admin/users", label: "Staff users", Icon: UserCog, min: "super_admin" },
];

const RANK: Record<StaffRole, number> = { editor: 1, admin: 2, super_admin: 3 };

export function AdminShell({
  role,
  email,
  pendingOrders,
  children,
}: {
  role: StaffRole;
  email: string | null;
  pendingOrders: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // close the mobile drawer when a link inside it is followed
  const closeOnLink = (e: React.MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("a")) setOpen(false);
  };

  const items = NAV.filter((n) => RANK[role] >= RANK[n.min]);
  // the most specific matching link is active (e.g. AI settings, not Settings)
  const activeHref = items
    .filter((n) => pathname === n.href || pathname.startsWith(`${n.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  const nav = (
    <nav aria-label="Admin" className="flex flex-col gap-0.5 p-3">
      {items.map(({ href, label, Icon }) => {
        const active = href === activeHref;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium",
              active ? "bg-white/12 text-white" : "text-white/70 hover:bg-white/8 hover:text-white",
            )}
          >
            <Icon className="h-[18px] w-[18px]" aria-hidden />
            <span className="flex-1">{label}</span>
            {href === "/admin/orders" && pendingOrders > 0 ? (
              <span className="rounded-full bg-taka px-1.5 text-[11px] font-bold text-white">{pendingOrders}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="mt-auto border-t border-white/10 p-3 text-xs text-white/60">
      <p className="truncate px-3">{email}</p>
      <p className="px-3 capitalize">{role.replace("_", " ")}</p>
      <div className="mt-2 flex gap-1">
        <Link href="/" target="_blank" className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-white/80 hover:bg-white/8">
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          View store
        </Link>
        <form action={signOutAction} className="flex-1">
          <button type="submit" className="h-9 w-full rounded-lg text-white/80 hover:bg-white/8">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="lg:pl-60">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col overflow-y-auto bg-ink lg:flex">
        <Link href="/admin/dashboard" className="px-6 py-5 text-lg font-extrabold text-white">
          AN<span className="text-[#F2C14E]">.</span> <span className="text-sm font-semibold text-white/60">Admin</span>
        </Link>
        {nav}
        {footer}
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-surface px-3 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg hover:bg-paper"
          aria-label="Open admin menu"
          aria-expanded={open}
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="font-extrabold">
          AN<span className="text-signal">.</span> Admin
        </span>
      </header>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Admin menu">
          <button type="button" className="absolute inset-0 bg-ink/50" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div onClick={closeOnLink} className="absolute inset-y-0 left-0 flex w-64 flex-col overflow-y-auto bg-ink">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="font-extrabold text-white">Admin</span>
              <button type="button" onClick={() => setOpen(false)} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-white hover:bg-white/10" aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            {nav}
            {footer}
          </div>
        </div>
      ) : null}

      <main className="mx-auto max-w-[1400px] px-4 py-6 md:px-6 lg:py-8">{children}</main>
    </div>
  );
}
