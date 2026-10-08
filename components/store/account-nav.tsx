"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "@/app/(store)/account/actions";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/account", label: "Profile" },
  { href: "/account/orders", label: "Orders" },
  { href: "/account/wishlist", label: "Wishlist" },
  { href: "/account/reviews", label: "Reviews" },
];

export function AccountNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Account" className="no-scrollbar flex gap-1 overflow-x-auto lg:flex-col">
      {LINKS.map((l) => {
        const active = l.href === "/account" ? pathname === "/account" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-[var(--radius-control)] px-3 py-2.5 text-sm font-semibold",
              active ? "bg-ink text-white" : "text-ink-soft hover:bg-ink/5 hover:text-ink",
            )}
          >
            {l.label}
          </Link>
        );
      })}
      <form action={signOutAction} className="shrink-0 lg:mt-3 lg:border-t lg:border-line lg:pt-3">
        <button type="submit" className="w-full rounded-[var(--radius-control)] px-3 py-2.5 text-left text-sm font-semibold text-deal hover:bg-deal-tint">
          Sign out
        </button>
      </form>
    </nav>
  );
}
