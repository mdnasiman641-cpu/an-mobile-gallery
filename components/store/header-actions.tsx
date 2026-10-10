"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, GitCompareArrows, Menu, ShoppingBag, User, X } from "lucide-react";
import { useStore } from "@/components/providers";
import { OverlayPortal, useModalOverlay } from "@/components/ui/overlay";
import { cn } from "@/lib/utils";

export function CartLink({ className }: { className?: string }) {
  const { count, ready } = useStore();
  return (
    <Link
      href="/cart"
      className={cn(
        "relative inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] px-2.5 text-ink hover:bg-signal-tint lg:h-11 lg:bg-signal-tint lg:px-3.5 lg:text-signal lg:hover:bg-signal lg:hover:text-white",
        className,
      )}
      aria-label={ready && count > 0 ? `Cart, ${count} item${count === 1 ? "" : "s"}` : "Cart"}
    >
      <ShoppingBag className="h-[22px] w-[22px]" aria-hidden />
      <span className="hidden text-sm font-semibold lg:inline">Cart</span>
      {ready && count > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-deal px-1 text-[11px] font-bold text-white lg:static lg:ml-0.5">
          {count}
        </span>
      ) : null}
    </Link>
  );
}

export function CompareLink() {
  const { compare, ready } = useStore();
  return (
    <Link
      href="/compare"
      className="relative hidden h-10 items-center gap-2 rounded-[var(--radius-control)] px-2.5 text-ink hover:bg-paper hover:text-signal md:inline-flex lg:h-11"
    >
      <GitCompareArrows className="h-5 w-5" aria-hidden />
      <span className="hidden text-sm font-semibold lg:inline">Compare</span>
      {ready && compare.length > 0 ? (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-signal px-1 text-[11px] font-bold text-white">
          {compare.length}
        </span>
      ) : null}
    </Link>
  );
}

export function AccountLink() {
  return (
    <Link
      href="/account"
      className="hidden h-10 items-center gap-2 rounded-[var(--radius-control)] px-2.5 text-ink hover:bg-paper hover:text-signal md:inline-flex lg:h-11"
    >
      <User className="h-5 w-5" aria-hidden />
      <span className="hidden text-sm font-semibold lg:inline">Account</span>
    </Link>
  );
}

interface MenuCategory {
  name: string;
  slug: string;
  children: { name: string; slug: string }[];
}

export function MobileMenu({
  categories,
  brands,
  storeName,
  phone,
}: {
  categories: MenuCategory[];
  brands: { name: string; slug: string }[];
  storeName: string;
  phone: string | null;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useModalOverlay(open, close, dialogRef, { initialFocus: closeButtonRef });

  // close when any link inside the menu is followed (and on any route change, e.g. Back)
  const closeOnLink = (e: React.MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("a")) setOpen(false);
  };
  const pathname = usePathname();
  const [shownFor, setShownFor] = useState(pathname);
  if (shownFor !== pathname) {
    setShownFor(pathname);
    if (open) setOpen(false);
  }

  const link = "flex items-center justify-between rounded-lg px-3 py-2.5 text-[15px] font-medium text-ink hover:bg-paper";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] hover:bg-ink/5 lg:hidden"
        aria-label="Open menu"
        aria-expanded={open}
        aria-controls="mobile-menu"
      >
        <Menu className="h-6 w-6" />
      </button>

      {open ? (
        <OverlayPortal>
        {/* rendered in <body>: covers the whole screen above the header (z-40) and category bar */}
        <div
          ref={dialogRef}
          tabIndex={-1}
          className="fixed inset-0 z-[60] outline-none lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          id="mobile-menu"
        >
          {/* backdrop: tap to close (the visible close button is the accessible one) */}
          <button type="button" tabIndex={-1} aria-hidden="true" className="absolute inset-0 h-full w-full cursor-default bg-ink/45" onClick={() => setOpen(false)} />
          <nav
            onClick={closeOnLink}
            aria-label="Main menu"
            className="absolute inset-y-0 left-0 flex w-[86%] max-w-sm flex-col overflow-y-auto overscroll-contain bg-surface pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)] shadow-xl"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3">
              <span className="min-w-0 truncate font-extrabold tracking-tight text-ink">{storeName}</span>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg hover:bg-paper"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-2 py-3">
              <Link href="/offers" className={link}>
                Offers
                <ChevronRight className="h-4 w-4 text-ink-mute" aria-hidden />
              </Link>
              <Link href="/products?sort=newest" className={link}>
                New arrivals
                <ChevronRight className="h-4 w-4 text-ink-mute" aria-hidden />
              </Link>
              <Link href="/compare" className={link}>
                Compare
                <ChevronRight className="h-4 w-4 text-ink-mute" aria-hidden />
              </Link>
              <Link href="/account" className={link}>
                My account
                <ChevronRight className="h-4 w-4 text-ink-mute" aria-hidden />
              </Link>
            </div>

            <div className="border-t border-line px-2 py-3">
              <p className="px-3 pb-1 text-sm font-semibold text-ink-mute">Categories</p>
              {categories.map((c) => (
                <div key={c.slug}>
                  <Link href={`/categories/${c.slug}`} className={link}>
                    {c.name}
                  </Link>
                  {c.children.map((child) => (
                    <Link key={child.slug} href={`/categories/${child.slug}`} className={cn(link, "pl-7 text-ink-soft")}>
                      {child.name}
                    </Link>
                  ))}
                </div>
              ))}
            </div>

            <div className="border-t border-line px-2 py-3">
              <p className="px-3 pb-1 text-sm font-semibold text-ink-mute">Brands</p>
              <div className="grid grid-cols-2">
                {brands.map((b) => (
                  <Link key={b.slug} href={`/brands/${b.slug}`} className={link}>
                    {b.name}
                  </Link>
                ))}
              </div>
            </div>

            {phone ? (
              <div className="mt-auto border-t border-line p-4">
                <a href={`tel:${phone}`} className="block rounded-lg bg-signal px-4 py-3 text-center font-semibold text-white">
                  Call {phone}
                </a>
              </div>
            ) : null}
          </nav>
        </div>
        </OverlayPortal>
      ) : null}
    </>
  );
}
