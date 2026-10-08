import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { AccountNav } from "@/components/store/account-nav";

export const metadata: Metadata = { title: "My account", robots: { index: false, follow: false } };

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("/account");
  return (
    <div className="container-page py-5 lg:py-8">
      <h1 className="text-2xl font-bold md:text-3xl">My account</h1>
      <p className="mt-1 text-sm text-ink-soft">{user.email}</p>
      <div className="mt-6 grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <AccountNav />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
