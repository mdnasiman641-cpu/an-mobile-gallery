import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { getStaffSession } from "@/lib/auth";

export const metadata: Metadata = { title: "Admin sign in" };

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const session = await getStaffSession();
  if (session) redirect("/admin/dashboard");

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-[var(--radius-card)] border border-line bg-surface p-6 sm:p-8">
        <p className="text-xl font-extrabold">
          AN<span className="text-signal">.</span> <span className="text-base font-semibold text-ink-soft">Admin</span>
        </p>
        <h1 className="mt-4 text-lg font-bold">Sign in to manage the store</h1>
        {error === "not_staff" ? (
          <p className="mt-3 rounded-lg bg-warn-tint p-3 text-sm text-warn" role="alert">
            This account doesn&rsquo;t have admin access. Sign in with a staff account.
          </p>
        ) : null}
        <div className="mt-5">
          <AuthForm mode="login" next={next?.startsWith("/admin") ? next : "/admin/dashboard"} audience="admin" />
        </div>
      </div>
    </div>
  );
}
