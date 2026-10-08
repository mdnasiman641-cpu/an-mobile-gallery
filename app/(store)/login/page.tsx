import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: true } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="container-page flex justify-center py-10">
      <div className="w-full max-w-md rounded-[var(--radius-card)] border border-line bg-surface p-6 sm:p-8">
        <h1 className="text-2xl font-bold">Sign in</h1>
        <p className="mt-1 text-sm text-ink-soft">Track orders, save phones to your wishlist and review your purchases.</p>
        <div className="mt-6">
          <AuthForm mode="login" next={next} />
        </div>
      </div>
    </div>
  );
}
