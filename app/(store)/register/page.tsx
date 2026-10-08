import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Create an account", robots: { index: false, follow: true } };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="container-page flex justify-center py-10">
      <div className="w-full max-w-md rounded-[var(--radius-card)] border border-line bg-surface p-6 sm:p-8">
        <h1 className="text-2xl font-bold">Create an account</h1>
        <p className="mt-1 text-sm text-ink-soft">You can also order without an account.</p>
        <div className="mt-6">
          <AuthForm mode="register" next={next} />
        </div>
      </div>
    </div>
  );
}
